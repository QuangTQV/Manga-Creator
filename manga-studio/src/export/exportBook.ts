"use client";

/**
 * Whole-project CBZ export: every page, in reading order, zipped as
 * sequentially-numbered PNGs — the standard interchange format comic
 * readers (ComicRack, YACReader, most e-readers) expect, and a much closer
 * fit for a manga tool than a page-layout format like PDF would be.
 *
 * There is exactly one live Konva stage (`PAGE_STAGE_ID`) showing whatever
 * page is currently selected — exporting every page means walking through
 * them, switching `currentPageId`, and capturing each in turn with the
 * same `capturePageDataUrl` a single-page export uses. The one real risk
 * that isn't present for a single-page export: a page the creator hasn't
 * looked at since opening the project may have images that haven't loaded
 * into `useImageElement`'s cache yet, which would otherwise export as a
 * blank loading-placeholder panel. Pre-warming that cache for every asset
 * before the page loop starts (`loadImageElement`, keyed by URL, so a
 * repeat is a no-op) removes that risk without needing to know in advance
 * which assets a given page actually uses.
 */

import JSZip from "jszip";
import { assetRenderUrl } from "@/assets/renderSource";
import { useEditorStore } from "@/editor/store";
import { loadImageElement } from "@/render/useImageElement";
import { capturePageDataUrl } from "./exportPage";

/** Two animation frames: one for React to commit the new `currentPageId`
 * into the tree, one for the browser to actually paint the Konva redraw
 * that commit triggers — a single frame occasionally captures the
 * previous page's content still on screen. */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

export interface ExportBookProgress {
  done: number;
  total: number;
}

export async function exportBookCbz(
  scale: 1 | 2 = 2,
  onProgress?: (progress: ExportBookProgress) => void,
): Promise<void> {
  const state = useEditorStore.getState();
  const doc = state.doc;
  if (!doc) throw new Error("No open project");
  const pageIds = Object.values(doc.pages)
    .sort((a, b) => a.index - b.index)
    .map((p) => p.id);
  if (pageIds.length === 0) throw new Error("This project has no pages to export");

  const urls = Object.values(doc.assets)
    .map(assetRenderUrl)
    .filter((url): url is string => Boolean(url));
  await Promise.allSettled(urls.map(loadImageElement));

  const originalPageId = state.currentPageId;
  const zip = new JSZip();
  const digits = String(pageIds.length).length;
  try {
    for (let i = 0; i < pageIds.length; i++) {
      state.setCurrentPage(pageIds[i]);
      await nextPaint();
      // Re-read the document each iteration: nothing here mutates it, but
      // reading through `useEditorStore.getState()` once per page (rather
      // than the possibly-stale `doc` captured above) is what the single
      // page exporter does too, and costs nothing to keep consistent with.
      const currentDoc = useEditorStore.getState().doc;
      if (!currentDoc) throw new Error("Project closed during export");
      const dataUrl = capturePageDataUrl(currentDoc, pageIds[i], scale);
      const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
      zip.file(`page_${String(i + 1).padStart(digits, "0")}.png`, base64, { base64: true });
      onProgress?.({ done: i + 1, total: pageIds.length });
    }
  } finally {
    // Always restore where the creator actually was, success or failure —
    // a book export must never leave the editor looking at a different
    // page than the one they were working on.
    if (originalPageId) state.setCurrentPage(originalPageId);
  }

  const blob = await zip.generateAsync({ type: "blob" });
  downloadBlob(blob, `${doc.project.name.replace(/\s+/g, "-").toLowerCase() || "manga"}.cbz`);
}

function downloadBlob(blob: Blob, filename: string): void {
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
