"use client";

/**
 * GenerationService — the single application-facing entry for AI generation.
 *
 * UI and the Manga Agent both call THIS module. They never import provider
 * adapters, never hand-roll `/api/generate` or `/api/provider/status` calls,
 * and never see protocol/credential details — those stay server-side in
 * `ai/providerRegistry` + `app/api/*`.
 *
 * Implementation lives in `ai/clientGeneration` (one write path, unchanged);
 * this facade names the boundary so both callers depend on a service, not on
 * an `ai/` internal.
 */

import {
  callGenerateApi,
  storeGeneratedAsset,
  type GenerateApiResult,
  type StoreGeneratedAssetInput,
} from "@/ai/clientGeneration";
import type { GeneratedAssetType } from "@/ai/types";
import type { ProviderSummary } from "@/server/providerSession";

export {
  GenerationApiError,
  CharacterTransparencyError,
  measureImage,
  recordFailedGeneration,
  recordGenerationEvidence,
} from "@/ai/clientGeneration";
export type {
  GenerateApiResult,
  GenerationErrorDetails,
  StoreGeneratedAssetInput,
} from "@/ai/clientGeneration";

export interface GenerateImageRequest {
  assetType: GeneratedAssetType;
  prompt: string;
  negativePrompt?: string;
  referenceUrls?: string[];
  /** A structural/pose control image (ComfyUI ControlNet) — purpose-distinct
   * from referenceUrls. */
  controlImageUrl?: string;
  size?: "portrait" | "landscape" | "square";
  expectMonochrome?: boolean;
  /** Screentone semantics, when assetType is "tone". */
  toneType?: "texture" | "atmosphere" | "decorative" | "pattern";
  tileable?: boolean;
}

/** Call the server generation route. Provider identity stays server-side. */
export function generateImage(request: GenerateImageRequest) {
  return callGenerateApi(request);
}

/**
 * A per-run generation cache — NOT a general "don't regenerate identical
 * prompts" cache. Scoped explicitly by the caller (one instance per Agent
 * run, shared across its "Retry (same plan)" attempts, discarded on a
 * genuinely new run) so a manual "regenerate this" click elsewhere in the
 * app is never surprised by a stale cached image; those call sites simply
 * never pass a cache.
 *
 * A whole-transaction rollback undoes the DOCUMENT, not this cache: when a
 * later step fails and the run rolls back, an earlier step's successful
 * generation (e.g. Haruto's reference image) stays cached, so re-executing
 * the same plan reuses that image instead of paying for a real regeneration
 * against the provider — the expensive part, not the document/Undo
 * semantics, is what gets skipped.
 */
export type GenerationCache = Map<string, Promise<GenerateApiResult>>;

/** Same as `generateImage`, but checks/fills `cache` first when given (a
 * request is cached by its exact JSON shape — a byte-identical retry hits,
 * anything else is a real call). A failed call is evicted so a subsequent
 * identical request gets a fresh attempt rather than replaying the failure. */
export function generateImageCached(request: GenerateImageRequest, cache: GenerationCache | undefined) {
  if (!cache) return generateImage(request);
  const key = JSON.stringify(request);
  const existing = cache.get(key);
  if (existing) return existing;
  const pending = generateImage(request).catch((error) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, pending);
  return pending;
}

/** Register a generated image as a library asset with provenance. */
export function registerGeneratedAsset(input: StoreGeneratedAssetInput) {
  return storeGeneratedAsset(input);
}

export interface ProviderCapabilities {
  referenceImage?: boolean;
  supportsTransparentBackground?: boolean;
  supportsReferenceImage?: boolean;
  /** A second, purpose-distinct structural/pose control image (ComfyUI ControlNet). */
  supportsControlImage?: boolean;
}

export interface ProviderStatusSnapshot {
  image?: ProviderSummary & { capabilities?: ProviderCapabilities };
  agent?: ProviderSummary;
  background?: ProviderSummary;
  /** Legacy top-level mirror of image.configured. */
  configured: boolean;
  capabilities?: ProviderCapabilities;
  storage?: { configured?: boolean; backend?: string };
}

/** Safe provider status: configured flags + capabilities, never key material. */
export async function fetchProviderStatus(): Promise<ProviderStatusSnapshot> {
  const response = await fetch("/api/provider/status");
  if (!response.ok) throw new Error("Provider status unavailable");
  return (await response.json()) as ProviderStatusSnapshot;
}

/** Capabilities of the connected image provider; all-false when unreachable. */
export async function imageProviderCapabilities(): Promise<{
  referenceImage: boolean;
  nativeTransparency: boolean;
}> {
  try {
    const status = await fetchProviderStatus();
    return {
      referenceImage: Boolean(status.capabilities?.referenceImage),
      nativeTransparency: Boolean(status.capabilities?.supportsTransparentBackground),
    };
  } catch {
    return { referenceImage: false, nativeTransparency: false };
  }
}
