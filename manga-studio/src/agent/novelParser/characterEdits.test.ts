import { describe, expect, it } from "vitest";
import { dedupeCharacters, matchExistingCharacters, mergeCharacterEntries, redirectCharacterName } from "./characterEdits";
import type { NovelBeat, NovelCharacter, NovelScene } from "./schema";

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
  return { ordinal: 1, location: "", timeLabel: "", weather: "", purpose: "", beats: [], ...overrides };
}

function character(overrides: Partial<NovelCharacter> = {}): NovelCharacter {
  return { primaryName: "Aki", aliases: [], description: "", ...overrides };
}

describe("redirectCharacterName", () => {
  it("renames a matching speakerName", () => {
    const scenes = [scene({ beats: [beat({ speakerName: "Akii" })] })];
    const result = redirectCharacterName(scenes, "Akii", "Aki");
    expect(result[0].beats[0].speakerName).toBe("Aki");
  });

  it("leaves a non-matching speakerName untouched", () => {
    const scenes = [scene({ beats: [beat({ speakerName: "Momo" })] })];
    const result = redirectCharacterName(scenes, "Akii", "Aki");
    expect(result[0].beats[0].speakerName).toBe("Momo");
  });

  it("renames a characterPresence key", () => {
    const scenes = [scene({ beats: [beat({ characterPresence: { Akii: "visible" } })] })];
    const result = redirectCharacterName(scenes, "Akii", "Aki");
    expect(result[0].beats[0].characterPresence).toEqual({ Aki: "visible" });
  });

  it("keeps the more specific presence when both names already appear on the same beat", () => {
    const scenes = [scene({ beats: [beat({ characterPresence: { Akii: "visible", Aki: "mentioned" } })] })];
    const result = redirectCharacterName(scenes, "Akii", "Aki");
    expect(result[0].beats[0].characterPresence).toEqual({ Aki: "visible" });
  });

  it("is a no-op when from and to are the same name", () => {
    const scenes = [scene({ beats: [beat({ speakerName: "Aki" })] })];
    expect(redirectCharacterName(scenes, "Aki", "Aki")).toBe(scenes);
  });

  it("does not mutate the input scenes", () => {
    const original = scene({ beats: [beat({ speakerName: "Akii" })] });
    const scenes = [original];
    redirectCharacterName(scenes, "Akii", "Aki");
    expect(original.beats[0].speakerName).toBe("Akii");
  });
});

describe("mergeCharacterEntries", () => {
  it("renames in place when the target name doesn't exist yet", () => {
    const characters = [character({ primaryName: "Akii", aliases: ["Aki-chan"] })];
    const result = mergeCharacterEntries(characters, "Akii", "Aki");
    expect(result).toEqual([{ primaryName: "Aki", aliases: ["Aki-chan"], description: "" }]);
  });

  it("merges aliases and keeps the old name as an alias when both entries exist", () => {
    const characters = [
      character({ primaryName: "Akii", aliases: ["Aki-chan"], description: "a student" }),
      character({ primaryName: "Aki", aliases: ["Ak"] }),
    ];
    const result = mergeCharacterEntries(characters, "Akii", "Aki");
    expect(result).toHaveLength(1);
    expect(result[0].primaryName).toBe("Aki");
    expect(new Set(result[0].aliases)).toEqual(new Set(["Ak", "Aki-chan", "Akii"]));
    expect(result[0].description).toBe("a student");
  });

  it("is a no-op when the source name doesn't exist", () => {
    const characters = [character({ primaryName: "Aki" })];
    expect(mergeCharacterEntries(characters, "Nobody", "Aki")).toBe(characters);
  });
});

describe("dedupeCharacters", () => {
  it("merges entries with the same name (case-insensitive), unioning aliases", () => {
    const characters = [
      character({ primaryName: "Aki", aliases: ["Ak"], description: "a student" }),
      character({ primaryName: "aki", aliases: ["Aki-chan"] }),
    ];
    const result = dedupeCharacters(characters);
    expect(result).toHaveLength(1);
    expect(new Set(result[0].aliases)).toEqual(new Set(["Ak", "Aki-chan"]));
    expect(result[0].description).toBe("a student");
  });

  it("keeps distinct characters separate", () => {
    const characters = [character({ primaryName: "Aki" }), character({ primaryName: "Momo" })];
    expect(dedupeCharacters(characters)).toHaveLength(2);
  });
});

describe("matchExistingCharacters", () => {
  it("flags an exact (case-insensitive) match to a project character already in the library", () => {
    const parsed = [character({ primaryName: "yuri" })];
    const result = matchExistingCharacters(parsed, ["Yuri", "Kenji"]);
    expect(result.get("yuri")).toEqual({ existingName: "Yuri", exact: false });
  });

  it("marks exact as true only when the casing is byte-for-byte identical", () => {
    const parsed = [character({ primaryName: "Yuri" })];
    const result = matchExistingCharacters(parsed, ["Yuri"]);
    expect(result.get("Yuri")).toEqual({ existingName: "Yuri", exact: true });
  });

  it("matches across diacritics — the real-world 'Yuri' vs 'Yūri' case", () => {
    const parsed = [character({ primaryName: "Yuri" })];
    const result = matchExistingCharacters(parsed, ["Yūri"]);
    expect(result.get("Yuri")).toEqual({ existingName: "Yūri", exact: false });
  });

  it("does not match genuinely different names", () => {
    const parsed = [character({ primaryName: "Kenji" })];
    const result = matchExistingCharacters(parsed, ["Yuri", "Momo"]);
    expect(result.has("Kenji")).toBe(false);
  });

  it("returns an empty map when the project has no existing characters yet", () => {
    const parsed = [character({ primaryName: "Yuri" })];
    expect(matchExistingCharacters(parsed, []).size).toBe(0);
  });

  it("only reports matched characters, keyed by the parsed primaryName", () => {
    const parsed = [character({ primaryName: "Yuri" }), character({ primaryName: "Kenji" })];
    const result = matchExistingCharacters(parsed, ["Yuri"]);
    expect([...result.keys()]).toEqual(["Yuri"]);
  });
});
