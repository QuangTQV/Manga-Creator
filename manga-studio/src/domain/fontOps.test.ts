import { describe, expect, it } from "vitest";
import { applyDomainCommand } from "./commands";
import { createProjectDocument } from "./factory";
import { duplicateProjectDocument, isProjectScoped, referencedProjectIds } from "./projectOps";
import type { ID } from "./types";

describe("font assets", () => {
  it("registers an uploaded font, scoped to the project", () => {
    const doc = createProjectDocument("Font test");
    const result = applyDomainCommand(doc, {
      type: "add-font-asset",
      name: "My SFX Font",
      storageUrl: "https://example.com/fonts/abc.ttf",
      format: "ttf",
    });
    const fontId = result.createdId as ID;

    expect(result.doc.fonts[fontId]).toMatchObject({
      name: "My SFX Font",
      storageUrl: "https://example.com/fonts/abc.ttf",
      format: "ttf",
      projectId: doc.project.id,
    });
    expect(isProjectScoped(result.doc)).toBe(true);
  });

  it("removes a font asset", () => {
    const doc = createProjectDocument("Font test");
    const added = applyDomainCommand(doc, {
      type: "add-font-asset",
      name: "My SFX Font",
      storageUrl: "https://example.com/fonts/abc.ttf",
      format: "ttf",
    });
    const fontId = added.createdId as ID;

    const removed = applyDomainCommand(added.doc, { type: "remove-font-asset", fontId }).doc;
    expect(removed.fonts[fontId]).toBeUndefined();
  });

  it("re-parents fonts to the new project id on duplicate", () => {
    let doc = createProjectDocument("Font test");
    doc = applyDomainCommand(doc, {
      type: "add-font-asset",
      name: "My SFX Font",
      storageUrl: "https://example.com/fonts/abc.ttf",
      format: "ttf",
    }).doc;

    const copy = duplicateProjectDocument(doc);
    const fontId = Object.keys(copy.fonts)[0];
    expect(copy.fonts[fontId].projectId).toBe(copy.project.id);
    expect(referencedProjectIds(copy).has(doc.project.id)).toBe(false);
  });
});
