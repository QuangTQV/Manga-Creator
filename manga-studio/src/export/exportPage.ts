"use client";

/**
 * Page PNG export. Reuses the live editor stage — the same scene graph the
 * user sees is what exports (WYSIWYG by construction). The overlay layer
 * (selection handles, ghosts, guides) is hidden for the capture.
 *
 * Remote asset images are loaded with crossOrigin=anonymous (see
 * useImageElement); without that, toDataURL would throw a tainted-canvas
 * SecurityError in production where assets live on Vercel Blob.
 */

import Konva from "konva";
import type { ProjectDocument } from "@/domain/types";
import { useEditorStore } from "@/editor/store";
import { PAGE_STAGE_ID } from "@/render/constants";

/**
 * Captures one page as a PNG data URL, by id — not necessarily the
 * currently-selected page, though the caller is responsible for making
 * sure that page's content is actually what the live Konva stage is
 * showing (switch `currentPageId` and wait a frame first if it might not
 * be — see `exportBook.ts`, which walks every page this way).
 */
export function capturePageDataUrl(doc: ProjectDocument, pageId: string, scale: 1 | 2): string {
  const stage = Konva.stages.find((s) => s.attrs.id === PAGE_STAGE_ID);
  if (!stage) throw new Error("Canvas is not ready");

  // The export boundary is the page object only: loose workspace material
  // (reference sheets, staged generations) and editor overlays never export.
  const overlay = stage.findOne(".overlay-layer");
  const workspace = stage.findOne(".workspace-layer");
  const page = doc.pages[pageId];
  if (!page) throw new Error("Page not found");
  const { pageWidth, pageHeight } = doc.project.settings;
  const stageScale = stage.scaleX();
  const position = stage.position();

  overlay?.visible(false);
  workspace?.visible(false);
  try {
    return stage.toDataURL({
      x: position.x + page.workspace.x * stageScale,
      y: position.y + page.workspace.y * stageScale,
      width: pageWidth * stageScale,
      height: pageHeight * stageScale,
      // pixelRatio maps the on-screen size back to full page resolution × scale.
      pixelRatio: scale / stageScale,
      mimeType: "image/png",
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "SecurityError") {
      throw new Error(
        "Export blocked by cross-origin image data. Ensure asset storage serves images with CORS enabled.",
      );
    }
    throw error;
  } finally {
    overlay?.visible(true);
    workspace?.visible(true);
  }
}

export async function exportCurrentPagePng(scale: 1 | 2): Promise<void> {
  const state = useEditorStore.getState();
  const doc = state.doc;
  if (!doc || !state.currentPageId) throw new Error("No page to export");

  const dataUrl = capturePageDataUrl(doc, state.currentPageId, scale);
  const page = doc.pages[state.currentPageId];
  const pageName = page.name?.replace(/\s+/g, "-").toLowerCase() ?? "page";
  downloadDataUrl(dataUrl, `${doc.project.name.replace(/\s+/g, "-").toLowerCase()}-${pageName}@${scale}x.png`);
}

function downloadDataUrl(dataUrl: string, filename: string): void {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  link.click();
}
