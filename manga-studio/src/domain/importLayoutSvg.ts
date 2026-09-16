/**
 * Parse an SVG panel-layout template (exported from Illustrator, Inkscape,
 * Affinity Designer or CorelDraw) into normalized panel rects, the same
 * shape `domain/layouts.ts`'s built-in presets produce.
 *
 * Regex-based rather than a real XML/DOM parse, deliberately: a DOMParser
 * is not available in every environment this needs to run in (this file is
 * pure and unit-testable in plain Node, with no browser or jsdom), and a
 * hand-drawn panel-division SVG is simple enough — a handful of `<rect>`
 * elements against one `viewBox` — that a tolerant regex scan covers the
 * real case without pulling in an XML parser. Only `<rect>` shapes are
 * read; a layout drawn as polygons or paths is a real, disclosed
 * limitation, not a bug — draw panel divisions as rectangles to import them.
 */

import type { Rect } from "./types";

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function numberAttr(attrs: string, name: string): number | undefined {
  const match = attrs.match(new RegExp(`\\b${name}\\s*=\\s*"([-\\d.eE]+)`, "i"));
  return match ? Number(match[1]) : undefined;
}

/**
 * Extract the SVG's own coordinate space from its root tag: `viewBox` when
 * present (the usual case for anything exported from real design software),
 * falling back to `width`/`height` attributes otherwise.
 */
function readCanvasSize(svgTag: string): { width: number; height: number } {
  const viewBox = svgTag.match(/\bviewBox\s*=\s*"([^"]+)"/i)?.[1];
  if (viewBox) {
    const parts = viewBox.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      return { width: parts[2], height: parts[3] };
    }
  }
  const width = numberAttr(svgTag, "width");
  const height = numberAttr(svgTag, "height");
  if (width && height && width > 0 && height > 0) return { width, height };
  throw new Error("This SVG has no usable viewBox or width/height to measure panels against");
}

/** Parses every `<rect>` element into a normalized (0..1) panel rect. */
export function parseLayoutSvg(svgText: string): Rect[] {
  const svgTag = svgText.match(/<svg\b[^>]*>/i)?.[0];
  if (!svgTag) throw new Error("Not a valid SVG file — no <svg> root element found");
  const canvas = readCanvasSize(svgTag);

  const rects: Rect[] = [];
  const rectPattern = /<rect\b([^>]*)\/?>/gi;
  let match: RegExpExecArray | null;
  while ((match = rectPattern.exec(svgText))) {
    const attrs = match[1];
    const x = numberAttr(attrs, "x") ?? 0;
    const y = numberAttr(attrs, "y") ?? 0;
    const width = numberAttr(attrs, "width");
    const height = numberAttr(attrs, "height");
    if (!width || !height || width <= 0 || height <= 0) continue;
    rects.push({
      x: clamp01(x / canvas.width),
      y: clamp01(y / canvas.height),
      width: Math.min(width / canvas.width, 1),
      height: Math.min(height / canvas.height, 1),
    });
  }

  if (rects.length === 0) {
    throw new Error("No panel rectangles found in this SVG — export panel divisions as <rect> shapes");
  }
  return rects;
}
