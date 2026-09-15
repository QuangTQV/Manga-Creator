/**
 * Pure edits for fixing up the parsed character list before pagination —
 * the manual complement to `knownCharacterNames` in prompt.ts (which only
 * *hints* at continuity across chunks; the model can still drift, split one
 * character into two across a chunk boundary, or misspell a name). Both
 * "rename" (the model's name was wrong) and "merge" (two entries turned
 * out to be the same person) are the same underlying operation: redirect
 * every reference to `from` onto `to`.
 */

import type { NovelCharacter, NovelScene } from "./schema";

const PRESENCE_STRENGTH = { visible: 2, offscreen: 1, mentioned: 0 } as const;

/** Redirects every beat reference (speakerName, characterPresence key) from
 * one character name to another, across every scene. When a beat already
 * has a characterPresence entry for `to`, keeps whichever presence is more
 * specific (visible > offscreen > mentioned) rather than blindly
 * overwriting — merging "Aki" (visible in one chunk) into "Aki-chan"
 * (only mentioned in another) must not downgrade her to merely mentioned. */
export function redirectCharacterName(scenes: NovelScene[], from: string, to: string): NovelScene[] {
  if (from === to) return scenes;
  return scenes.map((scene) => ({
    ...scene,
    beats: scene.beats.map((beat) => {
      const speakerName = beat.speakerName === from ? to : beat.speakerName;
      if (!(from in beat.characterPresence)) {
        return speakerName === beat.speakerName ? beat : { ...beat, speakerName };
      }
      const { [from]: fromPresence, ...rest } = beat.characterPresence;
      const existing = rest[to];
      const presence =
        !existing || PRESENCE_STRENGTH[fromPresence] > PRESENCE_STRENGTH[existing] ? fromPresence : existing;
      return { ...beat, speakerName, characterPresence: { ...rest, [to]: presence } };
    }),
  }));
}

/** Merges the character-list entry for `from` into `to` (aliases unioned,
 * `from`'s own name kept as an alias so old dialogue attribution still
 * resolves), and drops the `from` entry. If `to` isn't in the list yet
 * (a rename where the new name doesn't exist as its own entry), `from`'s
 * entry is renamed in place instead of dropped. */
export function mergeCharacterEntries(characters: NovelCharacter[], from: string, to: string): NovelCharacter[] {
  if (from === to) return characters;
  const fromEntry = characters.find((c) => c.primaryName === from);
  const toEntry = characters.find((c) => c.primaryName === to);
  if (!fromEntry) return characters;

  if (!toEntry) {
    // Pure rename: no existing "to" entry to merge into.
    return characters.map((c) => (c === fromEntry ? { ...c, primaryName: to } : c));
  }
  const aliases = Array.from(new Set([...toEntry.aliases, ...fromEntry.aliases, fromEntry.primaryName]));
  const merged: NovelCharacter = {
    ...toEntry,
    aliases,
    description: toEntry.description || fromEntry.description,
  };
  return characters.filter((c) => c !== fromEntry && c !== toEntry).concat(merged);
}

/** De-duplicates a character list by primaryName (case-insensitive),
 * unioning aliases — used to build one project-wide list across chapters
 * that were each parsed independently. Does NOT touch scene/beat data;
 * call `redirectCharacterName` per chapter first if names actually differ
 * in casing/spelling across chapters. */
export function dedupeCharacters(characters: NovelCharacter[]): NovelCharacter[] {
  const byKey = new Map<string, NovelCharacter>();
  for (const character of characters) {
    const key = character.primaryName.trim().toLowerCase();
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, character);
      continue;
    }
    byKey.set(key, {
      ...existing,
      aliases: Array.from(new Set([...existing.aliases, ...character.aliases])),
      description: existing.description || character.description,
    });
  }
  return Array.from(byKey.values());
}

/** Case-insensitive AND diacritic-insensitive ("Yuri" == "Yūri") — this,
 * not full fuzzy/edit-distance matching, is deliberate: it catches the
 * "same name, different accent marks" case a re-typed chapter is prone to,
 * without the false-positive risk of an approximate-string match silently
 * treating two genuinely different characters as the same person. */
const COMBINING_DIACRITICAL_MARKS = new RegExp("[\\u0300-\\u036f]", "g");

function normalizeCharacterName(name: string): string {
  return name.trim().toLowerCase().normalize("NFKD").replace(COMBINING_DIACRITICAL_MARKS, "");
}

/** How one freshly-parsed character relates to a name already in the
 * project's character library. */
export interface ExistingCharacterMatch {
  /** The exact name already in the project — use this verbatim when
   * offering to adopt it (e.g. as a rename target). */
  existingName: string;
  /** True when the parsed name is byte-for-byte identical to the existing
   * one — the case the Creative Director's own resolution layer already
   * reuses without any help from this dialog (see `agent-v3`'s
   * `resolutionIntent: "existing"`). False means only the diacritic-
   * insensitive normalization matched — the two are worth pointing out to
   * a creator, but not close enough to silently treat as certainly equal. */
  exact: boolean;
}

/**
 * Matches freshly-parsed characters against a project's PRE-EXISTING
 * character library — the check `dedupeCharacters` above deliberately does
 * NOT do (it only merges duplicates WITHIN one parse). Continuing an
 * already-populated project (pasting chapter 2 after chapter 1 is already
 * in the project) is exactly when this matters: without it, "Yuri" parsed
 * from new text has no idea a "Yuri" character already exists, and the
 * review step would happily let a near-duplicate through.
 *
 * Returns a map keyed by the PARSED character's `primaryName`, so callers
 * can look up `result.get(character.primaryName)` per card in the review
 * list — present only for characters that matched something existing.
 */
export function matchExistingCharacters(
  parsedCharacters: NovelCharacter[],
  existingCharacterNames: string[],
): Map<string, ExistingCharacterMatch> {
  const existingByNormalizedName = new Map<string, string>();
  for (const name of existingCharacterNames) {
    // First one wins on a collision — two existing project characters
    // that already normalize to the same key is a pre-existing ambiguity
    // this function isn't responsible for resolving.
    const key = normalizeCharacterName(name);
    if (!existingByNormalizedName.has(key)) existingByNormalizedName.set(key, name);
  }

  const matches = new Map<string, ExistingCharacterMatch>();
  for (const character of parsedCharacters) {
    const existingName = existingByNormalizedName.get(normalizeCharacterName(character.primaryName));
    if (existingName) {
      matches.set(character.primaryName, { existingName, exact: character.primaryName === existingName });
    }
  }
  return matches;
}
