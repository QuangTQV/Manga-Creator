/**
 * Guards for the product's core invariant: source assets vs panel instances.
 * If these fail, the asset-based thesis is broken regardless of UI polish.
 */

import { describe, expect, it } from "vitest";
import { createProjectDocument } from "./factory";
import { containsRect, panelPxRect } from "./docHelpers";
import { addAsset, removeAsset } from "./libraryOps";
import {
  duplicateItem,
  placeAsset,
  removeItem,
  reorderItem,
  setCropMode,
  updateItemTransform,
} from "./itemOps";
import type { AssetInstance, ProjectDocument } from "./types";

function docWithCharacterAsset(): { doc: ProjectDocument; assetId: string } {
  const base = createProjectDocument("Test");
  return addAsset(base, {
    category: "character",
    name: "Akari standing",
    storageUrl: "https://example.com/akari.png",
    width: 1000,
    height: 2000,
  });
}

function instance(doc: ProjectDocument, itemId: string): AssetInstance {
  const item = doc.items[itemId];
  if (item?.kind !== "asset") throw new Error("not an asset instance");
  return item;
}

describe("source asset vs panel instance", () => {
  it("the same source asset can live in two panels with independent transforms", () => {
    const { doc: d1, assetId } = docWithCharacterAsset();
    const [panelA, panelB] = Object.keys(d1.panels);

    const { doc: d2, itemId: itemA } = placeAsset(d1, panelA, assetId);
    const { doc: d3, itemId: itemB } = placeAsset(d2, panelB, assetId);

    const d4 = setCropMode(d3, itemA, "upper-body");
    const d5 = updateItemTransform(d4, itemB, { cx: 50, rotation: 15 });

    expect(instance(d5, itemA).cropMode).toBe("upper-body");
    expect(instance(d5, itemB).cropMode).toBe("custom");
    expect(instance(d5, itemB).rotation).toBe(15);
    // Editing B never leaked into A.
    expect(instance(d5, itemA).rotation).toBe(0);
    expect(instance(d5, itemA).cx).not.toBe(50);
  });

  it("editing an instance never mutates the source asset (deep-equal check)", () => {
    const { doc: d1, assetId } = docWithCharacterAsset();
    const panelId = Object.keys(d1.panels)[0];
    const before = JSON.stringify(d1.assets[assetId]);

    const { doc: d2, itemId } = placeAsset(d1, panelId, assetId);
    const d3 = updateItemTransform(d2, itemId, { width: 9999, height: 1, rotation: 180 });
    const d4 = setCropMode(d3, itemId, "fill");

    expect(JSON.stringify(d4.assets[assetId])).toBe(before);
  });

  it("deleting an instance keeps the source asset in the library", () => {
    const { doc: d1, assetId } = docWithCharacterAsset();
    const panelId = Object.keys(d1.panels)[0];
    const { doc: d2, itemId } = placeAsset(d1, panelId, assetId);

    const d3 = removeItem(d2, itemId);

    expect(d3.items[itemId]).toBeUndefined();
    expect(d3.assets[assetId]).toBeDefined();
  });

  it("deleting one of three instances leaves the other two unchanged", () => {
    const { doc: d1, assetId } = docWithCharacterAsset();
    const panelIds = Object.keys(d1.panels);
    const { doc: d2, itemId: i1 } = placeAsset(d1, panelIds[0], assetId);
    const { doc: d3, itemId: i2 } = placeAsset(d2, panelIds[1], assetId);
    const { doc: d4, itemId: i3 } = placeAsset(d3, panelIds[2], assetId);

    const snapshot1 = JSON.stringify(d4.items[i1]);
    const snapshot3 = JSON.stringify(d4.items[i3]);
    const d5 = removeItem(d4, i2);

    expect(JSON.stringify(d5.items[i1])).toBe(snapshot1);
    expect(JSON.stringify(d5.items[i3])).toBe(snapshot3);
  });

  it("removing a source asset removes its instances (the only cascading direction)", () => {
    const { doc: d1, assetId } = docWithCharacterAsset();
    const panelId = Object.keys(d1.panels)[0];
    const { doc: d2, itemId } = placeAsset(d1, panelId, assetId);

    const d3 = removeAsset(d2, assetId);

    expect(d3.items[itemId]).toBeUndefined();
    expect(d3.panels[panelId].itemIds).not.toContain(itemId);
  });

  it("duplicate creates an offset independent copy", () => {
    const { doc: d1, assetId } = docWithCharacterAsset();
    const panelId = Object.keys(d1.panels)[0];
    const { doc: d2, itemId } = placeAsset(d1, panelId, assetId);
    const { doc: d3, itemId: copyId } = duplicateItem(d2, itemId);

    expect(copyId).not.toBe(itemId);
    expect(instance(d3, copyId).cx).toBe(instance(d3, itemId).cx + 24);
    const d4 = updateItemTransform(d3, copyId, { rotation: 90 });
    expect(instance(d4, itemId).rotation).toBe(0);
  });
});

describe("layer ordering", () => {
  it("backgrounds insert below characters regardless of placement order", () => {
    const { doc: d1, assetId: charAsset } = docWithCharacterAsset();
    const { doc: d2, assetId: bgAsset } = addAsset(d1, {
      category: "background",
      name: "Classroom",
      storageUrl: "https://example.com/bg.png",
      width: 2000,
      height: 1500,
    });
    const panelId = Object.keys(d2.panels)[0];
    // Character placed FIRST, background second — background must still end up below.
    const { doc: d3, itemId: charItem } = placeAsset(d2, panelId, charAsset);
    const { doc: d4, itemId: bgItem } = placeAsset(d3, panelId, bgAsset);

    const order = d4.panels[panelId].itemIds;
    expect(order.indexOf(bgItem)).toBeLessThan(order.indexOf(charItem));
  });

  it("reorder moves items within the panel stack", () => {
    const { doc: d1, assetId } = docWithCharacterAsset();
    const panelId = Object.keys(d1.panels)[0];
    const { doc: d2, itemId: a } = placeAsset(d1, panelId, assetId);
    const { doc: d3, itemId: b } = placeAsset(d2, panelId, assetId);

    expect(d3.panels[panelId].itemIds).toEqual([a, b]);
    const d4 = reorderItem(d3, a, "front");
    expect(d4.panels[panelId].itemIds).toEqual([b, a]);
    const d5 = reorderItem(d4, a, "back");
    expect(d5.panels[panelId].itemIds).toEqual([a, b]);
  });
});

describe("automatic placement never fully covers an existing character", () => {
  // compositionValidation.ts treats one character fully obscuring another as
  // fatal and rolls back the whole agent run (a real case: a wide "monster"
  // pose fit to the same panel height as a narrower character left no
  // horizontal slot with any daylight, so nudging alone couldn't clear it).
  it("shrinks a second character whose fitted width would span the whole panel", () => {
    const base = createProjectDocument("Test");
    const panelId = Object.keys(base.panels)[0];
    const panelRect = panelPxRect(base, panelId);

    // Narrow, tall — a small, off-centre occupant regardless of which slot it lands in.
    const { doc: d1, assetId: narrowAsset } = addAsset(base, {
      category: "character",
      name: "Haruto",
      storageUrl: "https://example.com/haruto.png",
      width: 50,
      height: 5000,
    });
    // Same aspect ratio as the panel itself — fit-to-height means fit-to-width
    // too, so an unshrunk placement would cover the panel exactly.
    const { doc: d2, assetId: wideAsset } = addAsset(d1, {
      category: "character",
      name: "Monster",
      storageUrl: "https://example.com/monster.png",
      width: panelRect.width * 10,
      height: panelRect.height * 10,
    });

    const { doc: d3, itemId: narrowItem } = placeAsset(d2, panelId, narrowAsset);
    const { doc: d4, itemId: wideItem } = placeAsset(d3, panelId, wideAsset);

    const narrow = instance(d4, narrowItem);
    const wide = instance(d4, wideItem);
    expect(wide.width).toBeLessThan(panelRect.width);

    const narrowRect = { x: narrow.cx - narrow.width / 2, y: narrow.cy - narrow.height / 2, width: narrow.width, height: narrow.height };
    const wideRect = { x: wide.cx - wide.width / 2, y: wide.cy - wide.height / 2, width: wide.width, height: wide.height };
    expect(containsRect(wideRect, narrowRect)).toBe(false);
  });

  it("still respects an explicit drop point (no shrink) — only automatic placement is guarded", () => {
    const base = createProjectDocument("Test");
    const panelId = Object.keys(base.panels)[0];
    const panelRect = panelPxRect(base, panelId);
    const { doc: d1, assetId: narrowAsset } = addAsset(base, {
      category: "character",
      name: "Haruto",
      storageUrl: "https://example.com/haruto.png",
      width: 50,
      height: 5000,
    });
    const { doc: d2, assetId: wideAsset } = addAsset(d1, {
      category: "character",
      name: "Monster",
      storageUrl: "https://example.com/monster.png",
      width: panelRect.width * 10,
      height: panelRect.height * 10,
    });
    const { doc: d3 } = placeAsset(d2, panelId, narrowAsset);
    const { doc: d4, itemId: wideItem } = placeAsset(d3, panelId, wideAsset, { at: { x: panelRect.width / 2, y: panelRect.height / 2 } });
    expect(instance(d4, wideItem).width).toBe(panelRect.width);
  });
});
