import { NextRequest, NextResponse } from "next/server";
import { planCreativeDirection, directorRequestSchema } from "@/agent-v3/director/creativeDirector";
import { createAgentProvider } from "@/agent/providers/registry";
import { AgentModelError, type AgentExchange } from "@/agent/providers/types";
import { recordLiveCall, truncateForLog } from "@/server/callLog";
import { resolveProvider } from "@/server/providerSession";
import { readSessionTag } from "@/server/sessionTag";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Main Creative Director endpoint — the Agent V3 planning path. Same provider
 * session seam as the legacy planner; different contract (Creative Task Map
 * instead of raw tool steps).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const sessionTag = readSessionTag(request);
  const startedAt = Date.now();
  const body = await request.json().catch(() => null);
  const parsed = directorRequestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid director request" }, { status: 400 });

  const resolved = resolveProvider(request, "agent");
  if (!resolved) {
    return NextResponse.json({ error: "No agent model connected. Open AI Settings to add one." }, { status: 503 });
  }
  let provider: ReturnType<typeof createAgentProvider> | undefined;
  const exchange: AgentExchange = {};
  try {
    provider = createAgentProvider(resolved.config);
    const result = await planCreativeDirection(provider, parsed.data, {
      signal: request.signal,
      onExchange: (partial) => Object.assign(exchange, partial),
    });
    recordLiveCall(sessionTag, {
      kind: "agent",
      route: "agent-direct",
      provider: provider.label,
      model: provider.model,
      startedAt,
      durationMs: Date.now() - startedAt,
      ok: true,
      request: {
        systemPrompt: truncateForLog(exchange.systemPrompt ?? ""),
        userPrompt: truncateForLog(exchange.userPrompt ?? ""),
      },
      response: { text: truncateForLog(exchange.completionText ?? ""), finishReason: exchange.finishReason },
    });
    return NextResponse.json({ ...result, diagnostics: { provider: provider.label, model: provider.model } });
  } catch (error) {
    const message =
      error instanceof AgentModelError ? error.safeMessage || error.message : "Creative direction failed";
    recordLiveCall(sessionTag, {
      kind: "agent",
      route: "agent-direct",
      provider: provider?.label,
      model: provider?.model,
      startedAt,
      durationMs: Date.now() - startedAt,
      ok: false,
      request: {
        systemPrompt: truncateForLog(exchange.systemPrompt ?? ""),
        userPrompt: truncateForLog(exchange.userPrompt ?? ""),
      },
      error: { message, status: error instanceof AgentModelError ? error.status : undefined },
    });
    if (error instanceof AgentModelError) {
      return NextResponse.json({ error: message }, { status: error.status });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
