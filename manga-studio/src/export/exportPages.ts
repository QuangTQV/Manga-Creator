"use client";

/**
 * Shared "walk every page and capture it" logic for the two multi-page
 * exporters (`exportBookCbz`, `exportWebtoonStrip`) — see `exportBook.ts`'s
 * docstring for why the pre-warm/switch-page/wait-a-frame dance is needed at
 * all. Kept as one place so both stay correct together instead of two
 * slightly-diverging copies.
 */

import { assetRenderUrl } from "@/assets/renderSource";
import { useEditorStore } from "@/editor/store";
import { loadImageElement } from "@/render/useImageElement";
import { ensureCustomFontLoaded } from "@/render/customFonts";
import { capturePageDataUrl } from "./exportPage";

export interface ExportProgress {
  done: number;
  total: number;
}

/** Two animation frames: one for React to commit the new `currentPageId`
 * into the tree, one for the browser to actually paint the Konva redraw
 * that commit triggers — a single frame occasionally captures the
 * previous page's content still on screen. */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

/**
 * Captures pages as PNG data URLs, in the given order, restoring whatever
 * page the creator was actually looking at when it's done (success or
 * failure) — an export must never leave the editor on a different page.
 *
 * `pageIds` defaults to every page in reading order (the whole book); pass
 * an explicit subset — e.g. one chapter's `ChapterRange.pageIds` from
 * `chapterOps.ts` — to scope the export to just those pages.
 */
export async function captureAllPages(
  scale: number,
  onProgress?: (progress: ExportProgress) => void,
  pageIds?: string[],
): Promise<string[]> {
  const state = useEditorStore.getState();
  const doc = state.doc;
  if (!doc) throw new Error("No open project");
  const ids =
    pageIds ??
    Object.values(doc.pages)
      .sort((a, b) => a.index - b.index)
      .map((p) => p.id);
  if (ids.length === 0) throw new Error("This project has no pages to export");

  const urls = Object.values(doc.assets)
    .map(assetRenderUrl)
    .filter((url): url is string => Boolean(url));
  await Promise.allSettled([
    ...urls.map(loadImageElement),
    // A custom lettering font still loading when the capture happens would
    // export with the fallback font baked in — same reasoning as the image
    // pre-warm above, just for fonts instead of pictures.
    ...Object.values(doc.fonts).map(ensureCustomFontLoaded),
  ]);

  const originalPageId = state.currentPageId;
  const dataUrls: string[] = [];
  try {
    for (let i = 0; i < ids.length; i++) {
      state.setCurrentPage(ids[i]);
      await nextPaint();
      // Re-read the document each iteration: nothing here mutates it, but
      // reading through `useEditorStore.getState()` once per page (rather
      // than the possibly-stale `doc` captured above) costs nothing and
      // stays consistent if that ever changes.
      const currentDoc = useEditorStore.getState().doc;
      if (!currentDoc) throw new Error("Project closed during export");
      dataUrls.push(capturePageDataUrl(currentDoc, ids[i], scale));
      onProgress?.({ done: i + 1, total: ids.length });
    }
  } finally {
    if (originalPageId) state.setCurrentPage(originalPageId);
  }
  return dataUrls;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
  } finally {
    // Revoking synchronously right after click() is safe: the browser has
    // already read the Blob's data to start the download by the time this
    // runs, it just hasn't necessarily finished writing the file yet.
    URL.revokeObjectURL(url);
  }
}

export function projectFileBasename(projectName: string): string {
  return projectName.replace(/\s+/g, "-").toLowerCase() || "manga";
}
