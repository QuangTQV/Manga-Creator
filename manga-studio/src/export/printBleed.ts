"use client";

/**
 * Synthetic ("poor man's") bleed: stretches the outermost ring of already-
 * rendered pixels outward into a margin, rather than requiring art that
 * already extends past the trim edge — which nothing in Kumanga's domain
 * model can author today, since panels are hard-clamped to the page's
 * normalized 0..1 coordinate space (see `exportPrint.ts`'s docstring for
 * the full reasoning). Good enough that a printer's trim tolerance won't
 * expose a white sliver at the edge; not a substitute for deliberately
 * bled artwork.
 */

/** Bleed margin in device pixels, at the export's own DPI — kept as a
 * separate pure function so the math is unit-testable without a canvas. */
export function computeBleedPx(bleedInches: number, dpi: number): number {
  return Math.max(0, Math.round(bleedInches * dpi));
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("A captured page image failed to decode"));
    img.src = dataUrl;
  });
}

/**
 * Draws `source` centered on a canvas `bleedPx` larger on every side, then
 * stretches 1px-thick edge strips (and single corner pixels) outward to
 * fill the margin — plain `drawImage` calls with mismatched source/
 * destination rectangle sizes, no image-processing library needed.
 */
export function addBleedByExtendingEdges(source: CanvasImageSource & { width: number; height: number }, bleedPx: number): HTMLCanvasElement {
  const { width, height } = source;
  const canvas = document.createElement("canvas");
  canvas.width = width + bleedPx * 2;
  canvas.height = height + bleedPx * 2;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available");

  if (bleedPx <= 0) {
    ctx.drawImage(source, 0, 0);
    return canvas;
  }

  ctx.drawImage(source, bleedPx, bleedPx, width, height);

  // Edges: stretch a 1px-thick strip from the source edge across the margin.
  ctx.drawImage(source, 0, 0, width, 1, bleedPx, 0, width, bleedPx); // top
  ctx.drawImage(source, 0, height - 1, width, 1, bleedPx, height + bleedPx, width, bleedPx); // bottom
  ctx.drawImage(source, 0, 0, 1, height, 0, bleedPx, bleedPx, height); // left
  ctx.drawImage(source, width - 1, 0, 1, height, width + bleedPx, bleedPx, bleedPx, height); // right

  // Corners: stretch the single corner pixel into a bleedPx×bleedPx square.
  ctx.drawImage(source, 0, 0, 1, 1, 0, 0, bleedPx, bleedPx); // top-left
  ctx.drawImage(source, width - 1, 0, 1, 1, width + bleedPx, 0, bleedPx, bleedPx); // top-right
  ctx.drawImage(source, 0, height - 1, 1, 1, 0, height + bleedPx, bleedPx, bleedPx); // bottom-left
  ctx.drawImage(source, width - 1, height - 1, 1, 1, width + bleedPx, height + bleedPx, bleedPx, bleedPx); // bottom-right

  return canvas;
}

/** Same as `addBleedByExtendingEdges`, but from/to data URLs — the shape
 * the exporters actually pass around. Returns `dataUrl` unchanged when
 * `bleedPx` is 0, so callers can unconditionally call this without a
 * branch for "no bleed requested". */
export async function addBleedToDataUrl(dataUrl: string, bleedPx: number): Promise<string> {
  if (bleedPx <= 0) return dataUrl;
  const image = await loadImage(dataUrl);
  const canvas = addBleedByExtendingEdges(image, bleedPx);
  return canvas.toDataURL("image/png");
}
