import { describe, expect, it } from "vitest";
import { checkWebtoonCanvasLimit } from "./exportWebtoon";

describe("checkWebtoonCanvasLimit", () => {
  it("allows a strip within the browser-safe canvas ceiling", () => {
    expect(() => checkWebtoonCanvasLimit(2400, 14_000, 2)).not.toThrow();
  });

  it("rejects a strip whose total height exceeds the ceiling, with an actionable message", () => {
    expect(() => checkWebtoonCanvasLimit(2400, 20_000, 2)).toThrow(/too long.*webtoon strip at 2x/i);
    expect(() => checkWebtoonCanvasLimit(2400, 20_000, 2)).toThrow(/Try @1x, or export the book as CBZ instead/);
  });

  it("rejects a strip whose width alone exceeds the ceiling", () => {
    expect(() => checkWebtoonCanvasLimit(20_000, 3_000, 1)).toThrow(/too long/i);
  });
});
