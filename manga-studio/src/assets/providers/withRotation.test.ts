import { beforeEach, describe, expect, it } from "vitest";
import { ProviderError } from "@/ai/types";
import { resetRotationStateForTests } from "@/server/providerRotation";
import type { ProviderConfig } from "@/server/providerSession";
import type { BackgroundRemovalProvider, BackgroundRemovalResult } from "./types";
import { wrapBackgroundRemovalProviderWithRotation } from "./withRotation";

const RESULT: BackgroundRemovalResult = {
  success: true,
  processedImage: Buffer.from("x"),
  mimeType: "image/png",
  alphaValidation: { valid: true },
  providerMetadata: { id: "fake", name: "Fake" },
};

function config(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    kind: "background",
    providerType: "remove-bg",
    baseUrl: "https://api.remove.bg/v1.0/removebg",
    apiKey: "primary-key",
    model: "background-removal",
    ...overrides,
  };
}

function fakeAdapterFactory(scripts: Record<string, () => Promise<BackgroundRemovalResult>>) {
  const calls: string[] = [];
  const buildAdapter = (candidate: ProviderConfig): BackgroundRemovalProvider => ({
    id: "fake",
    name: "Fake",
    model: candidate.model,
    testConnection: async () => ({ ok: true }),
    removeBackground: async () => {
      calls.push(candidate.apiKey);
      const script = scripts[candidate.apiKey];
      if (!script) throw new Error(`No script for key ${candidate.apiKey}`);
      return script();
    },
  });
  return { buildAdapter, calls };
}

beforeEach(() => {
  resetRotationStateForTests();
});

describe("wrapBackgroundRemovalProviderWithRotation", () => {
  it("returns the plain adapter untouched when there are no backup keys", async () => {
    const { buildAdapter, calls } = fakeAdapterFactory({ "primary-key": async () => RESULT });
    const provider = wrapBackgroundRemovalProviderWithRotation(config(), buildAdapter);
    const result = await provider.removeBackground({});
    expect(result).toBe(RESULT);
    expect(calls).toEqual(["primary-key"]);
  });

  it("rotates to a backup key after the primary is rate limited", async () => {
    const { buildAdapter, calls } = fakeAdapterFactory({
      "primary-key": async () => {
        throw new ProviderError("rate limited", 429);
      },
      "backup-1": async () => RESULT,
    });
    const provider = wrapBackgroundRemovalProviderWithRotation(
      config({ backupApiKeys: ["backup-1"], rotationStrategy: "sequential" }),
      buildAdapter,
    );
    await expect(provider.removeBackground({})).resolves.toBe(RESULT);
    expect(calls).toEqual(["primary-key", "backup-1"]);
  });

  it("does not rotate testConnection", async () => {
    let primaryChecked = 0;
    const buildAdapter = (candidate: ProviderConfig): BackgroundRemovalProvider => ({
      id: "fake",
      name: "Fake",
      model: candidate.model,
      testConnection: async () => {
        if (candidate.apiKey === "primary-key") primaryChecked++;
        return { ok: candidate.apiKey === "primary-key" };
      },
      removeBackground: async () => RESULT,
    });
    const provider = wrapBackgroundRemovalProviderWithRotation(config({ backupApiKeys: ["backup-1"] }), buildAdapter);
    const status = await provider.testConnection?.();
    expect(status?.ok).toBe(true);
    expect(primaryChecked).toBe(1);
  });
});
