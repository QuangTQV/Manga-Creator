"use client";

/**
 * Novel Import: paste (or paste-in) prose, parse it into a structured script
 * (characters/scenes/beats — see `agent/novelParser/schema.ts`), review and
 * fix up the character list, then walk through the resulting planned pages
 * one at a time.
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
 * Persisted per project (`storage/novelOutlineStore.ts`, separate from the
 * project document itself — see that module's docstring for why): closing
 * the dialog or reloading the page restores wherever you left off. Only the
 * scratch outline is stored there; once a page is generated it is an
 * ordinary project page like any other and persists through the normal
 * project-save path.
 */

import { useEffect, useState } from "react";
import { executeCreativeRun, runCreativeDirection } from "@/agent-v3/run";
import type { RunV3Outcome } from "@/agent-v3/run";
import { groupSegmentsIntoChunks, splitIntoChapters, splitIntoSegments } from "@/agent/novelParser/segmentation";
import type { NovelFidelity } from "@/agent/novelParser/prompt";
import { MAX_SUPPORTED_PANELS_PER_PAGE, planPages, type PanelBudget, type PlannedPage } from "@/agent/novelParser/pagination";
import type { NovelCharacter, NovelScene } from "@/agent/novelParser/schema";
import { dedupeCharacters, mergeCharacterEntries, redirectCharacterName } from "@/agent/novelParser/characterEdits";
import type { LayoutPresetId } from "@/domain/types";
import { useEditorStore } from "@/editor/store";
import { useUiStore } from "@/editor/uiStore";
import {
  clearNovelOutline,
  loadNovelOutline,
  saveNovelOutline,
  type StoredChapterOutline,
  type NovelOutlinePageState as PageState,
} from "@/storage/novelOutlineStore";
import { CloseIcon, ICON_SIZE, ICON_STROKE } from "../ui/icons";

const SEGMENTS_PER_CHUNK = 3;
/** Kumanga's page layouts, indexed by how many panels they hold (1-based).
 * Picking the layout that actually matches a planned page's panel count
 * instead of always creating a fixed-size page — see pagination.ts's
 * `panelCount` on `PlannedPage`. */
const LAYOUT_BY_PANEL_COUNT: Record<number, LayoutPresetId> = {
  1: "single",
  2: "two-vertical",
  3: "three-vertical",
  4: "four-grid",
};

function layoutForPanelCount(panelCount: number): LayoutPresetId {
  return LAYOUT_BY_PANEL_COUNT[panelCount] ?? "four-grid";
}

function parsePanelBudget(value: string): PanelBudget {
  return value === "auto" ? "auto" : Number(value);
}

type Stage = "input" | "parsing" | "characters" | "review";
type ChapterOutline = StoredChapterOutline;

function currentProjectId(): string | null {
  return useEditorStore.getState().doc?.project.id ?? null;
}

export function NovelImportDialog() {
  const open = useUiStore((s) => s.novelImportOpen);
  const close = useUiStore((s) => s.closeNovelImport);

  const [text, setText] = useState("");
  const [titleHint, setTitleHint] = useState("");
  const [fidelity, setFidelity] = useState<NovelFidelity>("guided");
  const [panelsPerPage, setPanelsPerPage] = useState<PanelBudget>("auto");
  const [stage, setStage] = useState<Stage>("input");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [chapters, setChapters] = useState<ChapterOutline[]>([]);
  const [pageStates, setPageStates] = useState<Record<string, PageState>>({});
  // Planned-page id -> the real project page it was generated onto, so
  // regenerating overwrites that same page instead of leaving it behind.
  const [generatedPageIds, setGeneratedPageIds] = useState<Record<string, string>>({});
  const [pageErrors, setPageErrors] = useState<Record<string, string>>({});
  const [parseError, setParseError] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);

  // Restore a previously in-progress outline for this project, once, the
  // first time the dialog opens. A project with no saved outline yet just
  // starts at "input" as before.
  useEffect(() => {
    if (!open || restored) return;
    setRestored(true);
    const projectId = currentProjectId();
    if (!projectId) return;
    loadNovelOutline(projectId).then((stored) => {
      if (!stored || stored.chapters.length === 0) return;
      setFidelity(stored.fidelity);
      setPanelsPerPage(stored.panelsPerPage);
      setChapters(stored.chapters);
      setPageStates(stored.pageStates);
      setGeneratedPageIds(stored.generatedPageIds ?? {});
      setStage(stored.chapters.some((ch) => ch.pages.length > 0) ? "review" : "characters");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const persist = (
    nextChapters: ChapterOutline[],
    nextPageStates: Record<string, PageState>,
    nextGeneratedPageIds: Record<string, string> = generatedPageIds,
  ) => {
    const projectId = currentProjectId();
    if (!projectId) return;
    void saveNovelOutline({
      projectId,
      fidelity,
      panelsPerPage,
      chapters: nextChapters,
      pageStates: nextPageStates,
      generatedPageIds: nextGeneratedPageIds,
      savedAt: new Date().toISOString(),
    });
  };

  const reset = () => {
    const projectId = currentProjectId();
    if (projectId) void clearNovelOutline(projectId);
    setText("");
    setStage("input");
    setChapters([]);
    setPageStates({});
    setGeneratedPageIds({});
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
        // Pages are planned once the creator has reviewed/fixed up
        // characters below — an empty array here just means "not planned
        // yet", not "this chapter has no content".
        outlines.push({ title: draft.title, characters, scenes, pages: [] });
      }
      setChapters(outlines);
      setPageStates({});
      setStage("characters");
      persist(outlines, {});
    } catch (error) {
      setParseError(error instanceof Error ? error.message : "Novel parsing failed");
      setStage("input");
    }
  };

  /**
   * Redirects every reference to `from` onto `to`, across every chapter —
   * rename (the model's name was wrong) and merge (two entries turned out
   * to be the same person) are the same operation; see characterEdits.ts.
   */
  const applyCharacterRename = (from: string, to: string) => {
    const trimmed = to.trim();
    if (!trimmed || trimmed === from) return;
    const nextChapters = chapters.map((chapter) => ({
      ...chapter,
      scenes: redirectCharacterName(chapter.scenes, from, trimmed),
      characters: mergeCharacterEntries(chapter.characters, from, trimmed),
    }));
    setChapters(nextChapters);
    persist(nextChapters, pageStates);
  };

  const proceedToPages = () => {
    const nextChapters = chapters.map((chapter) => ({
      ...chapter,
      pages: planPages(chapter.title, chapter.scenes, panelsPerPage),
    }));
    setChapters(nextChapters);
    const nextPageStates = Object.fromEntries(
      nextChapters.flatMap((ch) => ch.pages.map((p) => [p.id, "planned" as PageState])),
    );
    setPageStates(nextPageStates);
    setStage("review");
    persist(nextChapters, nextPageStates);
  };

  /**
   * Re-groups already-parsed scenes into pages with a new panel budget —
   * `planPages` is a pure function with no model call, so this is instant
   * and free, unlike re-running the parse. Any page already generated keeps
   * its "done" status by id only if an id happens to still exist after
   * re-planning (ids are positional), so re-planning after generating some
   * pages is only safe before you've generated anything you want to keep —
   * the button is disabled once any page is done, to avoid that confusion.
   */
  const replan = (nextPanelsPerPage: PanelBudget) => {
    setPanelsPerPage(nextPanelsPerPage);
    const nextChapters = chapters.map((chapter) => ({
      ...chapter,
      pages: planPages(chapter.title, chapter.scenes, nextPanelsPerPage),
    }));
    setChapters(nextChapters);
    const nextPageStates = Object.fromEntries(
      nextChapters.flatMap((ch) => ch.pages.map((p) => [p.id, "planned" as PageState])),
    );
    setPageStates(nextPageStates);
    setPageErrors({});
    // Re-planned pages get fresh positional ids, so any earlier mapping to
    // real project pages no longer corresponds to anything (replan is
    // disabled once a page is generated, so this is normally already empty).
    setGeneratedPageIds({});
    persist(nextChapters, nextPageStates, {});
  };

  /** Edits a planned page's prompt text before (or between) generations — a
   * pure local edit, no re-parsing, no AI call. */
  const updatePagePrompt = (pageId: string, prompt: string) => {
    const nextChapters = chapters.map((chapter) => ({
      ...chapter,
      pages: chapter.pages.map((page) => (page.id === pageId ? { ...page, prompt } : page)),
    }));
    setChapters(nextChapters);
    persist(nextChapters, pageStates);
  };

  const generatePage = async (page: PlannedPage) => {
    setPageStates((prev) => {
      const next = { ...prev, [page.id]: "generating" as PageState };
      persist(chapters, next);
      return next;
    });
    setPageErrors((prev) => {
      const next = { ...prev };
      delete next[page.id];
      return next;
    });
    try {
      const store = useEditorStore.getState();
      if (!store.doc) throw new Error("No open project");
      const layout = layoutForPanelCount(page.panelCount);
      // Regenerating an already-generated page overwrites that same project
      // page in place (same id/position) instead of leaving the old one
      // behind — see resetPageLayout's docstring for why that's a real wipe,
      // not the content-preserving reshape `set-page-layout` does elsewhere.
      const existingPageId = generatedPageIds[page.id];
      let targetPageId: string;
      if (existingPageId && store.doc.pages[existingPageId]) {
        store.dispatch({ type: "reset-page-layout", pageId: existingPageId, layout });
        targetPageId = existingPageId;
      } else {
        const created = store.dispatch({ type: "add-page", layout });
        if (!created.createdId) throw new Error("Could not create a page for this panel");
        targetPageId = created.createdId;
      }
      store.setCurrentPage(targetPageId);

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
      setGeneratedPageIds((prevIds) => {
        const nextIds = { ...prevIds, [page.id]: targetPageId };
        setPageStates((prev) => {
          const next = { ...prev, [page.id]: "done" as PageState };
          persist(chapters, next, nextIds);
          return next;
        });
        return nextIds;
      });
    } catch (error) {
      setPageStates((prev) => {
        const next = { ...prev, [page.id]: "error" as PageState };
        persist(chapters, next);
        return next;
      });
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
  const allCharacters = dedupeCharacters(chapters.flatMap((ch) => ch.characters));

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
            <label className="mb-3 block">
              <span className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">Panels per page</span>
              <select
                className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-app)] px-2 py-1.5"
                value={panelsPerPage}
                onChange={(e) => setPanelsPerPage(parsePanelBudget(e.target.value))}
              >
                <option value="auto">Auto — let a dramatic beat take a whole page, pack quiet beats together (recommended)</option>
                {Array.from({ length: MAX_SUPPORTED_PANELS_PER_PAGE }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    Fixed: {n} panel{n > 1 ? "s" : ""} per page
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[10px] leading-4 text-zinc-600">
                Auto paces pages by each beat&apos;s importance (from the AI parse), not just a panel count. A
                page-turn cliffhanger beat always ends its page early either way. You can change this and re-plan
                for free after parsing, before generating any pages.
              </p>
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

        {stage === "characters" && (
          <>
            <div className="border-b border-[var(--border-subtle)] px-4 py-2">
              <p className="text-xs text-zinc-500">
                {allCharacters.length} character(s) found across {chapters.length} chapter(s). Fix a misspelled or
                drifted name below — renaming here also merges it with an existing name if you type one that
                already exists.
              </p>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {allCharacters.length === 0 ? (
                <p className="text-xs text-zinc-500">No characters were detected in this text.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {allCharacters.map((character) => (
                    <div key={character.primaryName} className="rounded-md border border-zinc-800 p-2.5">
                      <input
                        className="mb-1 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-app)] px-2 py-1 text-xs font-medium text-zinc-200"
                        defaultValue={character.primaryName}
                        onBlur={(e) => applyCharacterRename(character.primaryName, e.target.value)}
                      />
                      {character.aliases.length > 0 && (
                        <p className="mb-1 text-[11px] text-zinc-500">Also called: {character.aliases.join(", ")}</p>
                      )}
                      {character.description && <p className="text-[11px] text-zinc-600">{character.description}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center justify-between border-t border-[var(--border-subtle)] px-4 py-3">
              <button className="text-xs text-zinc-500 hover:text-zinc-300" onClick={reset}>
                Start over
              </button>
              <button
                className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs text-white hover:bg-[var(--accent-hover)]"
                onClick={proceedToPages}
              >
                Continue to page planning
              </button>
            </div>
          </>
        )}

        {stage === "review" && (
          <>
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-2">
              <p className="text-xs text-zinc-500">
                {chapters.length} chapter(s), {totalPages} planned page(s) — {donePages} generated
              </p>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs text-zinc-500">
                  Panels/page
                  <select
                    className="rounded border border-[var(--border-subtle)] bg-[var(--bg-app)] px-1.5 py-1 text-xs"
                    value={panelsPerPage}
                    onChange={(e) => replan(parsePanelBudget(e.target.value))}
                    disabled={donePages > 0}
                    title={
                      donePages > 0
                        ? "Re-planning is disabled once a page has been generated"
                        : "Re-plans every page for free — no AI call needed"
                    }
                  >
                    <option value="auto">Auto</option>
                    {Array.from({ length: MAX_SUPPORTED_PANELS_PER_PAGE }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="text-xs text-zinc-500 hover:text-zinc-300 disabled:opacity-40"
                  onClick={() => setStage("characters")}
                  disabled={donePages > 0}
                  title={
                    donePages > 0
                      ? "Disabled once a page has been generated — renaming a character would no longer match it"
                      : "Rename or merge characters, then re-plan pages"
                  }
                >
                  Back to characters
                </button>
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
                        onPromptChange={(prompt) => updatePagePrompt(page.id, prompt)}
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
  onPromptChange,
}: {
  index: number;
  page: PlannedPage;
  state: PageState;
  error?: string;
  onGenerate: () => void;
  onPromptChange: (prompt: string) => void;
}) {
  const badge: Record<PageState, { label: string; color: string }> = {
    planned: { label: "Planned", color: "var(--text-muted)" },
    generating: { label: "Generating…", color: "var(--accent)" },
    done: { label: "Generated", color: "var(--success)" },
    error: { label: "Failed", color: "#f87171" },
  };
  const busy = state === "generating";
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
      <textarea
        className="mb-2 max-h-40 min-h-28 w-full resize-y overflow-auto whitespace-pre-wrap rounded border border-transparent bg-[var(--bg-app)] p-2 font-mono text-[11px] leading-4 text-zinc-400 hover:border-zinc-700 focus:border-[var(--accent)] focus:outline-none disabled:opacity-60"
        value={page.prompt}
        onChange={(e) => onPromptChange(e.target.value)}
        disabled={busy}
        aria-label={`Prompt for page ${index}`}
        title={
          state === "done"
            ? "Editing this and regenerating replaces what's on the page now"
            : "Edit the prompt the agent will receive before generating"
        }
      />
      {error && <p className="mb-2 text-[11px] text-red-400">{error}</p>}
      <button
        className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-[11px] hover:bg-zinc-700 disabled:opacity-40"
        onClick={onGenerate}
        disabled={busy}
        title={state === "done" ? "Replaces the current content of this page" : undefined}
      >
        {state === "done" ? "Regenerate this page" : busy ? "Generating…" : "Generate this page"}
      </button>
    </div>
  );
}
