"use client";

/**
 * Full-backup project archive: a zip bundling BOTH the project document and
 * the actual image/font bytes it references, so the archive is portable
 * across machines and deployments — unlike the plain `.json` archive
 * (`exportProjectArchive.ts`), whose asset URLs still point at wherever
 * THIS deployment's object storage happens to be (Vercel Blob in
 * production, the local `.data/` dev server otherwise). That plain export
 * was a deliberate scope cut when project archives first shipped — see
 * MEMORY.md's 2026-09-15 "Project archive import/export" entry — not an
 * oversight; this is that deferred capability, added as a second, explicit
 * export option rather than replacing the fast default.
 *
 * Format: a zip with `project.json` (the same JSON `exportProjectArchive`
 * already writes — untouched, URLs and all), `manifest.json` (old URL →
 * bundled file path), and the bundled files themselves under `assets/`.
 * URLs are rewritten only on IMPORT, after `deserializeProject` has already
 * run full schema migration — so the URL-rewriting code
 * (`domain/assetUrls.ts`) only ever has to understand the CURRENT schema
 * shape, never any historical one.
 */

import JSZip from "jszip";
import { deserializeProject, serializeProject } from "@/domain/serialization";
import { collectAssetUrls, remapAssetUrls } from "@/domain/assetUrls";
import type { ProjectDocument } from "@/domain/types";
import { downloadBlob, projectFileBasename } from "./exportPages";

const PROJECT_JSON_PATH = "project.json";
const MANIFEST_PATH = "manifest.json";
const ASSETS_DIR = "assets";

const EXTENSION_FOR_MIME_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "font/ttf": "ttf",
  "font/otf": "otf",
  "font/woff": "woff",
  "font/woff2": "woff2",
};

export async function exportFullBackup(doc: ProjectDocument): Promise<void> {
  const urls = collectAssetUrls(doc);
  const zip = new JSZip();
  const manifest: Record<string, string> = {};
  const digits = String(Math.max(urls.length, 1)).length;

  // Independent per-URL: one unreachable/broken asset must not sink the
  // whole backup — it's simply left out of the manifest and (same as the
  // plain document-only export already accepts) stays a broken reference
  // on import, no worse than today's baseline.
  await Promise.all(
    urls.map(async (url, index) => {
      try {
        const response = await fetch(url);
        if (!response.ok) return;
        const blob = await response.blob();
        const extension = EXTENSION_FOR_MIME_TYPE[blob.type] ?? "bin";
        const path = `${ASSETS_DIR}/${String(index).padStart(digits, "0")}.${extension}`;
        zip.file(path, blob);
        manifest[url] = path;
      } catch {
        // Skip — see above.
      }
    }),
  );

  zip.file(MANIFEST_PATH, JSON.stringify(manifest));
  zip.file(PROJECT_JSON_PATH, serializeProject(doc));

  const blob = await zip.generateAsync({ type: "blob" });
  downloadBlob(blob, `${projectFileBasename(doc.project.name)}.kumanga-backup.zip`);
}

async function restoreBundledFile(blob: Blob, filename: string): Promise<string> {
  const form = new FormData();
  form.append("file", blob, filename);
  const response = await fetch("/api/assets/upload-archive-file", { method: "POST", body: form });
  const body = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!response.ok || !body.url) throw new Error(body.error ?? "Could not restore a bundled file");
  return body.url;
}

/**
 * Reads a full-backup zip and returns a ready-to-commit `ProjectDocument`
 * with every bundled asset re-uploaded to THIS deployment's own storage and
 * every URL rewritten to match. Does not itself save/register the project
 * — mirrors `deserializeProject`'s role for the plain-JSON import path,
 * which the caller (`projectsStore.ts`) hands to the same shared
 * "commit as a new project" step either way.
 */
export async function importFullBackupZip(file: File | Blob): Promise<ProjectDocument> {
  const zip = await JSZip.loadAsync(file);

  const projectEntry = zip.file(PROJECT_JSON_PATH);
  if (!projectEntry) {
    throw new Error("Not a valid Kumanga full backup — missing project.json");
  }
  const doc = deserializeProject(await projectEntry.async("string"));

  const manifestEntry = zip.file(MANIFEST_PATH);
  const manifest: Record<string, string> = manifestEntry ? JSON.parse(await manifestEntry.async("string")) : {};

  const urlMap = new Map<string, string>();
  await Promise.all(
    Object.entries(manifest).map(async ([originalUrl, path]) => {
      const entry = zip.file(path);
      if (!entry) return; // listed in the manifest but missing from the zip — leave unmapped
      try {
        const blob = await entry.async("blob");
        const newUrl = await restoreBundledFile(blob, path.split("/").pop() ?? path);
        urlMap.set(originalUrl, newUrl);
      } catch {
        // One bundled file failing to restore must not fail the whole import.
      }
    }),
  );

  return remapAssetUrls(doc, urlMap);
}
