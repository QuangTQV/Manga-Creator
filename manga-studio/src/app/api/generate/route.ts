import { NextRequest, NextResponse } from "next/server";
import { generateAssetImage, generateRequestSchema } from "@/ai/generate";
import { redactSecrets } from "@/ai/security";
import { ProviderError } from "@/ai/types";
import { recordLiveCall, truncateForLog } from "@/server/callLog";
import { resolveProvider } from "@/server/providerSession";
import { readSessionTag } from "@/server/sessionTag";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Real image generation. The API key never leaves this server boundary. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = crypto.randomUUID();
  const sessionTag = readSessionTag(request);
  const startedAt = Date.now();
  const trace = (stage: string, details: Record<string, string | number | boolean | undefined> = {}) => {
    console.info(`[generate] ${stage}`, { requestId, ...details });
  };
  trace("request_received");
  const body = await request.json().catch(() => null);
  trace(body === null ? "request_parse_failed" : "request_parsed");
  const parsed = generateRequestSchema.safeParse(body);
  if (!parsed.success) {
    trace("request_validation_failed");
    return NextResponse.json({ error: "Invalid generation request", requestId }, { status: 400 });
  }
  trace("request_validated", { assetType: parsed.data.assetType, referenceCount: parsed.data.referenceUrls?.length ?? 0 });

  // What Live AI shows as "what was sent" — the studio's own request, not
  // the exact provider-specific wire payload built deeper in the adapter.
  const liveRequest = {
    assetType: parsed.data.assetType,
    prompt: truncateForLog(parsed.data.prompt),
    negativePrompt: parsed.data.negativePrompt ? truncateForLog(parsed.data.negativePrompt) : undefined,
    referenceCount: parsed.data.referenceUrls?.length ?? 0,
    size: parsed.data.size,
  };

  try {
    // BYOK session config first; deployment env vars as operator fallback.
    const resolved = resolveProvider(request, "image", trace);
    const background = resolveProvider(request, "background", trace);
    const result = await generateAssetImage(parsed.data, resolved?.config ?? null, trace, background?.config);
    trace("request_complete", { provider: result.provider });
    recordLiveCall(sessionTag, {
      kind: "image",
      route: "generate",
      provider: result.provider,
      model: result.model,
      startedAt,
      durationMs: Date.now() - startedAt,
      ok: true,
      request: liveRequest,
      response: { mimeType: result.mimeType, referenceUsed: result.referenceUsed, url: result.url },
    });
    return NextResponse.json({ ...result, requestId });
  } catch (error) {
    if (error instanceof ProviderError) {
      trace("request_failed", {
        errorType: error.name,
        status: error.status,
        message: redactSecrets(error.safeMessage),
      });
      recordLiveCall(sessionTag, {
        kind: "image",
        route: "generate",
        startedAt,
        durationMs: Date.now() - startedAt,
        ok: false,
        request: liveRequest,
        error: { message: redactSecrets(error.safeMessage), status: error.status },
      });
      return NextResponse.json(
        { error: error.safeMessage, requestId, details: error.details },
        { status: error.status },
      );
    }
    const message = redactSecrets(error instanceof Error ? error.message : String(error));
    const stack = error instanceof Error && error.stack ? redactSecrets(error.stack) : undefined;
    console.error("[generate] request_failed", { requestId, errorType: error instanceof Error ? error.name : "Unknown", message, stack });
    recordLiveCall(sessionTag, {
      kind: "image",
      route: "generate",
      startedAt,
      durationMs: Date.now() - startedAt,
      ok: false,
      request: liveRequest,
      error: { message: "Generation failed" },
    });
    return NextResponse.json({ error: "Generation failed", requestId }, { status: 500 });
  }
}
