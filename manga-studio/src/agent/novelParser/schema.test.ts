import { describe, expect, it } from "vitest";
import { parseNovelParseOutput } from "./schema";

describe("parseNovelParseOutput", () => {
  it("accepts a well-formed output and fills in defaults for omitted fields", () => {
    const { output, error } = parseNovelParseOutput({
      characters: [{ primaryName: "Aki" }],
      scenes: [
        {
          ordinal: 1,
          location: "a station platform",
          beats: [{ ordinal: 1, action: "waits in the rain" }],
        },
      ],
    });
    expect(error).toBeUndefined();
    expect(output?.characters[0].aliases).toEqual([]);
    expect(output?.scenes[0].beats[0].mustVisualize).toBe(true);
    expect(output?.scenes[0].beats[0].importance).toBe(0.5);
    expect(output?.scenes[0].beats[0].characterPresence).toEqual({});
  });

  it("accepts an empty output (a chunk with no visualizable content)", () => {
    const { output, error } = parseNovelParseOutput({ characters: [], scenes: [] });
    expect(error).toBeUndefined();
    expect(output).toEqual({ characters: [], scenes: [] });
  });

  it("rejects a character with no primaryName", () => {
    const { output, error } = parseNovelParseOutput({ characters: [{ primaryName: "" }], scenes: [] });
    expect(output).toBeUndefined();
    expect(error).toContain("characters[0].primaryName");
  });

  it("rejects an out-of-range importance score with a pointed field path", () => {
    const { error } = parseNovelParseOutput({
      characters: [],
      scenes: [{ ordinal: 1, beats: [{ ordinal: 1, importance: 4 }] }],
    });
    expect(error).toContain("scenes[0].beats[0].importance");
  });

  it("rejects a characterPresence value outside visible/offscreen/mentioned", () => {
    const { error } = parseNovelParseOutput({
      characters: [],
      scenes: [{ ordinal: 1, beats: [{ ordinal: 1, characterPresence: { Aki: "somewhere-else" } }] }],
    });
    expect(error).toBeDefined();
  });

  it("rejects non-object input without throwing", () => {
    const { output, error } = parseNovelParseOutput("not an object");
    expect(output).toBeUndefined();
    expect(error).toBeDefined();
  });
});
