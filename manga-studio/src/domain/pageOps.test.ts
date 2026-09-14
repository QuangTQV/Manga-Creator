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
