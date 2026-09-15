"use client";

/**
 * Loading creator-uploaded fonts into the browser so Konva/canvas text can
 * actually use them.
 *
 * `BubbleStyle.fontFamily` is just a CSS font-family string — for a
 * built-in web-safe name that's already enough, the browser resolves it
 * for free. A custom uploaded font is different: nothing has told the
 * browser that family exists yet, so the FIRST render of any text using it
 * draws with a fallback font until the real one finishes loading. Once it
 * does, Konva has no way to know — canvas draws are imperative, not tied
 * to React reconciliation for text metrics — so every stage is nudged to
 * redraw once loading completes.
 */

import type { FontAsset } from "@/domain/types";

export function fontFamilyNameFor(fontId: string): string {
  return `kumanga-font-${fontId}`;
}

const loadedFamilies = new Set<string>();
const pending = new Map<string, Promise<void>>();

/** Idempotent and safe to call from multiple panels/pages at once — a
 * given font only ever actually loads once. */
export function ensureCustomFontLoaded(font: Pick<FontAsset, "id" | "storageUrl">): Promise<void> {
  const family = fontFamilyNameFor(font.id);
  if (loadedFamilies.has(family)) return Promise.resolve();
  const existing = pending.get(family);
  if (existing) return existing;
  if (typeof document === "undefined" || typeof FontFace === "undefined") return Promise.resolve();

  const promise = (async () => {
    const face = new FontFace(family, `url(${font.storageUrl})`);
    const loaded = await face.load();
    document.fonts.add(loaded);
    loadedFamilies.add(family);
    // Redraw every stage once so text already on screen (drawn with the
    // fallback while this was loading) picks up the real glyphs.
    const Konva = (await import("konva")).default;
    Konva.stages.forEach((stage) => stage.batchDraw());
  })()
    .catch(() => {
      // A broken/unsupported upload just keeps falling back to the
      // default font — it must never break rendering the rest of the panel.
    })
    .finally(() => {
      pending.delete(family);
    });
  pending.set(family, promise);
  return promise;
}
