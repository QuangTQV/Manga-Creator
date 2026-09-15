import { describe, expect, it } from "vitest";
import { computeBleedPx } from "./printBleed";

describe("computeBleedPx", () => {
  it("converts inches to pixels at the export's own DPI", () => {
    expect(computeBleedPx(0.125, 300)).toBe(38); // 0.125 * 300 = 37.5, rounded
    expect(computeBleedPx(0.25, 600)).toBe(150);
  });

  it("clamps negative input to zero", () => {
    expect(computeBleedPx(-1, 300)).toBe(0);
  });

  it("returns zero when bleed is disabled", () => {
    expect(computeBleedPx(0, 300)).toBe(0);
  });
});
