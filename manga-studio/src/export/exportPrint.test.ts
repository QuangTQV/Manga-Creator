import { describe, expect, it } from "vitest";
import { computePrintScale } from "./exportPrint";

describe("computePrintScale", () => {
  it("computes scale from physical width and DPI relative to the page's pixel width", () => {
    // A 1200px-wide page printed at 6in and 300dpi needs a 1800px-wide
    // output (6 * 300 = 1800), i.e. scale 1.5.
    expect(computePrintScale(1200, 6, 300)).toBeCloseTo(1.5);
  });

  it("scales up for higher DPI and down for lower DPI", () => {
    expect(computePrintScale(1200, 6, 600)).toBeCloseTo(3);
    expect(computePrintScale(1200, 6, 150)).toBeCloseTo(0.75);
  });

  it("rejects a non-positive physical width or DPI", () => {
    expect(() => computePrintScale(1200, 0, 300)).toThrow(/greater than zero/);
    expect(() => computePrintScale(1200, 6, 0)).toThrow(/greater than zero/);
    expect(() => computePrintScale(1200, -1, 300)).toThrow(/greater than zero/);
  });

  it("rejects an invalid page width", () => {
    expect(() => computePrintScale(0, 6, 300)).toThrow(/Invalid page size/);
  });
});
