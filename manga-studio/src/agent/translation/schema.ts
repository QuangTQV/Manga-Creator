/**
 * Translate-batch response contract. Deliberately minimal versus
 * `novelParser/schema.ts` — a translation response is just "give back
 * every id with its translated text," no scene/beat structure to model.
 */

import { z } from "zod";

const translationSchema = z.object({
  id: z.string().min(1).max(64),
  text: z.string().max(4000),
});

const translateOutputSchema = z.object({
  translations: z.array(translationSchema).min(1).max(200),
});

export type TranslateOutput = z.infer<typeof translateOutputSchema>;

export function parseTranslateOutput(raw: unknown): { output?: TranslateOutput; error?: string } {
  const parsed = translateOutputSchema.safeParse(raw);
  if (!parsed.success) {
    const formatPath = (path: PropertyKey[]) =>
      path.reduce<string>((acc, seg) => (typeof seg === "number" ? `${acc}[${seg}]` : acc ? `${acc}.${String(seg)}` : String(seg)), "");
    const details = parsed.error.issues
      .slice(0, 3)
      .map((issue) => `${formatPath(issue.path) || "(root)"} — ${issue.message}`)
      .join("; ");
    return { error: `Translate output invalid: ${details}` };
  }
  return { output: parsed.data };
}
