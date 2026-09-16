/** Quick picks for a language-name field's native suggestion dropdown —
 * not a fixed list either the Director's `dialogueLanguage` setting or
 * Translate Project restricts input to; any typed name works. Shared so
 * `TopBar.tsx`'s dialogue-language field and `TranslateProjectDialog.tsx`
 * offer the same suggestions instead of two separately-maintained lists. */
export const LANGUAGE_NAME_PRESETS = [
  "English",
  "Vietnamese",
  "Japanese",
  "Korean",
  "Chinese (Simplified)",
  "French",
  "Spanish",
  "German",
];
