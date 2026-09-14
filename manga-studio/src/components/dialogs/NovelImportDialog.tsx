"use client";

/**
 * Novel Import: paste (or paste-in) prose, parse it into a structured script
 * (characters/scenes/beats — see `agent/novelParser/schema.ts`), and walk
 * through the resulting planned pages one at a time.
 *
 * Deliberately reuses the existing single-page Manga Agent
 * (`runCreativeDirection`/`executeCreativeRun` in `agent-v3/run.ts`) as the
 * page executor instead of building a second one: each planned page is just
 * a plain-language prompt, generated exactly like a creator would type it,
 * handed to the same Creative Director the manual "ask the agent" flow
 * uses. This dialog's own job stops at producing good prompts in the right
 * order — see pagination.ts for why that split of responsibility mirrors
 * the Creative Director's own "LLM decides meaning, code decides structure."
 *
 * Not persisted: the parsed outline lives only in this component's state
 * for the current browser tab. Reloading loses in-progress (not yet
 * generated) pages — acceptable for a v1 that intentionally avoids a
 * project-document schema migration; already-generated pages are ordinary
 * pages in the project exactly like any other, and persist normally.
 */

import { useState } from "react";
import { executeCreativeRun, runCreativeDirection } from "@/agent-v3/run";
import type { RunV3Outcome } from "@/agent-v3/run";
import { groupSegmentsIntoChunks, splitIntoChapters, splitIntoSegments } from "@/agent/novelParser/segmentation";
import type { NovelFidelity } from "@/agent/novelParser/prompt";
import { planPages, type PlannedPage } from "@/agent/novelParser/pagination";
import type { NovelCharacter, NovelScene } from "@/agent/novelParser/schema";
import { useEditorStore } from "@/editor/store";
import { useUiStore } from "@/editor/uiStore";
import { CloseIcon, ICON_SIZE, ICON_STROKE } from "../ui/icons";

const MAX_PANELS_PER_PAGE = 4;
const SEGMENTS_PER_CHUNK = 3;

type Stage = "input" | "parsing" | "review";
type PageState = "planned" | "generating" | "done" | "error";

interface ChapterOutline {
  title: string;
  characters: NovelCharacter[];
  scenes: NovelScene[];
  pages: PlannedPage[];
}

export function NovelImportDialog() {
  const open = useUiStore((s) => s.novelImportOpen);
  const close = useUiStore((s) => s.closeNovelImport);

  const [text, setText] = useState("");
  const [titleHint, setTitleHint] = useState("");
  const [fidelity, setFidelity] = useState<NovelFidelity>("guided");
  const [stage, setStage] = useState<Stage>("input");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [chapters, setChapters] = useState<ChapterOutline[]>([]);
  const [pageStates, setPageStates] = useState<Record<string, PageState>>({});
  const [pageErrors, setPageErrors] = useState<Record<string, string>>({});
  const [parseError, setParseError] = useState<string | null>(null);

  if (!open) return null;

  const reset = () => {
    setText("");
    setStage("input");
    setChapters([]);
    setPageStates({});
    setPageErrors({});
    setParseError(null);
    setProgress(null);
  };

  const parse = async () => {
    if (!text.trim()) return;
    setStage("parsing");
    setParseError(null);
    const chapterDrafts = splitIntoChapters(text, titleHint || "Untitled");
    const outlines: ChapterOutline[] = [];

    // Segments-per-chunk, not the whole novel at once: each request stays a
    // reasonable size, a failed chunk is cheap to retry, and progress is
    // visible instead of one long silent wait.
    const totalChunks = chapterDrafts.reduce(
      (sum, ch) => sum + groupSegmentsIntoChunks(splitIntoSegments(ch.text), SEGMENTS_PER_CHUNK).length,
      0,
    );
    let doneChunks = 0;
    setProgress({ done: 0, total: totalChunks });

    try {
      for (const draft of chapterDrafts) {
        const chunks = groupSegmentsIntoChunks(splitIntoSegments(draft.text), SEGMENTS_PER_CHUNK);
        const characters: NovelCharacter[] = [];
        const scenes: NovelScene[] = [];
        for (const [index, chunk] of chunks.entries()) {
          const response = await fetch("/api/agent/parse-novel", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chunkLabel: `${index + 1}/${chunks.length}`,
              segments: chunk,
              fidelity,
              knownCharacterNames: characters.map((c) => c.primaryName),
            }),
          });
          const body = await response.json();
          if (!response.ok) throw new Error(body.error ?? `Chapter "${draft.title}" failed to parse`);
          for (const character of body.output.characters as NovelCharacter[]) {
            if (!characters.some((existing) => existing.primaryName === character.primaryName)) {
              characters.push(character);
            }
          }
          scenes.push(...(body.output.scenes as NovelScene[]));
          doneChunks += 1;
          setProgress({ done: doneChunks, total: totalChunks });
        }
        const pages = planPages(draft.title, scenes, MAX_PANELS_PER_PAGE);
        outlines.push({ title: draft.title, characters, scenes, pages });
      }
      setChapters(outlines);
      setPageStates(
        Object.fromEntries(outlines.flatMap((ch) => ch.pages.map((p) => [p.id, "planned" as PageState]))),
      );
      setStage("review");
    } catch (error) {
      setParseError(error instanceof Error ? error.message : "Novel parsing failed");
      setStage("input");
    }
  };

  const generatePage = async (page: PlannedPage) => {
    setPageStates((prev) => ({ ...prev, [page.id]: "generating" }));
    setPageErrors((prev) => {
      const next = { ...prev };
      delete next[page.id];
      return next;
    });
    try {
      const store = useEditorStore.getState();
      if (!store.doc) throw new Error("No open project");
      const created = store.dispatch({ type: "add-page" });
      if (!created.createdId) throw new Error("Could not create a page for this panel");
      store.setCurrentPage(created.createdId);

      const outcome: RunV3Outcome = await runCreativeDirection(page.prompt);
      if (outcome.kind === "blocked") throw new Error(outcome.reason);
      if (outcome.kind === "clarify") throw new Error(`The director needs a clearer prompt: ${outcome.question}`);
      // A walkthrough of many pages should not stop for a manual "3+ images,
      // are you sure?" click per page — the creator already consented by
      // choosing to generate this planned page.
      const result = await executeCreativeRun(outcome, () => {});
      if (result.execution.rolledBack || result.status === "failed") {
        throw new Error(result.execution.abortReason ?? "Generation failed — the page was left unchanged.");
      }
      setPageStates((prev) => ({ ...prev, [page.id]: "done" }));
    } catch (error) {
      setPageStates((prev) => ({ ...prev, [page.id]: "error" }));
      setPageErrors((prev) => ({ ...prev, [page.id]: error instanceof Error ? error.message : "Generation failed" }));
    }
  };

  const generateRemaining = async () => {
    for (const chapter of chapters) {
      for (const page of chapter.pages) {
        if (pageStates[page.id] === "done") continue;
        await generatePage(page);
      }
    }
  };

  const totalPages = chapters.reduce((sum, ch) => sum + ch.pages.length, 0);
  const donePages = Object.values(pageStates).filter((s) => s === "done").length;

  return (
    <div className="fixed inset-0 z-40 grid place-items-center overflow-y-auto bg-black/60 py-6" onMouseDown={close}>
      <div
        className="flex max-h-[92vh] w-[680px] flex-col overflow-hidden rounded-lg bg-[var(--bg-elevated)] text-sm shadow-2xl shadow-black/50"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] p-4 pb-3">
          <h2 className="font-semibold text-zinc-100">Novel Import</h2>
          <button
            aria-label="Close Novel Import"
            className="inline-flex h-7 w-7 items-center justify-center rounded text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            onClick={close}
          >
            <CloseIcon size={ICON_SIZE} strokeWidth={ICON_STROKE} />
          </button>
        </div>

        {stage === "input" && (
          <div className="flex-1 overflow-y-auto p-4">
            <p className="mb-3 text-xs leading-5 text-zinc-500">
              Paste a chapter (or a whole novel — it splits on detected chapter headings). The AI structures it into
              scenes and beats first, then a deterministic pass plans pages; you generate each page the same way you
              always do, one at a time.
            </p>
            <label className="mb-2 block">
              <span className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">
                Title (used if no chapter heading is found)
              </span>
              <input
                className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-app)] px-2 py-1.5"
                value={titleHint}
                onChange={(e) => setTitleHint(e.target.value)}
                placeholder="Untitled"
              />
            </label>
            <label className="mb-2 block">
              <span className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">Source text</span>
              <textarea
                className="h-64 w-full resize-y rounded-md border border-[var(--border-subtle)] bg-[var(--bg-app)] px-2 py-1.5 font-mono text-xs"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Paste your novel or chapter text here…"
              />
            </label>
            <label className="mb-3 block">
              <span className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">Adaptation fidelity</span>
              <select
                className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-app)] px-2 py-1.5"
                value={fidelity}
                onChange={(e) => setFidelity(e.target.value as NovelFidelity)}
              >
                <option value="faithful">Faithful — structure only what the text explicitly states</option>
                <option value="guided">Guided — fill in visual detail a panel needs, invent no plot (recommended)</option>
                <option value="creative">Creative — actively supply action/transitions where the prose is sparse</option>
              </select>
            </label>
            {parseError && <p className="mb-2 text-xs text-red-400">{parseError}</p>}
            <button
              className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs text-white hover:bg-[var(--accent-hover)] disabled:opacity-40"
              onClick={parse}
              disabled={!text.trim()}
            >
              Parse into script
            </button>
          </div>
        )}

        {stage === "parsing" && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
            <p className="text-sm text-zinc-300">Structuring your text into scenes and beats…</p>
            {progress && (
              <>
                <div className="h-1.5 w-64 overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className="h-full bg-[var(--accent)] transition-all"
                    style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
                  />
                </div>
                <p className="text-xs text-zinc-500">
                  {progress.done}/{progress.total} chunk(s)
                </p>
              </>
            )}
          </div>
        )}

        {stage === "review" && (
          <>
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-2">
              <p className="text-xs text-zinc-500">
                {chapters.length} chapter(s), {totalPages} planned page(s) — {donePages} generated
              </p>
              <div className="flex gap-2">
                <button className="text-xs text-zinc-500 hover:text-zinc-300" onClick={reset}>
                  Start over
                </button>
                <button
                  className="rounded bg-[var(--accent)] px-2.5 py-1 text-xs text-white hover:bg-[var(--accent-hover)] disabled:opacity-40"
                  onClick={generateRemaining}
                  disabled={donePages >= totalPages}
                >
                  Generate all remaining
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              {chapters.map((chapter) => (
                <div key={chapter.title} className="mb-4">
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    {chapter.title}
                  </h3>
                  <p className="mb-2 text-[11px] text-zinc-600">
                    {chapter.characters.length > 0 &&
                      `Characters: ${chapter.characters.map((c) => c.primaryName).join(", ")}`}
                  </p>
                  <div className="flex flex-col gap-2">
                    {chapter.pages.map((page, index) => (
                      <PlannedPageRow
                        key={page.id}
                        index={index + 1}
                        page={page}
                        state={pageStates[page.id] ?? "planned"}
                        error={pageErrors[page.id]}
                        onGenerate={() => generatePage(page)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PlannedPageRow({
  index,
  page,
  state,
  error,
  onGenerate,
}: {
  index: number;
  page: PlannedPage;
  state: PageState;
  error?: string;
  onGenerate: () => void;
}) {
  const badge: Record<PageState, { label: string; color: string }> = {
    planned: { label: "Planned", color: "var(--text-muted)" },
    generating: { label: "Generating…", color: "var(--accent)" },
    done: { label: "Generated", color: "var(--success)" },
    error: { label: "Failed", color: "#f87171" },
  };
  return (
    <div className="rounded-md border border-zinc-800 p-2.5">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-medium text-zinc-300">
          Page {index} — {page.sceneLocation || "unspecified setting"}
        </span>
        <span className="text-[10px]" style={{ color: badge[state].color }}>
          {badge[state].label}
        </span>
      </div>
      <pre className="mb-2 max-h-28 overflow-auto whitespace-pre-wrap rounded bg-[var(--bg-app)] p-2 font-mono text-[11px] leading-4 text-zinc-400">
        {page.prompt}
      </pre>
      {error && <p className="mb-2 text-[11px] text-red-400">{error}</p>}
      <button
        className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-[11px] hover:bg-zinc-700 disabled:opacity-40"
        onClick={onGenerate}
        disabled={state === "generating"}
      >
        {state === "done" ? "Regenerate as a new page" : state === "generating" ? "Generating…" : "Generate this page"}
      </button>
    </div>
  );
}
