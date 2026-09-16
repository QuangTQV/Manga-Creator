/**
 * Text style presets (§27) — see `TextStylePreset`'s own docstring in
 * types.ts for why applying one is a one-time copy, not a live link.
 */

import { describe, expect, it } from "vitest";
import { applyDomainCommand } from "./commands";
import { createProjectDocument } from "./factory";
import type { SpeechBubbleItem } from "./types";

function seededPanel() {
  const doc = createProjectDocument("Text style preset test");
  const panelId = Object.values(doc.pages)[0].panelIds[0];
  return { doc, panelId };
}

describe("save-text-style-preset", () => {
  it("creates a named preset from arbitrary field values", () => {
    const { doc } = seededPanel();
    const saved = applyDomainCommand(doc, {
      type: "save-text-style-preset",
      name: "Loud Narrator",
      fields: { fontFamily: "Impact", fontSize: 32, bold: true, textColor: "#ff0000" },
    });
    const presetId = saved.createdId!;
    const preset = saved.doc.textStylePresets[presetId];
    expect(preset.name).toBe("Loud Narrator");
    expect(preset.fontFamily).toBe("Impact");
    expect(preset.fontSize).toBe(32);
    expect(preset.bold).toBe(true);
  });

  it("rejects an empty name", () => {
    const { doc } = seededPanel();
    expect(() => applyDomainCommand(doc, { type: "save-text-style-preset", name: "   ", fields: {} })).toThrow(/needs a name/);
  });
});

describe("rename-text-style-preset", () => {
  it("renames an existing preset", () => {
    const { doc } = seededPanel();
    const saved = applyDomainCommand(doc, { type: "save-text-style-preset", name: "Draft", fields: {} });
    const renamed = applyDomainCommand(saved.doc, {
      type: "rename-text-style-preset",
      presetId: saved.createdId!,
      name: "Final",
    });
    expect(renamed.doc.textStylePresets[saved.createdId!].name).toBe("Final");
  });

  it("rejects an unknown preset", () => {
    const { doc } = seededPanel();
    expect(() => applyDomainCommand(doc, { type: "rename-text-style-preset", presetId: "nope", name: "X" })).toThrow(/Unknown/);
  });
});

describe("remove-text-style-preset", () => {
  it("removes the preset", () => {
    const { doc } = seededPanel();
    const saved = applyDomainCommand(doc, { type: "save-text-style-preset", name: "Draft", fields: {} });
    const removed = applyDomainCommand(saved.doc, { type: "remove-text-style-preset", presetId: saved.createdId! });
    expect(removed.doc.textStylePresets[saved.createdId!]).toBeUndefined();
  });

  it("is a no-op for an already-missing preset, rather than throwing", () => {
    const { doc } = seededPanel();
    expect(() => applyDomainCommand(doc, { type: "remove-text-style-preset", presetId: "nope" })).not.toThrow();
  });
});

describe("applying a preset to a bubble", () => {
  it("carries fontSize (on the item) and style fields together in one update-bubble dispatch", () => {
    const { doc, panelId } = seededPanel();
    const saved = applyDomainCommand(doc, {
      type: "save-text-style-preset",
      name: "Whisper style",
      fields: { fontFamily: "Georgia", fontSize: 14, italic: true, textColor: "#888888" },
    });
    const preset = saved.doc.textStylePresets[saved.createdId!];

    const added = applyDomainCommand(saved.doc, { type: "add-bubble", panelId, bubbleType: "speech", text: "Hi" });
    const itemId = added.createdId!;
    const applied = applyDomainCommand(added.doc, {
      type: "update-bubble",
      itemId,
      patch: {
        fontSize: preset.fontSize,
        style: { fontFamily: preset.fontFamily, italic: preset.italic, textColor: preset.textColor },
      },
    });
    const item = applied.doc.items[itemId] as SpeechBubbleItem;
    expect(item.fontSize).toBe(14);
    expect(item.style?.fontFamily).toBe("Georgia");
    expect(item.style?.italic).toBe(true);
    expect(item.style?.textColor).toBe("#888888");
  });
});
