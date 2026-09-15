"use client";

/**
 * Chapters: organize pages into named, orderable sections, and export any
 * one on its own (CBZ or webtoon strip) instead of the whole book.
 *
 * A chapter is a BOUNDARY, not a tag on every page — see `Chapter`'s own
 * docstring in `domain/types.ts` and the derivation in
 * `domain/chapterOps.ts`'s `chaptersInOrder`. This dialog is a thin view
 * over that: every control here dispatches one of the `*-chapter` domain
 * commands and reads the result back through `chaptersInOrder`, same as
 * any other editor surface.
 */

import { useState } from "react";
import { chaptersInOrder } from "@/domain/chapterOps";
import { useEditorStore } from "@/editor/store";
import { useUiStore } from "@/editor/uiStore";
import { exportBookCbz } from "@/export/exportBook";
import { exportWebtoonStrip } from "@/export/exportWebtoon";
import { CloseIcon, ChaptersIcon, ICON_SIZE, ICON_STROKE } from "../ui/icons";

export function ChaptersDialog() {
  const open = useUiStore((s) => s.chaptersOpen);
  const close = useUiStore((s) => s.closeChapters);
  const doc = useEditorStore((s) => s.doc);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newChapterPageId, setNewChapterPageId] = useState("");
  const [newChapterName, setNewChapterName] = useState("");

  if (!open || !doc) return null;

  const pages = Object.values(doc.pages).sort((a, b) => a.index - b.index);
  const { chapters, unassignedPageIds } = chaptersInOrder(doc);
  const usedStartIds = new Set(Object.values(doc.chapters).map((c) => c.startPageId));
  const pageName = (id: string) => doc.pages[id]?.name ?? "?";

  const run = async (label: string, action: () => unknown) => {
    setBusy(label);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  };

  const rangeLabel = (pageIds: string[]) =>
    pageIds.length === 1 ? pageName(pageIds[0]) : `${pageName(pageIds[0])} – ${pageName(pageIds[pageIds.length - 1])} (${pageIds.length} pages)`;

  return (
    <div className="fixed inset-0 z-40 grid place-items-center overflow-y-auto bg-black/60 py-6" onMouseDown={close}>
      <div
        className="flex max-h-[80vh] w-[560px] flex-col overflow-hidden rounded-lg bg-[var(--bg-elevated)] text-sm shadow-2xl shadow-black/50"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] p-4 pb-3">
          <h2 className="flex items-center gap-2 font-semibold text-zinc-100">
            <ChaptersIcon size={ICON_SIZE} strokeWidth={ICON_STROKE} />
            Chapters
          </h2>
          <button
            aria-label="Close Chapters"
            className="inline-flex h-7 w-7 items-center justify-center rounded text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            onClick={close}
          >
            <CloseIcon size={ICON_SIZE} strokeWidth={ICON_STROKE} />
          </button>
        </div>

        {error && <p className="border-b border-[var(--border-subtle)] px-4 py-2 text-[11px] text-red-400">{error}</p>}

        <div className="flex-1 overflow-y-auto p-3">
          {unassignedPageIds.length > 0 && (
            <div className="mb-3 rounded-md border border-dashed border-zinc-700 p-2.5">
              <p className="text-[11px] text-zinc-500">
                {chapters.length > 0 ? "Before the first chapter: " : "No chapters yet — "}
                {rangeLabel(unassignedPageIds)}
              </p>
              {chapters.length > 0 && (
                <button
                  className="mt-1.5 text-[10px] text-zinc-500 underline hover:text-zinc-300"
                  disabled={busy !== null}
                  onClick={() =>
                    void run("export-unassigned", () =>
                      exportBookCbz(2, undefined, { pageIds: unassignedPageIds, label: "prologue" }),
                    )
                  }
                >
                  Export as CBZ
                </button>
              )}
            </div>
          )}

          {chapters.map(({ chapter, pageIds }) => (
            <div key={chapter.id} className="mb-2 rounded-md border border-zinc-800 p-2.5">
              <div className="mb-1.5 flex items-center gap-2">
                <input
                  key={chapter.name}
                  aria-label={`Chapter name for ${chapter.name}`}
                  className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 font-medium text-zinc-200 hover:border-zinc-700 focus:border-[var(--accent)] focus:bg-[var(--bg-app)] focus:outline-none"
                  defaultValue={chapter.name}
                  onBlur={(e) => {
                    const trimmed = e.target.value.trim();
                    if (!trimmed || trimmed === chapter.name) {
                      e.target.value = chapter.name;
                      return;
                    }
                    void run(`rename-${chapter.id}`, () =>
                      useEditorStore.getState().dispatch({ type: "rename-chapter", chapterId: chapter.id, name: trimmed }),
                    );
                  }}
                />
                <button
                  className="rounded px-1.5 py-0.5 text-[10px] text-zinc-500 hover:bg-red-950/40 hover:text-red-300"
                  disabled={busy !== null}
                  onClick={() => void run(`remove-${chapter.id}`, () => useEditorStore.getState().dispatch({ type: "remove-chapter", chapterId: chapter.id }))}
                >
                  Delete
                </button>
              </div>
              <p className="mb-1.5 text-[11px] text-zinc-500">{rangeLabel(pageIds)}</p>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1 text-[10px] text-zinc-500">
                  Starts at
                  <select
                    className="rounded border border-zinc-700 bg-zinc-800 px-1 py-0.5 text-[11px] text-zinc-300"
                    value={chapter.startPageId}
                    disabled={busy !== null}
                    onChange={(e) =>
                      void run(`move-${chapter.id}`, () =>
                        useEditorStore
                          .getState()
                          .dispatch({ type: "move-chapter-start", chapterId: chapter.id, toPageId: e.target.value }),
                      )
                    }
                  >
                    {pages
                      .filter((p) => p.id === chapter.startPageId || !usedStartIds.has(p.id))
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                </label>
                <button
                  className="rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[10px] hover:bg-zinc-700 disabled:opacity-40"
                  disabled={busy !== null}
                  onClick={() =>
                    void run(`export-cbz-${chapter.id}`, () => exportBookCbz(2, undefined, { pageIds, label: chapter.name }))
                  }
                >
                  Export CBZ
                </button>
                <button
                  className="rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[10px] hover:bg-zinc-700 disabled:opacity-40"
                  disabled={busy !== null}
                  onClick={() =>
                    void run(`export-webtoon-${chapter.id}`, () =>
                      exportWebtoonStrip(2, undefined, { pageIds, label: chapter.name }),
                    )
                  }
                >
                  Export Webtoon
                </button>
              </div>
            </div>
          ))}

          <div className="mt-3 rounded-md border border-dashed border-zinc-700 p-2.5">
            <p className="mb-1.5 text-[10px] uppercase tracking-wider text-zinc-500">New chapter</p>
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="New chapter start page"
                className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-1 text-[11px] text-zinc-300"
                value={newChapterPageId}
                onChange={(e) => setNewChapterPageId(e.target.value)}
              >
                <option value="">Starts at…</option>
                {pages
                  .filter((p) => !usedStartIds.has(p.id))
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
              <input
                className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-800 px-1.5 py-1 text-[11px] text-zinc-300"
                placeholder="Chapter name"
                value={newChapterName}
                onChange={(e) => setNewChapterName(e.target.value)}
              />
              <button
                className="rounded bg-[var(--accent)] px-2.5 py-1 text-[10px] text-white hover:bg-[var(--accent-hover)] disabled:opacity-40"
                disabled={!newChapterPageId || busy !== null}
                onClick={() =>
                  void run("add", async () => {
                    useEditorStore.getState().dispatch({ type: "add-chapter", startPageId: newChapterPageId, name: newChapterName });
                    setNewChapterPageId("");
                    setNewChapterName("");
                  })
                }
              >
                Add
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
