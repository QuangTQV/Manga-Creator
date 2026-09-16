/**
 * The Agent's panel-structure tools (split_panel, merge_panels,
 * add_custom_panel) — added so the Director can restructure a page's
 * layout the same way the manual "Panel" button and split/merge controls
 * already let a creator do, instead of being limited to picking one of the
 * fixed layout presets or reshaping a single existing panel's polygon.
 *
 * These exercise real execution through `executePlan`, not just the scope
 * schemas — proving the tool actually resolves panel NUMBERS to panel IDs
 * and dispatches the real domain command, end to end.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { createProjectDocument } from "@/domain/factory";
import { useEditorStore } from "@/editor/store";
import { executePlan } from "@/agent-v2";
import type { AgentPlan } from "@/agent/tools/schemas";

function noop() {}

function currentPage() {
  const doc = useEditorStore.getState().doc!;
  const pageId = useEditorStore.getState().currentPageId!;
  return doc.pages[pageId];
}

beforeEach(() => {
  useEditorStore.getState().loadDocument(createProjectDocument("Panel structure tools"));
  const pageId = Object.values(useEditorStore.getState().doc!.pages)[0].id;
  useEditorStore.getState().dispatch({ type: "set-page-layout", pageId, layout: "two-vertical" });
});

function runPlan(steps: AgentPlan["steps"]) {
  return executePlan({ summary: "test", steps }, noop);
}

describe("split_panel", () => {
  it("splits panel 1 into two, growing the panel count by one", async () => {
    expect(currentPage().panelIds).toHaveLength(2);
    const summary = await runPlan([{ tool: "split_panel", args: { panel: 1, direction: "vertical" } }]);
    expect(summary.completed).toBe(1);
    expect(summary.failed).toBe(0);
    expect(currentPage().panelIds).toHaveLength(3);
  });

  it("the new panel lands right after the split one, so a later step can address it by its shifted number", async () => {
    // After splitting panel 1, the new panel is panel 2 and the original
    // panel 2 shifts to panel 3 — this plan adds a bubble to panel 3 to
    // prove the shift is real, not just documented.
    const summary = await runPlan([
      { tool: "split_panel", args: { panel: 1, direction: "horizontal" } },
      { tool: "add_speech_bubble", args: { panel: 3, bubbleType: "speech", text: "still the original panel 2" } },
    ]);
    expect(summary.completed).toBe(2);
    expect(summary.failed).toBe(0);
    const page = currentPage();
    const doc = useEditorStore.getState().doc!;
    const originalSecondPanelId = page.panelIds[2];
    const items = doc.panels[originalSecondPanelId].itemIds.map((id) => doc.items[id]);
    expect(items.some((item) => item.kind === "bubble" && item.text === "still the original panel 2")).toBe(true);
  });
});

describe("merge_panels", () => {
  it("merges panel 2 into panel 1, shrinking the panel count by one", async () => {
    expect(currentPage().panelIds).toHaveLength(2);
    const summary = await runPlan([{ tool: "merge_panels", args: { panelA: 1, panelB: 2 } }]);
    expect(summary.completed).toBe(1);
    expect(summary.failed).toBe(0);
    expect(currentPage().panelIds).toHaveLength(1);
  });
});

describe("add_custom_panel", () => {
  it("adds a new panel on top of the existing layout without removing any panel", async () => {
    expect(currentPage().panelIds).toHaveLength(2);
    const summary = await runPlan([
      { tool: "add_custom_panel", args: { rect: { x: 0.3, y: 0.3, width: 0.3, height: 0.3 } } },
    ]);
    expect(summary.completed).toBe(1);
    expect(summary.failed).toBe(0);
    expect(currentPage().panelIds).toHaveLength(3);
  });
});
