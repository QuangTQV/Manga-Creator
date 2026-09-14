import { describe, expect, it } from "vitest";
import { MAX_SUPPORTED_PANELS_PER_PAGE, planPages } from "./pagination";
import type { NovelBeat, NovelScene } from "./schema";

function beat(overrides: Partial<NovelBeat> = {}): NovelBeat {
  return {
    ordinal: 1,
    action: "",
    speakerName: "",
    dialogue: "",
    narration: "",
    emotion: "",
    subtext: "",
    importance: 0.5,
    mustVisualize: true,
    mergeable: false,
    pageTurnHook: false,
    characterPresence: {},
    props: [],
    ...overrides,
  };
}

function scene(overrides: Partial<NovelScene> = {}): NovelScene {
  return { ordinal: 1, location: "a quiet street", timeLabel: "", weather: "", purpose: "", beats: [], ...overrides };
}

describe("planPages", () => {
  it("gives every non-mergeable, must-visualize beat its own panel", () => {
    const beats = [1, 2, 3].map((n) => beat({ ordinal: n, action: `action ${n}` }));
    const pages = planPages("Chapter 1", [scene({ beats })], 4);
    expect(pages).toHaveLength(1);
    expect(pages[0].beats).toHaveLength(3);
    expect(pages[0].prompt).toContain("Panel 1:");
    expect(pages[0].prompt).toContain("Panel 2:");
    expect(pages[0].prompt).toContain("Panel 3:");
  });

  it("starts a new page once the panel budget is reached", () => {
    const beats = [1, 2, 3, 4, 5].map((n) => beat({ ordinal: n, action: `action ${n}` }));
    const pages = planPages("Chapter 1", [scene({ beats })], 2);
    expect(pages).toHaveLength(3); // 2 + 2 + 1
    expect(pages[0].beats.map((b) => b.action)).toEqual(["action 1", "action 2"]);
    expect(pages[1].beats.map((b) => b.action)).toEqual(["action 3", "action 4"]);
    expect(pages[2].beats.map((b) => b.action)).toEqual(["action 5"]);
  });

  it("folds a mergeable beat into the previous panel instead of starting a new one", () => {
    const beats = [
      beat({ ordinal: 1, action: "draws the sword" }),
      beat({ ordinal: 2, action: "sheathes it again", mergeable: true }),
    ];
    const pages = planPages("Chapter 1", [scene({ beats })], 4);
    expect(pages).toHaveLength(1);
    expect(pages[0].prompt).toContain("Panel 1: draws the sword; then sheathes it again");
    expect(pages[0].prompt).not.toContain("Panel 2:");
  });

  it("folds a beat the model marked as not needing its own panel", () => {
    const beats = [
      beat({ ordinal: 1, action: "walks to the window" }),
      beat({ ordinal: 2, action: "sighs quietly", mustVisualize: false }),
    ];
    const pages = planPages("Chapter 1", [scene({ beats })], 4);
    expect(pages[0].beats).toHaveLength(2);
    expect(pages[0].prompt).not.toContain("Panel 2:");
  });

  it("ends the page immediately after a page-turn-hook beat, even under budget", () => {
    const beats = [
      beat({ ordinal: 1, action: "calm moment" }),
      beat({ ordinal: 2, action: "the door creaks open", pageTurnHook: true }),
      beat({ ordinal: 3, action: "a figure steps out" }),
    ];
    const pages = planPages("Chapter 1", [scene({ beats })], 4);
    expect(pages).toHaveLength(2);
    expect(pages[0].beats.map((b) => b.action)).toEqual(["calm moment", "the door creaks open"]);
    expect(pages[1].beats.map((b) => b.action)).toEqual(["a figure steps out"]);
  });

  it("never spans a page across two scenes", () => {
    const sceneA = scene({ ordinal: 1, location: "the docks", beats: [beat({ ordinal: 1, action: "a" })] });
    const sceneB = scene({ ordinal: 2, location: "the market", beats: [beat({ ordinal: 1, action: "b" })] });
    const pages = planPages("Chapter 1", [sceneA, sceneB], 4);
    expect(pages).toHaveLength(2);
    expect(pages[0].sceneLocation).toBe("the docks");
    expect(pages[1].sceneLocation).toBe("the market");
  });

  it("processes beats in ordinal order regardless of input order", () => {
    const beats = [beat({ ordinal: 3, action: "third" }), beat({ ordinal: 1, action: "first" }), beat({ ordinal: 2, action: "second" })];
    const pages = planPages("Chapter 1", [scene({ beats })], 4);
    expect(pages[0].beats.map((b) => b.action)).toEqual(["first", "second", "third"]);
  });

  it("includes dialogue, speaker, and emotion in the panel prompt", () => {
    const beats = [beat({ ordinal: 1, action: "turns to face her", speakerName: "Aki", dialogue: "Wait!", emotion: "urgent" })];
    const pages = planPages("Chapter 1", [scene({ beats })], 4);
    expect(pages[0].prompt).toContain('Aki says "Wait!" (urgent)');
  });

  it("marks non-visible characters explicitly so the Director doesn't draw them", () => {
    const beats = [
      beat({
        ordinal: 1,
        action: "stares at the photo",
        characterPresence: { Aki: "visible", Momo: "mentioned" },
      }),
    ];
    const pages = planPages("Chapter 1", [scene({ beats })], 4);
    expect(pages[0].prompt).toContain("Momo is only mentioned, not drawn");
    expect(pages[0].prompt).not.toContain("Aki is");
  });

  it("produces no pages for a chapter with no scenes", () => {
    expect(planPages("Empty chapter", [], 4)).toEqual([]);
  });

  it("assigns unique, stable ids across pages", () => {
    const beats = [1, 2, 3, 4, 5].map((n) => beat({ ordinal: n }));
    const pages = planPages("Chapter 1", [scene({ beats })], 2);
    expect(new Set(pages.map((p) => p.id)).size).toBe(pages.length);
  });

  it("reports panelCount as the number of panels, not the number of beats", () => {
    const beats = [
      beat({ ordinal: 1, action: "draws the sword" }),
      beat({ ordinal: 2, action: "sheathes it again", mergeable: true }),
      beat({ ordinal: 3, action: "walks away" }),
    ];
    const pages = planPages("Chapter 1", [scene({ beats })], 4);
    expect(pages[0].beats).toHaveLength(3);
    expect(pages[0].panelCount).toBe(2); // beats 1+2 share a panel, beat 3 is its own
  });

  it("clamps a panel budget above what Kumanga's page layouts support", () => {
    const beats = Array.from({ length: 6 }, (_, i) => beat({ ordinal: i + 1, action: `action ${i + 1}` }));
    const pages = planPages("Chapter 1", [scene({ beats })], 99);
    expect(pages[0].panelCount).toBeLessThanOrEqual(MAX_SUPPORTED_PANELS_PER_PAGE);
  });

  it("clamps a panel budget below 1 up to 1", () => {
    const beats = [beat({ ordinal: 1 }), beat({ ordinal: 2 })];
    const pages = planPages("Chapter 1", [scene({ beats })], 0);
    expect(pages.every((p) => p.panelCount === 1)).toBe(true);
    expect(pages).toHaveLength(2);
  });
});
