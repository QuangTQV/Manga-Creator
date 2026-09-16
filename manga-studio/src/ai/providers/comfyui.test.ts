/**
 * ComfyUI adapter tests. The load-bearing case is the dynamic `prompt_id`
 * history key (a hyphenated UUID) — the exact shape `jsonPath.ts`'s static
 * path grammar cannot express, which is why this adapter exists as coded
 * TypeScript rather than a declarative Custom API config.
 *
 * Tests pass tiny `pollIntervalMs`/`pollTimeoutMs` overrides and use REAL
 * timers (no `vi.useFakeTimers()`): outboundFetch's own internal request
 * timeout also runs on a real `setTimeout`, and mixing fake timers with its
 * real DNS-lookup step is fragile — small real delays are simpler and fast.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ImageGenerationRequest } from "../types";
import { buildWorkflow, createComfyUiProvider } from "./comfyui";

const REQUEST: ImageGenerationRequest = {
  prompt: "a manga hero, dynamic pose",
  negativePrompt: "blurry, low quality",
  assetType: "character",
  width: 832,
  height: 1216,
};

// A real ComfyUI prompt_id: a hyphenated UUID — the case getAtPath's
// identifier-only path grammar cannot parse as an object key.
const PROMPT_ID = "3ba1b2c4-758b-4b53-8a4c-dc1c9a8c9a95";
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const FAST_POLL = { pollIntervalMs: 5, pollTimeoutMs: 200 };

function stubFetch(handler: (url: string, init?: RequestInit) => Response) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init);
  });
  return calls;
}

describe("buildWorkflow", () => {
  it("places prompt, negativePrompt, size, and checkpoint model in the expected graph nodes", () => {
    const graph = buildWorkflow(REQUEST, "sd_xl_base_1.0.safetensors") as Record<
      string,
      { class_type: string; inputs: Record<string, unknown> }
    >;
    expect(graph["6"].inputs.text).toBe(REQUEST.prompt);
    expect(graph["7"].inputs.text).toBe(REQUEST.negativePrompt);
    expect(graph["5"].inputs.width).toBe(832);
    expect(graph["5"].inputs.height).toBe(1216);
    expect(graph["4"].inputs.ckpt_name).toBe("sd_xl_base_1.0.safetensors");
    expect(graph["9"].class_type).toBe("SaveImage");
  });

  it("defaults negativePrompt to empty string and size to 1024 when omitted", () => {
    const graph = buildWorkflow({ prompt: "x" }, "model.safetensors") as Record<
      string,
      { inputs: Record<string, unknown> }
    >;
    expect(graph["7"].inputs.text).toBe("");
    expect(graph["5"].inputs.width).toBe(1024);
    expect(graph["5"].inputs.height).toBe(1024);
  });
});

describe("createComfyUiProvider", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("submits, polls the dynamic prompt_id history key until completed, and fetches the image", async () => {
    let historyCalls = 0;
    const calls = stubFetch((url) => {
      if (url.includes("/prompt")) {
        return new Response(JSON.stringify({ prompt_id: PROMPT_ID }), { status: 200 });
      }
      if (url.includes("/history/")) {
        historyCalls += 1;
        if (historyCalls === 1) return new Response(JSON.stringify({}), { status: 200 }); // not in history yet
        return new Response(
          JSON.stringify({
            [PROMPT_ID]: {
              status: { completed: true, status_str: "success" },
              outputs: { "9": { images: [{ filename: "kumanga_00001_.png", subfolder: "", type: "output" }] } },
            },
          }),
          { status: 200 },
        );
      }
      if (url.includes("/view")) return new Response(PNG_BYTES, { status: 200 });
      throw new Error(`unexpected fetch: ${url}`);
    });

    const provider = createComfyUiProvider({ baseUrl: "https://comfy.example.com", model: "sd_xl_base_1.0.safetensors", ...FAST_POLL });
    const result = await provider.generateImage(REQUEST);

    expect(result.mimeType).toBe("image/png");
    expect(result.data.equals(PNG_BYTES)).toBe(true);
    expect(historyCalls).toBeGreaterThanOrEqual(2); // proves it actually polled past the "still pending" response
    expect(calls.some((c) => c.url.includes(`/history/${PROMPT_ID}`))).toBe(true);
    expect(calls.some((c) => c.url.includes("filename=kumanga_00001_.png"))).toBe(true);
  });

  it("sends no Authorization header when no API key is configured", async () => {
    const calls = stubFetch((url) => {
      if (url.includes("/prompt")) return new Response(JSON.stringify({ prompt_id: PROMPT_ID }), { status: 200 });
      if (url.includes("/history/")) {
        return new Response(
          JSON.stringify({
            [PROMPT_ID]: { status: { completed: true }, outputs: { "9": { images: [{ filename: "a.png", type: "output" }] } } },
          }),
          { status: 200 },
        );
      }
      return new Response(PNG_BYTES, { status: 200 });
    });
    const provider = createComfyUiProvider({ baseUrl: "https://comfy.example.com", model: "m.safetensors", ...FAST_POLL });
    await provider.generateImage(REQUEST);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      const headers = call.init?.headers as Record<string, string> | undefined;
      expect(headers?.Authorization).toBeUndefined();
    }
  });

  it("sends a Bearer Authorization header when an API key is configured (e.g. behind a proxy)", async () => {
    const calls = stubFetch((url) => {
      if (url.includes("/prompt")) return new Response(JSON.stringify({ prompt_id: PROMPT_ID }), { status: 200 });
      if (url.includes("/history/")) {
        return new Response(
          JSON.stringify({
            [PROMPT_ID]: { status: { completed: true }, outputs: { "9": { images: [{ filename: "a.png", type: "output" }] } } },
          }),
          { status: 200 },
        );
      }
      return new Response(PNG_BYTES, { status: 200 });
    });
    const provider = createComfyUiProvider({
      baseUrl: "https://comfy.example.com",
      model: "m.safetensors",
      apiKey: "proxy-token",
      ...FAST_POLL,
    });
    await provider.generateImage(REQUEST);
    const submitCall = calls.find((c) => c.url.includes("/prompt"));
    const headers = submitCall?.init?.headers as Record<string, string> | undefined;
    expect(headers?.Authorization).toBe("Bearer proxy-token");
  });

  it("surfaces a safe error when the workflow submission is rejected", async () => {
    stubFetch((url) => {
      if (url.includes("/prompt")) {
        return new Response(JSON.stringify({ error: "invalid prompt", node_errors: { "4": { errors: ["ckpt not found"] } } }), {
          status: 400,
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const provider = createComfyUiProvider({ baseUrl: "https://comfy.example.com", model: "missing.safetensors", ...FAST_POLL });
    await expect(provider.generateImage(REQUEST)).rejects.toThrow(/ComfyUI error/);
  });

  it("throws when ComfyUI reports the generation itself as failed", async () => {
    stubFetch((url) => {
      if (url.includes("/prompt")) return new Response(JSON.stringify({ prompt_id: PROMPT_ID }), { status: 200 });
      if (url.includes("/history/")) {
        return new Response(JSON.stringify({ [PROMPT_ID]: { status: { completed: false, status_str: "error" } } }), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const provider = createComfyUiProvider({ baseUrl: "https://comfy.example.com", model: "m.safetensors", ...FAST_POLL });
    await expect(provider.generateImage(REQUEST)).rejects.toThrow(/failed/);
  });

  it("times out with a clear message if ComfyUI never reports completion", async () => {
    stubFetch((url) => {
      if (url.includes("/prompt")) return new Response(JSON.stringify({ prompt_id: PROMPT_ID }), { status: 200 });
      if (url.includes("/history/")) return new Response(JSON.stringify({}), { status: 200 }); // never completes
      throw new Error(`unexpected fetch: ${url}`);
    });
    const provider = createComfyUiProvider({
      baseUrl: "https://comfy.example.com",
      model: "m.safetensors",
      pollIntervalMs: 5,
      pollTimeoutMs: 20,
    });
    await expect(provider.generateImage(REQUEST)).rejects.toThrow(/Timed out/);
  });

  it("testConnection pings /system_stats without side effects", async () => {
    const calls = stubFetch((url) => {
      expect(url).toContain("/system_stats");
      return new Response("{}", { status: 200 });
    });
    const provider = createComfyUiProvider({ baseUrl: "https://comfy.example.com", model: "m.safetensors" });
    const status = await provider.testConnection();
    expect(status.ok).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("declares no reference/editing/transparent support in this pass", () => {
    const provider = createComfyUiProvider({ baseUrl: "https://comfy.example.com", model: "m.safetensors" });
    expect(provider.capabilities.supportsReferenceImage).toBe(false);
    expect(provider.capabilities.supportsImageEditing).toBe(false);
    expect(provider.capabilities.supportsTransparentBackground).toBe(false);
    expect(provider.capabilities.asyncGeneration).toBe(true);
    expect(provider.editImage).toBeUndefined();
  });
});
