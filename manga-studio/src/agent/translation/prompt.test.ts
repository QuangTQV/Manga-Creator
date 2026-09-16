import { describe, expect, it } from "vitest";
import { buildTranslatePrompt } from "./prompt";

describe("buildTranslatePrompt", () => {
  it("includes the target language and every item's id and text", () => {
    const prompt = buildTranslatePrompt({
      items: [
        { id: "b1", text: "Xin chào" },
        { id: "b2", text: "Tạm biệt" },
      ],
      targetLanguage: "English",
    });
    expect(prompt).toContain("English");
    expect(prompt).toContain("[b1] Xin chào");
    expect(prompt).toContain("[b2] Tạm biệt");
  });

  it("asks for a JSON object keyed by translations", () => {
    const prompt = buildTranslatePrompt({ items: [{ id: "b1", text: "Hi" }], targetLanguage: "French" });
    expect(prompt).toContain('"translations"');
  });
});
