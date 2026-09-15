"use client";

/**
 * Print-ready export: DPI-accurate pixel dimensions plus a synthetic bleed
 * margin, for creators sending pages to a physical printer.
 *
 * Kumanga's page size (`doc.project.settings.pageWidth/Height`) carries no
 * physical unit — panels are authored in normalized coordinates against
 * it, and "1x" isn't tied to any real-world inch count. Rather than
 * retrofit a persisted physical-size field onto `ProjectSettings` (a
 * schema migration, plus a value that would be risky to edit later since
 * panel geometry assumes the page's pixel dimensions never move — see the
 * schema-bump precedent for #13/#14 in MEMORY.md), physical width and
 * target DPI are asked fresh at export time, purely as export parameters,
 * and used only to compute an export `scale` for the existing capture
 * pipeline:
 *
 *   scale = (physicalWidthInches * dpi) / doc.project.settings.pageWidth
 *
 * True bleed — art that already extends past the trim edge — isn't
 * authorable today either: panels are hard-clamped to the page's 0..1
 * coordinate space, so there is nothing past the edge to bleed. This
 * approximates it the standard "poor man's bleed" way instead: stretch the
 * outermost ring of already-rendered pixels outward into the bleed margin
 * (`printBleed.ts`), rather than changing the domain model to let panels
 * overhang the page.
 */

import JSZip from "jszip";
import { useEditorStore } from "@/editor/store";
import { capturePageDataUrl } from "./exportPage";
import { captureAllPages, downloadBlob, projectFileBasename, type ExportProgress } from "./exportPages";
import type { ExportScope } from "./exportBook";
import { addBleedToDataUrl, computeBleedPx } from "./printBleed";

export type PrintExportProgress = ExportProgress;

/** Common DPI targets: 150 for quick proofs, 300 for standard print
 * (the usual print-industry default), 600 for fine line-art/screentone
 * work where banding at 300 would be visible. */
export const DPI_PRESETS = [150, 300, 600] as const;

export interface PrintExportOptions {
  /** Target page width once printed, in inches. */
  physicalWidthInches: number;
  /** Target resolution, in pixels per inch. */
  dpi: number;
  /** Bleed margin added on all four sides, in inches. 0 disables it. */
  bleedInches: number;
  /** Draw corner trim marks in the bleed margin, for a print shop to cut
   * to. No-op when the bleed margin ends up too thin to hold one (see
   * `printCropMarks.ts`'s `cropMarkGeometry`) — most relevantly when
   * `bleedInches` is 0, since marks need bleed to sit in. */
  cropMarks?: boolean;
}

/** Pulled out as a pure function so the DPI math is unit-testable without
 * a live document or canvas. */
export function computePrintScale(pageWidthPx: number, physicalWidthInches: number, dpi: number): number {
  if (!(pageWidthPx > 0)) throw new Error("Invalid page size");
  if (!(physicalWidthInches > 0) || !(dpi > 0)) {
    throw new Error("Enter a page width and DPI greater than zero");
  }
  return (physicalWidthInches * dpi) / pageWidthPx;
}

export async function exportCurrentPagePrintPng(options: PrintExportOptions): Promise<void> {
  const state = useEditorStore.getState();
  const doc = state.doc;
  if (!doc || !state.currentPageId) throw new Error("No page to export");

  const scale = computePrintScale(doc.project.settings.pageWidth, options.physicalWidthInches, options.dpi);
  const dataUrl = capturePageDataUrl(doc, state.currentPageId, scale);
  const finalDataUrl = await addBleedToDataUrl(dataUrl, computeBleedPx(options.bleedInches, options.dpi), {
    cropMarks: options.cropMarks,
  });

  const page = doc.pages[state.currentPageId];
  const pageName = page.name?.replace(/\s+/g, "-").toLowerCase() ?? "page";
  const link = document.createElement("a");
  link.href = finalDataUrl;
  link.download = `${projectFileBasename(doc.project.name)}-${pageName}-print@${options.dpi}dpi.png`;
  link.click();
}

export async function exportBookPrintCbz(
  options: PrintExportOptions,
  onProgress?: (progress: PrintExportProgress) => void,
  scope?: ExportScope,
): Promise<void> {
  const doc = useEditorStore.getState().doc;
  if (!doc) throw new Error("No open project");

  const scale = computePrintScale(doc.project.settings.pageWidth, options.physicalWidthInches, options.dpi);
  const dataUrls = await captureAllPages(scale, onProgress, scope?.pageIds);
  const bleedPx = computeBleedPx(options.bleedInches, options.dpi);
  const bled = await Promise.all(dataUrls.map((url) => addBleedToDataUrl(url, bleedPx, { cropMarks: options.cropMarks })));

  const zip = new JSZip();
  const digits = String(bled.length).length;
  bled.forEach((dataUrl, i) => {
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    zip.file(`page_${String(i + 1).padStart(digits, "0")}.png`, base64, { base64: true });
  });

  const blob = await zip.generateAsync({ type: "blob" });
  const name = scope
    ? `${projectFileBasename(doc.project.name)}-${projectFileBasename(scope.label)}-print@${options.dpi}dpi`
    : `${projectFileBasename(doc.project.name)}-print@${options.dpi}dpi`;
  downloadBlob(blob, `${name}.cbz`);
}
