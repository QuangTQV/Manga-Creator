import { describe, expect, it } from "vitest";
import { cropMarkGeometry } from "./printCropMarks";

describe("cropMarkGeometry", () => {
  it("returns null when the bleed margin is too thin to hold a mark", () => {
    expect(cropMarkGeometry(0)).toBeNull();
    expect(cropMarkGeometry(3)).toBeNull();
  });

  it("sizes gap and length proportionally to the bleed, always fitting inside it", () => {
    const geo = cropMarkGeometry(100);
    expect(geo).not.toBeNull();
    expect(geo!.gap).toBe(20);
    expect(geo!.length).toBe(60);
    // Never runs past the outer canvas edge: gap + length stays inside bleedPx.
    expect(geo!.gap + geo!.length).toBeLessThan(100);
  });

  it("keeps a minimum stroke weight of 1px even for a very thin bleed", () => {
    expect(cropMarkGeometry(4)!.weight).toBe(1);
  });

  it("scales stroke weight up for a generous bleed", () => {
    const geo = cropMarkGeometry(200)!;
    expect(geo.weight).toBeGreaterThan(1);
    expect(geo.weight).toBe(8);
  });
});
