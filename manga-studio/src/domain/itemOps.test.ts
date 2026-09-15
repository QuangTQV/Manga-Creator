/**
 * Blend mode is on `PanelItemBase`, so it's available on every item kind —
 * these check it actually round-trips through `set-instance-props` for the
 * two kinds that use it (asset instances, bubbles); tone's own path
 * (`update-tone`) is covered in `tones.test.ts`.
 */

import { describe, expect, it } from "vitest";
import { applyDomainCommand } from "./commands";
import { createProjectDocument } from "./factory";
import { addAsset } from "./libraryOps";
import type { AssetInstance, SpeechBubbleItem } from "./types";

function seededPanel() {
  const doc = createProjectDocument("Blend mode test");
  const panelId = Object.values(doc.pages)[0].panelIds[0];
  return { doc, panelId };
}

describe("blend mode on panel items", () => {
  it("defaults to unset (normal) on a new asset instance", () => {
    const { doc, panelId } = seededPanel();
    const art = addAsset(doc, {
      category: "character",
      name: "Yuri",
      storageUrl: "https://example.com/yuri.png",
      width: 400,
      height: 800,
    });
    const placed = applyDomainCommand(art.doc, { type: "add-instance", panelId, assetId: art.assetId });
    const item = placed.doc.items[placed.createdId!] as AssetInstance;
    expect(item.blendMode).toBeUndefined();
  });

  it("round-trips through set-instance-props on an asset instance", () => {
    const { doc, panelId } = seededPanel();
    const art = addAsset(doc, {
      category: "character",
      name: "Yuri",
      storageUrl: "https://example.com/yuri.png",
      width: 400,
      height: 800,
    });
    const placed = applyDomainCommand(art.doc, { type: "add-instance", panelId, assetId: art.assetId });
    const itemId = placed.createdId!;

    const patched = applyDomainCommand(placed.doc, {
      type: "set-instance-props",
      instanceId: itemId,
      patch: { blendMode: "screen" },
    });
    expect((patched.doc.items[itemId] as AssetInstance).blendMode).toBe("screen");
  });

  it("round-trips through set-instance-props on a bubble too", () => {
    const { doc, panelId } = seededPanel();
    const added = applyDomainCommand(doc, { type: "add-bubble", panelId, bubbleType: "speech", text: "Hi" });
    const itemId = added.createdId!;

    const patched = applyDomainCommand(added.doc, {
      type: "set-instance-props",
      instanceId: itemId,
      patch: { blendMode: "overlay" },
    });
    expect((patched.doc.items[itemId] as SpeechBubbleItem).blendMode).toBe("overlay");
  });
});

describe("update-bubble height patch (auto-fit)", () => {
  it("accepts a height alongside text, in the same command", () => {
    const { doc, panelId } = seededPanel();
    const added = applyDomainCommand(doc, { type: "add-bubble", panelId, bubbleType: "speech", text: "Hi" });
    const itemId = added.createdId!;
    const originalHeight = (added.doc.items[itemId] as SpeechBubbleItem).height;

    const patched = applyDomainCommand(added.doc, {
      type: "update-bubble",
      itemId,
      patch: { text: "A much longer line of dialogue that needs more room", height: originalHeight * 2 },
    });
    const item = patched.doc.items[itemId] as SpeechBubbleItem;
    expect(item.text).toBe("A much longer line of dialogue that needs more room");
    expect(item.height).toBe(originalHeight * 2);
  });

  it("leaves height untouched when the patch omits it (a plain text edit with no fit computed)", () => {
    const { doc, panelId } = seededPanel();
    const added = applyDomainCommand(doc, { type: "add-bubble", panelId, bubbleType: "speech", text: "Hi" });
    const itemId = added.createdId!;
    const originalHeight = (added.doc.items[itemId] as SpeechBubbleItem).height;

    const patched = applyDomainCommand(added.doc, { type: "update-bubble", itemId, patch: { text: "Still short" } });
    expect((patched.doc.items[itemId] as SpeechBubbleItem).height).toBe(originalHeight);
  });
});
