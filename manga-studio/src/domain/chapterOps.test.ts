/**
 * Chapters are boundary markers, not a tag on every page (see `Chapter`'s
 * own docstring) — these tests exercise the derivation (`chaptersInOrder`)
 * and the two places that could desync it: reordering a page across a
 * chapter boundary, and removing a page that IS one.
 */

import { describe, expect, it } from "vitest";
import { applyDomainCommand } from "./commands";
import { chaptersInOrder } from "./chapterOps";
import { createProjectDocument } from "./factory";
import type { ID, ProjectDocument } from "./types";

function fivePages(): { doc: ProjectDocument; ids: ID[] } {
  let doc = createProjectDocument("Chapters test");
  const ids = [Object.values(doc.pages)[0].id];
  for (let i = 0; i < 4; i++) {
    const result = applyDomainCommand(doc, { type: "add-page" });
    doc = result.doc;
    ids.push(result.createdId as ID);
  }
  return { doc, ids };
}

describe("chaptersInOrder", () => {
  it("with no chapters, every page is unassigned", () => {
    const { doc, ids } = fivePages();
    const { chapters, unassignedPageIds } = chaptersInOrder(doc);
    expect(chapters).toEqual([]);
    expect(unassignedPageIds).toEqual(ids);
  });

  it("pages before the first chapter's start are unassigned; the rest split at boundaries", () => {
    const { doc, ids } = fivePages();
    const withCh1 = applyDomainCommand(doc, { type: "add-chapter", startPageId: ids[1], name: "Ch 1" });
    const withCh2 = applyDomainCommand(withCh1.doc, { type: "add-chapter", startPageId: ids[3], name: "Ch 2" });

    const { chapters, unassignedPageIds } = chaptersInOrder(withCh2.doc);
    expect(unassignedPageIds).toEqual([ids[0]]);
    expect(chapters).toHaveLength(2);
    expect(chapters[0].chapter.name).toBe("Ch 1");
    expect(chapters[0].pageIds).toEqual([ids[1], ids[2]]);
    expect(chapters[1].chapter.name).toBe("Ch 2");
    expect(chapters[1].pageIds).toEqual([ids[3], ids[4]]);
  });

  it("refuses a second chapter starting on the same page", () => {
    const { doc, ids } = fivePages();
    const withCh1 = applyDomainCommand(doc, { type: "add-chapter", startPageId: ids[1] }).doc;
    expect(() => applyDomainCommand(withCh1, { type: "add-chapter", startPageId: ids[1] })).toThrow();
  });

  it("reordering a page across a boundary updates chapter membership automatically", () => {
    const { doc, ids } = fivePages();
    const withCh1 = applyDomainCommand(doc, { type: "add-chapter", startPageId: ids[2], name: "Ch 1" }).doc;
    // ids[0] originally comes before the chapter; drag it to the very end.
    const reordered = applyDomainCommand(withCh1, { type: "reorder-page", pageId: ids[0], toIndex: 4 }).doc;

    const { chapters, unassignedPageIds } = chaptersInOrder(reordered);
    // Nothing keeps ids[0] tagged to "unassigned" — its new position decides.
    expect(unassignedPageIds).not.toContain(ids[0]);
    expect(chapters[0].pageIds).toContain(ids[0]);
  });

  it("removing a chapter's start page moves the chapter to the next surviving page", () => {
    const { doc, ids } = fivePages();
    const withCh1 = applyDomainCommand(doc, { type: "add-chapter", startPageId: ids[2], name: "Ch 1" }).doc;

    const removed = applyDomainCommand(withCh1, { type: "remove-page", pageId: ids[2] }).doc;

    const { chapters } = chaptersInOrder(removed);
    expect(chapters).toHaveLength(1);
    expect(chapters[0].chapter.startPageId).toBe(ids[3]);
  });

  it("removing a chapter's last remaining page deletes the chapter instead of dangling", () => {
    const { doc, ids } = fivePages();
    // Chapter starts on the very last page — nothing after it to fall back to.
    const withCh1 = applyDomainCommand(doc, { type: "add-chapter", startPageId: ids[4], name: "Ch 1" }).doc;

    const removed = applyDomainCommand(withCh1, { type: "remove-page", pageId: ids[4] }).doc;

    expect(Object.keys(removed.chapters)).toHaveLength(0);
  });

  it("removing a page whose successor already starts another chapter deletes it rather than colliding", () => {
    const { doc, ids } = fivePages();
    const withBoth = [
      { type: "add-chapter" as const, startPageId: ids[2], name: "Ch 1" },
      { type: "add-chapter" as const, startPageId: ids[3], name: "Ch 2" },
    ].reduce((d, cmd) => applyDomainCommand(d, cmd).doc, doc);

    const removed = applyDomainCommand(withBoth, { type: "remove-page", pageId: ids[2] }).doc;

    const remaining = Object.values(removed.chapters);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].name).toBe("Ch 2");
    expect(remaining[0].startPageId).toBe(ids[3]);
  });

  it("rename and remove", () => {
    const { doc, ids } = fivePages();
    const added = applyDomainCommand(doc, { type: "add-chapter", startPageId: ids[1], name: "Draft" });
    const chapterId = added.createdId as ID;

    const renamed = applyDomainCommand(added.doc, { type: "rename-chapter", chapterId, name: "Final Name" }).doc;
    expect(renamed.chapters[chapterId].name).toBe("Final Name");

    const removed = applyDomainCommand(renamed, { type: "remove-chapter", chapterId }).doc;
    expect(removed.chapters[chapterId]).toBeUndefined();
  });
});
