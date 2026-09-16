"use client";

/**
 * Whole-project PDF export: one PDF document, one page per manga page.
 *
 * Where CBZ (`exportBook.ts`) is the interchange format comic READERS
 * expect, PDF is what print shops, school/portfolio submissions, and
 * publisher slush-pile calls actually ask for by name — a single file a
 * non-technical recipient can open directly, with no comic-reader app.
 *
 * Built on jsPDF entirely client-side, same "everything already ran in the
 * browser" shape as the CBZ/webtoon exporters next to this file. Every page
 * shares one `pageWidth`/`pageHeight` (`ProjectSettings`), so the PDF's page
 * size is computed once from that plus `scale` — no need to decode each
 * captured image just to ask it its own dimensions back.
 */

import { jsPDF } from "jspdf";
import { useEditorStore } from "@/editor/store";
import { captureAllPages, downloadBlob, projectFileBasename, type ExportProgress } from "./exportPages";
import type { ExportScope } from "./exportBook";

export type ExportPdfProgress = ExportProgress;

export async function exportBookPdf(
  scale: 1 | 2 = 2,
  onProgress?: (progress: ExportPdfProgress) => void,
  scope?: ExportScope,
): Promise<void> {
  const doc = useEditorStore.getState().doc;
  if (!doc) throw new Error("No open project");

  const dataUrls = await captureAllPages(scale, onProgress, scope?.pageIds);
  const width = doc.project.settings.pageWidth * scale;
  const height = doc.project.settings.pageHeight * scale;

  const pdf = new jsPDF({ unit: "px", format: [width, height], compress: true });
  dataUrls.forEach((dataUrl, i) => {
    if (i > 0) pdf.addPage([width, height]);
    pdf.addImage(dataUrl, "PNG", 0, 0, width, height);
  });

  const name = scope
    ? `${projectFileBasename(doc.project.name)}-${projectFileBasename(scope.label)}`
    : projectFileBasename(doc.project.name);
  downloadBlob(pdf.output("blob"), `${name}.pdf`);
}
