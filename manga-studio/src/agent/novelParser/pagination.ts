/**
 * Deterministic pagination: groups parsed beats (schema.ts) into pages and
 * writes each page's plain-language prompt — the SAME shape of text a
 * creator would type into the Manga Agent by hand. This is the "optimization"
 * over MangaFlow's approach for Kumanga specifically: rather than building a
 * second execution engine that turns beats directly into panels/dialogue,
 * every planned page is just handed to the EXISTING, already-tested Creative
 * Director (`runCreativeDirection` in agent-v3/run.ts) exactly like a normal
 * prompt — its own literal-lock extraction picks up the quoted dialogue and
 * named characters this module is careful to preserve exactly.
 *
 * The LLM decided per-beat pacing signals (importance/mustVisualize/
 * mergeable/pageTurnHook); this module decides page/panel BOUNDARIES from
 * them — no model call here, so re-planning pagination (e.g. after changing
 * the panel budget) is instant and free.
 */

import type { NovelBeat, NovelScene } from "./schema";

export interface PlannedPage {
  id: string;
  chapterTitle: string;
  sceneOrdinal: number;
  sceneLocation: string;
  /** Beats this page covers, in reading order — for the review UI, not sent
   * to the Creative Director directly (the prompt below is). */
  beats: NovelBeat[];
  /** How many panels this page actually needs (beats sharing a panel via
   * `mergeable`/`!mustVisualize` count once) — the caller uses this to pick
   * a matching page layout instead of always creating a fixed-size page. */
  panelCount: number;
  prompt: string;
}

/** Kumanga's page layouts (`domain/layouts.ts`) top out at 4 panels — this
 * is a real ceiling of the editor, not an arbitrary pacing choice, so a
 * caller offering "panels per page" as a setting should not offer more. */
export const MAX_SUPPORTED_PANELS_PER_PAGE = 4;

const DEFAULT_MAX_PANELS_PER_PAGE = MAX_SUPPORTED_PANELS_PER_PAGE;

/** Whether `beat` should share a panel with whatever came before it on the
 * current page, instead of starting a new one — a beat marked `mergeable`
 * by the model, or one the model said doesn't need its own panel at all. */
function foldsIntoPreviousPanel(beat: NovelBeat, hasOpenPanel: boolean): boolean {
  return hasOpenPanel && (beat.mergeable || !beat.mustVisualize);
}

function describeBeat(beat: NovelBeat): string {
  const parts: string[] = [];
  if (beat.action) parts.push(beat.action);
  if (beat.dialogue && beat.speakerName) parts.push(`${beat.speakerName} says "${beat.dialogue}"${beat.emotion ? ` (${beat.emotion})` : ""}`);
  else if (beat.dialogue) parts.push(`Dialogue: "${beat.dialogue}"`);
  else if (beat.emotion) parts.push(`(${beat.emotion})`);
  if (beat.narration) parts.push(`Caption: "${beat.narration}"`);
  if (beat.subtext) parts.push(`Subtext: ${beat.subtext}`);
  const offscreenOrMentioned = Object.entries(beat.characterPresence).filter(([, presence]) => presence !== "visible");
  if (offscreenOrMentioned.length > 0) {
    parts.push(
      offscreenOrMentioned
        .map(([who, presence]) => `${who} is ${presence === "offscreen" ? "heard but not drawn" : "only mentioned, not drawn"}`)
        .join("; "),
    );
  }
  if (beat.props.length > 0) parts.push(`Visible objects: ${beat.props.join(", ")}`);
  return parts.filter(Boolean).join(". ") || "A quiet beat — establish the moment visually.";
}

function buildPagePrompt(chapterTitle: string, scene: NovelScene, panels: NovelBeat[][]): string {
  const setting = [scene.location, scene.timeLabel, scene.weather].filter(Boolean).join(", ");
  const header = [
    `Page from "${chapterTitle}".`,
    setting ? `Setting: ${setting}.` : "",
    scene.purpose ? `Scene purpose: ${scene.purpose}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const panelLines = panels.map(
    (group, index) => `Panel ${index + 1}: ${group.map(describeBeat).join("; then ")}`,
  );
  return [header, ...panelLines].join("\n");
}

/**
 * Groups a chapter's already-parsed scenes into pages. A page never spans
 * two scenes (keeps each page's prompt coherent for the Creative Director,
 * and matches how the beats' own scene-level context — location/time/
 * weather/purpose — was written); a scene that needs more panels than
 * `maxPanelsPerPage` simply continues onto a following page.
 */
export function planPages(
  chapterTitle: string,
  scenes: NovelScene[],
  maxPanelsPerPage = DEFAULT_MAX_PANELS_PER_PAGE,
): PlannedPage[] {
  // Clamp rather than trust the caller — a page this module plans for more
  // panels than Kumanga's own layouts support would just get silently
  // capped at page-creation time anyway (see NovelImportDialog.tsx).
  const panelBudget = Math.max(1, Math.min(maxPanelsPerPage, MAX_SUPPORTED_PANELS_PER_PAGE));
  const pages: PlannedPage[] = [];
  let pageCounter = 0;

  for (const scene of scenes) {
    let panels: NovelBeat[][] = [];

    const flush = () => {
      if (panels.length === 0) return;
      pageCounter += 1;
      pages.push({
        id: `planned-page-${pageCounter}`,
        chapterTitle,
        sceneOrdinal: scene.ordinal,
        sceneLocation: scene.location,
        beats: panels.flat(),
        panelCount: panels.length,
        prompt: buildPagePrompt(chapterTitle, scene, panels),
      });
      panels = [];
    };

    const sortedBeats = [...scene.beats].sort((a, b) => a.ordinal - b.ordinal);
    for (const beat of sortedBeats) {
      const hasOpenPanel = panels.length > 0;
      if (foldsIntoPreviousPanel(beat, hasOpenPanel)) {
        panels[panels.length - 1].push(beat);
      } else {
        if (panels.length >= panelBudget) flush();
        panels.push([beat]);
      }
      // A page-turn cliffhanger always ends the page right after it, even
      // if there's still panel budget left — pacing over density.
      if (beat.pageTurnHook) flush();
    }
    flush();
  }
  return pages;
}
