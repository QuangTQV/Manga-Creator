/**
 * Typography additions (bold/italic/letterSpacing): SFX's forced-bold look
 * is materialized into its default style at creation time, not a runtime
 * fallback during render — so it must actually be `true` here, an explicit
 * override must still win, and an old saved style missing the field must
 * still resolve to the type's own default via `normalizeBubbleStyle`.
 */

import { describe, expect, it } from "vitest";
import { defaultBubbleStyle, normalizeBubbleStyle, updateBubbleStyle } from "./bubbleStyles";

describe("bold/italic/letterSpacing defaults", () => {
  it("SFX defaults to bold; speech does not", () => {
    expect(defaultBubbleStyle("sfx").bold).toBe(true);
    expect(defaultBubbleStyle("speech").bold).toBeFalsy();
  });

  it("an explicit bold: false override on SFX is respected, not forced back to true", () => {
    const style = updateBubbleStyle("sfx", defaultBubbleStyle("sfx"), { bold: false });
    expect(style.bold).toBe(false);
  });

  it("a pre-existing SFX style saved without `bold` still resolves to bold via the type default", () => {
    // Simulates a bubble saved before this field existed: no `bold` key at all.
    const oldStyle = { ...defaultBubbleStyle("sfx") } as Record<string, unknown>;
    delete oldStyle.bold;
    const resolved = normalizeBubbleStyle("sfx", oldStyle);
    expect(resolved.bold).toBe(true);
  });

  it("italic and letterSpacing round-trip through a patch", () => {
    const style = updateBubbleStyle("speech", defaultBubbleStyle("speech"), { italic: true, letterSpacing: 8 });
    expect(style.italic).toBe(true);
    expect(style.letterSpacing).toBe(8);
  });

  it("clamps letterSpacing into [-10, 60]", () => {
    expect(normalizeBubbleStyle("speech", { letterSpacing: 999 }).letterSpacing).toBe(60);
    expect(normalizeBubbleStyle("speech", { letterSpacing: -999 }).letterSpacing).toBe(-10);
  });
});
