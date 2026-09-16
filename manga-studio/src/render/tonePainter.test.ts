/**
 * The four traditional Japanese pattern painters (asanoha, ichimatsu, shippo,
 * uroko) added alongside the original dot/line/cross-hatch/gradient/noise
 * set. Not pixel-exact assertions (there is no real canvas in this test
 * environment — see MEMORY.md's Konva/canvas gotcha) — just proof that each
 * type actually paints something distinguishable instead of silently
 * no-op'ing through an unhandled switch case.
 */

import { describe, expect, it } from "vitest";
import { paintTone, type ToneContext } from "./tonePainter";
import type { ProceduralToneParams } from "@/domain/tones";

function recordingContext(): { ctx: ToneContext; calls: () => number } {
  let calls = 0;
  const ctx: ToneContext = {
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    rect() {},
    fill() {
      calls += 1;
    },
    stroke() {
      calls += 1;
    },
    fillRect() {
      calls += 1;
    },
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    globalAlpha: 1,
  };
  return { ctx, calls: () => calls };
}

const TRADITIONAL_TYPES = ["asanoha", "ichimatsu", "shippo", "uroko"] as const;

describe("traditional Japanese tone patterns actually paint", () => {
  for (const type of TRADITIONAL_TYPES) {
    it(`draws something for "${type}"`, () => {
      const recorder = recordingContext();
      const params: ProceduralToneParams = { type, density: 0.4, frequency: 20, angle: 0 };
      paintTone(recorder.ctx, 200, 200, params);
      expect(recorder.calls()).toBeGreaterThan(0);
    });
  }

  it("paints nothing when density is zero, same as every other pattern", () => {
    const recorder = recordingContext();
    paintTone(recorder.ctx, 200, 200, { type: "asanoha", density: 0, frequency: 20, angle: 0 });
    expect(recorder.calls()).toBe(0);
  });
});
