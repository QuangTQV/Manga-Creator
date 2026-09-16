/**
 * `resetPageLayout` is "start this page over, in place": Novel Import's
 * regenerate action needs the same page identity (id, name, index, workspace
 * position) so the result lands where the old one was, but none of the old
 * page's content — unlike `setPageLayout`, which deliberately carries old
 * content into the new panels.
 */

import { describe, expect, it } from "vitest";
import { applyDomainCommand } from "./commands";
import { createProjectDocument } from "./factory";
import { addAsset } from "./libraryOps";
import type { ID, ProjectDocument } from "./types";

function pageWithContent(): { doc: ProjectDocument; pageId: ID } {
  let doc = createProjectDocument("Reset page test");
  const art = addAsset(doc, {
    category: "character",
    name: "Yuri standing",
    storageUrl: "https://example.com/yuri.png",
    processedImageUrl: "https://example.com/yuri-alpha.png",
    width: 900,
    height: 1400,
  });
  doc = art.doc;
  const pageId = Object.values(doc.pages)[0].id;
  doc = applyDomainCommand(doc, { type: "set-page-layout", pageId, layout: "two-vertical" }).doc;
  const panelId = doc.pages[pageId].panelIds[0];
  doc = applyDomainCommand(doc, { type: "add-instance", panelId, assetId: art.assetId }).doc;
  return { doc, pageId };
}

describe("resetPageLayout", () => {
  it("keeps the page's identity but discards every old panel, scene and item", () => {
    const { doc, pageId } = pageWithContent();
    const before = doc.pages[pageId];
    expect(before.panelIds.length).toBe(2);
    expect(Object.keys(doc.items).length).toBeGreaterThan(0);

    const after = applyDomainCommand(doc, { type: "reset-page-layout", pageId, layout: "four-grid" }).doc;
    const page = after.pages[pageId];

    expect(page.id).toBe(before.id);
    expect(page.name).toBe(before.name);
    expect(page.index).toBe(before.index);
    expect(page.workspace).toEqual(before.workspace);
    expect(page.panelIds.length).toBe(4);
    expect(Object.keys(after.items).length).toBe(0);

    // The old panel/scene ids are gone entirely, not just detached.
    for (const oldPanelId of before.panelIds) {
      expect(after.panels[oldPanelId]).toBeUndefined();
      expect(after.scenes[oldPanelId]).toBeUndefined();
    }
  });

  it("leaves every other page untouched", () => {
    const { doc, pageId } = pageWithContent();
    const other = applyDomainCommand(doc, { type: "add-page" });
    const otherPageId = other.createdId as ID;
    const before = other.doc.pages[otherPageId];

    const after = applyDomainCommand(other.doc, { type: "reset-page-layout", pageId, layout: "single" }).doc;

    expect(after.pages[otherPageId]).toEqual(before);
  });
});

describe("set-page-layout with a literal custom layout (SVG import, §27)", () => {
  it("applies literal rects the same way it applies a preset id, carrying old content forward", () => {
    const { doc, pageId } = pageWithContent();
    const customRects = [
      { x: 0, y: 0, width: 1, height: 0.5 },
      { x: 0, y: 0.5, width: 0.5, height: 0.5 },
      { x: 0.5, y: 0.5, width: 0.5, height: 0.5 },
    ];
    const after = applyDomainCommand(doc, { type: "set-page-layout", pageId, layout: customRects }).doc;
    const page = after.pages[pageId];
    expect(page.panelIds).toHaveLength(3);
    // The instance that lived in the old panel 1 followed it into the new panel 1.
    expect(Object.keys(after.items)).toHaveLength(1);
    expect(after.items[Object.keys(after.items)[0]].panelId).toBe(page.panelIds[0]);
  });

  it("rejects an empty rect list", () => {
    const { doc, pageId } = pageWithContent();
    expect(() => applyDomainCommand(doc, { type: "set-page-layout", pageId, layout: [] })).toThrow(/at least one panel/);
  });
});

function threePages(): { doc: ProjectDocument; ids: [ID, ID, ID] } {
  let doc = createProjectDocument("Reorder page test");
  const first = Object.values(doc.pages)[0].id;
  const second = applyDomainCommand(doc, { type: "add-page" });
  doc = second.doc;
  const third = applyDomainCommand(doc, { type: "add-page" });
  doc = third.doc;
  return { doc, ids: [first, second.createdId as ID, third.createdId as ID] };
}

describe("reorderPage", () => {
  it("moves a page to a later position and renumbers everyone in between", () => {
    const { doc, ids: [first, second, third] } = threePages();

    const after = applyDomainCommand(doc, { type: "reorder-page", pageId: first, toIndex: 2 }).doc;

    expect(after.pages[second].index).toBe(0);
    expect(after.pages[third].index).toBe(1);
    expect(after.pages[first].index).toBe(2);
  });

  it("moves a page to an earlier position and renumbers everyone in between", () => {
    const { doc, ids: [first, second, third] } = threePages();

    const after = applyDomainCommand(doc, { type: "reorder-page", pageId: third, toIndex: 0 }).doc;

    expect(after.pages[third].index).toBe(0);
    expect(after.pages[first].index).toBe(1);
    expect(after.pages[second].index).toBe(2);
  });

  it("keeps workspace.x in sync with the new reading order", () => {
    const { doc, ids: [first, , third] } = threePages();
    const pageWidth = doc.project.settings.pageWidth;

    const after = applyDomainCommand(doc, { type: "reorder-page", pageId: third, toIndex: 0 }).doc;

    expect(after.pages[third].workspace).toEqual({ x: 0, y: 0 });
    expect(after.pages[first].workspace).toEqual({ x: pageWidth + 240, y: 0 });
  });

  it("clamps an out-of-range target instead of throwing", () => {
    const { doc, ids: [first, , third] } = threePages();

    const after = applyDomainCommand(doc, { type: "reorder-page", pageId: first, toIndex: 999 }).doc;

    expect(after.pages[first].index).toBe(2);
    expect(after.pages[third].index).toBe(1);
  });

  it("is a true no-op (same doc reference) when the page is already at that position", () => {
    const { doc, ids: [first] } = threePages();

    const after = applyDomainCommand(doc, { type: "reorder-page", pageId: first, toIndex: 0 }).doc;

    expect(after).toBe(doc);
  });
});
