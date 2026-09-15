"use client";

/**
 * Auto-fit a bubble's HEIGHT to its text, right after the text changes —
 * so a creator typing a long line of dialogue doesn't have to separately
 * remember to drag the bubble taller. Deliberately height-only, never
 * width: `BubbleNode.tsx`'s non-rectangular shapes (cloud, spiky, ellipse,
 * …) read as that shape at whatever width/height ratio the creator set,
 * so growing width too on every keystroke would keep reshaping the
 * silhouette itself, not just making room for text. A creator who wants a
 * wider bubble still resizes it manually — this only ever adjusts height.
 *
 * Uses a real (but offscreen, never attached to a Stage) Konva.Text node
 * to measure — the only way to get a number that matches what
 * `BubbleNode.tsx` actually renders, since Konva's own text-wrapping/
 * line-height math isn't worth reimplementing by hand. Not unit-testable
 * (this project's vitest environment is `"node"`, no real canvas — the
 * same reason `printBleed.ts`'s actual drawing isn't either); verified by
 * Playwright instead.
 */

import Konva from "konva";
import { fontStyleFor } from "@/domain/bubbleStyles";
import type { BubbleStyle } from "@/domain/types";

const DEFAULT_FONT_FAMILY = "'Comic Sans MS', 'Segoe UI', sans-serif";

/** Returns the bubble HEIGHT (matching `SpeechBubbleItem.height`'s units)
 * that fits `text` at the bubble's current `width`/`fontSize`/style —
 * floored at roughly one line's worth of height so emptying a bubble out
 * never collapses it to nothing. */
export function fitBubbleHeight(params: { text: string; width: number; fontSize: number; style: BubbleStyle }): number {
  const { text, width, fontSize, style } = params;
  const pad = Math.min(Math.max(style.padding, 0), 0.45); // same range normalizeBubbleStyle already enforces
  const innerWidth = Math.max(1, width * (1 - pad * 2));

  const probe = new Konva.Text({
    text: text || " ",
    fontSize,
    fontFamily: style.fontFamily ?? DEFAULT_FONT_FAMILY,
    fontStyle: fontStyleFor(style),
    letterSpacing: style.letterSpacing ?? 0,
    width: innerWidth,
    wrap: "word",
  });
  const textHeight = probe.height();
  probe.destroy();

  const innerHeight = Math.max(textHeight, fontSize * 1.4);
  return innerHeight / (1 - pad * 2);
}
