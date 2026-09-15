"use client";

/**
 * Character Model Sheet: every generation of a character's canonical
 * reference and rendered states, composited into one reference image —
 * the thing an artist keeps beside them while drawing new panels to catch
 * the AI drifting off-design, or hands to a collaborator as a design doc.
 *
 * Deliberately scoped down from the full backlog idea (see MEMORY.md
 * #17): this is layout + canvas compositing only, reusing the same
 * "capture pages, stitch onto one canvas" technique already used by
 * `exportWebtoon.ts`. It does NOT attempt automatic drift DETECTION
 * (flagging when a generation visually diverges from the reference) —
 * that needs its own AI vision call or an image-similarity pipeline, a
 * materially bigger and riskier feature than compositing existing
 * renders onto a grid. This gives a human everything they need to judge
 * that by eye.
 *
 * No domain model changes: this reads `character.assetIds` and existing
 * asset metadata exactly the way `CharactersTab.tsx`'s "Rendered states"
 * section already does (via `groupCharacterStates`), it just keeps every
 * variant of a state instead of only the latest, and adds the canonical
 * reference as its own labeled row so it reads as the "ground truth" the
 * other rows are judged against.
 */

import type { Character, ID, ProjectDocument, SourceAsset } from "@/domain/types";
import { characterReferenceId, groupCharacterStates } from "@/characters/state";
import { assetRenderUrl } from "@/assets/renderSource";
import { loadImageElement } from "@/render/useImageElement";
import { useEditorStore } from "@/editor/store";
import { downloadBlob, projectFileBasename } from "./exportPages";

/** One row of the sheet: a label ("Canonical Reference", or a state like
 * "Standing · Smile · Default Outfit · Front") plus every asset filed
 * under it, oldest generation first. */
export interface ModelSheetRow {
  label: string;
  assets: SourceAsset[];
}

/**
 * Every row the sheet will show for this character, in display order:
 * the canonical reference first (if one exists and isn't archived), then
 * one row per distinct rendered state. Shared between the dialog (which
 * renders it as an HTML grid) and the PNG exporter (which composites it
 * onto a canvas) so the two never disagree about what counts as a row.
 */
export function modelSheetRows(doc: ProjectDocument, character: Character): ModelSheetRow[] {
  const allAssets = character.assetIds.map((id) => doc.assets[id]).filter((a): a is SourceAsset => Boolean(a) && a.status !== "archived");
  const rows: ModelSheetRow[] = [];

  const referenceId = characterReferenceId(character);
  const reference = referenceId ? doc.assets[referenceId] : undefined;
  if (reference && reference.status !== "archived") {
    rows.push({ label: "Canonical Reference", assets: [reference] });
  }

  const stateAssets = allAssets.filter((asset) => asset.metadata?.characterAssetRole !== "canonical");
  for (const group of groupCharacterStates(stateAssets, character.id)) {
    rows.push({ label: group.label, assets: group.variants });
  }
  return rows;
}

/** Fixed geometry, kept as plain numbers (not canvas-dependent) so the
 * layout math is unit-testable without a browser. */
export const MODEL_SHEET_CELL = 200;
export const MODEL_SHEET_PADDING = 16;
const LABEL_HEIGHT = 22;
const CAPTION_HEIGHT = 16;
const HEADER_HEIGHT = 40;

export interface ModelSheetLayout {
  canvasWidth: number;
  canvasHeight: number;
  headerHeight: number;
  rows: { label: string; top: number; cellXs: number[] }[];
}

/** Pure layout pass: given only how many variants each row has, computes
 * where every cell goes. Rows are stacked top to bottom; each row is as
 * wide as its most-populous row needs (a fixed cell size × count), so a
 * character with one lonely "Jumping · Shocked" generation doesn't force
 * every other row's cells to stretch to match a busier row. */
export function computeModelSheetLayout(rowVariantCounts: number[]): ModelSheetLayout {
  const maxVariants = Math.max(1, ...rowVariantCounts);
  const rowHeight = LABEL_HEIGHT + MODEL_SHEET_CELL + CAPTION_HEIGHT + MODEL_SHEET_PADDING;
  const canvasWidth = MODEL_SHEET_PADDING + maxVariants * (MODEL_SHEET_CELL + MODEL_SHEET_PADDING);
  const canvasHeight = HEADER_HEIGHT + rowVariantCounts.length * rowHeight + MODEL_SHEET_PADDING;
  const rows = rowVariantCounts.map((count, i) => ({
    label: "",
    top: HEADER_HEIGHT + i * rowHeight,
    cellXs: Array.from({ length: count }, (_, j) => MODEL_SHEET_PADDING + j * (MODEL_SHEET_CELL + MODEL_SHEET_PADDING)),
  }));
  return { canvasWidth, canvasHeight, headerHeight: HEADER_HEIGHT, rows };
}

/** Draws one already-loaded image into a square cell, letterboxed
 * ("contain" scaling) rather than cropped or stretched — a model sheet
 * exists to judge proportions accurately, so distorting the art to fill
 * the cell would defeat the point. */
function drawContained(ctx: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, size: number): void {
  const scale = Math.min(size / image.width, size / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  ctx.drawImage(image, x + (size - drawWidth) / 2, y + (size - drawHeight) / 2, drawWidth, drawHeight);
}

/** Composites already-loaded images onto one canvas. Browser-only
 * (canvas), so not unit tested directly — see `computeModelSheetLayout`
 * for the part that is, and the Playwright test for end-to-end coverage
 * of this function in a real browser. */
export function renderModelSheetToCanvas(characterName: string, rows: { label: string; images: HTMLImageElement[] }[]): HTMLCanvasElement {
  const layout = computeModelSheetLayout(rows.map((r) => r.images.length));
  const canvas = document.createElement("canvas");
  canvas.width = layout.canvasWidth;
  canvas.height = layout.canvasHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#18181b";
  ctx.font = "600 20px sans-serif";
  ctx.textBaseline = "top";
  ctx.fillText(`${characterName} — Model Sheet`, MODEL_SHEET_PADDING, 12);

  rows.forEach((row, i) => {
    const { top, cellXs } = layout.rows[i];
    ctx.fillStyle = "#3f3f46";
    ctx.font = "600 13px sans-serif";
    ctx.fillText(row.label, MODEL_SHEET_PADDING, top);

    const cellTop = top + LABEL_HEIGHT;
    row.images.forEach((image, j) => {
      const x = cellXs[j];
      ctx.strokeStyle = "#d4d4d8";
      ctx.strokeRect(x, cellTop, MODEL_SHEET_CELL, MODEL_SHEET_CELL);
      drawContained(ctx, image, x, cellTop, MODEL_SHEET_CELL);

      if (row.images.length > 1) {
        ctx.fillStyle = "#71717a";
        ctx.font = "11px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(`v${j + 1}`, x + MODEL_SHEET_CELL / 2, cellTop + MODEL_SHEET_CELL + 2);
        ctx.textAlign = "left";
      }
    });
  });

  return canvas;
}

export async function exportCharacterModelSheetPng(characterId: ID): Promise<void> {
  const doc = useEditorStore.getState().doc;
  if (!doc) throw new Error("No open project");
  const character = doc.characters[characterId];
  if (!character) throw new Error("Character not found");

  const rows = modelSheetRows(doc, character);
  if (rows.length === 0) throw new Error("This character has no reference or rendered states to include in a model sheet");

  const loadedRows = await Promise.all(
    rows.map(async (row) => {
      const urls = row.assets.map(assetRenderUrl).filter((url): url is string => Boolean(url));
      const images = await Promise.all(urls.map(loadImageElement));
      return { label: row.label, images };
    }),
  );

  const canvas = renderModelSheetToCanvas(character.name, loadedRows);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Could not encode the model sheet image");
  downloadBlob(blob, `${projectFileBasename(character.name)}-model-sheet.png`);
}
