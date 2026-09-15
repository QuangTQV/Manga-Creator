import { describe, expect, it } from "vitest";
import {
  clipPolygonHalfPlane,
  convexHull,
  cropModeTransform,
  DEFAULT_UPPER_BODY_REGION,
  fillTransform,
  fitTransform,
  frameRegionTransform,
  pointInPolygon,
  polygonBounds,
  polygonToNormalized,
  polygonToPx,
  rectToPoints,
  supportsFaceFocus,
} from "./geometry";

// A tall portrait character in a landscape panel — the common hard case.
const ASSET = { width: 1000, height: 2000 };
const PANEL = { width: 400, height: 300 };

describe("fitTransform", () => {
  it("contains the whole asset inside the panel", () => {
    const t = fitTransform(ASSET.width, ASSET.height, PANEL.width, PANEL.height);
    expect(t.height).toBeCloseTo(300);
    expect(t.width).toBeCloseTo(150);
    expect(t.cx).toBeCloseTo(200);
    expect(t.cy).toBeCloseTo(150);
  });

  it("preserves aspect ratio", () => {
    const t = fitTransform(ASSET.width, ASSET.height, PANEL.width, PANEL.height);
    expect(t.width / t.height).toBeCloseTo(ASSET.width / ASSET.height);
  });
});

describe("fillTransform", () => {
  it("covers the panel completely (overflow clipped by viewport)", () => {
    const t = fillTransform(ASSET.width, ASSET.height, PANEL.width, PANEL.height);
    expect(t.width).toBeGreaterThanOrEqual(PANEL.width);
    expect(t.height).toBeGreaterThanOrEqual(PANEL.height);
    expect(t.width).toBeCloseTo(400);
    expect(t.height).toBeCloseTo(800);
  });

  it("2000x3000 asset in 400x600 panel yields center crop (PRD acceptance)", () => {
    const t = fillTransform(2000, 3000, 400, 600);
    expect(t.width).toBeCloseTo(400);
    expect(t.height).toBeCloseTo(600);
    expect(t.cx).toBeCloseTo(200);
    expect(t.cy).toBeCloseTo(300);
  });
});

describe("frameRegionTransform", () => {
  it("centers the region on the panel and covers it", () => {
    // Face occupies the top-middle 20% of the asset.
    const region = { x: 0.4, y: 0.05, width: 0.2, height: 0.15 };
    const t = frameRegionTransform(ASSET.width, ASSET.height, PANEL.width, PANEL.height, region);
    // Rendered region size must cover the panel.
    expect(region.width * t.width).toBeGreaterThanOrEqual(PANEL.width - 0.01);
    expect(region.height * t.height).toBeGreaterThanOrEqual(PANEL.height - 0.01);
    // Region center lands on panel center.
    const regionCenterX = t.cx + (region.x + region.width / 2 - 0.5) * t.width;
    const regionCenterY = t.cy + (region.y + region.height / 2 - 0.5) * t.height;
    expect(regionCenterX).toBeCloseTo(PANEL.width / 2);
    expect(regionCenterY).toBeCloseTo(PANEL.height / 2);
  });
});

describe("cropModeTransform", () => {
  it("upper-body falls back to the heuristic region without metadata", () => {
    const t = cropModeTransform("upper-body", { ...ASSET, focusRegions: undefined }, PANEL.width, PANEL.height);
    expect(t).not.toBeNull();
    // The upper-body frame must zoom in more than plain fill.
    const fill = fillTransform(ASSET.width, ASSET.height, PANEL.width, PANEL.height);
    expect(t!.width).toBeGreaterThan(fill.width);
    expect(DEFAULT_UPPER_BODY_REGION.y).toBeLessThan(0.5);
  });

  it("face mode is unavailable (null) without region metadata — never faked", () => {
    expect(cropModeTransform("face", { ...ASSET }, PANEL.width, PANEL.height)).toBeNull();
    expect(supportsFaceFocus({ focusRegions: undefined })).toBe(false);
  });

  it("face mode frames the annotated region when present", () => {
    const asset = {
      ...ASSET,
      focusRegions: [{ kind: "face" as const, rect: { x: 0.35, y: 0.02, width: 0.3, height: 0.15 } }],
    };
    expect(supportsFaceFocus(asset)).toBe(true);
    const t = cropModeTransform("face", asset, PANEL.width, PANEL.height);
    expect(t).not.toBeNull();
    expect(t!.width).toBeGreaterThan(PANEL.width);
  });

  it("custom returns null (keep the user's transform)", () => {
    expect(cropModeTransform("custom", { ...ASSET }, PANEL.width, PANEL.height)).toBeNull();
  });
});

describe("panel polygons", () => {
  it("rectToPoints produces the equivalent clockwise quad", () => {
    const points = rectToPoints({ x: 0.1, y: 0.2, width: 0.4, height: 0.3 });
    expect(points).toEqual([
      { x: 0.1, y: 0.2 },
      { x: 0.5, y: 0.2 },
      { x: 0.5, y: 0.5 },
      { x: 0.1, y: 0.5 },
    ]);
  });

  it("polygonToPx + polygonBounds recover the pixel rect", () => {
    const px = polygonToPx(rectToPoints({ x: 0.5, y: 0.25, width: 0.5, height: 0.5 }), 1200, 1800);
    expect(polygonBounds(px)).toEqual({ x: 600, y: 450, width: 600, height: 900 });
  });

  it("pointInPolygon works for non-rectangular (diagonal) panels", () => {
    // Right triangle: the classic diagonal manga panel cut.
    const triangle = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 0, y: 100 },
    ];
    expect(pointInPolygon(10, 10, triangle)).toBe(true);
    expect(pointInPolygon(90, 90, triangle)).toBe(false); // inside bbox, outside polygon
    expect(pointInPolygon(150, 50, triangle)).toBe(false);
  });

  it("polygonToNormalized is the exact inverse of polygonToPx", () => {
    const normalized = rectToPoints({ x: 0.1, y: 0.2, width: 0.3, height: 0.4 });
    const roundTripped = polygonToNormalized(polygonToPx(normalized, 1200, 1800), 1200, 1800);
    for (let i = 0; i < normalized.length; i++) {
      expect(roundTripped[i].x).toBeCloseTo(normalized[i].x, 10);
      expect(roundTripped[i].y).toBeCloseTo(normalized[i].y, 10);
    }
  });
});

describe("clipPolygonHalfPlane (splitPanel's cut)", () => {
  const square = rectToPoints({ x: 0, y: 0, width: 100, height: 100 });

  it("keeps only the left half when clipping x <= 50", () => {
    const left = clipPolygonHalfPlane(square, (p) => p.x - 50);
    expect(polygonBounds(left)).toEqual({ x: 0, y: 0, width: 50, height: 100 });
  });

  it("the two halves of a clip partition the original area", () => {
    const left = clipPolygonHalfPlane(square, (p) => p.x - 50);
    const right = clipPolygonHalfPlane(square, (p) => 50 - p.x);
    const area = (points: typeof square) => {
      let sum = 0;
      for (let i = 0; i < points.length; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        sum += a.x * b.y - b.x * a.y;
      }
      return Math.abs(sum / 2);
    };
    expect(area(left) + area(right)).toBeCloseTo(area(square), 5);
  });

  it("clipping entirely outside the half-plane yields an empty polygon", () => {
    expect(clipPolygonHalfPlane(square, () => 1)).toEqual([]);
  });

  it("works on a non-rectangular (diagonal) panel too", () => {
    const triangle = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 0, y: 100 },
    ];
    const left = clipPolygonHalfPlane(triangle, (p) => p.x - 50);
    // Cutting a right triangle at x=50 leaves a smaller polygon entirely
    // within the left half, touching but not crossing the cut line.
    expect(left.every((p) => p.x <= 50 + 1e-9)).toBe(true);
    expect(left.length).toBeGreaterThanOrEqual(3);
  });
});

describe("convexHull (mergePanels' shape)", () => {
  it("returns the hull vertices only, dropping interior/collinear points", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
      { x: 50, y: 50 }, // interior — must not survive
      { x: 50, y: 0 }, // collinear on the bottom edge — must not survive
    ];
    const hull = convexHull(points);
    expect(hull).toHaveLength(4);
    expect(hull).not.toContainEqual({ x: 50, y: 50 });
  });

  it("covers two separate rectangles (the merge-two-panels case)", () => {
    const a = rectToPoints({ x: 0, y: 0, width: 100, height: 100 });
    const b = rectToPoints({ x: 200, y: 0, width: 100, height: 100 });
    const hull = convexHull([...a, ...b]);
    const bounds = polygonBounds(hull);
    expect(bounds).toEqual({ x: 0, y: 0, width: 300, height: 100 });
  });
});
