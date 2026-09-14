"use client";

/**
 * Browser persistence for an in-progress Novel Import outline, keyed by
 * project id. Deliberately separate from `projectStore.ts`'s `ProjectDocument`
 * (no `SCHEMA_VERSION` bump, no migration): an outline is scratch state for
 * planning pages, not part of the project's own domain model — once a page
 * is generated, it becomes an ordinary `Page`/`Panel` in the real project
 * document and this store no longer has anything authoritative about it.
 *
 * Same physical IndexedDB database as `projectStore.ts` (`manga-studio`), a
 * new object store added via a version bump — see the DB_VERSION comment in
 * projectStore.ts for why both modules must keep their copy of that number
 * (and their defensive store-creation list) in sync.
 */

import type { PanelBudget, PlannedPage } from "@/agent/novelParser/pagination";
import type { NovelFidelity } from "@/agent/novelParser/prompt";
import type { NovelCharacter, NovelScene } from "@/agent/novelParser/schema";

export type NovelOutlinePageState = "planned" | "generating" | "done" | "error";

export interface StoredChapterOutline {
  title: string;
  characters: NovelCharacter[];
  scenes: NovelScene[];
  pages: PlannedPage[];
}

export interface StoredNovelOutline {
  projectId: string;
  fidelity: NovelFidelity;
  panelsPerPage: PanelBudget;
  chapters: StoredChapterOutline[];
  pageStates: Record<string, NovelOutlinePageState>;
  savedAt: string;
}

const DB_NAME = "manga-studio";
const DB_VERSION = 2;
const NOVEL_OUTLINES = "novelOutlines";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      // v1 stores (kept as-is if already present from projectStore.ts).
      if (!db.objectStoreNames.contains("projects")) db.createObjectStore("projects");
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
      // v2: this module's own store.
      if (!db.objectStoreNames.contains(NOVEL_OUTLINES)) db.createObjectStore(NOVEL_OUTLINES);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveNovelOutline(outline: StoredNovelOutline): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(NOVEL_OUTLINES, "readwrite");
    tx.objectStore(NOVEL_OUTLINES).put(outline, outline.projectId);
    await txDone(tx);
  } finally {
    db.close();
  }
}

export async function loadNovelOutline(projectId: string): Promise<StoredNovelOutline | null> {
  const db = await openDb();
  try {
    const tx = db.transaction(NOVEL_OUTLINES, "readonly");
    const value = await requestValue<StoredNovelOutline | undefined>(
      tx.objectStore(NOVEL_OUTLINES).get(projectId) as IDBRequest<StoredNovelOutline | undefined>,
    );
    await txDone(tx);
    return value ?? null;
  } finally {
    db.close();
  }
}

export async function clearNovelOutline(projectId: string): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(NOVEL_OUTLINES, "readwrite");
    tx.objectStore(NOVEL_OUTLINES).delete(projectId);
    await txDone(tx);
  } finally {
    db.close();
  }
}
