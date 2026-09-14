import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseModelJson } from "@/agent/planner";
import { buildNovelParsePrompt, NOVEL_PARSE_SYSTEM_PROMPT } from "@/agent/novelParser/prompt";
import { parseNovelParseOutput } from "@/agent/novelParser/schema";
import { createAgentProvider } from "@/agent/providers/registry";
import { AgentModelError } from "@/agent/providers/types";
import { recordLiveCall, truncateForLog } from "@/server/callLog";
import { resolveProvider } from "@/server/providerSession";
import { readSessionTag } from "@/server/sessionTag";

export const runtime = "nodejs";
export const maxDuration = 120;

const requestSchema = z.object({
  chunkLabel: z.string().max(20),
  segments: z.array(z.object({ ordinal: z.number().int().min(1), text: z.string().min(1).max(4000) })).min(1).max(6),
  fidelity: z.enum(["faithful", "guided", "creative"]),
  knownCharacterNames: z.array(z.string().max(80)).max(60).default([]),
});

/**
 * One chunk of the novel → structured scenes/beats (schema.ts). The client
 * drives the chunk loop (see NovelImportDialog.tsx) so import progress is
 * visible and a single failed chunk doesn't lose every chunk that already
 * succeeded — the same resumability goal MangaFlow solves with a server-side
 * DB checkpoint, achieved here with no DB at all by just letting the
 * caller retry one request.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const sessionTag = readSessionTag(request);
  const startedAt = Date.now();
  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid novel-parse request" }, { status: 400 });

  const resolved = resolveProvider(request, "agent");
  if (!resolved) {
    return NextResponse.json({ error: "No agent model connected. Open AI Settings to add one." }, { status: 503 });
  }

  const prompt = buildNovelParsePrompt(parsed.data);
  let provider: ReturnType<typeof createAgentProvider> | undefined;
  try {
    provider = createAgentProvider(resolved.config);
    const completion = await provider.completeJson(NOVEL_PARSE_SYSTEM_PROMPT, prompt, {
      signal: request.signal,
    });
    const raw = parseModelJson(completion.text);
    const { output, error } = parseNovelParseOutput(raw);
    if (!output) {
      recordLiveCall(sessionTag, {
        kind: "agent",
        route: "parse-novel",
        provider: provider.label,
        model: provider.model,
        startedAt,
        durationMs: Date.now() - startedAt,
        ok: false,
        request: { chunkLabel: parsed.data.chunkLabel, prompt: truncateForLog(prompt) },
        error: { message: error ?? "Invalid novel-parse output" },
      });
      return NextResponse.json({ error: error ?? "Invalid novel-parse output" }, { status: 502 });
    }
    recordLiveCall(sessionTag, {
      kind: "agent",
      route: "parse-novel",
      provider: provider.label,
      model: provider.model,
      startedAt,
      durationMs: Date.now() - startedAt,
      ok: true,
      request: { chunkLabel: parsed.data.chunkLabel, prompt: truncateForLog(prompt) },
      response: {
        text: truncateForLog(completion.text),
        characters: output.characters.length,
        scenes: output.scenes.length,
        beats: output.scenes.reduce((sum, scene) => sum + scene.beats.length, 0),
      },
    });
    return NextResponse.json({ output });
  } catch (error) {
    const message = error instanceof AgentModelError ? error.safeMessage : "Novel parsing failed";
    const status = error instanceof AgentModelError ? error.status : 500;
    recordLiveCall(sessionTag, {
      kind: "agent",
      route: "parse-novel",
      provider: provider?.label,
      model: provider?.model,
      startedAt,
      durationMs: Date.now() - startedAt,
      ok: false,
      request: { chunkLabel: parsed.data.chunkLabel, prompt: truncateForLog(prompt) },
      error: { message, status },
    });
    return NextResponse.json({ error: message }, { status });
  }
}
