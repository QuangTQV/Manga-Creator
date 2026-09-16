"use client";

import type { CropMode, ID, LayoutPresetId, Point, Rect } from "@/domain/types";
import { useEditorStore } from "@/editor/store";
import { requireCharacter } from "@/agent/resolver";
import type { RunContext } from "../types";

export function doSetPageLayout(ctx: RunContext, args: { layout: LayoutPresetId }): void {
  const pageId = useEditorStore.getState().currentPageId;
  if (!pageId) throw new Error("No current page");
  ctx.dispatch({ type: "set-page-layout", pageId, layout: args.layout });
}

export function doReshapePanel(ctx: RunContext, args: { panel: number; points: Point[] }): void {
  const panelId = ctx.panelIdByNumber(args.panel);
  ctx.dispatch({ type: "reshape-panel", panelId, points: args.points });
}

/**
 * Splits a panel into two, side by side or stacked — see `panelOps.ts`'s
 * `splitPanel` for the actual geometry (a real polygon clip, so it works on
 * any panel shape, not just rectangles). The new panel is inserted directly
 * after the split one in reading order, which shifts every later panel's
 * number up by one for the REST of this plan — a step that references a
 * panel by number after a split means "whatever is now panel N", not
 * whatever was panel N before the split (`TOOL_DOCS` in `agent/tools/
 * schemas.ts` says this explicitly, since the model has to plan around it).
 */
export function doSplitPanel(ctx: RunContext, args: { panel: number; direction: "vertical" | "horizontal"; fraction?: number }): void {
  const panelId = ctx.panelIdByNumber(args.panel);
  ctx.dispatch({ type: "split-panel", panelId, direction: args.direction, fraction: args.fraction });
}

/** Merges two panels into one (a convex-hull shape, keeping `panelA`'s
 * identity, camera and border) — see `panelOps.ts`'s `mergePanels`. Removes
 * `panelB` entirely, which also shifts later panel numbers. */
export function doMergePanels(ctx: RunContext, args: { panelA: number; panelB: number }): void {
  const panelAId = ctx.panelIdByNumber(args.panelA);
  const panelBId = ctx.panelIdByNumber(args.panelB);
  ctx.dispatch({ type: "merge-panels", panelAId, panelBId });
}

/**
 * Draws a brand-new rectangular panel directly onto the current page, on top
 * of whatever is already there — a breakout/bleeding panel, not a
 * replacement for the existing layout. See `panelOps.ts`'s `addCustomPanel`.
 * Same `useEditorStore` pageId lookup `doSetPageLayout` above already uses;
 * this tool has no `panel` argument to resolve a panel FROM, since it is
 * adding one, not editing one.
 */
export function doAddCustomPanel(ctx: RunContext, args: { rect: Rect }): void {
  const pageId = useEditorStore.getState().currentPageId;
  if (!pageId) throw new Error("No current page");
  ctx.dispatch({ type: "add-custom-panel", pageId, rect: args.rect });
}

export function doSetCropMode(ctx: RunContext, args: {
  panel: number;
  characterName?: string;
  characterId?: ID;
  category?: "character" | "background" | "prop" | "upload";
  mode: CropMode;
}): void {
  const doc = ctx.currentDoc();
  const panelId = ctx.panelIdByNumber(args.panel);
  const panel = doc.panels[panelId];

  const targets = panel.itemIds
    .map((id) => doc.items[id])
    .filter((item) => item?.kind === "asset")
    .filter((item) => {
      const asset = doc.assets[(item as { sourceAssetId: ID }).sourceAssetId];
      if (!asset) return false;
      if (args.characterId ?? args.characterName) {
        const character = requireCharacter(doc, args);
        return asset.metadata?.characterId === character.id;
      }
      if (args.category) return asset.category === args.category;
      return asset.category === "character"; // default target: the character shot
    });
  const target = targets[targets.length - 1];
  if (!target) throw new Error(`Nothing to reframe in panel ${args.panel}`);
  ctx.dispatch({ type: "set-framing", instanceId: target.id, cropMode: args.mode });
}

export function doRemoveItems(ctx: RunContext, args: { panel: number; kind?: "asset" | "bubble" | "effect" }): void {
  const doc = ctx.currentDoc();
  const panelId = ctx.panelIdByNumber(args.panel);
  const toRemove = doc.panels[panelId].itemIds.filter((id) => {
    const item = doc.items[id];
    return item && (!args.kind || item.kind === args.kind);
  });
  for (const itemId of toRemove) ctx.dispatch({ type: "delete-instance", instanceId: itemId });
}



/**
 * Coordinated multi-character action (P0.3/P0.4).
 *
 * Delegates to the SAME service the Inspector's Hug button uses, so the Agent
 * cannot acquire a different notion of what a hug is. The service decides
 * whether the action is local placement, a shared anchor, or one joint render
 * carrying both identity references — and performs the real provider call.
 *
 * Never satisfied by overlapping two existing sprites.
 */
