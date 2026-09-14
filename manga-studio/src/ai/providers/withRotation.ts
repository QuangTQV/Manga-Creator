/**
 * Wraps an image-generation adapter with multi-key AND multi-provider
 * rotation when the resolved `ProviderConfig` carries `backupApiKeys` and/or
 * `fallbackProviders`. A no-op (returns the plain adapter untouched) when
 * there are neither, so configuring rotation is strictly opt-in and costs
 * nothing otherwise.
 *
 * This is the ONLY place rotation is applied — `providerRegistry.ts` wraps
 * every adapter it builds, so every call site (generation, editing, asset
 * upload, puppet reconstruction, connection tests) benefits automatically
 * without each one knowing rotation exists.
 */

import type { ProviderConfig } from "@/server/providerSession";
import {
  allCoolingDownMessage,
  buildCandidates,
  classifyStatus,
  markCooldown,
  nextCandidateIndex,
  orderCandidates,
} from "@/server/providerRotation";
import {
  ProviderError,
  type ImageEditRequest,
  type ImageGenerationProvider,
  type ImageGenerationRequest,
  type ImageGenerationResult,
} from "../types";

export function wrapImageProviderWithRotation(
  config: ProviderConfig,
  buildAdapter: (candidate: ProviderConfig) => ImageGenerationProvider,
): ImageGenerationProvider {
  if (!config.backupApiKeys?.length && !config.fallbackProviders?.length) return buildAdapter(config);

  const primary = buildAdapter(config);

  async function withRotation<T>(run: (adapter: ImageGenerationProvider) => Promise<T>): Promise<T> {
    const { ready, soonestReadySeconds } = orderCandidates(config);
    if (ready.length === 0) {
      throw new ProviderError(
        allCoolingDownMessage(buildCandidates(config).length, soonestReadySeconds),
        429,
      );
    }
    // Every iteration either returns or throws — there is no normal loop
    // exit, `nextCandidateIndex` returning -1 always throws immediately.
    for (let i = 0; ; ) {
      try {
        return await run(buildAdapter(ready[i]));
      } catch (error) {
        // A shape we don't recognize (programming error, not a provider
        // failure) must not be silently swallowed by rotating past it.
        if (!(error instanceof ProviderError)) throw error;
        const failure = classifyStatus(error.status);
        markCooldown(ready[i], failure, error.retryAfterSeconds);
        const next = nextCandidateIndex(ready, i, failure);
        if (next === -1) throw error;
        i = next;
      }
    }
  }

  return {
    id: primary.id,
    label: primary.label,
    model: primary.model,
    capabilities: primary.capabilities,
    // Deliberately NOT rotated: testing a connection means testing the
    // exact key the user just typed, not whichever backup happens to work.
    testConnection: () => primary.testConnection(),
    generateImage: (request: ImageGenerationRequest): Promise<ImageGenerationResult> =>
      withRotation((adapter) => adapter.generateImage(request)),
    editImage: primary.editImage
      ? (request: ImageEditRequest): Promise<ImageGenerationResult> =>
          withRotation((adapter) => {
            if (!adapter.editImage) throw new ProviderError("Provider does not support image editing", 400);
            return adapter.editImage(request);
          })
      : undefined,
  };
}
