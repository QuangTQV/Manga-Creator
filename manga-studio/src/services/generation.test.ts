import { beforeEach, describe, expect, it, vi } from "vitest";

const callGenerateApi = vi.fn();

beforeEach(() => {
  callGenerateApi.mockReset();
});

vi.mock("@/ai/clientGeneration", () => ({
  callGenerateApi: (...args: unknown[]) => callGenerateApi(...args),
  storeGeneratedAsset: vi.fn(),
}));

import { generateImageCached, type GenerationCache } from "./generation";

const REQUEST = { assetType: "character" as const, prompt: "a hero", negativePrompt: "blurry" };

describe("generateImageCached", () => {
  it("calls through every time when no cache is given — never surprises a manual regenerate", async () => {
    callGenerateApi.mockResolvedValue({ url: "https://example.com/a.png" });
    await generateImageCached(REQUEST, undefined);
    await generateImageCached(REQUEST, undefined);
    expect(callGenerateApi).toHaveBeenCalledTimes(2);
  });

  it("reuses the cached result for a byte-identical request instead of calling again", async () => {
    callGenerateApi.mockResolvedValue({ url: "https://example.com/a.png" });
    const cache: GenerationCache = new Map();
    const first = await generateImageCached(REQUEST, cache);
    const second = await generateImageCached({ ...REQUEST }, cache); // structurally identical, new object
    expect(callGenerateApi).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it("does not conflate two different requests into the same cache entry", async () => {
    callGenerateApi.mockResolvedValueOnce({ url: "https://example.com/a.png" }).mockResolvedValueOnce({ url: "https://example.com/b.png" });
    const cache: GenerationCache = new Map();
    await generateImageCached(REQUEST, cache);
    await generateImageCached({ ...REQUEST, prompt: "a villain" }, cache);
    expect(callGenerateApi).toHaveBeenCalledTimes(2);
  });

  it("evicts a failed call so a later identical request gets a fresh attempt, not the same rejection", async () => {
    callGenerateApi.mockRejectedValueOnce(new Error("provider unreachable")).mockResolvedValueOnce({ url: "https://example.com/a.png" });
    const cache: GenerationCache = new Map();
    await expect(generateImageCached(REQUEST, cache)).rejects.toThrow("provider unreachable");
    const result = await generateImageCached(REQUEST, cache);
    expect(result).toEqual({ url: "https://example.com/a.png" });
    expect(callGenerateApi).toHaveBeenCalledTimes(2);
  });
});
