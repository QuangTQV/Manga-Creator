import { beforeEach, describe, expect, it } from "vitest";
import { resetRotationStateForTests } from "@/server/providerRotation";
import type { ProviderConfig } from "@/server/providerSession";
import { ProviderError, type ImageGenerationProvider, type ImageGenerationResult } from "../types";
import { wrapImageProviderWithRotation } from "./withRotation";

const RESULT: ImageGenerationResult = { mimeType: "image/png", data: Buffer.from("x") };

function config(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    kind: "image",
    providerType: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com",
    apiKey: "primary-key",
    model: "gemini-2.5-flash-image",
    ...overrides,
  };
}

/** A fake adapter whose behavior is scripted per API key, so tests can
 * assert exactly which candidate(s) rotation actually called. */
function fakeAdapterFactory(scripts: Record<string, () => Promise<ImageGenerationResult>>) {
  const calls: string[] = [];
  const buildAdapter = (candidate: ProviderConfig): ImageGenerationProvider => ({
    id: "fake",
    label: "Fake",
    model: candidate.model,
    capabilities: {
      textToImage: true,
      supportsReferenceImage: false,
      supportsTransparentBackground: false,
      supportsImageEditing: false,
      reference: { supported: false, transport: "none" },
      referenceImage: false,
      imageVariation: false,
      transparentOutput: false,
      asyncGeneration: false,
    },
    testConnection: async () => ({ ok: true }),
    generateImage: async () => {
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

describe("wrapImageProviderWithRotation", () => {
  it("returns the plain adapter untouched when there are no backup keys", async () => {
    const { buildAdapter, calls } = fakeAdapterFactory({
      "primary-key": async () => RESULT,
    });
    const provider = wrapImageProviderWithRotation(config(), buildAdapter);
    const result = await provider.generateImage({ prompt: "x", assetType: "character" });
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
    const provider = wrapImageProviderWithRotation(
      config({ backupApiKeys: [{ key: "backup-1" }], rotationStrategy: "sequential" }),
      buildAdapter,
    );
    const result = await provider.generateImage({ prompt: "x", assetType: "character" });
    expect(result).toBe(RESULT);
    expect(calls).toEqual(["primary-key", "backup-1"]);
  });

  it("rotates past a bad (401) key without benching the whole provider", async () => {
    const { buildAdapter, calls } = fakeAdapterFactory({
      "primary-key": async () => {
        throw new ProviderError("bad key", 401);
      },
      "backup-1": async () => RESULT,
    });
    const provider = wrapImageProviderWithRotation(
      config({ backupApiKeys: [{ key: "backup-1" }], rotationStrategy: "sequential" }),
      buildAdapter,
    );
    await expect(provider.generateImage({ prompt: "x", assetType: "character" })).resolves.toBe(RESULT);
    expect(calls).toEqual(["primary-key", "backup-1"]);
  });

  it("does not rotate to a same-provider backup on a fatal (400) error — it would fail identically", async () => {
    const { buildAdapter, calls } = fakeAdapterFactory({
      "primary-key": async () => {
        throw new ProviderError("bad prompt", 400);
      },
      "backup-1": async () => RESULT,
    });
    const provider = wrapImageProviderWithRotation(
      config({ backupApiKeys: [{ key: "backup-1" }], rotationStrategy: "sequential" }),
      buildAdapter,
    );
    await expect(provider.generateImage({ prompt: "x", assetType: "character" })).rejects.toThrow("bad prompt");
    expect(calls).toEqual(["primary-key"]);
  });

  it("DOES rotate past a fatal error to a genuinely different fallback provider", async () => {
    const calls: string[] = [];
    const buildAdapter = (candidate: ProviderConfig): ImageGenerationProvider => ({
      id: candidate.providerType,
      label: candidate.providerType,
      model: candidate.model,
      capabilities: {
        textToImage: true,
        supportsReferenceImage: false,
        supportsTransparentBackground: false,
        supportsImageEditing: false,
        reference: { supported: false, transport: "none" },
        referenceImage: false,
        imageVariation: false,
        transparentOutput: false,
        asyncGeneration: false,
      },
      testConnection: async () => ({ ok: true }),
      generateImage: async () => {
        calls.push(`${candidate.providerType}:${candidate.apiKey}`);
        if (candidate.providerType === "gemini") throw new ProviderError("bad prompt for this model", 400);
        return RESULT;
      },
    });
    const provider = wrapImageProviderWithRotation(
      config({
        providerType: "gemini",
        backupApiKeys: [{ key: "backup-1" }],
        rotationStrategy: "sequential",
        fallbackProviders: [
          {
            providerType: "openai-compatible",
            baseUrl: "https://api.example.com/v1",
            apiKey: "fb-key",
            model: "fb-model",
          },
        ],
      }),
      buildAdapter,
    );
    const result = await provider.generateImage({ prompt: "x", assetType: "character" });
    expect(result).toBe(RESULT);
    // Both gemini candidates (primary + its backup) are skipped as fatal —
    // never retried — but the fallback provider is still reached.
    expect(calls).toEqual(["gemini:primary-key", "openai-compatible:fb-key"]);
  });

  it("throws a clear error when every configured key is already cooling down", async () => {
    const { buildAdapter } = fakeAdapterFactory({
      "primary-key": async () => RESULT,
      "backup-1": async () => RESULT,
    });
    const cfg = config({ backupApiKeys: [{ key: "backup-1" }], rotationStrategy: "sequential" });
    const provider = wrapImageProviderWithRotation(cfg, buildAdapter);
    // Exhaust both candidates with rate limits first so both are cooling.
    const failing = fakeAdapterFactory({
      "primary-key": async () => {
        throw new ProviderError("rate limited", 429);
      },
      "backup-1": async () => {
        throw new ProviderError("rate limited", 429);
      },
    });
    const failingProvider = wrapImageProviderWithRotation(cfg, failing.buildAdapter);
    await expect(failingProvider.generateImage({ prompt: "x", assetType: "character" })).rejects.toThrow();
    // Now every candidate is cooling — even a provider whose adapter would
    // succeed must refuse without calling anything, respecting the cooldown.
    await expect(provider.generateImage({ prompt: "x", assetType: "character" })).rejects.toThrow(
      /cooling down/,
    );
  });

  it("does not rotate testConnection — it always checks the primary key exactly as configured", async () => {
    let primaryChecked = 0;
    const buildAdapter = (candidate: ProviderConfig): ImageGenerationProvider => ({
      id: "fake",
      label: "Fake",
      model: candidate.model,
      capabilities: {
        textToImage: true,
        supportsReferenceImage: false,
        supportsTransparentBackground: false,
        supportsImageEditing: false,
        reference: { supported: false, transport: "none" },
        referenceImage: false,
        imageVariation: false,
        transparentOutput: false,
        asyncGeneration: false,
      },
      testConnection: async () => {
        if (candidate.apiKey === "primary-key") primaryChecked++;
        return { ok: candidate.apiKey === "primary-key" };
      },
      generateImage: async () => RESULT,
    });
    const provider = wrapImageProviderWithRotation(
      config({ backupApiKeys: [{ key: "backup-1" }] }),
      buildAdapter,
    );
    const status = await provider.testConnection();
    expect(status.ok).toBe(true);
    expect(primaryChecked).toBe(1);
  });
});
