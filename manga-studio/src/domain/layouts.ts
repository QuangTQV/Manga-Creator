/**
 * Predefined panel layouts as normalized rect lists (0–1 page coordinates).
 * Rect arithmetic instead of a constraint solver — deliberately simple; a
 * smarter layout engine can replace this without touching panel content.
 */

import type { LayoutPresetId, Rect } from "./types";

const MARGIN = 0.03;
const GUTTER = 0.02;

export interface LayoutPreset {
  id: LayoutPresetId;
  label: string;
  rects: Rect[];
}

function grid(cols: number, rows: number): Rect[] {
  const width = (1 - 2 * MARGIN - (cols - 1) * GUTTER) / cols;
  const height = (1 - 2 * MARGIN - (rows - 1) * GUTTER) / rows;
  const rects: Rect[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      rects.push({
        x: MARGIN + c * (width + GUTTER),
        y: MARGIN + r * (height + GUTTER),
        width,
        height,
      });
    }
  }
  return rects;
}

export const LAYOUT_PRESETS: Record<LayoutPresetId, LayoutPreset> = {
  single: { id: "single", label: "Single panel", rects: grid(1, 1) },
  "two-vertical": { id: "two-vertical", label: "Two panels (stacked)", rects: grid(1, 2) },
  "two-horizontal": { id: "two-horizontal", label: "Two panels (side by side)", rects: grid(2, 1) },
  "three-vertical": { id: "three-vertical", label: "Three panels (stacked)", rects: grid(1, 3) },
  "four-grid": { id: "four-grid", label: "Four-panel grid", rects: grid(2, 2) },
  yonkoma: { id: "yonkoma", label: "Yonkoma (4 stacked)", rects: grid(1, 4) },
  // Deliberately zero margin, unlike `single` (which keeps MARGIN so a
  // panel reads as a panel on the page). This one exists for content that
  // should cover the physical page edge to edge — a splash page, or an
  // imported page image that already IS a finished page and must not be
  // framed with an extra border around it (see `services/importPages.ts`).
  "full-bleed": { id: "full-bleed", label: "Full bleed (edge to edge)", rects: [{ x: 0, y: 0, width: 1, height: 1 }] },
};

export function isLayoutPresetId(value: string): value is LayoutPresetId {
  return value in LAYOUT_PRESETS;
}
