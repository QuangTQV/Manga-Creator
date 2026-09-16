import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyDomainCommand } from "@/domain/commands";
import { createProjectDocument } from "@/domain/factory";
import type { ID, ProjectDocument, SpeechBubbleItem } from "@/domain/types";
import { translateProject } from "./translateProject";

// fitBubbleHeight measures with a real Konva.Text node, which needs a real
// canvas — unavailable in this project's Node vitest environment (the same
// reason `bubbleFit.ts` itself has no unit test of its own; see backlog
// #24). Mocked here so this file can test translateProject's own
// orchestration (batching, scope filtering, skip-on-missing-id, progress)
// without depending on Konva at all.
vi.mock("@/render/bubbleFit", () => ({ fitBubbleHeight: vi.fn(() => 42) }));

function seedTwoPagesWithBubbles(): { doc: ProjectDocument; page1BubbleId: ID; page2BubbleId: ID; page2Id: ID } {
  let doc = createProjectDocument("Translate test");
  const page1 = Object.values(doc.pages)[0];
  const panel1 = page1.panelIds[0];
  const bubble1 = applyDomainCommand(doc, { type: "add-bubble", panelId: panel1, bubbleType: "speech", text: "Xin chào" });
  doc = bubble1.doc;

  const added = applyDomainCommand(doc, { type: "add-page" });
  doc = added.doc;
  const page2Id = added.createdId!;
  const panel2 = doc.pages[page2Id].panelIds[0];
  const bubble2 = applyDomainCommand(doc, { type: "add-bubble", panelId: panel2, bubbleType: "speech", text: "Tạm biệt" });
  doc = bubble2.doc;

  return { doc, page1BubbleId: bubble1.createdId!, page2BubbleId: bubble2.createdId!, page2Id };
}

function mockFetchOnce(translations: { id: string; text: string }[]) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ output: { translations } }),
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("translateProject", () => {
  it("translates every bubble in the project by default, refitting each one's height", async () => {
    const { doc, page1BubbleId, page2BubbleId } = seedTwoPagesWithBubbles();
    global.fetch = mockFetchOnce([
      { id: page1BubbleId, text: "Hello" },
      { id: page2BubbleId, text: "Goodbye" },
    ]);

    const result = await translateProject(doc, { targetLanguage: "English" });

    expect(result.translatedCount).toBe(2);
    expect(result.skippedCount).toBe(0);
    expect((result.newDoc.items[page1BubbleId] as SpeechBubbleItem).text).toBe("Hello");
    expect((result.newDoc.items[page2BubbleId] as SpeechBubbleItem).text).toBe("Goodbye");
    // The original document passed in is never mutated.
    expect((doc.items[page1BubbleId] as SpeechBubbleItem).text).toBe("Xin chào");
  });

  it("restricts translation to the given pageIds when a scope is passed", async () => {
    const { doc, page1BubbleId, page2BubbleId, page2Id } = seedTwoPagesWithBubbles();
    global.fetch = mockFetchOnce([{ id: page2BubbleId, text: "Goodbye" }]);

    const result = await translateProject(doc, { targetLanguage: "English", pageIds: [page2Id] });

    expect(result.translatedCount).toBe(1);
    expect((result.newDoc.items[page2BubbleId] as SpeechBubbleItem).text).toBe("Goodbye");
    // Page 1's bubble was outside the scope — untouched.
    expect((result.newDoc.items[page1BubbleId] as SpeechBubbleItem).text).toBe("Xin chào");
    // Only the in-scope bubble was ever sent to the API.
    const sentBody = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(sentBody.items).toEqual([{ id: page2BubbleId, text: "Tạm biệt" }]);
  });

  it("keeps a bubble's original text when the model's response omits its id", async () => {
    const { doc, page1BubbleId, page2BubbleId } = seedTwoPagesWithBubbles();
    // Only page1's translation comes back — page2's id is missing.
    global.fetch = mockFetchOnce([{ id: page1BubbleId, text: "Hello" }]);

    const result = await translateProject(doc, { targetLanguage: "English" });

    expect(result.translatedCount).toBe(1);
    expect(result.skippedCount).toBe(1);
    expect((result.newDoc.items[page2BubbleId] as SpeechBubbleItem).text).toBe("Tạm biệt");
  });

  it("reports progress once per batch", async () => {
    const { doc, page1BubbleId, page2BubbleId } = seedTwoPagesWithBubbles();
    global.fetch = mockFetchOnce([
      { id: page1BubbleId, text: "Hello" },
      { id: page2BubbleId, text: "Goodbye" },
    ]);
    const onProgress = vi.fn();

    await translateProject(doc, { targetLanguage: "English" }, onProgress);

    expect(onProgress).toHaveBeenCalledWith({ done: 0, total: 1 });
    expect(onProgress).toHaveBeenCalledWith({ done: 1, total: 1 });
  });

  it("throws when there is no dialogue to translate in scope", async () => {
    const doc = createProjectDocument("Empty");
    await expect(translateProject(doc, { targetLanguage: "English" })).rejects.toThrow(/No dialogue/);
  });

  it("surfaces the server's error message when a batch request fails", async () => {
    const { doc } = seedTwoPagesWithBubbles();
    global.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "No agent model connected" }) });
    await expect(translateProject(doc, { targetLanguage: "English" })).rejects.toThrow("No agent model connected");
  });
});
