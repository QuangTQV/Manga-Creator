/**
 * `contextLine` is what carries the project's dialogue-language setting to
 * the Creative Director (see the "Dialogue/narration language" rule in
 * `director/systemPrompt.ts`) — a plain pure-function test is enough to
 * pin its exact wording without spinning up a real agent run.
 */

import { describe, expect, it } from "vitest";
import { createProjectDocument } from "@/domain/factory";
import { applyDomainCommand } from "@/domain/commands";
import { contextLine } from "./run";

describe("contextLine", () => {
  it("omits the language sentence when no dialogue language is set", () => {
    const doc = createProjectDocument("Untitled");
    const line = contextLine({ currentPageId: null, selection: {} }, doc);
    expect(line).not.toContain("Dialogue/narration language");
  });

  it("states the configured dialogue language", () => {
    let doc = createProjectDocument("Untitled");
    doc = applyDomainCommand(doc, { type: "set-dialogue-language", language: "Vietnamese" }).doc;
    const line = contextLine({ currentPageId: null, selection: {} }, doc);
    expect(line).toContain("Dialogue/narration language: Vietnamese.");
  });

  it("clearing the language (null) removes the sentence again", () => {
    let doc = createProjectDocument("Untitled");
    doc = applyDomainCommand(doc, { type: "set-dialogue-language", language: "Japanese" }).doc;
    doc = applyDomainCommand(doc, { type: "set-dialogue-language", language: null }).doc;
    const line = contextLine({ currentPageId: null, selection: {} }, doc);
    expect(line).not.toContain("Dialogue/narration language");
    expect(doc.project.settings.dialogueLanguage).toBeUndefined();
  });
});
