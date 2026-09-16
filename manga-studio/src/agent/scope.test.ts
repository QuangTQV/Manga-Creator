import { describe, expect, it } from "vitest";
import { createProjectDocument } from "@/domain/factory";
import { addAsset, addCharacter } from "@/domain/libraryOps";
import { placeAsset } from "@/domain/itemOps";
import { applyDomainCommand } from "@/domain/commands";
import { resolveAgentScope } from "./scope";
import { validatePlan, validateStepScope } from "./tools/schemas";

function scopedDocument() {
  let doc = createProjectDocument("Scope");
  const page = Object.values(doc.pages)[0];
  const character = addCharacter(doc, "Yuri");
  doc = character.doc;
  const asset = addAsset(doc, {
    category: "character",
    name: "Walk Cycle 03",
    storageUrl: "https://example.com/yuri-walk.png",
    width: 800,
    height: 1600,
    metadata: { characterId: character.characterId, pose: "walking", characterAssetRole: "state" },
  });
  doc = asset.doc;
  const placed = placeAsset(doc, page.panelIds[0], asset.assetId);
  return { doc: placed.doc, pageId: page.id, panelId: page.panelIds[0], itemId: placed.itemId };
}

/** Two panels, so merge_panels/split_panel scope tests have a "the other panel" to check against. */
function twoPanelDocument() {
  const doc = createProjectDocument("Panel structure scope");
  const pageId = Object.values(doc.pages)[0].id;
  const withLayout = applyDomainCommand(doc, { type: "set-page-layout", pageId, layout: "two-vertical" }).doc;
  const page = withLayout.pages[pageId];
  return { doc: withLayout, pageId, panelId: page.panelIds[0], otherPanelId: page.panelIds[1] };
}

describe("authoritative agent scope", () => {
  it("prioritizes selected object, then selected panel, then current page", () => {
    const { doc, pageId, panelId, itemId } = scopedDocument();
    expect(resolveAgentScope({ doc, currentPageId: pageId, selection: { panelId, itemId }, prompt: "make her smile" }).kind)
      .toBe("selected-object");
    expect(resolveAgentScope({ doc, currentPageId: pageId, selection: { panelId }, prompt: "add a thought" }).label)
      .toBe("Selected Panel · Panel 1");
    expect(resolveAgentScope({ doc, currentPageId: pageId, selection: {}, prompt: "add a thought" }).kind)
      .toBe("current-page");
  });

  it("expands a selected panel only when the prompt explicitly requests page/project scope", () => {
    const { doc, pageId, panelId } = scopedDocument();
    expect(resolveAgentScope({ doc, currentPageId: pageId, selection: { panelId }, prompt: "update all four panels" }).kind)
      .toBe("current-page");
    expect(resolveAgentScope({ doc, currentPageId: pageId, selection: { panelId }, prompt: "update the whole project" }).kind)
      .toBe("whole-project");
  });

  it("rejects cross-panel calls before execution", () => {
    const { doc, pageId, panelId } = scopedDocument();
    const scope = resolveAgentScope({ doc, currentPageId: pageId, selection: { panelId }, prompt: "change this panel" });
    const result = validatePlan({
      summary: "attempted spill",
      steps: [
        { tool: "add_effect", args: { panel: 1, effectKind: "focus-lines" } },
        { tool: "add_speech_bubble", args: { panel: 2, bubbleType: "thought", text: "No" } },
        { tool: "set_page_layout", args: { layout: "yonkoma" } },
      ],
    }, scope);
    expect(result.plan.steps).toHaveLength(1);
    expect(result.rejected).toHaveLength(2);
    expect(result.rejected.every((entry) => entry.error.includes("Scope violation"))).toBe(true);
  });
});

describe("scope covers the virtual manga stage tools", () => {
  it("blocks camera, perspective, depth and bubble tools aimed at another panel", () => {
    const { doc, pageId, panelId } = scopedDocument();
    const page = doc.pages[pageId];
    const selectedPanelNumber = page.panelIds.indexOf(panelId) + 1;
    const otherPanelNumber = selectedPanelNumber === 1 ? 2 : 1;
    const scope = resolveAgentScope({
      doc,
      currentPageId: pageId,
      selection: { panelId },
      prompt: "make this dramatic",
    });
    expect(scope.kind).toBe("selected-panel");

    for (const step of [
      { tool: "set_camera", args: { panel: otherPanelNumber, shot: "close-up" } },
      { tool: "set_perspective", args: { panel: otherPanelNumber, type: "one-point" } },
      { tool: "set_character_depth", args: { panel: otherPanelNumber, depth: 0.8 } },
      { tool: "attach_bubble", args: { panel: otherPanelNumber, characterName: "Yuri", bubbleType: "speech", text: "hi" } },
    ]) {
      expect(validateStepScope(step.tool as never, step.args, scope)).toMatch(/Scope violation/);
    }
  });

  it("allows the same tools on the selected panel", () => {
    const { doc, pageId, panelId } = scopedDocument();
    const page = doc.pages[pageId];
    const panelNumber = page.panelIds.indexOf(panelId) + 1;
    const scope = resolveAgentScope({
      doc,
      currentPageId: pageId,
      selection: { panelId },
      prompt: "make this dramatic",
    });

    for (const step of [
      { tool: "set_camera", args: { panel: panelNumber, angle: "low" } },
      { tool: "set_perspective", args: { panel: panelNumber, type: "two-point" } },
      { tool: "set_character_depth", args: { panel: panelNumber, depth: 0.2 } },
      { tool: "attach_bubble", args: { panel: panelNumber, characterName: "Yuri", bubbleType: "shout", text: "hi" } },
    ]) {
      expect(validateStepScope(step.tool as never, step.args, scope)).toBeNull();
    }
  });

  it("rejects a panel number that does not exist on the page", () => {
    const { doc, pageId } = scopedDocument();
    const scope = resolveAgentScope({ doc, currentPageId: pageId, selection: {}, prompt: "set the camera" });
    expect(validateStepScope("set_camera" as never, { panel: 11, shot: "wide" }, scope)).toMatch(/outside/);
  });

  it("keeps a selected-object run away from panel-level camera changes", () => {
    const { doc, pageId, panelId, itemId } = scopedDocument();
    const scope = resolveAgentScope({
      doc,
      currentPageId: pageId,
      selection: { panelId, itemId },
      prompt: "make her angry",
    });
    expect(scope.kind).toBe("selected-object");
    // Selecting one character must not license restaging the whole panel.
    expect(validateStepScope("set_camera" as never, { panel: 1, shot: "close-up" }, scope)).toMatch(/Scope violation/);
  });
});

describe("scope covers panel-structure tools (split/merge/add_custom_panel)", () => {
  it("selecting one object never licenses restructuring panels", () => {
    const { doc, pageId, panelId, itemId } = scopedDocument();
    const scope = resolveAgentScope({ doc, currentPageId: pageId, selection: { panelId, itemId }, prompt: "change something" });
    expect(scope.kind).toBe("selected-object");

    expect(validateStepScope("split_panel" as never, { panel: 1, direction: "vertical" }, scope)).toMatch(/Scope violation/);
    expect(validateStepScope("merge_panels" as never, { panelA: 1, panelB: 2 }, scope)).toMatch(/Scope violation/);
    expect(validateStepScope("add_custom_panel" as never, { rect: { x: 0, y: 0, width: 0.3, height: 0.3 } }, scope)).toMatch(
      /Scope violation/,
    );
  });

  it("split_panel is allowed on the selected panel, rejected on another", () => {
    const { doc, pageId, panelId, otherPanelId } = twoPanelDocument();
    const page = doc.pages[pageId];
    const selectedNumber = page.panelIds.indexOf(panelId) + 1;
    const otherNumber = page.panelIds.indexOf(otherPanelId) + 1;
    const scope = resolveAgentScope({ doc, currentPageId: pageId, selection: { panelId }, prompt: "cut this panel in half" });
    expect(scope.kind).toBe("selected-panel");

    expect(validateStepScope("split_panel" as never, { panel: selectedNumber, direction: "vertical" }, scope)).toBeNull();
    expect(validateStepScope("split_panel" as never, { panel: otherNumber, direction: "vertical" }, scope)).toMatch(
      /Scope violation/,
    );
  });

  it("add_custom_panel is a page-level change, rejected even for a selected panel", () => {
    const { doc, pageId, panelId } = twoPanelDocument();
    const scope = resolveAgentScope({ doc, currentPageId: pageId, selection: { panelId }, prompt: "add a panel" });
    expect(scope.kind).toBe("selected-panel");
    expect(
      validateStepScope("add_custom_panel" as never, { rect: { x: 0, y: 0, width: 0.3, height: 0.3 } }, scope),
    ).toMatch(/cannot add a new panel/);
  });

  it("merge_panels is allowed for a selected panel when it is EITHER side of the merge", () => {
    const { doc, pageId, panelId, otherPanelId } = twoPanelDocument();
    const page = doc.pages[pageId];
    const selectedNumber = page.panelIds.indexOf(panelId) + 1;
    const otherNumber = page.panelIds.indexOf(otherPanelId) + 1;
    const scope = resolveAgentScope({ doc, currentPageId: pageId, selection: { panelId }, prompt: "merge with the next panel" });
    expect(scope.kind).toBe("selected-panel");

    expect(validateStepScope("merge_panels" as never, { panelA: selectedNumber, panelB: otherNumber }, scope)).toBeNull();
    expect(validateStepScope("merge_panels" as never, { panelA: otherNumber, panelB: selectedNumber }, scope)).toBeNull();
  });

  it("rejects a merge_panels call naming a panel number outside the page", () => {
    const { doc, pageId } = twoPanelDocument();
    const scope = resolveAgentScope({ doc, currentPageId: pageId, selection: {}, prompt: "merge panels" });
    expect(scope.kind).toBe("current-page");
    expect(validateStepScope("merge_panels" as never, { panelA: 1, panelB: 9 }, scope)).toMatch(/outside/);
  });

  it("validatePlan rejects the structural tools when scoped to a different panel", () => {
    const { doc, pageId, otherPanelId } = twoPanelDocument();
    const scope = resolveAgentScope({ doc, currentPageId: pageId, selection: { panelId: otherPanelId }, prompt: "work on this panel" });
    const result = validatePlan(
      {
        summary: "attempted structural change to the wrong panel",
        steps: [{ tool: "split_panel", args: { panel: 1, direction: "horizontal" } }],
      },
      scope,
    );
    expect(result.plan.steps).toHaveLength(0);
    expect(result.rejected[0]?.error).toMatch(/Scope violation/);
  });
});
