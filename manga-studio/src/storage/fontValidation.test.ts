import { describe, expect, it } from "vitest";
import { detectFontType } from "./fontValidation";

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

describe("detectFontType", () => {
  it("recognizes a TrueType font by its sfnt version tag", () => {
    expect(detectFontType(bytes(0x00, 0x01, 0x00, 0x00, 0, 0, 0, 0))).toEqual({ mimeType: "font/ttf", extension: "ttf" });
  });

  it("recognizes the older Apple 'true' TrueType tag", () => {
    expect(detectFontType(bytes(0x74, 0x72, 0x75, 0x65))).toEqual({ mimeType: "font/ttf", extension: "ttf" });
  });

  it("recognizes a TrueType Collection", () => {
    expect(detectFontType(bytes(0x74, 0x74, 0x63, 0x66))).toEqual({ mimeType: "font/ttf", extension: "ttf" });
  });

  it("recognizes an OpenType font ('OTTO')", () => {
    expect(detectFontType(bytes(0x4f, 0x54, 0x54, 0x4f))).toEqual({ mimeType: "font/otf", extension: "otf" });
  });

  it("recognizes a WOFF font", () => {
    expect(detectFontType(bytes(0x77, 0x4f, 0x46, 0x46))).toEqual({ mimeType: "font/woff", extension: "woff" });
  });

  it("recognizes a WOFF2 font", () => {
    expect(detectFontType(bytes(0x77, 0x4f, 0x46, 0x32))).toEqual({ mimeType: "font/woff2", extension: "woff2" });
  });

  it("rejects an unrecognized or too-short file rather than guessing", () => {
    expect(detectFontType(bytes(0x00, 0x00, 0x00))).toBeNull(); // too short
    expect(detectFontType(bytes(0x89, 0x50, 0x4e, 0x47))).toBeNull(); // a PNG, not a font
    expect(detectFontType(new TextEncoder().encode("not a font at all"))).toBeNull();
  });
});
