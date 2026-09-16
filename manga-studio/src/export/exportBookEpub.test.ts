import { describe, expect, it } from "vitest";
import { epubLanguageCode, escapeXml } from "./exportBookEpub";

describe("escapeXml", () => {
  it("escapes every XML-significant character", () => {
    expect(escapeXml(`<Title> & "quotes" 'here'`)).toBe("&lt;Title&gt; &amp; &quot;quotes&quot; &apos;here&apos;");
  });

  it("leaves ordinary text untouched", () => {
    expect(escapeXml("My Manga Chapter 1")).toBe("My Manga Chapter 1");
  });
});

describe("epubLanguageCode", () => {
  it("maps a known dialogue language name to its BCP-47 code", () => {
    expect(epubLanguageCode("Vietnamese")).toBe("vi");
    expect(epubLanguageCode("Japanese")).toBe("ja");
  });

  it("is case-insensitive", () => {
    expect(epubLanguageCode("ENGLISH")).toBe("en");
  });

  it("falls back to English for an unrecognized or absent language", () => {
    expect(epubLanguageCode("Klingon")).toBe("en");
    expect(epubLanguageCode(undefined)).toBe("en");
    expect(epubLanguageCode("")).toBe("en");
  });
});
