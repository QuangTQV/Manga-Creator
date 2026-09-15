/**
 * Split/merge panels. The property that actually matters for both: an
 * item's PAGE-SPACE (visual) position survives exactly, even though its
 * panel-local `cx`/`cy` numbers change underneath it — every resulting
 * panel gets its own new bounding box, so "unchanged panel-local
 * coordinates" would actually mean "item silently jumped on screen".
 */

import { describe, expect, it } from "vitest";
import { applyDomainCommand } from "./commands";
import { createProjectDocument } from "./factory";
import { addAsset } from "./libraryOps";
import { panelBoundsPx, panelLocalToPage } from "./coords";
import type { ID, ProjectDocument } from "./types";

function pagePositionOf(doc: ProjectDocument, itemId: ID): { x: number; y: number } {
  const item = doc.items[itemId];
  const panel = doc.panels[item.panelId];
  const bounds = panelBoundsPx(doc, panel);
  return panelLocalToPage({ x: item.cx, y: item.cy }, bounds);
}

function docWithItemAt(fractionX: number, fractionY: number): { doc: ProjectDocument; panelId: ID; itemId: ID } {
  let doc = createProjectDocument("Panel ops test");
  const art = addAsset(doc, {
    category: "character",
    name: "Yuri",
    storageUrl: "https://example.com/yuri.png",
    width: 400,
    height: 800,
  });
  doc = art.doc;
  const pageId = Object.values(doc.pages)[0].id;
  doc = applyDomainCommand(doc, { type: "set-page-layout", pageId, layout: "single" }).doc;
  const panelId = doc.pages[pageId].panelIds[0];
  const placed = applyDomainCommand(doc, { type: "add-instance", panelId, assetId: art.assetId });
  doc = placed.doc;
  const itemId = placed.createdId as ID;

  const bounds = panelBoundsPx(doc, doc.panels[panelId]);
  doc = applyDomainCommand(doc, {
    type: "update-instance-transform",
    instanceId: itemId,
    patch: { cx: bounds.width * fractionX, cy: bounds.height * fractionY },
  }).doc;
  return { doc, panelId, itemId };
}

describe("splitPanel", () => {
  it("splits vertically into two panels inserted right after the original", () => {
    const { doc, panelId } = docWithItemAt(0.2, 0.5);
    const pageId = doc.panels[panelId].pageId;

    const result = applyDomainCommand(doc, { type: "split-panel", panelId, direction: "vertical" });
    const newPanelId = result.createdId as ID;
    const page = result.doc.pages[pageId];

    expect(page.panelIds).toEqual([panelId, newPanelId]);
    expect(Object.keys(result.doc.panels)).toHaveLength(2);
    expect(result.doc.scenes[newPanelId]).toBeDefined();
  });

  it("keeps an item in the first half and preserves its exact page position", () => {
    const { doc, panelId, itemId } = docWithItemAt(0.2, 0.5); // left side
    const before = pagePositionOf(doc, itemId);

    const after = applyDomainCommand(doc, { type: "split-panel", panelId, direction: "vertical" }).doc;

    expect(after.items[itemId].panelId).toBe(panelId); // stayed
    const afterPos = pagePositionOf(after, itemId);
    expect(afterPos.x).toBeCloseTo(before.x, 5);
    expect(afterPos.y).toBeCloseTo(before.y, 5);
  });

  it("moves an item to the second half and preserves its exact page position", () => {
    const { doc, panelId, itemId } = docWithItemAt(0.8, 0.5); // right side
    const before = pagePositionOf(doc, itemId);

    const result = applyDomainCommand(doc, { type: "split-panel", panelId, direction: "vertical" });
    const newPanelId = result.createdId as ID;

    expect(result.doc.items[itemId].panelId).toBe(newPanelId);
    expect(result.doc.panels[panelId].itemIds).not.toContain(itemId);
    expect(result.doc.panels[newPanelId].itemIds).toContain(itemId);
    const afterPos = pagePositionOf(result.doc, itemId);
    expect(afterPos.x).toBeCloseTo(before.x, 5);
    expect(afterPos.y).toBeCloseTo(before.y, 5);
  });

  it("splits horizontally the same way", () => {
    const { doc, panelId, itemId } = docWithItemAt(0.5, 0.9); // bottom
    const before = pagePositionOf(doc, itemId);

    const result = applyDomainCommand(doc, { type: "split-panel", panelId, direction: "horizontal" });
    const newPanelId = result.createdId as ID;

    expect(result.doc.items[itemId].panelId).toBe(newPanelId);
    const afterPos = pagePositionOf(result.doc, itemId);
    expect(afterPos.x).toBeCloseTo(before.x, 5);
    expect(afterPos.y).toBeCloseTo(before.y, 5);
  });

  it("refuses a split fraction outside (0, 1)", () => {
    const { doc, panelId } = docWithItemAt(0.5, 0.5);
    expect(() => applyDomainCommand(doc, { type: "split-panel", panelId, direction: "vertical", fraction: 0 })).toThrow();
    expect(() => applyDomainCommand(doc, { type: "split-panel", panelId, direction: "vertical", fraction: 1 })).toThrow();
  });
});

describe("mergePanels", () => {
  it("merges two panels into one, keeping panel A's identity", () => {
    const { doc, panelId } = docWithItemAt(0.5, 0.5);
    const split = applyDomainCommand(doc, { type: "split-panel", panelId, direction: "vertical" });
    const newPanelId = split.createdId as ID;
    const pageId = split.doc.panels[panelId].pageId;

    const merged = applyDomainCommand(split.doc, { type: "merge-panels", panelAId: panelId, panelBId: newPanelId }).doc;

    expect(merged.panels[panelId]).toBeDefined();
    expect(merged.panels[newPanelId]).toBeUndefined();
    expect(merged.scenes[newPanelId]).toBeUndefined();
    expect(merged.pages[pageId].panelIds).toEqual([panelId]);
  });

  it("round-trips a split + merge back to the original item positions", () => {
    const { doc, panelId, itemId } = docWithItemAt(0.5, 0.5);
    const before = pagePositionOf(doc, itemId);

    const split = applyDomainCommand(doc, { type: "split-panel", panelId, direction: "vertical" });
    const newPanelId = split.createdId as ID;
    const merged = applyDomainCommand(split.doc, { type: "merge-panels", panelAId: panelId, panelBId: newPanelId }).doc;

    const after = pagePositionOf(merged, itemId);
    expect(after.x).toBeCloseTo(before.x, 4);
    expect(after.y).toBeCloseTo(before.y, 4);
  });

  it("carries items from both panels into the merged one", () => {
    const { doc: seeded, panelId, itemId: firstItemId } = docWithItemAt(0.2, 0.5);
    const split = applyDomainCommand(seeded, { type: "split-panel", panelId, direction: "vertical" });
    let doc = split.doc;
    const newPanelId = split.createdId as ID;

    const art = addAsset(doc, {
      category: "character",
      name: "Mio",
      storageUrl: "https://example.com/mio.png",
      width: 400,
      height: 800,
    });
    doc = art.doc;
    const secondItem = applyDomainCommand(doc, { type: "add-instance", panelId: newPanelId, assetId: art.assetId });
    doc = secondItem.doc;
    const secondItemId = secondItem.createdId as ID;

    const merged = applyDomainCommand(doc, { type: "merge-panels", panelAId: panelId, panelBId: newPanelId }).doc;

    expect(merged.panels[panelId].itemIds.sort()).toEqual([firstItemId, secondItemId].sort());
    expect(Object.keys(merged.items)).toHaveLength(2);
    for (const item of Object.values(merged.items)) expect(item.panelId).toBe(panelId);
  });

  it("refuses merging a panel with itself, and panels on different pages", () => {
    const { doc, panelId } = docWithItemAt(0.5, 0.5);
    expect(() => applyDomainCommand(doc, { type: "merge-panels", panelAId: panelId, panelBId: panelId })).toThrow();

    const otherPage = applyDomainCommand(doc, { type: "add-page" });
    const otherPanelId = otherPage.doc.pages[otherPage.createdId as ID].panelIds[0];
    expect(() =>
      applyDomainCommand(otherPage.doc, { type: "merge-panels", panelAId: panelId, panelBId: otherPanelId }),
    ).toThrow();
  });
});
