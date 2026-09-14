/**
 * Pure text segmentation — no IO, no LLM. Splits pasted/uploaded novel text
 * into chapters, then each chapter into LLM-sized chunks, so a whole novel
 * never has to fit in one completion call. Ported concept from MangaFlow's
 * split_chapters/_paragraph_ranges/_split_long_range (content_workflow.py),
 * re-tuned for English prose (MangaFlow's char caps and its 第X章-style
 * chapter regex are Chinese-specific — Chinese packs far more meaning per
 * character, so a much smaller cap applies there).
 */

export interface NovelChapterDraft {
  title: string;
  text: string;
}

export interface NovelSegment {
  ordinal: number;
  text: string;
}

/** English/common chapter-heading patterns: "Chapter 1", "Chapter One:",
 * "CHAPTER IV", "Part 3", "Prologue", "Epilogue" — each required to be
 * alone on its line (a heading, not a mid-sentence mention). */
const CHAPTER_HEADER = new RegExp(
  String.raw`^[ \t]*(chapter\s+[\dIVXLCDM]+\b.*|chapter\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\b.*|part\s+[\dIVXLCDM]+\b.*|prologue\b.*|epilogue\b.*)[ \t]*$`,
  "gim",
);

const MAX_CHAPTER_TITLE_LENGTH = 200;

function normalizeTitle(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim().slice(0, MAX_CHAPTER_TITLE_LENGTH);
}

/** Splits on detected chapter headings; the whole text is one chapter
 * (`fallbackTitle`) when none are found — pasting a short story or a
 * single chapter is the common case, not an error. */
export function splitIntoChapters(text: string, fallbackTitle: string): NovelChapterDraft[] {
  const matches = [...text.matchAll(CHAPTER_HEADER)];
  if (matches.length === 0) {
    return [{ title: normalizeTitle(fallbackTitle) || "Untitled", text }];
  }
  const chapters: NovelChapterDraft[] = [];
  const prefix = text.slice(0, matches[0].index ?? 0);
  matches.forEach((match, index) => {
    const start = match.index ?? 0;
    const end = index + 1 < matches.length ? (matches[index + 1].index ?? text.length) : text.length;
    let chunk = text.slice(start, end);
    if (index === 0 && prefix.trim()) chunk = prefix + chunk;
    chapters.push({ title: normalizeTitle(match[0]) || `Chapter ${index + 1}`, text: chunk });
  });
  return chapters;
}

const PARAGRAPH_BREAK = /\r?\n\s*\r?\n+/g;
/** Prefer breaking a paragraph at the end of a sentence over a hard mid-word
 * cut — keeps a chunk from splitting a quote or a beat in half. */
const SENTENCE_END = /[.!?][ \t]/g;

function paragraphRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let cursor = 0;
  for (const match of text.matchAll(PARAGRAPH_BREAK)) {
    const end = match.index ?? cursor;
    if (text.slice(cursor, end).trim()) ranges.push([cursor, end]);
    cursor = end + match[0].length;
  }
  if (text.slice(cursor).trim()) ranges.push([cursor, text.length]);
  if (ranges.length === 0 && text.trim()) ranges.push([0, text.length]);
  return ranges;
}

function splitLongRange(text: string, start: number, end: number, maxChars: number): Array<[number, number]> {
  if (end - start <= maxChars) return [[start, end]];
  const ranges: Array<[number, number]> = [];
  let cursor = start;
  while (cursor < end) {
    let upper = Math.min(cursor + maxChars, end);
    if (upper < end) {
      let boundary = -1;
      SENTENCE_END.lastIndex = 0;
      for (const match of text.slice(cursor, upper).matchAll(SENTENCE_END)) {
        boundary = cursor + (match.index ?? 0) + 1;
      }
      if (boundary > cursor + maxChars / 2) upper = boundary;
    }
    ranges.push([cursor, upper]);
    cursor = upper;
  }
  return ranges;
}

/** `maxChars` bounds a single LLM call's input — large enough to give the
 * model real narrative continuity, small enough to keep output parseable
 * and a single failed chunk cheap to retry. ~1800 chars (~300 English
 * words) is a paragraph or two of prose, comfortably inside any provider's
 * context/output budget for the beat-by-beat detail this asks for. */
export function splitIntoSegments(chapterText: string, maxChars = 1800): NovelSegment[] {
  const segments: NovelSegment[] = [];
  let ordinal = 1;
  for (const [start, end] of paragraphRanges(chapterText)) {
    for (const [chunkStart, chunkEnd] of splitLongRange(chapterText, start, end, maxChars)) {
      const value = chapterText.slice(chunkStart, chunkEnd);
      if (!value.trim()) continue;
      segments.push({ ordinal: ordinal++, text: value });
    }
  }
  return segments;
}

/** Groups consecutive segments into one LLM call's worth of input —
 * separate from the per-segment character cap above: this bounds how many
 * segments (not characters) travel in one request, so a very short-segment
 * chapter (lots of blank-line breaks) doesn't turn into one call per
 * paragraph. */
export function groupSegmentsIntoChunks(segments: NovelSegment[], segmentsPerChunk = 3): NovelSegment[][] {
  const chunks: NovelSegment[][] = [];
  for (let i = 0; i < segments.length; i += segmentsPerChunk) {
    chunks.push(segments.slice(i, i + segmentsPerChunk));
  }
  return chunks;
}
