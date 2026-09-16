import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseModelJson } from "@/agent/planner";
import { buildTranslatePrompt, TRANSLATE_SYSTEM_PROMPT } from "@/agent/translation/prompt";
import { parseTranslateOutput } from "@/agent/translation/schema";
import { createAgentProvider } from "@/agent/providers/registry";
import { AgentModelError } from "@/agent/providers/types";
import { recordLiveCall, truncateForLog } from "@/server/callLog";
import { resolveProvider } from "@/server/providerSession";
import { readSessionTag } from "@/server/sessionTag";

export const runtime = "nodejs";
export const maxDuration = 120;

const requestSchema = z.object({
  items: z.array(z.object({ id: z.string().min(1).max(64), text: z.string().min(1).max(2000) })).min(1).max(60),
  targetLanguage: z.string().min(1).max(60),
});

/**
 * One batch of already-lettered dialogue lines → their translations
 * (schema.ts). The client drives the batch loop (see
 * `services/translateProject.ts`) so progress is visible and a single
 * failed batch doesn't lose every batch that already succeeded — same
 * resumability reasoning as `parse-novel/route.ts`'s own chunk loop.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const sessionTag = readSessionTag(request);
  const startedAt = Date.now();
  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid translate request" }, { status: 400 });

  const resolved = resolveProvider(request, "agent");
  if (!resolved) {
    return NextResponse.json({ error: "No agent model connected. Open AI Settings to add one." }, { status: 503 });
  }

  const prompt = buildTranslatePrompt(parsed.data);
  let provider: ReturnType<typeof createAgentProvider> | undefined;
  try {
    provider = createAgentProvider(resolved.config);
    const completion = await provider.completeJson(TRANSLATE_SYSTEM_PROMPT, prompt, { signal: request.signal });
    const raw = parseModelJson(completion.text);
    const { output, error } = parseTranslateOutput(raw);
    if (!output) {
      recordLiveCall(sessionTag, {
        kind: "agent",
        route: "translate",
        provider: provider.label,
        model: provider.model,
        startedAt,
        durationMs: Date.now() - startedAt,
        ok: false,
        request: { targetLanguage: parsed.data.targetLanguage, items: parsed.data.items.length, prompt: truncateForLog(prompt) },
        error: { message: error ?? "Invalid translate output" },
      });
      return NextResponse.json({ error: error ?? "Invalid translate output" }, { status: 502 });
    }
    recordLiveCall(sessionTag, {
      kind: "agent",
      route: "translate",
      provider: provider.label,
      model: provider.model,
      startedAt,
      durationMs: Date.now() - startedAt,
      ok: true,
      request: { targetLanguage: parsed.data.targetLanguage, items: parsed.data.items.length, prompt: truncateForLog(prompt) },
      response: { text: truncateForLog(completion.text), translations: output.translations.length },
    });
    return NextResponse.json({ output });
  } catch (error) {
    const message = error instanceof AgentModelError ? error.safeMessage : "Translation failed";
    const status = error instanceof AgentModelError ? error.status : 500;
    recordLiveCall(sessionTag, {
      kind: "agent",
      route: "translate",
      provider: provider?.label,
      model: provider?.model,
      startedAt,
      durationMs: Date.now() - startedAt,
      ok: false,
      request: { targetLanguage: parsed.data.targetLanguage, items: parsed.data.items.length, prompt: truncateForLog(prompt) },
      error: { message, status },
    });
    return NextResponse.json({ error: message }, { status });
  }
}
