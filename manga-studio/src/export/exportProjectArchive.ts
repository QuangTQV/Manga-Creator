"use client";

/**
 * Project archive export: a full backup of one project, independent of the
 * browser's IndexedDB — the project only otherwise exists there, so
 * clearing site data or losing the browser profile loses it outright.
 *
 * This is the SAME JSON `storage/projectStore.ts` already writes to
 * IndexedDB (`domain/serialization.ts`'s `serializeProject`/
 * `deserializeProject`, with its full schema migration and shape
 * validation on the way back in) — an archive is not a new format, just
 * that JSON saved to a file instead of a database. Importing is
 * `useProjectsStore.getState().importProject(json)`.
 *
 * Scope: the document only — pages, panels, characters, everything except
 * image bytes. Every asset URL keeps pointing at this deployment's object
 * storage (Vercel Blob in production, the local `.data/` dev server
 * otherwise), exactly as `duplicateProject` already does for a same-browser
 * copy — restoring into THIS deployment's data is the goal, not migrating
 * images to a different storage backend or machine. On a local dev server,
 * importing on a DIFFERENT machine (whose `.data/` folder doesn't have
 * those files) restores the document with broken image references.
 */

import { serializeProject } from "@/domain/serialization";
import type { ProjectDocument } from "@/domain/types";
import { downloadBlob, projectFileBasename } from "./exportPages";

export function exportProjectArchive(doc: ProjectDocument): void {
  const json = serializeProject(doc);
  const blob = new Blob([json], { type: "application/json" });
  downloadBlob(blob, `${projectFileBasename(doc.project.name)}.kumanga.json`);
}
