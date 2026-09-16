import { describe, expect, it } from "vitest";
import { parseLayoutSvg } from "./importLayoutSvg";

describe("parseLayoutSvg", () => {
  it("normalizes rects against the viewBox", () => {
    const svg = `<svg viewBox="0 0 1000 1500" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="1000" height="700" />
      <rect x="0" y="800" width="1000" height="700" />
    </svg>`;
    const rects = parseLayoutSvg(svg);
    expect(rects).toHaveLength(2);
    expect(rects[0]).toEqual({ x: 0, y: 0, width: 1, height: 700 / 1500 });
    expect(rects[1]).toEqual({ x: 0, y: 800 / 1500, width: 1, height: 700 / 1500 });
  });

  it("falls back to width/height attributes when there is no viewBox", () => {
    const svg = `<svg width="800" height="1200"><rect x="100" y="100" width="600" height="1000"/></svg>`;
    const rects = parseLayoutSvg(svg);
    expect(rects).toEqual([{ x: 0.125, y: 100 / 1200, width: 0.75, height: 1000 / 1200 }]);
  });

  it("clamps a rect that overhangs the canvas instead of producing an out-of-range value", () => {
    const svg = `<svg viewBox="0 0 100 100"><rect x="-10" y="90" width="50" height="50"/></svg>`;
    const [rect] = parseLayoutSvg(svg);
    expect(rect.x).toBe(0);
    expect(rect.width).toBeLessThanOrEqual(1);
  });

  it("skips degenerate rects (zero or missing width/height)", () => {
    const svg = `<svg viewBox="0 0 100 100">
      <rect x="0" y="0" width="0" height="50"/>
      <rect x="0" y="0" width="50"/>
      <rect x="10" y="10" width="40" height="40"/>
    </svg>`;
    expect(parseLayoutSvg(svg)).toHaveLength(1);
  });

  it("throws a clear error when there is no <svg> root", () => {
    expect(() => parseLayoutSvg("<div>not an svg</div>")).toThrow(/valid SVG/);
  });

  it("throws when the SVG has no rects to import", () => {
    const svg = `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="20"/></svg>`;
    expect(() => parseLayoutSvg(svg)).toThrow(/No panel rectangles/);
  });

  it("throws when the SVG has neither a viewBox nor width/height", () => {
    const svg = `<svg><rect x="0" y="0" width="10" height="10"/></svg>`;
    expect(() => parseLayoutSvg(svg)).toThrow(/viewBox/);
  });
});
