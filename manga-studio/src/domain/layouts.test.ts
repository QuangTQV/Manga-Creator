import { describe, expect, it } from "vitest";
import { estimatePanelCountFromText, suggestedLayoutFor } from "./layouts";

describe("estimatePanelCountFromText", () => {
  it("counts sentence-like beats, split on . ! ? and newlines", () => {
    expect(estimatePanelCountFromText("Haruto runs. A monster follows.")).toBe(2);
    expect(estimatePanelCountFromText("Haruto runs!\nA monster follows?\nHina is trapped.")).toBe(3);
  });

  it("clamps to the [1, 4] range the layout presets actually support", () => {
    expect(estimatePanelCountFromText("")).toBe(1);
    expect(estimatePanelCountFromText("   ")).toBe(1);
    expect(estimatePanelCountFromText("One beat only, no terminator")).toBe(1);
    expect(estimatePanelCountFromText("One. Two. Three. Four. Five. Six.")).toBe(4);
  });

  it("ignores empty segments from trailing punctuation or blank lines", () => {
    expect(estimatePanelCountFromText("Haruto runs.\n\nA monster follows.")).toBe(2);
    expect(estimatePanelCountFromText("Haruto runs...")).toBe(1);
  });
});

describe("suggestedLayoutFor", () => {
  it("maps beat count to the matching preset", () => {
    expect(suggestedLayoutFor("Just one beat")).toBe("single");
    expect(suggestedLayoutFor("Beat one. Beat two.")).toBe("two-vertical");
    expect(suggestedLayoutFor("Beat one. Beat two. Beat three.")).toBe("three-vertical");
    expect(suggestedLayoutFor("Beat one. Beat two. Beat three. Beat four.")).toBe("four-grid");
  });

  it("caps at four-grid rather than picking yonkoma automatically", () => {
    // Yonkoma is a deliberate creative choice (via the "Convert to yonkoma"
    // quick action), not something Auto should guess into from beat count alone.
    expect(suggestedLayoutFor("One. Two. Three. Four. Five. Six. Seven.")).toBe("four-grid");
  });
});
