/** Creator-uploaded lettering fonts — see `FontAsset`'s own docstring. */

import { cloneDoc, touch } from "./docHelpers";
import { newId } from "./factory";
import type { FontAsset, ID, ProjectDocument } from "./types";

export function addFontAsset(
  doc: ProjectDocument,
  input: { name: string; storageUrl: string; format: FontAsset["format"] },
): { doc: ProjectDocument; fontId: ID } {
  const next = cloneDoc(doc);
  const font: FontAsset = {
    id: newId(),
    projectId: next.project.id,
    name: input.name.trim() || "Untitled font",
    storageUrl: input.storageUrl,
    format: input.format,
  };
  next.fonts[font.id] = font;
  touch(next);
  return { doc: next, fontId: font.id };
}

export function removeFontAsset(doc: ProjectDocument, fontId: ID): ProjectDocument {
  if (!doc.fonts[fontId]) return doc;
  const next = cloneDoc(doc);
  delete next.fonts[fontId];
  touch(next);
  return next;
}
