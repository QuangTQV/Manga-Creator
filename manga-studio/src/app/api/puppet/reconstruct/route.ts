import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { loadStoredAsset } from "@/assets/loadStoredAsset";
import { ProviderError } from "@/ai/types";
import { putObject } from "@/storage/objectStore";
import { resolveProvider } from "@/server/providerSession";
import { createImageProvider } from "@/ai/providerRegistry";
import { recordLiveCall, truncateForLog } from "@/server/callLog";
import { readSessionTag } from "@/server/sessionTag";
import { hiddenRegionInstruction } from "@/puppet/compiler";
import type { PuppetPartType } from "@/puppet/model";

export const runtime = "nodejs";
export const maxDuration = 60;

const requestSchema = z.object({
  sourceUrl: z.string().max(2048),
  partType: z.string().max(40),
});

/**
 * Hidden-region reconstruction (V3.2 §9).
 *
 * When a part is cut out of a flat drawing, the material it covered does not
 * exist. This asks the configured image-EDIT provider to redraw only that
 * hidden area, preserving identity, outfit, line style and monochrome — a local
 * material-reconstruction task, not a character regeneration.
 *
 * Honest limitation: image-edit providers operate on the whole image, so what
 * comes back is a full-image edit that we treat as the underlayer. We cannot
 * enforce "only these pixels changed" at the provider boundary. That is why the
 * result becomes a SEPARATE asset used only as the occluded part's backdrop —
 * the canonical render is never overwritten, so a bad edit cannot damage the
 * character.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = crypto.randomUUID();
  const sessionTag = readSessionTag(request);
  const startedAt = Date.now();
  const trace = (stage: string, details: Record<string, string | number | boolean | undefined> = {}) => {
    console.info("[puppet-reconstruct]", JSON.stringify({ requestId, stage, ...details }));
  };
  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid reconstruction request", requestId }, { status: 400 });
  }
  const liveRequest = { partType: parsed.data.partType };

  try {
    const imageConfig = resolveProvider(request, "image", trace)?.config;
    const provider = imageConfig ? createImageProvider(imageConfig) : undefined;
    if (!provider?.capabilities.supportsImageEditing || !provider.editImage) {
      // Refuse rather than fabricate: a puppet with unreconstructed hidden
      // regions is honest, and the capability system already reports it.
      return NextResponse.json(
        {
          error:
            "The configured image model cannot edit images, so hidden regions cannot be reconstructed. The puppet will report large movements as approximate.",
          requestId,
        },
        { status: 422 },
      );
    }

    const source = await loadStoredAsset(parsed.data.sourceUrl);
    trace("source_loaded", { bytes: source.data.length });
    const instruction = hiddenRegionInstruction(parsed.data.partType as PuppetPartType);
    const edited = await provider.editImage({
      instruction,
      image: { mimeType: source.mimeType, data: source.data, url: parsed.data.sourceUrl },
      trace,
    });
    const stored = await putObject(
      `puppet/hidden-${parsed.data.partType}-${crypto.randomUUID()}.png`,
      edited.data,
      edited.mimeType,
    );
    trace("reconstruction_stored", { url: stored.url });
    recordLiveCall(sessionTag, {
      kind: "image",
      route: "puppet-reconstruct",
      provider: provider.id,
      model: provider.model,
      startedAt,
      durationMs: Date.now() - startedAt,
      ok: true,
      request: { ...liveRequest, instruction: truncateForLog(instruction) },
      response: { url: stored.url, mimeType: edited.mimeType },
    });
    return NextResponse.json({ url: stored.url, mimeType: edited.mimeType, requestId });
  } catch (error) {
    const status = error instanceof ProviderError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Reconstruction failed";
    recordLiveCall(sessionTag, {
      kind: "image",
      route: "puppet-reconstruct",
      startedAt,
      durationMs: Date.now() - startedAt,
      ok: false,
      request: liveRequest,
      error: { message, status },
    });
    return NextResponse.json({ error: message, requestId }, { status });
  }
}
