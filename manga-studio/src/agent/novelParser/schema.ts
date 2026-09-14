/**
 * Novel → structured script contract. The LLM turns raw prose into scenes of
 * beats with pacing signals (importance / mergeable / pageTurnHook); a
 * DETERMINISTIC algorithm (pagination.ts) then decides where pages actually
 * break — the model is never asked to output page/panel layout directly,
 * the same division of labor the Creative Director itself uses (LLM decides
 * meaning, code decides structure).
 *
 * Ported from — and considerably slimmed down for Kumanga's needs versus —
 * the sibling MangaFlow project's StoryParseOutput/SceneDraft/BeatDraft
 * (apps/api/app/services/ai_schemas.py, worker_handlers/story_parse.py).
 * MangaFlow persists this as normalized DB rows with cross-chunk alias
 * merging, ordinal-conflict retries and character-offset anchoring; Kumanga
 * has none of that machinery (no server DB — projects are a client-side
 * document), so this keeps only what a single browser session actually
 * needs to plan pages, and skips DB-shaped concerns entirely.
 */

import { z } from "zod";

const text = (max: number) => z.string().max(max).default("");
const name = z.string().min(1).max(80);

/** VISIBLE = drawn on-panel. OFFSCREEN = speaks/acts without being drawn
 * (a voice through a door). MENTIONED = referred to only in dialogue or
 * narration — must NOT be drawn. Mirrors MangaFlow's character_presence,
 * which exists specifically to stop models from drawing someone a line of
 * dialogue merely refers to. */
export const presenceSchema = z.enum(["visible", "offscreen", "mentioned"]);

export const novelBeatSchema = z.object({
  ordinal: z.number().int().min(0).default(0),
  /** What happens, in the creator's own visual language — never a plot summary. */
  action: text(400),
  speakerName: text(80),
  /** Exact, byte-preserved quoted dialogue from the source — never paraphrased. */
  dialogue: text(400),
  narration: text(300),
  emotion: text(60),
  /** Subtext a panel's staging/expression should carry without being said aloud. */
  subtext: text(200),
  /** 0-1: how much this beat matters to the page. Pagination spends its
   * limited panel budget on the highest-importance beats in a scene. */
  importance: z.number().min(0).max(1).default(0.5),
  /** False = connective tissue (a beat that exists for narrative completeness
   * but doesn't need its own panel) — pagination may fold it into a
   * neighboring beat's panel instead of spending a panel on it alone. */
  mustVisualize: z.boolean().default(true),
  /** True = this beat and the next may share one panel if space is tight. */
  mergeable: z.boolean().default(false),
  /** True = a natural page-turn cliffhanger; pagination always ends the
   * current page after a beat marked true instead of packing more in. */
  pageTurnHook: z.boolean().default(false),
  characterPresence: z.record(z.string(), presenceSchema).default({}),
  /** Scene objects worth drawing (a photograph, a weapon) — kept distinct
   * from characterPresence so a photo of someone is never mistaken for
   * that person actually being on-panel. */
  props: z.array(z.string().max(60)).max(10).default([]),
});
export type NovelBeat = z.infer<typeof novelBeatSchema>;

export const novelSceneSchema = z.object({
  ordinal: z.number().int().min(0).default(0),
  location: text(160),
  timeLabel: text(60),
  weather: text(60),
  /** One sentence: what this scene needs to accomplish dramatically. */
  purpose: text(300),
  beats: z.array(novelBeatSchema).max(60).default([]),
});
export type NovelScene = z.infer<typeof novelSceneSchema>;

export const novelCharacterSchema = z.object({
  primaryName: name,
  aliases: z.array(z.string().max(80)).max(10).default([]),
  description: text(500),
});
export type NovelCharacter = z.infer<typeof novelCharacterSchema>;

export const novelParseOutputSchema = z.object({
  characters: z.array(novelCharacterSchema).max(30).default([]),
  scenes: z.array(novelSceneSchema).max(20).default([]),
});
export type NovelParseOutput = z.infer<typeof novelParseOutputSchema>;

export function parseNovelParseOutput(raw: unknown): { output?: NovelParseOutput; error?: string } {
  const parsed = novelParseOutputSchema.safeParse(raw);
  if (!parsed.success) {
    const formatPath = (path: PropertyKey[]) =>
      path.reduce<string>((acc, seg) => (typeof seg === "number" ? `${acc}[${seg}]` : acc ? `${acc}.${String(seg)}` : String(seg)), "");
    const details = parsed.error.issues
      .slice(0, 3)
      .map((issue) => `${formatPath(issue.path) || "(root)"} — ${issue.message}`)
      .join("; ");
    return { error: `Novel parse output invalid: ${details}` };
  }
  return { output: parsed.data };
}
