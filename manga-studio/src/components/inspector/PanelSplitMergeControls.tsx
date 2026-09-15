"use client";

/**
 * Split a panel into two, or merge it with another panel on the same page.
 *
 * Split works on any panel shape (a real polygon clip, not a bounding-box
 * trick — see `domain/panelOps.ts`); merge takes the convex hull of both
 * panels' shapes, which can include a sliver of extra area between two
 * panels that weren't already touching — a deliberate tradeoff over full
 * polygon-union math, documented on `mergePanels` itself.
 */

import { useState } from "react";
import type { ID } from "@/domain/types";
import { useEditorStore } from "@/editor/store";

export function PanelSplitMergeControls({ panelId }: { panelId: ID }) {
  const doc = useEditorStore((s) => s.doc);
  const [fraction, setFraction] = useState(0.5);
  const [mergeTarget, setMergeTarget] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!doc) return null;
  const panel = doc.panels[panelId];
  if (!panel) return null;
  const page = doc.pages[panel.pageId];
  const otherPanelIds = page.panelIds.filter((id) => id !== panelId);

  const split = (direction: "vertical" | "horizontal") => {
    setError(null);
    try {
      useEditorStore.getState().dispatch({ type: "split-panel", panelId, direction, fraction });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not split this panel");
    }
  };

  const merge = () => {
    if (!mergeTarget) return;
    setError(null);
    try {
      useEditorStore.getState().dispatch({ type: "merge-panels", panelAId: panelId, panelBId: mergeTarget });
      setMergeTarget("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not merge these panels");
    }
  };

  return (
    <div className="rounded border border-zinc-800 bg-zinc-950/50 p-2">
      <p className="mb-2 text-[10px] uppercase tracking-wider text-zinc-500">Split / merge</p>
      {error && <p className="mb-2 text-[10px] text-red-400">{error}</p>}

      <label className="mb-1 flex items-center justify-between text-[10px] text-zinc-500">
        <span>Split position</span>
        <span>{Math.round(fraction * 100)}%</span>
      </label>
      <input
        type="range"
        min={0.1}
        max={0.9}
        step={0.05}
        className="mb-2 w-full"
        value={fraction}
        onChange={(e) => setFraction(Number(e.target.value))}
        aria-label="Split position"
      />
      <div className="mb-3 flex gap-2">
        <button
          className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-[11px] hover:bg-zinc-700"
          onClick={() => split("vertical")}
        >
          Split ↔ side by side
        </button>
        <button
          className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-[11px] hover:bg-zinc-700"
          onClick={() => split("horizontal")}
        >
          Split ↕ stacked
        </button>
      </div>

      {otherPanelIds.length > 0 && (
        <div className="flex items-center gap-2">
          <select
            aria-label="Merge with"
            className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-800 px-1.5 py-1 text-[11px] text-zinc-300"
            value={mergeTarget}
            onChange={(e) => setMergeTarget(e.target.value)}
          >
            <option value="">Merge with…</option>
            {otherPanelIds.map((id) => (
              <option key={id} value={id}>
                Panel {page.panelIds.indexOf(id) + 1}
              </option>
            ))}
          </select>
          <button
            className="rounded border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-[11px] hover:bg-zinc-700 disabled:opacity-40"
            disabled={!mergeTarget}
            onClick={merge}
          >
            Merge
          </button>
        </div>
      )}
    </div>
  );
}
