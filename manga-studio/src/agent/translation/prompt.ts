/**
 * Prompt for translating a batch of already-lettered dialogue lines into a
 * target language. Deliberately the OPPOSITE of `agent-v3/director/
 * systemPrompt.ts`'s literal-lock rule ("never translate exact quoted
 * dialogue") — that rule protects a creator's own wording from being
 * silently reworded while the Director composes NEW pages; this is a
 * separate, explicitly creator-initiated action (Translate Project) whose
 * entire point is producing translated text, so the two don't contradict
 * each other.
 */

export interface TranslateItemInput {
  id: string;
  text: string;
}

export interface TranslateChunkInput {
  items: TranslateItemInput[];
  targetLanguage: string;
}

export const TRANSLATE_SYSTEM_PROMPT =
  "You are a professional manga localization translator. Translate dialogue naturally and concisely enough to fit a speech bubble, preserving tone, register, and intent — not a literal word-for-word rendering. Keep every line's own id exactly as given.";

export function buildTranslatePrompt(input: TranslateChunkInput): string {
  const lines = input.items.map((item) => `[${item.id}] ${item.text}`).join("\n");
  return `Translate each of the following manga dialogue lines into ${input.targetLanguage}. Each line is independent — do not merge, split, omit, or reorder any of them, and do not translate the bracketed id itself.

Respond with ONLY one JSON object shaped exactly like this:
{ "translations": [{ "id": "same id as given", "text": "translated line" }] }

Lines:
${lines}`;
}
