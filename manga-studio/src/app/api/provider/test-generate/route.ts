import { NextRequest, NextResponse } from "next/server";
import { createImageProvider } from "@/ai/providerRegistry";
import { buildAssetPrompt } from "@/ai/promptTemplates";
import { SIZE_MAP } from "@/ai/generate";
import { ProviderError } from "@/ai/types";
import { redactSecrets } from "@/ai/security";
import { recordLiveCall, truncateForLog } from "@/server/callLog";
import { resolveProvider } from "@/server/providerSession";
import { readSessionTag } from "@/server/sessionTag";
import { putObject } from "@/storage/objectStore";
import { BUILTIN_STYLE_PROFILES, DEFAULT_STYLE_PROFILE_ID } from "@/styles/profiles";

export const runtime = "nodejs";
export const maxDuration = 120;

const TEST_STYLE = BUILTIN_STYLE_PROFILES.find((profile) => profile.id === DEFAULT_STYLE_PROFILE_ID);

const TEST_PROMPT = buildAssetPrompt({
  assetType: "character",
  characterName: "Test Character",
  characterDescription: "a generic person, used only to preview this image provider's current configuration",
  style: TEST_STYLE
    ? { name: TEST_STYLE.name, positivePrompt: TEST_STYLE.positivePrompt, visualProperties: TEST_STYLE.visualProperties }
    : undefined,
});

/**
 * Test generation: a REAL image call against the provider's saved config
 * (checkpoint, LoRA, CFG, ControlNet, IPAdapter — whatever is set), returned
 * raw. Unlike Test Connection (status-only, never a full generation), this
 * costs real GPU/API time — it exists so a config can be tuned by looking
 * at actual output instead of reading files off disk or waiting for a real
 * character-asset run to fail on background removal.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const sessionTag = readSessionTag(request);
  const startedAt = Date.now();

  const resolved = resolveProvider(request, "image");
  if (!resolved) {
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }

  const size = SIZE_MAP.portrait;
  const liveRequest = {
    assetType: "character" as const,
    prompt: truncateForLog(TEST_PROMPT),
    negativePrompt: TEST_STYLE?.negativePrompt ? truncateForLog(TEST_STYLE.negativePrompt) : undefined,
    referenceCount: 0,
    size: "portrait" as const,
  };

  try {
    const provider = createImageProvider(resolved.config);
    const result = await provider.generateImage({
      prompt: TEST_PROMPT,
      negativePrompt: TEST_STYLE?.negativePrompt,
      assetType: "character",
      width: size.width,
      height: size.height,
    });
    const stored = await putObject(`generated/test-${crypto.randomUUID()}.png`, result.data, result.mimeType);
    recordLiveCall(sessionTag, {
      kind: "image",
      route: "test-generate",
      provider: provider.id,
      model: provider.model,
      startedAt,
      durationMs: Date.now() - startedAt,
      ok: true,
      request: liveRequest,
      response: { mimeType: result.mimeType, referenceUsed: false, url: stored.url },
    });
    return NextResponse.json({ ok: true, url: stored.url, mimeType: result.mimeType, prompt: TEST_PROMPT });
  } catch (error) {
    if (error instanceof ProviderError) {
      recordLiveCall(sessionTag, {
        kind: "image",
        route: "test-generate",
        startedAt,
        durationMs: Date.now() - startedAt,
        ok: false,
        request: liveRequest,
        error: { message: redactSecrets(error.safeMessage), status: error.status },
      });
      return NextResponse.json({ ok: false, error: error.safeMessage }, { status: error.status });
    }
    const message = redactSecrets(error instanceof Error ? error.message : String(error));
    recordLiveCall(sessionTag, {
      kind: "image",
      route: "test-generate",
      startedAt,
      durationMs: Date.now() - startedAt,
      ok: false,
      request: liveRequest,
      error: { message: "Generation failed" },
    });
    console.error("[test-generate] request_failed", { message });
    return NextResponse.json({ ok: false, error: "Generation failed" }, { status: 500 });
  }
}
