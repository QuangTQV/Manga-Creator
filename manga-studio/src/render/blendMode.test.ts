import { describe, expect, it } from "vitest";
import { blendModeToCanvas } from "./blendMode";

describe("blendModeToCanvas", () => {
  it("maps an absent blend mode to canvas's own default", () => {
    expect(blendModeToCanvas(undefined)).toBe("source-over");
  });

  it("maps the 'normal' sentinel to canvas's own default", () => {
    expect(blendModeToCanvas("normal")).toBe("source-over");
  });

  it("passes every other value straight through — it's already a real GlobalCompositeOperation", () => {
    expect(blendModeToCanvas("multiply")).toBe("multiply");
    expect(blendModeToCanvas("screen")).toBe("screen");
    expect(blendModeToCanvas("color-dodge")).toBe("color-dodge");
  });
});
