/**
 * Wraps a background-removal adapter with multi-key AND multi-provider
 * rotation when the resolved `ProviderConfig` carries `backupApiKeys`
 * and/or `fallbackProviders`. A no-op (returns the plain adapter untouched)
 * when there are neither. Mirrors `src/ai/providers/withRotation.ts` —
 * same shared cooldown/ordering core in `@/server/providerRotation`.
 *
 * Both built-in adapters (`removeBg.ts`, `custom.ts`) throw `ProviderError`
 * on an HTTP failure exactly like the image adapters do — `success: false`
 * results are reserved for input/alpha-validation failures, not provider
 * errors — so this wrapper can reuse the identical try/rotate/cooldown
 * shape rather than inventing a result-based variant.
 */

import { ProviderError } from "@/ai/types";
import type { ProviderConfig } from "@/server/providerSession";
import {
  allCoolingDownMessage,
  buildCandidates,
  classifyStatus,
  markCooldown,
  nextCandidateIndex,
  orderCandidates,
} from "@/server/providerRotation";
import type { BackgroundRemovalInput, BackgroundRemovalProvider, BackgroundRemovalResult } from "./types";

export function wrapBackgroundRemovalProviderWithRotation(
  config: ProviderConfig,
  buildAdapter: (candidate: ProviderConfig) => BackgroundRemovalProvider,
): BackgroundRemovalProvider {
  if (!config.backupApiKeys?.length && !config.fallbackProviders?.length) return buildAdapter(config);

  const primary = buildAdapter(config);

  return {
    id: primary.id,
    name: primary.name,
    model: primary.model,
    // Deliberately NOT rotated: testing a connection means testing the
    // exact key the user just typed, not whichever backup happens to work.
    testConnection: primary.testConnection ? () => primary.testConnection!() : undefined,
    async removeBackground(input: BackgroundRemovalInput): Promise<BackgroundRemovalResult> {
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
          return await buildAdapter(ready[i]).removeBackground(input);
        } catch (error) {
          if (!(error instanceof ProviderError)) throw error;
          const failure = classifyStatus(error.status);
          markCooldown(ready[i], failure, error.retryAfterSeconds);
          const next = nextCandidateIndex(ready, i, failure);
          if (next === -1) throw error;
          i = next;
        }
      }
    },
  };
}
