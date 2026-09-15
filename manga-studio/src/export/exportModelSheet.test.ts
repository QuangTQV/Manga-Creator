import { describe, expect, it } from "vitest";
import { createProjectDocument } from "@/domain/factory";
import { addAsset, addCharacter } from "@/domain/libraryOps";
import { computeModelSheetLayout, modelSheetRows, MODEL_SHEET_CELL, MODEL_SHEET_PADDING } from "./exportModelSheet";

function addState(
  doc: ReturnType<typeof createProjectDocument>,
  characterId: string,
  state: { pose: string; expression: string },
) {
  const added = addAsset(doc, {
    category: "character",
    name: `${state.pose}-${state.expression}`,
    storageUrl: `https://example.com/${state.pose}-${state.expression}.png`,
    width: 800,
    height: 1600,
    metadata: { characterId, characterAssetRole: "state", pose: state.pose, expression: state.expression, outfit: "default outfit", view: "front" },
  });
  return added;
}

describe("modelSheetRows", () => {
  it("puts the canonical reference first, then one row per distinct state with every variant kept", () => {
    let doc = createProjectDocument("Model sheet test");
    const created = addCharacter(doc, "Yuri");
    doc = created.doc;
    const characterId = created.characterId;

    const reference = addAsset(doc, {
      category: "character",
      name: "Yuri reference",
      storageUrl: "https://example.com/yuri-ref.png",
      width: 800,
      height: 1600,
      metadata: { characterId, characterAssetRole: "canonical", pose: "standing", expression: "neutral", outfit: "default outfit", view: "front" },
    });
    doc = reference.doc;
    doc = { ...doc, characters: { ...doc.characters, [characterId]: { ...doc.characters[characterId], canonicalReferenceAssetId: reference.assetId } } };

    const standingNeutral1 = addState(doc, characterId, { pose: "standing", expression: "neutral" });
    doc = standingNeutral1.doc;
    const standingNeutral2 = addState(doc, characterId, { pose: "standing", expression: "neutral" }); // regeneration
    doc = standingNeutral2.doc;
    const jumpingHappy = addState(doc, characterId, { pose: "jumping", expression: "happy" });
    doc = jumpingHappy.doc;

    const rows = modelSheetRows(doc, doc.characters[characterId]);

    expect(rows[0]).toMatchObject({ label: "Canonical Reference" });
    expect(rows[0].assets.map((a) => a.id)).toEqual([reference.assetId]);

    const standingRow = rows.find((r) => r.label.startsWith("Standing"));
    expect(standingRow?.assets.map((a) => a.id)).toEqual([standingNeutral1.assetId, standingNeutral2.assetId]);

    const jumpingRow = rows.find((r) => r.label.startsWith("Jumping"));
    expect(jumpingRow?.assets.map((a) => a.id)).toEqual([jumpingHappy.assetId]);
  });

  it("returns no rows for a character with nothing generated yet", () => {
    const doc = createProjectDocument("No reference");
    const created = addCharacter(doc, "Mori");
    const rows = modelSheetRows(created.doc, created.doc.characters[created.characterId]);
    expect(rows).toEqual([]);
  });

  it("still surfaces a reference row for the first-ever asset, even one not explicitly marked canonical", () => {
    // libraryOps.addAsset auto-promotes a character's very first asset to
    // referenceAssetId/canonicalReferenceAssetId regardless of its own
    // characterAssetRole — the same asset then also appears in its own
    // state row, since it genuinely is both today.
    let doc = createProjectDocument("Auto reference");
    const created = addCharacter(doc, "Mori");
    doc = created.doc;
    const first = addState(doc, created.characterId, { pose: "standing", expression: "neutral" });
    doc = first.doc;

    const rows = modelSheetRows(doc, doc.characters[created.characterId]);
    expect(rows[0]).toMatchObject({ label: "Canonical Reference" });
    expect(rows[0].assets.map((a) => a.id)).toEqual([first.assetId]);
  });
});

describe("computeModelSheetLayout", () => {
  it("sizes the canvas to the busiest row and stacks rows top to bottom", () => {
    const layout = computeModelSheetLayout([1, 3, 2]);

    const expectedWidth = MODEL_SHEET_PADDING + 3 * (MODEL_SHEET_CELL + MODEL_SHEET_PADDING);
    expect(layout.canvasWidth).toBe(expectedWidth);
    expect(layout.rows).toHaveLength(3);
    expect(layout.rows[0].cellXs).toHaveLength(1);
    expect(layout.rows[1].cellXs).toHaveLength(3);
    expect(layout.rows[2].cellXs).toHaveLength(2);
    // Rows stack strictly downward, never overlapping.
    expect(layout.rows[1].top).toBeGreaterThan(layout.rows[0].top);
    expect(layout.rows[2].top).toBeGreaterThan(layout.rows[1].top);
  });

  it("gives an empty sheet a sane minimum size instead of a degenerate one", () => {
    const layout = computeModelSheetLayout([]);
    expect(layout.canvasWidth).toBeGreaterThan(0);
    expect(layout.canvasHeight).toBeGreaterThan(0);
  });
});
