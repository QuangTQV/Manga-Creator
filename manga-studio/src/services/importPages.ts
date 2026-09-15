"use client";

/**
 * Bulk-import existing page images as new project pages, in reading order
 * — for a creator switching to Kumanga with manga they already made
 * elsewhere and want to CONTINUE, not restart from a blank project. Each
 * image becomes its own full-bleed page (one panel spanning the whole
 * page, `cropMode: "fill"` so it covers edge to edge without a letterbox
 * gap) — placed exactly as-is, never regenerated or edited. This is
 * deliberately just plumbing: no AI call, no character/style
 * understanding. Once the old pages are in the project, a creator wires
 * up consistency for NEW pages themselves — crop a character out of an
 * imported page and use it as a canonical reference (`CreateCharacterDialog`'s
 * "Reference Only" path already supports any uploaded image), or set one
 * as the project's Art Style reference — rather than Kumanga trying to
 * infer any of that automatically from the imported bitmaps.
 *
 * Sequential, not parallel: matches the pacing `generatePack`
 * (`CreateCharacterDialog.tsx`) and `captureAllPages` (`exportPages.ts`)
 * already use for other multi-step bulk operations in this codebase,
 * rather than firing dozens of uploads at the server at once.
 */

import { uploadImageFile } from "@/components/library/uploadAsset";
import { useEditorStore } from "@/editor/store";

export interface ImportPagesProgress {
  done: number;
  total: number;
}

/**
 * Deterministic reading order for a bulk file selection. Browsers don't
 * reliably preserve the order files were picked/dragged in, but
 * "page01.png, page02.png, …" naming is exactly the realistic case this
 * feature exists for, so a natural (numeric-aware, so "page9" sorts
 * before "page10") filename sort is what a creator actually expects —
 * not upload-completion order or OS file-picker order.
 */
export function sortFilesByName(files: File[]): File[] {
  return [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
}

/**
 * Imports every file as a new page, appended in order after whatever
 * pages the project already has. One file failing to upload stops the
 * whole import (rather than silently skipping it and leaving a gap in
 * the middle of an imported chapter) — the caller sees the error and
 * knows exactly which page never made it in, since `onProgress` already
 * reported how many succeeded before the failure.
 */
export async function importPagesFromFiles(
  files: File[],
  onProgress?: (progress: ImportPagesProgress) => void,
): Promise<void> {
  const ordered = sortFilesByName(files);
  for (let i = 0; i < ordered.length; i++) {
    const file = ordered[i];
    // Category "upload": source material, not a cut-out layer — the same
    // reason `ReferencePicker` uses it for reference images, so this
    // never gets routed through foreground/background-removal processing
    // meant for isolating a single character or object.
    const assetId = await uploadImageFile(file, "upload");

    const store = useEditorStore.getState();
    const result = store.dispatch({ type: "add-page", layout: "full-bleed" });
    if (result.createdId) {
      const panelId = result.doc.pages[result.createdId]?.panelIds[0];
      if (panelId) {
        store.dispatch({ type: "add-instance", panelId, assetId, cropMode: "fill" });
      }
      store.setCurrentPage(result.createdId);
    }
    onProgress?.({ done: i + 1, total: ordered.length });
  }
}
