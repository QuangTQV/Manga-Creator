import { beforeEach, describe, expect, it } from "vitest";
import { createProjectDocument } from "@/domain/factory";
import { addAsset } from "@/domain/libraryOps";
import { placeAsset, updateItemTransform } from "@/domain/itemOps";
import { historyTimeline, useEditorStore } from "./store";

function seed() {
  let doc = createProjectDocument("Undo test");
  const asset = addAsset(doc, {
    category: "character",
    name: "Akari",
    storageUrl: "https://example.com/a.png",
    width: 1000,
    height: 2000,
  });
  doc = asset.doc;
  useEditorStore.getState().loadDocument(doc);
  return { assetId: asset.assetId, panelId: Object.keys(doc.panels)[0] };
}

describe("editor history", () => {
  beforeEach(() => {
    useEditorStore.getState().loadDocument(createProjectDocument("reset"));
  });

  it("commit → undo → redo round-trips the document", () => {
    const { assetId, panelId } = seed();
    const store = useEditorStore.getState();
    const before = store.doc!;

    store.commit((d) => placeAsset(d, panelId, assetId).doc);
    const after = useEditorStore.getState().doc!;
    expect(Object.keys(after.items)).toHaveLength(1);

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().doc).toBe(before);

    useEditorStore.getState().redo();
    expect(useEditorStore.getState().doc).toBe(after);
  });

  it("a transient gesture collapses into a single undo entry", () => {
    const { assetId, panelId } = seed();
    useEditorStore.getState().commit((d) => placeAsset(d, panelId, assetId).doc);
    const itemId = Object.keys(useEditorStore.getState().doc!.items)[0];
    const beforeDrag = useEditorStore.getState().doc!;

    // Simulate a 60fps drag: many transient updates, one commit.
    for (let i = 0; i < 30; i++) {
      useEditorStore.getState().transient((d) => updateItemTransform(d, itemId, { cx: i * 10 }));
    }
    useEditorStore.getState().commitTransient();

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().doc).toBe(beforeDrag);
  });

  it("a transaction groups many commits into one undo step (agent runs)", () => {
    const { assetId, panelId } = seed();
    const store = useEditorStore.getState();
    const before = store.doc!;

    store.beginTransaction();
    store.commit((d) => placeAsset(d, panelId, assetId).doc);
    store.commit((d) => placeAsset(d, panelId, assetId).doc);
    store.commit((d) => placeAsset(d, panelId, assetId).doc);
    store.endTransaction();

    expect(Object.keys(useEditorStore.getState().doc!.items)).toHaveLength(3);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().doc).toBe(before);
  });

  it("an empty transaction adds no history entry", () => {
    seed();
    const store = useEditorStore.getState();
    const pastLength = useEditorStore.getState().past.length;
    store.beginTransaction();
    store.endTransaction();
    expect(useEditorStore.getState().past).toHaveLength(pastLength);
  });

  it("dispatch derives a human label from the command type", () => {
    const { assetId, panelId } = seed();
    useEditorStore.getState().dispatch({ type: "add-instance", panelId, assetId });
    expect(useEditorStore.getState().currentLabel).toBe("Add instance");
  });

  it("an agent-run transaction is labeled with the run's own summary", () => {
    const { assetId, panelId } = seed();
    const store = useEditorStore.getState();
    store.beginTransaction();
    store.commit((d) => placeAsset(d, panelId, assetId).doc);
    store.endTransaction("Agent: create a dramatic close-up");
    expect(useEditorStore.getState().currentLabel).toBe("Agent: create a dramatic close-up");
  });

  it("jumpTo moves directly across several steps in one call, in both directions", () => {
    const { assetId, panelId } = seed();
    const store = useEditorStore.getState();
    const origin = store.doc!;

    store.dispatch({ type: "add-instance", panelId, assetId });
    store.dispatch({ type: "add-bubble", panelId, bubbleType: "speech", text: "Hi" });
    store.dispatch({ type: "add-effect", panelId, effectKind: "speed-lines" });
    const latest = useEditorStore.getState().doc!;

    const { entries, currentIndex } = historyTimeline(useEditorStore.getState());
    expect(entries).toHaveLength(4); // origin + 3 commits
    expect(currentIndex).toBe(3);

    // Jump straight back to the very first state — no repeated undo() calls.
    useEditorStore.getState().jumpTo(0);
    expect(useEditorStore.getState().doc).toBe(origin);

    // And straight forward again to the latest, in one call.
    useEditorStore.getState().jumpTo(3);
    expect(useEditorStore.getState().doc).toBe(latest);
  });

  it("jumpTo to the current position is a no-op", () => {
    const { assetId, panelId } = seed();
    const store = useEditorStore.getState();
    store.dispatch({ type: "add-instance", panelId, assetId });
    const doc = useEditorStore.getState().doc;
    const { currentIndex } = historyTimeline(useEditorStore.getState());

    useEditorStore.getState().jumpTo(currentIndex);
    expect(useEditorStore.getState().doc).toBe(doc);
  });

  it("undo drops selection of removed items", () => {
    const { assetId, panelId } = seed();
    const store = useEditorStore.getState();
    store.commit((d) => placeAsset(d, panelId, assetId).doc);
    const itemId = Object.keys(useEditorStore.getState().doc!.items)[0];
    useEditorStore.getState().select({ itemId, panelId });

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().selection.itemId).toBeUndefined();
    expect(useEditorStore.getState().selection.panelId).toBe(panelId);
  });
});
