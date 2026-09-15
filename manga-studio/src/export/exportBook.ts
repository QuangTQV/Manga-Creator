"use client";

/**
 * Whole-project CBZ export: every page, in reading order, zipped as
 * sequentially-numbered PNGs — the standard interchange format comic
 * readers (ComicRack, YACReader, most e-readers) expect, and a much closer
 * fit for a manga tool than a page-layout format like PDF would be.
 *
 * Page capture itself (switching pages, pre-warming the image cache,
 * restoring the original page) is shared with `exportWebtoon.ts` — see
 * `exportPages.ts`.
 */

import JSZip from "jszip";
import { useEditorStore } from "@/editor/store";
import { captureAllPages, downloadBlob, projectFileBasename, type ExportProgress } from "./exportPages";

export type ExportBookProgress = ExportProgress;

export async function exportBookCbz(scale: 1 | 2 = 2, onProgress?: (progress: ExportBookProgress) => void): Promise<void> {
  const doc = useEditorStore.getState().doc;
  if (!doc) throw new Error("No open project");

  const dataUrls = await captureAllPages(scale, onProgress);

  const zip = new JSZip();
  const digits = String(dataUrls.length).length;
  dataUrls.forEach((dataUrl, i) => {
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    zip.file(`page_${String(i + 1).padStart(digits, "0")}.png`, base64, { base64: true });
  });

  const blob = await zip.generateAsync({ type: "blob" });
  downloadBlob(blob, `${projectFileBasename(doc.project.name)}.cbz`);
}
