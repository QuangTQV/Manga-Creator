/**
 * Wraps an agent (planning LLM) adapter with multi-key rotation when the
 * resolved `ProviderConfig` carries `backupApiKeys`. A no-op (returns the
 * plain adapter untouched) when there are none. Mirrors `src/ai/providers/
 * withRotation.ts` — same shared cooldown/ordering core in
 * `@/server/providerRotation`, adapted to `AgentModelProvider`'s shape
 * (`completeJson` instead of `generateImage`/`editImage`).
 */

import type { ProviderConfig } from "@/server/providerSession";
import {
  allCoolingDownMessage,
  buildCandidates,
  classifyStatus,
  markCooldown,
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
  if (!config.backupApiKeys?.length) return buildAdapter(config);

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
      let lastError: unknown;
      for (let i = 0; i < ready.length; i++) {
        const isLast = i === ready.length - 1;
        try {
          return await buildAdapter(ready[i]).completeJson(systemPrompt, userPrompt, options);
        } catch (error) {
          lastError = error;
          if (!(error instanceof AgentModelError)) throw error;
          const failure = classifyStatus(error.status);
          markCooldown(ready[i], failure, error.retryAfterSeconds);
          if (isLast || failure === "fatal") throw error;
        }
      }
      throw lastError;
    },
  };
}
