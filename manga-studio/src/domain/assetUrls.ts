/**
 * Every URL-bearing field, across every entity kind, that points at
 * externally-stored image/font bytes rather than being embedded in the
 * document itself.
 *
 * Kept in exactly one place so a new URL-bearing field added to any entity
 * is a one-line addition here, not a silent gap — this is the single
 * source of truth both the full-backup EXPORT (which fields to bundle) and
 * IMPORT (which fields to rewrite to the new deployment's URLs) read from,
 * so the two can never drift out of sync with each other.
 *
 * Deliberately pure/IO-free (no `fetch`, no zip): collecting/rewriting URL
 * strings is domain-layer work; actually downloading or re-uploading bytes
 * is `export/projectBackup.ts`'s job.
 */

import type { ProjectDocument, SourceAsset } from "./types";

function sourceAssetUrls(asset: SourceAsset): (string | undefined)[] {
  return [asset.sourceUrl, asset.storageUrl, asset.processedImageUrl, asset.thumbnailUrl, asset.provenance?.localEdit?.maskUrl];
}

/** Every distinct URL in the document worth bundling into a full backup. */
export function collectAssetUrls(doc: ProjectDocument): string[] {
  const urls = new Set<string>();
  for (const asset of Object.values(doc.assets)) {
    for (const url of sourceAssetUrls(asset)) if (url) urls.add(url);
  }
  for (const font of Object.values(doc.fonts)) {
    if (font.storageUrl) urls.add(font.storageUrl);
  }
  for (const effect of Object.values(doc.language)) {
    if (effect.thumbnailUrl) urls.add(effect.thumbnailUrl);
  }
  for (const profile of Object.values(doc.project.settings.artStyle.customProfiles)) {
    if (profile.previewImage) urls.add(profile.previewImage);
  }
  return [...urls];
}

/**
 * Returns a NEW document (never mutates `doc`) with every URL found in
 * `urlMap` replaced by its mapped value. A URL with no entry in `urlMap` is
 * left exactly as-is — the same broken-link fallback the document-only
 * archive already accepts (see `exportProjectArchive.ts`'s docstring), not
 * a new failure mode: one asset that failed to bundle or re-upload must
 * not sink the rest of a restored project.
 */
export function remapAssetUrls(doc: ProjectDocument, urlMap: Map<string, string>): ProjectDocument {
  const remap = <T extends string | undefined>(url: T): T => (url && urlMap.has(url) ? (urlMap.get(url) as T) : url);

  return {
    ...doc,
    assets: Object.fromEntries(
      Object.entries(doc.assets).map(([id, asset]) => [
        id,
        {
          ...asset,
          sourceUrl: remap(asset.sourceUrl),
          storageUrl: remap(asset.storageUrl),
          processedImageUrl: remap(asset.processedImageUrl),
          thumbnailUrl: remap(asset.thumbnailUrl),
          provenance:
            asset.provenance?.localEdit &&
            (asset.provenance.localEdit.maskUrl ? urlMap.has(asset.provenance.localEdit.maskUrl) : false)
              ? {
                  ...asset.provenance,
                  localEdit: { ...asset.provenance.localEdit, maskUrl: remap(asset.provenance.localEdit.maskUrl) },
                }
              : asset.provenance,
        },
      ]),
    ),
    fonts: Object.fromEntries(
      Object.entries(doc.fonts).map(([id, font]) => [id, { ...font, storageUrl: remap(font.storageUrl) }]),
    ),
    language: Object.fromEntries(
      Object.entries(doc.language).map(([id, effect]) => [id, { ...effect, thumbnailUrl: remap(effect.thumbnailUrl) }]),
    ),
    project: {
      ...doc.project,
      settings: {
        ...doc.project.settings,
        artStyle: {
          ...doc.project.settings.artStyle,
          customProfiles: Object.fromEntries(
            Object.entries(doc.project.settings.artStyle.customProfiles).map(([id, profile]) => [
              id,
              { ...profile, previewImage: remap(profile.previewImage) },
            ]),
          ),
        },
      },
    },
  };
}
