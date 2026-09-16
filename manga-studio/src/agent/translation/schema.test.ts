import { describe, expect, it } from "vitest";
import { parseTranslateOutput } from "./schema";

describe("parseTranslateOutput", () => {
  it("accepts a valid translations array", () => {
    const { output, error } = parseTranslateOutput({ translations: [{ id: "b1", text: "Hello" }] });
    expect(error).toBeUndefined();
    expect(output?.translations).toEqual([{ id: "b1", text: "Hello" }]);
  });

  it("rejects a missing translations field with a descriptive error", () => {
    const { output, error } = parseTranslateOutput({ nonsense: true });
    expect(output).toBeUndefined();
    expect(error).toContain("translations");
  });

  it("rejects an empty translations array", () => {
    const { output } = parseTranslateOutput({ translations: [] });
    expect(output).toBeUndefined();
  });

  it("rejects a translation entry missing an id", () => {
    const { output } = parseTranslateOutput({ translations: [{ text: "Hello" }] });
    expect(output).toBeUndefined();
  });
});
