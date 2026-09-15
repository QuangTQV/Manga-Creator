"use client";

/**
 * Webtoon-strip export: every page stacked into one continuous vertical
 * PNG, the format webtoon platforms and most phone-scroll readers expect —
 * as opposed to CBZ's paginated, one-file-per-page shape (`exportBook.ts`).
 *
 * Scope: this concatenates whole PAGES, it does not re-flow panels into a
 * true webtoon layout (no cross-page panel bleeding, no panel-to-panel
 * gap tuning) — the same content, read continuously downward instead of
 * page by page. A real panel-reflow webtoon layout is a distinct, much
 * larger feature; this is page concatenation, which is what most
 * manga-to-webtoon converters actually do at this level.
 *
 * Page capture (switching pages, pre-warming images, restoring the
 * original page) is shared with `exportBook.ts` — see `exportPages.ts`.
 */

import { useEditorStore } from "@/editor/store";
import { captureAllPages, downloadBlob, projectFileBasename, type ExportProgress } from "./exportPages";

export type ExportWebtoonProgress = ExportProgress;

/**
 * Conservative cross-browser ceiling for a single canvas dimension. Safari
 * has historically been the tightest real-world limit (documented failures
 * well under Chrome/Firefox's much higher ceilings); exceeding a browser's
 * actual limit doesn't throw, it silently produces a blank or truncated
 * canvas, so this is enforced up front with an actionable message instead
 * of shipping a broken PNG.
 */
const MAX_CANVAS_DIMENSION = 16_384;

/** Pulled out as a pure function so the limit logic is unit-testable
 * without needing a real `Image`/`HTMLCanvasElement` in the test env. */
export function checkWebtoonCanvasLimit(width: number, height: number, scale: 1 | 2): void {
  if (width > MAX_CANVAS_DIMENSION || height > MAX_CANVAS_DIMENSION) {
    throw new Error(
      `This book is too long to export as one webtoon strip at ${scale}x ` +
        `(${width}×${height}px, over the ${MAX_CANVAS_DIMENSION}px browser limit). ` +
        `Try @1x, or export the book as CBZ instead.`,
    );
  }
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("A captured page image failed to decode"));
    img.src = dataUrl;
  });
}

export async function exportWebtoonStrip(
  scale: 1 | 2 = 2,
  onProgress?: (progress: ExportWebtoonProgress) => void,
): Promise<void> {
  const doc = useEditorStore.getState().doc;
  if (!doc) throw new Error("No open project");

  const dataUrls = await captureAllPages(scale, onProgress);
  const images = await Promise.all(dataUrls.map(loadImage));

  const width = Math.max(...images.map((img) => img.width));
  const totalHeight = images.reduce((sum, img) => sum + img.height, 0);
  checkWebtoonCanvasLimit(width, totalHeight, scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = totalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available");

  let y = 0;
  for (const img of images) {
    ctx.drawImage(img, 0, y);
    y += img.height;
  }

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Could not encode the webtoon strip image");
  downloadBlob(blob, `${projectFileBasename(doc.project.name)}-webtoon@${scale}x.png`);
}
