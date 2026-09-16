"use client";

/**
 * Translate Project: send an already-lettered project's dialogue into
 * another language, producing a NEW, separate project — the master
 * (source-language) project is never touched. See
 * `services/translateProject.ts`'s docstring for the full reasoning
 * (why a copy, not an in-place rewrite; why height auto-refits per
 * bubble; why this doesn't try to translate SFX baked into images).
 */

import { useState } from "react";
import { chaptersInOrder } from "@/domain/chapterOps";
import { LANGUAGE_NAME_PRESETS } from "@/domain/languagePresets";
import { useEditorStore } from "@/editor/store";
import { useProjectsStore } from "@/editor/projectsStore";
import { useUiStore } from "@/editor/uiStore";
import { translateProject, type TranslateProgress } from "@/services/translateProject";
import { CloseIcon, ICON_SIZE, ICON_STROKE, TranslateIcon } from "../ui/icons";

export function TranslateProjectDialog() {
  const open = useUiStore((s) => s.translateProjectOpen);
  const close = useUiStore((s) => s.closeTranslateProject);
  const doc = useEditorStore((s) => s.doc);
  const currentPageId = useEditorStore((s) => s.currentPageId);

  const [targetLanguage, setTargetLanguage] = useState("");
  const [busyScope, setBusyScope] = useState<string | null>(null);
  const [progress, setProgress] = useState<TranslateProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ translatedCount: number; skippedCount: number; projectName: string } | null>(null);

  if (!open || !doc) return null;

  const { chapters } = chaptersInOrder(doc);

  const run = async (scopeKey: string, pageIds: string[] | undefined, scopeLabel: string) => {
    const trimmed = targetLanguage.trim();
    if (!trimmed) {
      setError("Enter a target language first.");
      return;
    }
    setBusyScope(scopeKey);
    setError(null);
    setResult(null);
    setProgress(null);
    try {
      const { newDoc, translatedCount, skippedCount } = await translateProject(doc, { targetLanguage: trimmed, pageIds }, setProgress);
      const projectName = `${doc.project.name} (${trimmed})`;
      const renamed = { ...newDoc, project: { ...newDoc.project, name: projectName } };
      const newId = await useProjectsStore.getState().importDocument(renamed);
      await useProjectsStore.getState().openProject(newId);
      setResult({ translatedCount, skippedCount, projectName });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `Translating ${scopeLabel} failed`);
    } finally {
      setBusyScope(null);
      setProgress(null);
    }
  };

  return (
    <div className="fixed inset-0 z-40 grid place-items-center overflow-y-auto bg-black/60 py-6" onMouseDown={close}>
      <div
        className="flex max-h-[85vh] w-[480px] flex-col overflow-hidden rounded-lg bg-[var(--bg-elevated)] text-sm shadow-2xl shadow-black/50"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] p-4 pb-3">
          <h2 className="flex items-center gap-2 font-semibold text-zinc-100">
            <TranslateIcon size={ICON_SIZE} strokeWidth={ICON_STROKE} />
            Translate Project
          </h2>
          <button
            aria-label="Close Translate Project"
            className="inline-flex h-7 w-7 items-center justify-center rounded text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            onClick={close}
          >
            <CloseIcon size={ICON_SIZE} strokeWidth={ICON_STROKE} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <p className="mb-3 text-[11px] leading-4 text-zinc-500">
            Translates every bubble&apos;s dialogue with AI and creates a NEW project with the result — your current
            project keeps its original text untouched.
          </p>

          <label className="mb-3 block">
            <span className="mb-1 block text-[11px] text-zinc-500">Target language</span>
            <input
              aria-label="Target language"
              list="translate-language-options"
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-[12px] text-zinc-200"
              value={targetLanguage}
              onChange={(e) => setTargetLanguage(e.target.value)}
              placeholder="English"
            />
            <datalist id="translate-language-options">
              {LANGUAGE_NAME_PRESETS.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </label>

          {error && <p className="mb-3 text-[11px] text-red-400">{error}</p>}
          {busyScope && (
            <p className="mb-3 text-[11px] text-zinc-400">
              Translating… {progress ? `batch ${progress.done}/${progress.total}` : "preparing"}
            </p>
          )}
          {result && (
            <p className="mb-3 rounded border border-emerald-800/50 bg-emerald-950/30 p-2 text-[11px] text-emerald-300">
              Done — created &ldquo;{result.projectName}&rdquo; with {result.translatedCount} line
              {result.translatedCount === 1 ? "" : "s"} translated
              {result.skippedCount > 0 ? ` (${result.skippedCount} kept their original text)` : ""}.
            </p>
          )}

          <div className="border-t border-[var(--border-subtle)] pt-3">
            <button
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-[12px] text-zinc-200 hover:bg-zinc-700 disabled:opacity-40"
              disabled={busyScope !== null || !currentPageId}
              onClick={() => void run("current-page", [currentPageId!], "the current page")}
            >
              {busyScope === "current-page" ? "Translating…" : "Translate current page"}
            </button>
            <button
              className="mt-2 w-full rounded bg-[var(--accent)] px-3 py-1.5 text-[12px] text-white hover:bg-[var(--accent-hover)] disabled:opacity-40"
              disabled={busyScope !== null}
              onClick={() => void run("whole-project", undefined, "the whole project")}
            >
              {busyScope === "whole-project" ? "Translating…" : "Translate whole project"}
            </button>

            {chapters.length > 0 && (
              <div className="mt-3">
                <p className="mb-1.5 text-[10px] uppercase tracking-wider text-zinc-500">Or translate one chapter</p>
                <div className="flex flex-col gap-1.5">
                  {chapters.map(({ chapter, pageIds }) => (
                    <button
                      key={chapter.id}
                      className="rounded border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-left text-[11px] text-zinc-300 hover:bg-zinc-700 disabled:opacity-40"
                      disabled={busyScope !== null}
                      onClick={() => void run(`chapter-${chapter.id}`, pageIds, chapter.name)}
                    >
                      {busyScope === `chapter-${chapter.id}` ? "Translating…" : chapter.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
