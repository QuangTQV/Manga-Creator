"use client";

/**
 * Crop (trim) marks — the small corner tick marks a print shop uses to
 * know exactly where to cut. Real print-prep tooling usually places these
 * just OUTSIDE the bleed margin, in a further margin of its own; this
 * pipeline draws them INSIDE the bleed band `printBleed.ts` already
 * extends the canvas by instead, since that's the only extra space this
 * synthetic-bleed approach actually has — adding a second margin
 * dimension just for mark placement would be a bigger, riskier change to
 * the export pipeline than this feature is worth. A mark sitting in the
 * bleed band, clear of both the trim line and the canvas edge, tells a
 * printer the same thing.
 *
 * Sized proportionally to the bleed itself (not a fixed real-world
 * length), so marks always fit inside whatever bleed margin the creator
 * set, at any DPI, with no extra configuration and no clipping.
 */

export interface CropMarkGeometry {
  /** Distance from the trim corner to where each tick begins, in px. */
  gap: number;
  /** Tick length, in px. */
  length: number;
  /** Stroke width, in px. */
  weight: number;
}

/** Pulled out as a pure function so the sizing math is unit-testable
 * without a canvas — same reasoning `computeBleedPx` in `printBleed.ts`
 * is. Returns null when the bleed margin is too thin to hold a mark
 * without touching either the trim line or the canvas edge; marks are
 * skipped in that case rather than drawn cramped or clipped. */
export function cropMarkGeometry(bleedPx: number): CropMarkGeometry | null {
  if (bleedPx < 4) return null;
  return { gap: bleedPx * 0.2, length: bleedPx * 0.6, weight: Math.max(1, bleedPx * 0.04) };
}

/**
 * Draws the 4-corner trim marks directly onto an already-bled canvas, in
 * place — 2D canvas drawing, so not unit-testable in this project's Node
 * vitest environment (same reason `addBleedByExtendingEdges` isn't);
 * verified by Playwright instead. A no-op when `cropMarkGeometry` finds no
 * room for marks (see above).
 */
export function drawCropMarks(canvas: HTMLCanvasElement, bleedPx: number): void {
  const geo = cropMarkGeometry(bleedPx);
  if (!geo) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available");

  const trimLeft = bleedPx;
  const trimTop = bleedPx;
  const trimRight = canvas.width - bleedPx;
  const trimBottom = canvas.height - bleedPx;
  const { gap, length, weight } = geo;

  ctx.save();
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = weight;
  ctx.beginPath();
  // Each corner gets one horizontal + one vertical tick, both starting a
  // `gap` outside the trim corner and extending `length` further outward
  // — the (dx, dy) pair is which way "outward" points for that corner.
  for (const [x, y, dx, dy] of [
    [trimLeft, trimTop, -1, -1],
    [trimRight, trimTop, 1, -1],
    [trimLeft, trimBottom, -1, 1],
    [trimRight, trimBottom, 1, 1],
  ] as const) {
    ctx.moveTo(x + dx * gap, y);
    ctx.lineTo(x + dx * (gap + length), y);
    ctx.moveTo(x, y + dy * gap);
    ctx.lineTo(x, y + dy * (gap + length));
  }
  ctx.stroke();
  ctx.restore();
}
