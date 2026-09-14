/**
 * Prompt for turning one chunk of novel text into structured scenes/beats
 * (see schema.ts). Structure and rules are ported from MangaFlow's
 * story_parse chunk prompt (worker_handlers/story_parse.py) — translated to
 * English, Kumanga's field names, and its own fidelity dial.
 */

import type { NovelSegment } from "./segmentation";

/** How much creative liberty the model takes turning prose into panels — a
 * genuinely necessary dial for novel adaptation specifically: a page holds
 * far less prose than a paragraph, so SOME compression is unavoidable, and
 * the creator should choose how much interpretation vs strict transcription
 * they want, the same way MangaFlow's DIRECTOR/SEMI_AUTO/AUTO modes do. */
export type NovelFidelity = "faithful" | "guided" | "creative";

const FIDELITY_INSTRUCTION: Record<NovelFidelity, string> = {
  faithful:
    "FAITHFUL mode: structure only what the source text explicitly states. Do not invent actions, expressions, or environment details the text doesn't support — leave a field empty rather than guess.",
  guided:
    "GUIDED mode: you may add the action, expression, and environment detail a panel needs to read visually, but never invent new plot facts, character motives, or events the source doesn't contain.",
  creative:
    "CREATIVE mode: actively supply visualizable action, expression, environment, transitions, subtext, and page-turn beats where the prose is sparse — but the PLOT itself must never change from what the source describes.",
};

export interface NovelParseChunkInput {
  chunkLabel: string; // e.g. "2/5" — told to the model so it never guesses at neighboring chunks
  segments: NovelSegment[];
  fidelity: NovelFidelity;
  /** Primary names already established by earlier chunks in this chapter —
   * told to the model so it reuses the exact same name instead of drifting
   * to a nickname or a retranslated spelling mid-chapter. */
  knownCharacterNames: string[];
}

export const NOVEL_PARSE_SYSTEM_PROMPT =
  "You are a faithful manga script structuring editor. Source coverage matters more than brevity — every sentence in the input must be accounted for by some scene or beat.";

export function buildNovelParsePrompt(input: NovelParseChunkInput): string {
  const known =
    input.knownCharacterNames.length > 0
      ? `Characters already established earlier in this chapter — reuse these EXACT names, never a nickname or retranslation of them: ${input.knownCharacterNames.join(", ")}.\n`
      : "";
  return `Rewrite the following novel excerpt into a complete manga script, segment by segment. Summarizing, cutting, or merging away plot content is forbidden — every segment must be represented.
${FIDELITY_INSTRUCTION[input.fidelity]}
Extract: each character's primary name and any aliases/nicknames used for them; each scene's location, time, weather, and dramatic purpose; and, beat by beat, the action, exact quoted dialogue (byte-exact, never paraphrased), narration, speaker, emotion, subtext, an importance score (0-1, how much this beat matters to the page), whether it must be drawn as its own panel, whether it may share a panel with the next beat, and whether it is a natural page-turn cliffhanger.
For every beat, set characterPresence for each character involved: "visible" if actually drawn on-panel, "offscreen" if speaking/acting without being drawn (e.g. a voice through a door), "mentioned" if only referred to in dialogue or narration. A photograph, portrait, or memorial of a character is a PROP, not that character being visible — never mark someone "visible" because an image of them appears.
${known}This is chunk ${input.chunkLabel} of the chapter — only structure THIS excerpt; do not guess at content from other chunks.

Respond with ONLY one JSON object shaped exactly like this (omit a field only where the schema below marks it optional; use empty string/array/object, never null or placeholder words like "unknown"):
{
  "characters": [{ "primaryName": "Aki", "aliases": ["Aki-chan"], "description": "..." }],
  "scenes": [{
    "ordinal": 1, "location": "...", "timeLabel": "...", "weather": "...", "purpose": "...",
    "beats": [{
      "ordinal": 1, "action": "...", "speakerName": "Aki", "dialogue": "exact quoted line",
      "narration": "", "emotion": "worried", "subtext": "...",
      "importance": 0.7, "mustVisualize": true, "mergeable": false, "pageTurnHook": false,
      "characterPresence": { "Aki": "visible", "Momo": "mentioned" }, "props": []
    }]
  }]
}

Excerpt:
${input.segments.map((segment) => `[segment ${segment.ordinal}] ${segment.text}`).join("\n\n")}`;
}
