import { describe, expect, it } from "vitest";
import { groupSegmentsIntoChunks, splitIntoChapters, splitIntoSegments } from "./segmentation";

describe("splitIntoChapters", () => {
  it("treats the whole text as one chapter when no heading is found", () => {
    const chapters = splitIntoChapters("Once upon a time, in a quiet village...", "My Story");
    expect(chapters).toHaveLength(1);
    expect(chapters[0].title).toBe("My Story");
  });

  it("splits on 'Chapter N' headings, keeping any prologue text with chapter 1", () => {
    const text = [
      "A brief prologue line.",
      "",
      "Chapter 1: The Beginning",
      "Aki walked into the rain.",
      "",
      "Chapter 2",
      "Momo waited at the station.",
    ].join("\n");
    const chapters = splitIntoChapters(text, "fallback");
    expect(chapters).toHaveLength(2);
    expect(chapters[0].title).toContain("Chapter 1");
    expect(chapters[0].text).toContain("A brief prologue line.");
    expect(chapters[0].text).toContain("Aki walked into the rain.");
    expect(chapters[1].title).toContain("Chapter 2");
    expect(chapters[1].text).toContain("Momo waited at the station.");
    expect(chapters[1].text).not.toContain("Aki walked");
  });

  it("recognizes Roman-numeral and spelled-out chapter headings", () => {
    const romanChapters = splitIntoChapters("Chapter IV\nSome text.\nChapter V\nMore text.", "fallback");
    expect(romanChapters).toHaveLength(2);

    const spelledChapters = splitIntoChapters("Chapter One\nSome text.\nChapter Two\nMore text.", "fallback");
    expect(spelledChapters).toHaveLength(2);
  });

  it("recognizes Prologue/Epilogue as chapter-like headings", () => {
    const chapters = splitIntoChapters("Prologue\nBefore it all began.\nEpilogue\nAfter it ended.", "fallback");
    expect(chapters.map((c) => c.title)).toEqual(["Prologue", "Epilogue"]);
  });

  it("does not treat a mid-sentence mention of 'chapter' as a heading", () => {
    const chapters = splitIntoChapters("She had read every chapter twice before bed.", "fallback");
    expect(chapters).toHaveLength(1);
  });

  it("falls back to 'Untitled' when both the title and the text lack a usable title", () => {
    const chapters = splitIntoChapters("No headings here.", "   ");
    expect(chapters[0].title).toBe("Untitled");
  });
});

describe("splitIntoSegments", () => {
  it("splits on blank-line paragraph breaks", () => {
    const segments = splitIntoSegments("First paragraph.\n\nSecond paragraph.\n\nThird paragraph.");
    expect(segments.map((s) => s.text)).toEqual(["First paragraph.", "Second paragraph.", "Third paragraph."]);
    expect(segments.map((s) => s.ordinal)).toEqual([1, 2, 3]);
  });

  it("keeps a short chapter as a single segment", () => {
    const segments = splitIntoSegments("Just one short paragraph.");
    expect(segments).toHaveLength(1);
  });

  it("splits an overlong paragraph at a sentence boundary near the char cap", () => {
    const sentence = "This is one sentence of the story. ";
    const long = sentence.repeat(20); // ~700 chars, well over a small cap
    const segments = splitIntoSegments(long, 200);
    expect(segments.length).toBeGreaterThan(1);
    // Every piece should end at (or very near) a sentence boundary, not mid-word.
    for (const segment of segments.slice(0, -1)) {
      expect(segment.text.trimEnd().endsWith(".")).toBe(true);
    }
    // No content lost: concatenating every piece reconstructs the original.
    expect(segments.map((s) => s.text).join("")).toBe(long);
  });

  it("ignores blank paragraphs created by excess whitespace", () => {
    const segments = splitIntoSegments("First.\n\n\n\n   \n\nSecond.");
    expect(segments.map((s) => s.text)).toEqual(["First.", "Second."]);
  });
});

describe("groupSegmentsIntoChunks", () => {
  it("groups consecutive segments into fixed-size chunks", () => {
    const segments = splitIntoSegments("A.\n\nB.\n\nC.\n\nD.\n\nE.");
    const chunks = groupSegmentsIntoChunks(segments, 2);
    expect(chunks).toHaveLength(3);
    expect(chunks[0].map((s) => s.text)).toEqual(["A.", "B."]);
    expect(chunks[2].map((s) => s.text)).toEqual(["E."]);
  });

  it("returns no chunks for no segments", () => {
    expect(groupSegmentsIntoChunks([], 3)).toEqual([]);
  });
});
