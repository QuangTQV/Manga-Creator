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
