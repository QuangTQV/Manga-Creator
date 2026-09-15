/**
 * Chapters as page-order boundaries — see `Chapter`'s own docstring in
 * types.ts for why membership is derived, not stored per page.
 */

import { cloneDoc, touch } from "./docHelpers";
import { newId } from "./factory";
import type { Chapter, ID, ProjectDocument } from "./types";

export function addChapter(doc: ProjectDocument, startPageId: ID, name?: string): { doc: ProjectDocument; chapterId: ID } {
  const page = doc.pages[startPageId];
  if (!page) throw new Error(`Unknown page: ${startPageId}`);
  if (Object.values(doc.chapters).some((c) => c.startPageId === startPageId)) {
    throw new Error("A chapter already starts on this page");
  }

  const next = cloneDoc(doc);
  const chapter: Chapter = {
    id: newId(),
    projectId: next.project.id,
    name: (name ?? "").trim() || `Chapter ${Object.keys(next.chapters).length + 1}`,
    startPageId,
  };
  next.chapters[chapter.id] = chapter;
  touch(next);
  return { doc: next, chapterId: chapter.id };
}

export function renameChapter(doc: ProjectDocument, chapterId: ID, name: string): ProjectDocument {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("A chapter needs a name");
  if (!doc.chapters[chapterId]) throw new Error(`Unknown chapter: ${chapterId}`);
  const next = cloneDoc(doc);
  next.chapters[chapterId].name = trimmed;
  touch(next);
  return next;
}

/** Deletes the chapter marker. Its pages are not touched — they simply
 * fall back into whichever range now covers them (the previous chapter's,
 * or the unassigned prologue if it was first — see `chaptersInOrder`). */
export function removeChapter(doc: ProjectDocument, chapterId: ID): ProjectDocument {
  if (!doc.chapters[chapterId]) return doc;
  const next = cloneDoc(doc);
  delete next.chapters[chapterId];
  touch(next);
  return next;
}

/** Moves WHERE a chapter begins — e.g. dragging its start to a different
 * page. Same uniqueness rule as `addChapter`: two chapters cannot start on
 * the same page. */
export function moveChapterStart(doc: ProjectDocument, chapterId: ID, toPageId: ID): ProjectDocument {
  const chapter = doc.chapters[chapterId];
  if (!chapter) throw new Error(`Unknown chapter: ${chapterId}`);
  if (!doc.pages[toPageId]) throw new Error(`Unknown page: ${toPageId}`);
  if (chapter.startPageId === toPageId) return doc;
  if (Object.values(doc.chapters).some((c) => c.id !== chapterId && c.startPageId === toPageId)) {
    throw new Error("A chapter already starts on this page");
  }
  const next = cloneDoc(doc);
  next.chapters[chapterId].startPageId = toPageId;
  touch(next);
  return next;
}

export interface ChapterRange {
  chapter: Chapter;
  pageIds: ID[];
}

/**
 * Chapters and their pages, in reading order — the derivation
 * `Chapter`'s docstring describes. `unassignedPageIds` are the pages
 * before the first chapter's start (an implicit, unnamed prologue); empty
 * whenever the book has no chapters yet, or its first chapter starts on
 * page 1.
 */
export function chaptersInOrder(doc: ProjectDocument): { chapters: ChapterRange[]; unassignedPageIds: ID[] } {
  const pages = Object.values(doc.pages).sort((a, b) => a.index - b.index);
  const pageIndex = new Map(pages.map((p, i) => [p.id, i]));
  const chapters = Object.values(doc.chapters)
    .filter((c) => pageIndex.has(c.startPageId))
    .sort((a, b) => pageIndex.get(a.startPageId)! - pageIndex.get(b.startPageId)!);

  const unassignedPageIds =
    chapters.length > 0 ? pages.slice(0, pageIndex.get(chapters[0].startPageId)).map((p) => p.id) : pages.map((p) => p.id);

  const ranges: ChapterRange[] = chapters.map((chapter, i) => {
    const start = pageIndex.get(chapter.startPageId)!;
    const end = i + 1 < chapters.length ? pageIndex.get(chapters[i + 1].startPageId)! : pages.length;
    return { chapter, pageIds: pages.slice(start, end).map((p) => p.id) };
  });

  return { chapters: ranges, unassignedPageIds };
}

/**
 * A page was removed: any chapter that started there follows the page that
 * is now first in what's left of ITS OWN range (bounded by the next
 * chapter after it, if any — never steals a page that already belongs to
 * that next chapter), or is deleted if nothing is left. Called from
 * `pageOps.ts`'s `removePage`, before the page is actually deleted, so
 * `chaptersInOrder` can still see it as the (about to be former) boundary.
 */
export function reassignChapterStartsAfterPageRemoval(doc: ProjectDocument, removedPageId: ID): void {
  const affected = Object.values(doc.chapters).filter((c) => c.startPageId === removedPageId);
  if (affected.length === 0) return;

  const { chapters: ranges } = chaptersInOrder(doc);
  for (const chapter of affected) {
    const remaining = (ranges.find((r) => r.chapter.id === chapter.id)?.pageIds ?? []).filter(
      (id) => id !== removedPageId,
    );
    if (remaining.length > 0) chapter.startPageId = remaining[0];
    else delete doc.chapters[chapter.id];
  }
}
