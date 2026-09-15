/**
 * Panel geometry mutations. Presets create the initial shape; these commands
 * let the creator (or the agent) own the layout afterwards — including
 * non-rectangular manga panels.
 */

import { cloneDoc, touch } from "./docHelpers";
import { pageSize, panelBoundsPx, panelLocalToPage, pageToPanelLocal } from "./coords";
import { clipPolygonHalfPlane, convexHull, polygonBounds, polygonToNormalized, polygonToPx } from "./geometry";
import { newId } from "./factory";
import { applyAttachments } from "./languageOps";
import { createEmptyScene, syncPanelScene } from "./sceneOps";
import type { ID, Panel, Point, ProjectDocument } from "./types";

export const MIN_PANEL_POINTS = 3;
export const MAX_PANEL_POINTS = 10;

/** Replace a panel's polygon (normalized page coords, clamped to the page). */
export function reshapePanel(doc: ProjectDocument, panelId: ID, points: Point[]): ProjectDocument {
  if (points.length < MIN_PANEL_POINTS || points.length > MAX_PANEL_POINTS) {
    throw new Error(`Panel shape needs ${MIN_PANEL_POINTS}–${MAX_PANEL_POINTS} points`);
  }
  const next = cloneDoc(doc);
  const panel = next.panels[panelId];
  if (!panel) throw new Error(`Unknown panel: ${panelId}`);
  panel.points = points.map(clampToPage);
  assertNotDegenerate(panel.points);
  touch(next);
  return next;
}

/** Move a single vertex — the drag interaction in shape-edit mode. */
export function movePanelPoint(doc: ProjectDocument, panelId: ID, index: number, point: Point): ProjectDocument {
  const next = cloneDoc(doc);
  const panel = next.panels[panelId];
  if (!panel) throw new Error(`Unknown panel: ${panelId}`);
  if (index < 0 || index >= panel.points.length) throw new Error("No such panel point");
  panel.points[index] = clampToPage(point);
  touch(next);
  return next;
}

function clampToPage(point: Point): Point {
  return { x: clamp01(point.x), y: clamp01(point.y) };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** A zero-area polygon would render nothing and break framing math. */
function assertNotDegenerate(points: Point[]): void {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  if (Math.abs(area / 2) < 0.0005) throw new Error("Panel shape is degenerate (zero area)");
}

/**
 * Splits a panel along a straight line into two panels, side by side
 * (`"vertical"`) or stacked (`"horizontal"`) — `fraction` is where along
 * the panel's own bounding box the cut falls (0.5 = the middle). Works on
 * any panel shape, not just rectangles: the cut is a real polygon clip
 * (`clipPolygonHalfPlane`), not a bounding-box trick.
 *
 * Every item on the panel is kept — reassigned to whichever half its
 * center now falls in, with `cx`/`cy` recomputed against that half's OWN
 * new bounding box (both halves get new, smaller boxes than the original,
 * so even items that "stay" on the first half need their local coordinates
 * redone, not just the ones that move).
 */
export function splitPanel(
  doc: ProjectDocument,
  panelId: ID,
  direction: "vertical" | "horizontal",
  fraction = 0.5,
): { doc: ProjectDocument; newPanelId: ID } {
  const panel = doc.panels[panelId];
  if (!panel) throw new Error(`Unknown panel: ${panelId}`);
  if (fraction <= 0 || fraction >= 1) throw new Error("Split position must be strictly between the panel's edges");
  const page = Object.values(doc.pages).find((p) => p.id === panel.pageId);
  if (!page) throw new Error("Panel does not belong to any page");

  const { width: pageW, height: pageH } = pageSize(doc);
  const polygonPx = polygonToPx(panel.points, pageW, pageH);
  const bounds = polygonBounds(polygonPx);
  const boundary = direction === "vertical" ? bounds.x + bounds.width * fraction : bounds.y + bounds.height * fraction;
  const sideOf = (p: Point) => (direction === "vertical" ? p.x : p.y) - boundary;

  const firstPx = clipPolygonHalfPlane(polygonPx, sideOf);
  const secondPx = clipPolygonHalfPlane(polygonPx, (p) => -sideOf(p));
  if (firstPx.length < MIN_PANEL_POINTS || secondPx.length < MIN_PANEL_POINTS) {
    throw new Error("Panel is too small to split at this point");
  }
  const firstPoints = polygonToNormalized(firstPx, pageW, pageH);
  const secondPoints = polygonToNormalized(secondPx, pageW, pageH);
  assertNotDegenerate(firstPoints);
  assertNotDegenerate(secondPoints);

  const next = cloneDoc(doc);
  const firstPanel = next.panels[panelId];
  firstPanel.points = firstPoints;
  const firstBoundsPx = polygonBounds(firstPx);
  const secondBoundsPx = polygonBounds(secondPx);

  const newPanel: Panel = {
    id: newId(),
    pageId: page.id,
    points: secondPoints,
    border: { ...firstPanel.border },
    itemIds: [],
  };
  next.panels[newPanel.id] = newPanel;
  next.scenes[newPanel.id] = createEmptyScene(newPanel.id);
  const nextPage = next.pages[page.id];
  const insertAt = nextPage.panelIds.indexOf(panelId);
  nextPage.panelIds.splice(insertAt + 1, 0, newPanel.id);

  const movedToSecond: ID[] = [];
  for (const itemId of firstPanel.itemIds) {
    const item = next.items[itemId];
    if (!item) continue;
    const pagePoint = panelLocalToPage({ x: item.cx, y: item.cy }, bounds);
    const onSecondSide = sideOf(pagePoint) > 0;
    const local = pageToPanelLocal(pagePoint, onSecondSide ? secondBoundsPx : firstBoundsPx);
    item.cx = local.x;
    item.cy = local.y;
    if (onSecondSide) {
      item.panelId = newPanel.id;
      movedToSecond.push(itemId);
    }
  }
  newPanel.itemIds = movedToSecond;
  firstPanel.itemIds = firstPanel.itemIds.filter((id) => !movedToSecond.includes(id));
  if (firstPanel.focalItemId && movedToSecond.includes(firstPanel.focalItemId)) {
    newPanel.focalItemId = firstPanel.focalItemId;
    firstPanel.focalItemId = undefined;
  }

  // Recompute attached decorations (§11) now that subjects may have moved —
  // an attachment whose target crossed into the other half detaches rather
  // than snapping across panels, the same rule applyAttachments always uses.
  let result = applyAttachments(next, panelId);
  result = applyAttachments(result, newPanel.id);
  syncPanelScene(result, panelId);
  syncPanelScene(result, newPanel.id);
  touch(result);
  return { doc: result, newPanelId: newPanel.id };
}

/**
 * Merges `panelBId` into `panelAId`: the result's shape is the convex hull
 * of both panels' polygons (not a true polygon union — see `convexHull`'s
 * own docstring for the tradeoff), keeping `panelAId`'s identity, camera,
 * perspective and border. Every item from both panels survives, `cx`/`cy`
 * recomputed against the merged panel's new bounding box.
 */
export function mergePanels(doc: ProjectDocument, panelAId: ID, panelBId: ID): ProjectDocument {
  if (panelAId === panelBId) throw new Error("Cannot merge a panel with itself");
  const a = doc.panels[panelAId];
  const b = doc.panels[panelBId];
  if (!a || !b) throw new Error("Unknown panel");
  if (a.pageId !== b.pageId) throw new Error("Panels must be on the same page to merge");

  const { width: pageW, height: pageH } = pageSize(doc);
  const aPx = polygonToPx(a.points, pageW, pageH);
  const bPx = polygonToPx(b.points, pageW, pageH);
  const hullPx = convexHull([...aPx, ...bPx]);
  if (hullPx.length > MAX_PANEL_POINTS) {
    throw new Error("Merged panel shape would need too many points — try simpler panel shapes first");
  }
  const hullPoints = polygonToNormalized(hullPx, pageW, pageH);
  assertNotDegenerate(hullPoints);

  const aBoundsPx = panelBoundsPx(doc, a);
  const bBoundsPx = panelBoundsPx(doc, b);
  const hullBoundsPx = polygonBounds(hullPx);
  const bItemIds = new Set(b.itemIds);

  const next = cloneDoc(doc);
  const merged = next.panels[panelAId];
  merged.points = hullPoints;

  const allItemIds = [...a.itemIds, ...b.itemIds];
  for (const itemId of allItemIds) {
    const item = next.items[itemId];
    if (!item) continue;
    const fromBounds = bItemIds.has(itemId) ? bBoundsPx : aBoundsPx;
    const pagePoint = panelLocalToPage({ x: item.cx, y: item.cy }, fromBounds);
    const local = pageToPanelLocal(pagePoint, hullBoundsPx);
    item.cx = local.x;
    item.cy = local.y;
    item.panelId = panelAId;
  }
  merged.itemIds = allItemIds;
  if (!merged.focalItemId && b.focalItemId) merged.focalItemId = b.focalItemId;

  delete next.panels[panelBId];
  delete next.scenes[panelBId];
  const page = next.pages[a.pageId];
  page.panelIds = page.panelIds.filter((id) => id !== panelBId);

  const result = applyAttachments(next, panelAId);
  syncPanelScene(result, panelAId);
  touch(result);
  return result;
}
