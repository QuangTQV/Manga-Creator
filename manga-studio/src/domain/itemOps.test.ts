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

describe("update-bubble continuesFromItemId (linked/extended bubbles, §27)", () => {
  it("links to another bubble in the same panel", () => {
    const { doc, panelId } = seededPanel();
    const a = applyDomainCommand(doc, { type: "add-bubble", panelId, bubbleType: "speech", text: "First part…" });
    const b = applyDomainCommand(a.doc, { type: "add-bubble", panelId, bubbleType: "speech", text: "…second part." });
    const bId = b.createdId!;

    const linked = applyDomainCommand(b.doc, {
      type: "update-bubble",
      itemId: bId,
      patch: { continuesFromItemId: a.createdId! },
    });
    expect((linked.doc.items[bId] as SpeechBubbleItem).continuesFromItemId).toBe(a.createdId);
  });

  it("clears an existing link with null", () => {
    const { doc, panelId } = seededPanel();
    const a = applyDomainCommand(doc, { type: "add-bubble", panelId, bubbleType: "speech", text: "A" });
    const b = applyDomainCommand(a.doc, { type: "add-bubble", panelId, bubbleType: "speech", text: "B" });
    const bId = b.createdId!;
    const linked = applyDomainCommand(b.doc, { type: "update-bubble", itemId: bId, patch: { continuesFromItemId: a.createdId! } });

    const cleared = applyDomainCommand(linked.doc, { type: "update-bubble", itemId: bId, patch: { continuesFromItemId: null } });
    expect((cleared.doc.items[bId] as SpeechBubbleItem).continuesFromItemId).toBeUndefined();
  });

  it("leaves an existing link untouched when the patch omits the field entirely", () => {
    const { doc, panelId } = seededPanel();
    const a = applyDomainCommand(doc, { type: "add-bubble", panelId, bubbleType: "speech", text: "A" });
    const b = applyDomainCommand(a.doc, { type: "add-bubble", panelId, bubbleType: "speech", text: "B" });
    const bId = b.createdId!;
    const linked = applyDomainCommand(b.doc, { type: "update-bubble", itemId: bId, patch: { continuesFromItemId: a.createdId! } });

    const patched = applyDomainCommand(linked.doc, { type: "update-bubble", itemId: bId, patch: { text: "B, edited" } });
    expect((patched.doc.items[bId] as SpeechBubbleItem).continuesFromItemId).toBe(a.createdId);
  });

  it("rejects a bubble continuing itself", () => {
    const { doc, panelId } = seededPanel();
    const a = applyDomainCommand(doc, { type: "add-bubble", panelId, bubbleType: "speech", text: "A" });
    expect(() =>
      applyDomainCommand(a.doc, { type: "update-bubble", itemId: a.createdId!, patch: { continuesFromItemId: a.createdId! } }),
    ).toThrow(/cannot continue itself/);
  });

  it("rejects an unknown target", () => {
    const { doc, panelId } = seededPanel();
    const a = applyDomainCommand(doc, { type: "add-bubble", panelId, bubbleType: "speech", text: "A" });
    expect(() =>
      applyDomainCommand(a.doc, { type: "update-bubble", itemId: a.createdId!, patch: { continuesFromItemId: "does-not-exist" } }),
    ).toThrow(/Unknown bubble/);
  });

  it("rejects linking to a bubble in a different panel", () => {
    const doc = createProjectDocument("Cross panel link test");
    const withLayout = applyDomainCommand(doc, {
      type: "set-page-layout",
      pageId: Object.values(doc.pages)[0].id,
      layout: "two-vertical",
    });
    const [panelA, panelB] = withLayout.doc.pages[Object.values(withLayout.doc.pages)[0].id].panelIds;
    const a = applyDomainCommand(withLayout.doc, { type: "add-bubble", panelId: panelA, bubbleType: "speech", text: "A" });
    const b = applyDomainCommand(a.doc, { type: "add-bubble", panelId: panelB, bubbleType: "speech", text: "B" });

    expect(() =>
      applyDomainCommand(b.doc, { type: "update-bubble", itemId: b.createdId!, patch: { continuesFromItemId: a.createdId! } }),
    ).toThrow(/same panel/);
  });
});
