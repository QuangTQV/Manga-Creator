"use client";

/**
 * Translate an already-lettered project's dialogue into another language.
 * Deliberately does NOT mutate the source project — the caller commits the
 * returned document as a genuinely new, separate project (via
 * `projectsStore.ts`'s `importDocument`), so a creator keeps their master-
 * language project untouched and gets a new per-locale copy, the way a
 * real localization workflow works.
 *
 * Reuses, rather than reinventing:
 *  - the batched-request-with-progress pattern `NovelImportDialog.tsx`'s
 *    own parse step already established (one `/api/agent/*` POST per
 *    batch, `onProgress` after each);
 *  - `render/bubbleFit.ts`'s `fitBubbleHeight` (from backlog #24) to
 *    re-fit each bubble's height to its NEW text, exactly as a manual
 *    text edit already does — a translated string is just another string
 *    as far as that measurement is concerned;
 *  - `domain/itemOps.ts`'s `updateBubble`, applied directly to a plain
 *    (not-yet-open) `ProjectDocument` rather than through the editor
 *    store's `dispatch` — there is no open document to dispatch against
 *    until the result is committed as a new project.
 */

import type { ProjectDocument, SpeechBubbleItem } from "@/domain/types";
import { updateBubble } from "@/domain/itemOps";
import { resolvedBubbleStyle } from "@/domain/bubbleStyles";
import { fitBubbleHeight } from "@/render/bubbleFit";

export interface TranslateProgress {
  done: number;
  total: number;
}

export interface TranslateProjectOptions {
  targetLanguage: string;
  /** Restricts translation to bubbles on these pages. Omit to translate
   * every bubble in the project. */
  pageIds?: string[];
}

export interface TranslateProjectResult {
  newDoc: ProjectDocument;
  translatedCount: number;
  /** Bubbles the model's response didn't include a translation for —
   * left with their original text rather than failing the whole run. */
  skippedCount: number;
}

/** One provider call per batch, not one per bubble — keeps the number of
 * requests reasonable for a whole project's worth of dialogue while
 * staying well inside a typical prompt's comfortable size. */
const ITEMS_PER_BATCH = 30;

function bubblesInScope(doc: ProjectDocument, pageIds?: string[]): SpeechBubbleItem[] {
  const all = Object.values(doc.items).filter(
    (item): item is SpeechBubbleItem => item.kind === "bubble" && item.text.trim().length > 0,
  );
  if (!pageIds) return all;
  const scope = new Set(pageIds);
  return all.filter((bubble) => {
    const panel = doc.panels[bubble.panelId];
    return Boolean(panel && scope.has(panel.pageId));
  });
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

export async function translateProject(
  doc: ProjectDocument,
  options: TranslateProjectOptions,
  onProgress?: (progress: TranslateProgress) => void,
): Promise<TranslateProjectResult> {
  const bubbles = bubblesInScope(doc, options.pageIds);
  if (bubbles.length === 0) throw new Error("No dialogue found to translate in this scope");

  const batches = chunk(bubbles, ITEMS_PER_BATCH);
  let workingDoc = doc;
  let translatedCount = 0;
  let skippedCount = 0;
  onProgress?.({ done: 0, total: batches.length });

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    const response = await fetch("/api/agent/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: batch.map((bubble) => ({ id: bubble.id, text: bubble.text })),
        targetLanguage: options.targetLanguage,
      }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      output?: { translations: { id: string; text: string }[] };
      error?: string;
    };
    if (!response.ok || !body.output) {
      throw new Error(body.error ?? `Translating batch ${batchIndex + 1}/${batches.length} failed`);
    }

    const translationById = new Map(body.output.translations.map((t) => [t.id, t.text]));
    for (const bubble of batch) {
      const translatedText = translationById.get(bubble.id);
      if (translatedText === undefined) {
        skippedCount += 1;
        continue;
      }
      const current = workingDoc.items[bubble.id];
      if (!current || current.kind !== "bubble") continue;
      const height = fitBubbleHeight({
        text: translatedText,
        width: current.width,
        fontSize: current.fontSize,
        style: resolvedBubbleStyle(current),
      });
      workingDoc = updateBubble(workingDoc, bubble.id, { text: translatedText, height });
      translatedCount += 1;
    }
    onProgress?.({ done: batchIndex + 1, total: batches.length });
  }

  return { newDoc: workingDoc, translatedCount, skippedCount };
}
