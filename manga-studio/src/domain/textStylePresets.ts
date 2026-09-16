/**
 * Reusable text style presets (§27) — see `TextStylePreset`'s own docstring
 * in types.ts for why applying one is a one-time copy, not a live link.
 */

import { cloneDoc, touch } from "./docHelpers";
import { newId } from "./factory";
import type { ID, ProjectDocument, TextStylePreset } from "./types";

export type TextStyleFields = Omit<TextStylePreset, "id" | "name">;

export function addTextStylePreset(
  doc: ProjectDocument,
  name: string,
  fields: TextStyleFields,
): { doc: ProjectDocument; presetId: ID } {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("A style preset needs a name");

  const next = cloneDoc(doc);
  const preset: TextStylePreset = { id: newId(), name: trimmed, ...fields };
  next.textStylePresets[preset.id] = preset;
  touch(next);
  return { doc: next, presetId: preset.id };
}

export function renameTextStylePreset(doc: ProjectDocument, presetId: ID, name: string): ProjectDocument {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("A style preset needs a name");
  if (!doc.textStylePresets[presetId]) throw new Error(`Unknown text style preset: ${presetId}`);
  const next = cloneDoc(doc);
  next.textStylePresets[presetId].name = trimmed;
  touch(next);
  return next;
}

export function removeTextStylePreset(doc: ProjectDocument, presetId: ID): ProjectDocument {
  if (!doc.textStylePresets[presetId]) return doc;
  const next = cloneDoc(doc);
  delete next.textStylePresets[presetId];
  touch(next);
  return next;
}
