/**
 * Wraps an agent (planning LLM) adapter with multi-key AND multi-provider
 * rotation when the resolved `ProviderConfig` carries `backupApiKeys` and/or
 * `fallbackProviders`. A no-op (returns the plain adapter untouched) when
 * there are neither. Mirrors `src/ai/providers/withRotation.ts` — same
 * shared cooldown/ordering core in `@/server/providerRotation`, adapted to
 * `AgentModelProvider`'s shape (`completeJson` instead of
 * `generateImage`/`editImage`).
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
  AgentModelError,
  type AgentCompletion,
  type AgentCompletionOptions,
  type AgentModelProvider,
} from "./types";

export function wrapAgentProviderWithRotation(
  config: ProviderConfig,
  buildAdapter: (candidate: ProviderConfig) => AgentModelProvider,
): AgentModelProvider {
  if (!config.backupApiKeys?.length && !config.fallbackProviders?.length) return buildAdapter(config);

  const primary = buildAdapter(config);

  return {
    label: primary.label,
    model: primary.model,
    // Deliberately NOT rotated: testing a connection means testing the
    // exact key the user just typed, not whichever backup happens to work.
    testConnection: () => primary.testConnection(),
    async completeJson(
      systemPrompt: string,
      userPrompt: string,
      options?: AgentCompletionOptions,
    ): Promise<AgentCompletion> {
      const { ready, soonestReadySeconds } = orderCandidates(config);
      if (ready.length === 0) {
        throw new AgentModelError(
          allCoolingDownMessage(buildCandidates(config).length, soonestReadySeconds),
          429,
        );
      }
      // Every iteration either returns or throws — there is no normal loop
      // exit, `nextCandidateIndex` returning -1 always throws immediately.
      for (let i = 0; ; ) {
        try {
          return await buildAdapter(ready[i]).completeJson(systemPrompt, userPrompt, options);
        } catch (error) {
          if (!(error instanceof AgentModelError)) throw error;
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
