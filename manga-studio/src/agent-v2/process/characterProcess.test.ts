/**
 * Regression: a preserved-but-unlinked character-state asset must be REUSED,
 * not treated as a reason to fail the run.
 *
 * `preserveRunArtifacts` (editor/store.ts) deliberately keeps a rolled-back
 * run's paid-for generations in `doc.assets` so a retry doesn't pay for the
 * same image twice — but it restores `characters` from the pre-run snapshot,
 * so the asset is never re-added to `character.assetIds`. Before this fix,
 * `doGenerateCharacterAsset` found that orphan via the broader
 * `metadata.characterId` scan and threw "already has a ... state — reused
 * instead of generating a duplicate" — a message that describes a REUSE but
 * was wired to a THROW, failing the whole run for exactly the case
 * `preserveRunArtifacts` exists to make cheap and safe.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createProjectDocument } from "@/domain/factory";
import { addAsset, addCharacter } from "@/domain/libraryOps";
import { useEditorStore } from "@/editor/store";
import { executePlan } from "@/agent-v2";
import { validatePlan } from "@/agent/tools/schemas";

class MockImage {
  naturalWidth = 900;
  naturalHeight = 1400;
  crossOrigin = "";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_value: string) {
    this.onload?.();
  }
}

beforeEach(() => {
  vi.stubGlobal("Image", MockImage as unknown as typeof Image);
  useEditorStore.setState({ doc: null, undoStack: [], redoStack: [] } as never);
});

describe("doGenerateCharacterAsset reuses a preserved-but-unlinked state asset", () => {
  it("reuses the orphan (no generation call, relinks it) instead of throwing", async () => {
    const base = createProjectDocument("Orphan reuse");
    const added = addCharacter(base, "Monster", "a monster");
    const orphan = addAsset(added.doc, {
      category: "character",
      name: "Monster pursuing haruto",
      storageUrl: "https://example.com/monster.png",
      processedImageUrl: "https://example.com/monster-alpha.png",
      width: 900,
      height: 1400,
      hasAlpha: true,
      backgroundRemoved: true,
      processingStatus: "ready",
      metadata: {
        characterId: added.characterId,
        characterAssetRole: "state",
        pose: "pursuing haruto",
        expression: "menacing",
        outfit: "default outfit",
        view: "front",
      },
    });

    // Simulate exactly what preserveRunArtifacts leaves behind: the asset
    // survives in doc.assets, but the character's own assetIds reverted to
    // what they were before the (rolled-back) run that created it.
    const doc = {
      ...orphan.doc,
      characters: {
        ...orphan.doc.characters,
        [added.characterId]: { ...orphan.doc.characters[added.characterId], assetIds: [] },
      },
    };
    useEditorStore.getState().loadDocument(doc);
    expect(useEditorStore.getState().doc!.characters[added.characterId].assetIds).toEqual([]);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/generate")) throw new Error("must not regenerate — the orphan already satisfies this state");
        return new Response(JSON.stringify({ capabilities: { referenceImage: true } }), { status: 200 });
      }),
    );

    const { plan } = validatePlan({
      summary: "Give the monster its pursuing pose",
      steps: [
        {
          tool: "generate_character_asset",
          args: { characterName: "Monster", kind: "pose", pose: "pursuing haruto", expression: "menacing" },
        },
      ],
    });
    const summary = await executePlan(plan!, () => {});

    expect(summary.status).toBe("completed");
    expect(summary.failed).toBe(0);

    // Reused, and relinked — every other consumer of the character's assets
    // (the library sidebar, resolveCharacterAsset) can now find it too.
    const after = useEditorStore.getState().doc!;
    expect(after.characters[added.characterId].assetIds).toContain(orphan.assetId);
  });
});
