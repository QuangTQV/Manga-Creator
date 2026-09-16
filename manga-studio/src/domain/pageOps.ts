/** Mutations for pages and panel layouts. */

import { cloneDoc, touch } from "./docHelpers";
import { createPanelFromRect, defaultPageWorkspacePosition, newId } from "./factory";
import { LAYOUT_PRESETS } from "./layouts";
import type { ID, LayoutPresetId, Page, ProjectDocument, Rect } from "./types";

/** A built-in preset, or a literal panel layout — e.g. from an SVG import
 * (`services/importLayoutSvg.ts`). Both flow through the same
 * content-preserving re-homing logic below. */
export type PageLayout = LayoutPresetId | Rect[];
import { createEmptyScene, syncPanelScene } from "./sceneOps";
import { reassignChapterStartsAfterPageRemoval } from "./chapterOps";

export function addPage(
  doc: ProjectDocument,
  layout: PageLayout = "four-grid",
): { doc: ProjectDocument; pageId: ID } {
  const next = cloneDoc(doc);
  const index = Object.keys(next.pages).length;
  const page: Page = {
    id: newId(),
    projectId: next.project.id,
    name: `Page ${index + 1}`,
    index,
    panelIds: [],
    workspace: defaultPageWorkspacePosition(index, next.project.settings.pageWidth),
  };
  next.pages[page.id] = page;
  applyLayout(next, page, layout);
  touch(next);
  return { doc: next, pageId: page.id };
}

/**
 * Replace a page's panel arrangement. Content is never silently deleted:
 * existing panel item stacks are re-homed into the new panels by position
 * (panel 1 → panel 1, …); overflow stacks land in the last new panel.
 */
export function setPageLayout(doc: ProjectDocument, pageId: ID, layout: PageLayout): ProjectDocument {
  const next = cloneDoc(doc);
  const page = next.pages[pageId];
  if (!page) throw new Error(`Unknown page: ${pageId}`);

  const oldStacks = page.panelIds.map((panelId) => {
    const stack = next.panels[panelId]?.itemIds ?? [];
    delete next.panels[panelId];
    delete next.scenes[panelId];
    return stack;
  });

  applyLayout(next, page, layout);

  page.panelIds.forEach((panelId, i) => {
    const carried = oldStacks[i] ?? [];
    // Panels beyond the new count collapse into the last panel.
    const overflow = i === page.panelIds.length - 1 ? oldStacks.slice(page.panelIds.length).flat() : [];
    const itemIds = [...carried, ...overflow];
    next.panels[panelId].itemIds = itemIds;
    for (const itemId of itemIds) {
      const item = next.items[itemId];
      if (item) item.panelId = panelId;
    }
    syncPanelScene(next, panelId);
  });

  touch(next);
  return next;
}

/**
 * Wipe a page back to an empty layout, in place: same id, name, index and
 * workspace position, but every existing panel/scene/item on it is gone —
 * unlike `setPageLayout`, which deliberately re-homes old content into the
 * new panels. This is for "start this page over" (e.g. Novel Import
 * regenerating a page), where carrying the old composition forward would
 * just leave stale content mixed in with the new run's output.
 */
export function resetPageLayout(doc: ProjectDocument, pageId: ID, layout: PageLayout): ProjectDocument {
  const next = cloneDoc(doc);
  const page = next.pages[pageId];
  if (!page) throw new Error(`Unknown page: ${pageId}`);

  for (const panelId of page.panelIds) {
    for (const itemId of next.panels[panelId]?.itemIds ?? []) delete next.items[itemId];
    delete next.panels[panelId];
    delete next.scenes[panelId];
  }

  applyLayout(next, page, layout);
  touch(next);
  return next;
}

/**
 * Move a page to a new reading-order position. `toIndex` is clamped into
 * range, and every affected page's `index` AND `workspace.x` are
 * recomputed together (`defaultPageWorkspacePosition` is the only place
 * that ever sets `workspace`, at creation time — nothing else moves a page
 * in the infinite workspace canvas), so the spatial left-to-right layout
 * stays in sync with reading order rather than going stale after a reorder.
 * Returns the SAME `doc` reference, unchanged, for a no-op move (already at
 * that position) — `editor/store.ts`'s `commit` treats reference equality
 * as "nothing happened" and skips pushing a history entry for it.
 */
export function reorderPage(doc: ProjectDocument, pageId: ID, toIndex: number): ProjectDocument {
  const page = doc.pages[pageId];
  if (!page) throw new Error(`Unknown page: ${pageId}`);

  const ordered = Object.values(doc.pages).sort((a, b) => a.index - b.index);
  const from = ordered.findIndex((p) => p.id === pageId);
  const clampedTo = Math.max(0, Math.min(toIndex, ordered.length - 1));
  if (from === clampedTo) return doc;

  ordered.splice(from, 1);
  ordered.splice(clampedTo, 0, page);

  const next = cloneDoc(doc);
  ordered.forEach((p, i) => {
    const movedPage = next.pages[p.id];
    movedPage.index = i;
    movedPage.workspace = defaultPageWorkspacePosition(i, next.project.settings.pageWidth);
  });
  touch(next);
  return next;
}

export function removePage(doc: ProjectDocument, pageId: ID): ProjectDocument {
  const next = cloneDoc(doc);
  const page = next.pages[pageId];
  if (!page) return next;
  for (const panelId of page.panelIds) {
    for (const itemId of next.panels[panelId]?.itemIds ?? []) delete next.items[itemId];
    delete next.panels[panelId];
    delete next.scenes[panelId];
  }
  reassignChapterStartsAfterPageRemoval(next, pageId);
  delete next.pages[pageId];
  Object.values(next.pages)
    .sort((a, b) => a.index - b.index)
    .forEach((p, i) => {
      p.index = i;
    });
  touch(next);
  return next;
}

function applyLayout(doc: ProjectDocument, page: Page, layout: PageLayout): void {
  page.panelIds = [];
  const rects = Array.isArray(layout) ? layout : LAYOUT_PRESETS[layout].rects;
  if (rects.length === 0) throw new Error("A layout needs at least one panel");
  for (const rect of rects) {
    const panel = createPanelFromRect(page.id, rect);
    doc.panels[panel.id] = panel;
    doc.scenes[panel.id] = createEmptyScene(panel.id);
    page.panelIds.push(panel.id);
  }
}
