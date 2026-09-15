"use client";

/** Client-side font upload flow — mirrors `uploadAsset.ts`'s `uploadImageFile`
 * shape, but a font is a document-level asset (`doc.fonts`), not a
 * `SourceAsset`, so it registers through its own command. */

import type { FontAsset } from "@/domain/types";
import { useEditorStore } from "@/editor/store";
import { fontFamilyNameFor } from "@/render/customFonts";

export async function uploadFontFile(file: File): Promise<{ fontId: string; familyName: string }> {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch("/api/assets/upload-font", { method: "POST", body: form });
  const body = (await response.json()) as { url?: string; format?: FontAsset["format"]; error?: string };
  if (!response.ok || !body.url || !body.format) throw new Error(body.error ?? "Font upload failed");

  const result = useEditorStore.getState().dispatch({
    type: "add-font-asset",
    name: file.name.replace(/\.[^.]+$/, ""),
    storageUrl: body.url,
    format: body.format,
  });
  if (!result.createdId) throw new Error("Uploaded font could not be registered");
  return { fontId: result.createdId, familyName: fontFamilyNameFor(result.createdId) };
}
