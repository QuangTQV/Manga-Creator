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
import { buildEditWorkflow, buildWorkflow, createComfyUiProvider, fetchObjectInfoOptions } from "./comfyui";

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

  it("overrides sampler defaults when extra config is provided", () => {
    const graph = buildWorkflow(REQUEST, "m.safetensors", { steps: 30, cfg: 4.5, samplerName: "dpmpp_2m", scheduler: "karras" }) as Record<
      string,
      { inputs: Record<string, unknown> }
    >;
    expect(graph["3"].inputs).toMatchObject({ steps: 30, cfg: 4.5, sampler_name: "dpmpp_2m", scheduler: "karras" });
  });

  it("chains a single LoRA between the checkpoint and everything downstream", () => {
    const graph = buildWorkflow(REQUEST, "m.safetensors", { loras: [{ name: "detail_tweaker_xl.safetensors", strength: 0.8 }] }) as Record<
      string,
      { class_type: string; inputs: Record<string, unknown> }
    >;
    expect(graph["20"]).toMatchObject({
      class_type: "LoraLoader",
      inputs: { lora_name: "detail_tweaker_xl.safetensors", strength_model: 0.8, strength_clip: 0.8, model: ["4", 0], clip: ["4", 1] },
    });
    expect(graph["3"].inputs.model).toEqual(["20", 0]);
    expect(graph["6"].inputs.clip).toEqual(["20", 1]);
    expect(graph["7"].inputs.clip).toEqual(["20", 1]);
    expect(graph["21"]).toBeUndefined(); // only one entry configured
  });

  it("chains 4 LoRAs in order, each feeding the next, with the checkpoint feeding only the first", () => {
    const loras = [
      { name: "a.safetensors" },
      { name: "b.safetensors" },
      { name: "c.safetensors" },
      { name: "d.safetensors" },
    ];
    const graph = buildWorkflow(REQUEST, "m.safetensors", { loras }) as Record<string, { inputs: Record<string, unknown> }>;
    expect(graph["20"].inputs.model).toEqual(["4", 0]);
    expect(graph["21"].inputs.model).toEqual(["20", 0]);
    expect(graph["22"].inputs.model).toEqual(["21", 0]);
    expect(graph["23"].inputs.model).toEqual(["22", 0]);
    expect(graph["3"].inputs.model).toEqual(["23", 0]); // KSampler reads the LAST chain link
    expect(graph["20"].inputs.strength_model).toBe(1); // default strength when unset
  });

  it("switches to img2img (LoadImage → ImageScale → VAEEncode) when an uploaded image is given, dropping EmptyLatentImage", () => {
    const graph = buildWorkflow(REQUEST, "m.safetensors", undefined, { name: "ref_00001_.png", subfolder: "", type: "input" }) as Record<
      string,
      { class_type: string; inputs: Record<string, unknown> }
    >;
    expect(graph["5"]).toBeUndefined(); // EmptyLatentImage replaced entirely
    expect(graph["30"]).toMatchObject({ class_type: "LoadImage", inputs: { image: "ref_00001_.png" } });
    expect(graph["32"]).toMatchObject({
      class_type: "ImageScale",
      inputs: { image: ["30", 0], width: 832, height: 1216, upscale_method: "lanczos", crop: "disabled" },
    });
    expect(graph["31"]).toMatchObject({ class_type: "VAEEncode", inputs: { pixels: ["32", 0], vae: ["4", 2] } });
    expect(graph["3"].inputs.latent_image).toEqual(["31", 0]);
    expect(graph["3"].inputs.denoise).toBe(0.6); // preserves reference identity, still allows variation
  });

  it("joins a non-empty upload subfolder into LoadImage's image path", () => {
    const graph = buildWorkflow(REQUEST, "m.safetensors", undefined, { name: "ref.png", subfolder: "kumanga" }) as Record<
      string,
      { inputs: Record<string, unknown> }
    >;
    expect(graph["30"].inputs.image).toBe("kumanga/ref.png");
  });

  it("wires ControlNetApplyAdvanced between the text-encode nodes and KSampler when a control image + model are configured", () => {
    const controlImage = { name: "pose.png", subfolder: "", type: "input" };
    const graph = buildWorkflow(REQUEST, "m.safetensors", { controlNetModel: "control_v11p_sd15_openpose.pth", controlNetStrength: 0.8 }, undefined, controlImage) as Record<
      string,
      { class_type: string; inputs: Record<string, unknown> }
    >;
    expect(graph["40"]).toMatchObject({ class_type: "LoadImage", inputs: { image: "pose.png" } });
    expect(graph["41"]).toMatchObject({ class_type: "ControlNetLoader", inputs: { control_net_name: "control_v11p_sd15_openpose.pth" } });
    expect(graph["42"]).toMatchObject({
      class_type: "ControlNetApplyAdvanced",
      inputs: {
        positive: ["6", 0],
        negative: ["7", 0],
        control_net: ["41", 0],
        image: ["40", 0],
        strength: 0.8,
        start_percent: 0,
        end_percent: 1,
      },
    });
    expect(graph["3"].inputs.positive).toEqual(["42", 0]);
    expect(graph["3"].inputs.negative).toEqual(["42", 1]);
  });

  it("defaults ControlNet strength to 1 when unset", () => {
    const graph = buildWorkflow(REQUEST, "m.safetensors", { controlNetModel: "control.pth" }, undefined, { name: "pose.png" }) as Record<
      string,
      { inputs: Record<string, unknown> }
    >;
    expect(graph["42"].inputs.strength).toBe(1);
  });

  it("ignores an uploaded control image if no controlNetModel is configured — no ControlNet nodes added", () => {
    const graph = buildWorkflow(REQUEST, "m.safetensors", undefined, undefined, { name: "pose.png" }) as Record<string, unknown>;
    expect(graph["40"]).toBeUndefined();
    expect(graph["41"]).toBeUndefined();
    expect(graph["42"]).toBeUndefined();
  });

  it("composes LoRA + img2img + ControlNet simultaneously without collision — each affects only its own KSampler input", () => {
    const graph = buildWorkflow(
      REQUEST,
      "m.safetensors",
      { loras: [{ name: "detail.safetensors", strength: 0.7 }], controlNetModel: "control.pth" },
      { name: "identity-ref.png" }, // img2img reference
      { name: "pose.png" }, // ControlNet control image
    ) as Record<string, { class_type: string; inputs: Record<string, unknown> }>;

    // LoRA affects model/clip source only.
    expect(graph["3"].inputs.model).toEqual(["20", 0]);
    expect(graph["6"].inputs.clip).toEqual(["20", 1]);
    // img2img affects latent source only.
    expect(graph["30"]).toMatchObject({ class_type: "LoadImage", inputs: { image: "identity-ref.png" } });
    expect(graph["3"].inputs.latent_image).toEqual(["31", 0]);
    expect(graph["3"].inputs.denoise).toBe(0.6);
    // ControlNet affects positive/negative conditioning source only.
    expect(graph["40"]).toMatchObject({ class_type: "LoadImage", inputs: { image: "pose.png" } });
    expect(graph["3"].inputs.positive).toEqual(["42", 0]);
    expect(graph["3"].inputs.negative).toEqual(["42", 1]);
    // ControlNetApplyAdvanced itself reads from the ORIGINAL text-encode
    // nodes (not affected by the LoRA chain — clip is, conditioning isn't).
    expect(graph["42"].inputs.positive).toEqual(["6", 0]);
    expect(graph["42"].inputs.negative).toEqual(["7", 0]);
  });
});

describe("buildEditWorkflow", () => {
  const SOURCE = { name: "source_00001_.png", subfolder: "", type: "input" };

  it("without a mask: whole-image edit at denoise 0.6, no LoadImageMask/SetLatentNoiseMask", () => {
    const graph = buildEditWorkflow("add a hat", "m.safetensors", SOURCE, undefined) as Record<
      string,
      { class_type: string; inputs: Record<string, unknown> }
    >;
    expect(graph["30"]).toMatchObject({ class_type: "LoadImage", inputs: { image: "source_00001_.png" } });
    expect(graph["31"]).toMatchObject({ class_type: "VAEEncode", inputs: { pixels: ["30", 0], vae: ["4", 2] } });
    expect(graph["3"].inputs.latent_image).toEqual(["31", 0]);
    expect(graph["3"].inputs.denoise).toBe(0.6);
    expect(graph["6"].inputs.text).toBe("add a hat");
    expect(graph["7"].inputs.text).toBe("");
    expect(graph["33"]).toBeUndefined();
    expect(graph["34"]).toBeUndefined();
    expect(graph["5"]).toBeUndefined(); // no EmptyLatentImage on the edit path at all
  });

  it("with a mask: LoadImageMask uses channel 'red' (not 'alpha'), SetLatentNoiseMask wired in, denoise 1.0", () => {
    const mask = { name: "mask_00001_.png", subfolder: "kumanga", type: "input" };
    const graph = buildEditWorkflow("add a hat", "m.safetensors", SOURCE, mask) as Record<
      string,
      { class_type: string; inputs: Record<string, unknown> }
    >;
    expect(graph["33"]).toMatchObject({ class_type: "LoadImageMask", inputs: { image: "kumanga/mask_00001_.png", channel: "red" } });
    expect(graph["34"]).toMatchObject({ class_type: "SetLatentNoiseMask", inputs: { samples: ["31", 0], mask: ["33", 0] } });
    expect(graph["3"].inputs.latent_image).toEqual(["34", 0]);
    expect(graph["3"].inputs.denoise).toBe(1);
  });

  it("chains LoRAs the same way the generation-path graph does", () => {
    const graph = buildEditWorkflow("add a hat", "m.safetensors", SOURCE, undefined, {
      loras: [{ name: "detail_tweaker_xl.safetensors", strength: 0.8 }],
    }) as Record<string, { inputs: Record<string, unknown> }>;
    expect(graph["20"].inputs).toMatchObject({ lora_name: "detail_tweaker_xl.safetensors", strength_model: 0.8, strength_clip: 0.8 });
    expect(graph["3"].inputs.model).toEqual(["20", 0]);
    expect(graph["6"].inputs.clip).toEqual(["20", 1]);
  });

  it("applies sampler overrides the same way the generation-path graph does", () => {
    const graph = buildEditWorkflow("add a hat", "m.safetensors", SOURCE, undefined, {
      steps: 30,
      cfg: 4.5,
      samplerName: "dpmpp_2m",
      scheduler: "karras",
    }) as Record<string, { inputs: Record<string, unknown> }>;
    expect(graph["3"].inputs).toMatchObject({ steps: 30, cfg: 4.5, sampler_name: "dpmpp_2m", scheduler: "karras" });
  });

  it("with an extra reference image: wires IPAdapterUnifiedLoader + IPAdapterAdvanced, defaulting to the architecture-agnostic preset", () => {
    const reference = { name: "canonical.png", subfolder: "", type: "input" };
    const graph = buildEditWorkflow("add a hat", "m.safetensors", SOURCE, undefined, undefined, reference) as Record<
      string,
      { class_type: string; inputs: Record<string, unknown> }
    >;
    expect(graph["50"]).toMatchObject({ class_type: "LoadImage", inputs: { image: "canonical.png" } });
    expect(graph["51"]).toMatchObject({
      class_type: "IPAdapterUnifiedLoader",
      inputs: { model: ["4", 0], preset: "STANDARD (medium strength)" },
    });
    expect(graph["52"]).toMatchObject({
      class_type: "IPAdapterAdvanced",
      inputs: {
        model: ["51", 0],
        ipadapter: ["51", 1],
        image: ["50", 0],
        weight: 1,
        weight_type: "linear",
        combine_embeds: "concat",
        start_at: 0,
        end_at: 1,
        embeds_scaling: "V only",
      },
    });
    expect(graph["3"].inputs.model).toEqual(["52", 0]); // KSampler reads the IPAdapter-wrapped model
  });

  it("respects ipAdapterPreset/ipAdapterWeight overrides", () => {
    const reference = { name: "canonical.png" };
    const graph = buildEditWorkflow("add a hat", "m.safetensors", SOURCE, undefined, {
      ipAdapterPreset: "PLUS (high strength)",
      ipAdapterWeight: 0.6,
    }, reference) as Record<string, { inputs: Record<string, unknown> }>;
    expect(graph["51"].inputs.preset).toBe("PLUS (high strength)");
    expect(graph["52"].inputs.weight).toBe(0.6);
  });

  it("chains LoRA before IPAdapter: the LoRA-chain output feeds IPAdapterUnifiedLoader, not the raw checkpoint", () => {
    const reference = { name: "canonical.png" };
    const graph = buildEditWorkflow(
      "add a hat",
      "m.safetensors",
      SOURCE,
      undefined,
      { loras: [{ name: "detail.safetensors", strength: 0.7 }] },
      reference,
    ) as Record<string, { inputs: Record<string, unknown> }>;
    expect(graph["51"].inputs.model).toEqual(["20", 0]); // the LoRA chain's output, not ["4", 0]
    expect(graph["3"].inputs.model).toEqual(["52", 0]); // IPAdapter still wins as KSampler's final model source
  });

  it("without a reference image: no IPAdapter nodes at all, KSampler reads the plain model source", () => {
    const graph = buildEditWorkflow("add a hat", "m.safetensors", SOURCE, undefined) as Record<string, unknown>;
    expect(graph["50"]).toBeUndefined();
    expect(graph["51"]).toBeUndefined();
    expect(graph["52"]).toBeUndefined();
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

  it("declares reference-image (img2img) and editing support, but no transparent-background support", () => {
    const provider = createComfyUiProvider({ baseUrl: "https://comfy.example.com", model: "m.safetensors" });
    expect(provider.capabilities.supportsReferenceImage).toBe(true);
    expect(provider.capabilities.reference).toMatchObject({ supported: true, transport: "provider-native", maxImages: 1 });
    expect(provider.capabilities.supportsImageEditing).toBe(true);
    expect(provider.capabilities.supportsTransparentBackground).toBe(false);
    expect(provider.capabilities.asyncGeneration).toBe(true);
    expect(provider.editImage).toBeInstanceOf(Function);
  });

  it("uploads the reference image, then submits a workflow whose LoadImage node uses the SERVER's own upload response name, not the client filename", async () => {
    const uploadedName = "server_renamed_ref_00007_.png";

    const calls = stubFetch((url) => {
      if (url.includes("/upload/image")) return new Response(JSON.stringify({ name: uploadedName, subfolder: "", type: "input" }), { status: 200 });
      if (url.includes("/prompt")) return new Response(JSON.stringify({ prompt_id: PROMPT_ID }), { status: 200 });
      if (url.includes("/history/")) {
        return new Response(
          JSON.stringify({
            [PROMPT_ID]: { status: { completed: true }, outputs: { "9": { images: [{ filename: "out.png", type: "output" }] } } },
          }),
          { status: 200 },
        );
      }
      if (url.includes("/view")) return new Response(PNG_BYTES, { status: 200 });
      throw new Error(`unexpected fetch: ${url}`);
    });

    const provider = createComfyUiProvider({ baseUrl: "https://comfy.example.com", model: "m.safetensors", ...FAST_POLL });
    const referenceBytes = Buffer.from([1, 2, 3, 4, 5]);
    await provider.generateImage({ ...REQUEST, referenceImages: [{ mimeType: "image/png", data: referenceBytes }] });

    const uploadCall = calls.find((c) => c.url.includes("/upload/image"));
    expect(uploadCall).toBeDefined();
    const uploadedFile = (uploadCall!.init!.body as FormData).get("image") as File;
    expect(new Uint8Array(await uploadedFile.arrayBuffer())).toEqual(new Uint8Array(referenceBytes));

    const promptCall = calls.find((c) => c.url.includes("/prompt"));
    const submittedWorkflow = JSON.parse(String(promptCall!.init!.body)).prompt as Record<
      string,
      { class_type: string; inputs: Record<string, unknown> }
    >;
    expect(submittedWorkflow["30"]).toMatchObject({ class_type: "LoadImage", inputs: { image: uploadedName } });
    expect(submittedWorkflow["3"].inputs.denoise).toBe(0.6);
  });

  it("editImage uploads source and mask separately, then submits a masked-inpaint workflow using each upload's own server name", async () => {
    const sourceName = "server-source.png";
    const maskName = "server-mask.png";
    let uploadCount = 0;
    const calls = stubFetch((url) => {
      if (url.includes("/upload/image")) {
        uploadCount += 1;
        const name = uploadCount === 1 ? sourceName : maskName;
        return new Response(JSON.stringify({ name, subfolder: "", type: "input" }), { status: 200 });
      }
      if (url.includes("/prompt")) return new Response(JSON.stringify({ prompt_id: PROMPT_ID }), { status: 200 });
      if (url.includes("/history/")) {
        return new Response(
          JSON.stringify({
            [PROMPT_ID]: { status: { completed: true }, outputs: { "9": { images: [{ filename: "edited.png", type: "output" }] } } },
          }),
          { status: 200 },
        );
      }
      if (url.includes("/view")) return new Response(PNG_BYTES, { status: 200 });
      throw new Error(`unexpected fetch: ${url}`);
    });

    const provider = createComfyUiProvider({ baseUrl: "https://comfy.example.com", model: "m.safetensors", ...FAST_POLL });
    const result = await provider.editImage!({
      instruction: "add a hat",
      image: { mimeType: "image/png", data: Buffer.from([10, 20, 30]) },
      mask: { mimeType: "image/png", data: Buffer.from([40, 50, 60]) },
    });

    expect(result.mimeType).toBe("image/png");
    expect(calls.filter((c) => c.url.includes("/upload/image"))).toHaveLength(2);

    const promptCall = calls.find((c) => c.url.includes("/prompt"));
    const submittedWorkflow = JSON.parse(String(promptCall!.init!.body)).prompt as Record<
      string,
      { class_type: string; inputs: Record<string, unknown> }
    >;
    expect(submittedWorkflow["30"]).toMatchObject({ class_type: "LoadImage", inputs: { image: sourceName } });
    expect(submittedWorkflow["33"]).toMatchObject({ class_type: "LoadImageMask", inputs: { image: maskName, channel: "red" } });
    expect(submittedWorkflow["3"].inputs.denoise).toBe(1);
  });

  it("editImage uploads source, mask, AND an extra identity reference separately, wiring IPAdapter with each upload's own server name", async () => {
    const sourceName = "server-source.png";
    const maskName = "server-mask.png";
    const referenceName = "server-reference.png";
    const names = [sourceName, maskName, referenceName];
    let uploadCount = 0;
    const calls = stubFetch((url) => {
      if (url.includes("/upload/image")) {
        const name = names[uploadCount];
        uploadCount += 1;
        return new Response(JSON.stringify({ name, subfolder: "", type: "input" }), { status: 200 });
      }
      if (url.includes("/prompt")) return new Response(JSON.stringify({ prompt_id: PROMPT_ID }), { status: 200 });
      if (url.includes("/history/")) {
        return new Response(
          JSON.stringify({
            [PROMPT_ID]: { status: { completed: true }, outputs: { "9": { images: [{ filename: "edited.png", type: "output" }] } } },
          }),
          { status: 200 },
        );
      }
      if (url.includes("/view")) return new Response(PNG_BYTES, { status: 200 });
      throw new Error(`unexpected fetch: ${url}`);
    });

    const provider = createComfyUiProvider({ baseUrl: "https://comfy.example.com", model: "m.safetensors", ...FAST_POLL });
    const result = await provider.editImage!({
      instruction: "add a hat",
      image: { mimeType: "image/png", data: Buffer.from([10, 20, 30]) },
      mask: { mimeType: "image/png", data: Buffer.from([40, 50, 60]) },
      referenceImages: [{ mimeType: "image/png", data: Buffer.from([70, 80, 90]) }],
    });

    expect(result.mimeType).toBe("image/png");
    expect(calls.filter((c) => c.url.includes("/upload/image"))).toHaveLength(3);

    const promptCall = calls.find((c) => c.url.includes("/prompt"));
    const submittedWorkflow = JSON.parse(String(promptCall!.init!.body)).prompt as Record<
      string,
      { class_type: string; inputs: Record<string, unknown> }
    >;
    expect(submittedWorkflow["50"]).toMatchObject({ class_type: "LoadImage", inputs: { image: referenceName } });
    expect(submittedWorkflow["51"].class_type).toBe("IPAdapterUnifiedLoader");
    expect(submittedWorkflow["52"].class_type).toBe("IPAdapterAdvanced");
    expect(submittedWorkflow["3"].inputs.model).toEqual(["52", 0]);
  });

  it("generateImage uploads the control image and submits a ControlNet-wired workflow using its own server name", async () => {
    const controlName = "server-control.png";
    const calls = stubFetch((url) => {
      if (url.includes("/upload/image")) return new Response(JSON.stringify({ name: controlName, subfolder: "", type: "input" }), { status: 200 });
      if (url.includes("/prompt")) return new Response(JSON.stringify({ prompt_id: PROMPT_ID }), { status: 200 });
      if (url.includes("/history/")) {
        return new Response(
          JSON.stringify({
            [PROMPT_ID]: { status: { completed: true }, outputs: { "9": { images: [{ filename: "out.png", type: "output" }] } } },
          }),
          { status: 200 },
        );
      }
      if (url.includes("/view")) return new Response(PNG_BYTES, { status: 200 });
      throw new Error(`unexpected fetch: ${url}`);
    });

    const provider = createComfyUiProvider({
      baseUrl: "https://comfy.example.com",
      model: "m.safetensors",
      comfyui: { controlNetModel: "control_v11p_sd15_openpose.pth" },
      ...FAST_POLL,
    });
    await provider.generateImage({ ...REQUEST, controlImage: { mimeType: "image/png", data: Buffer.from([9, 9, 9]) } });

    const promptCall = calls.find((c) => c.url.includes("/prompt"));
    const submittedWorkflow = JSON.parse(String(promptCall!.init!.body)).prompt as Record<string, { inputs: Record<string, unknown> }>;
    expect(submittedWorkflow["40"].inputs.image).toBe(controlName);
    expect(submittedWorkflow["3"].inputs.positive).toEqual(["42", 0]);
  });

  it("throws a clear ProviderError when a control image is supplied but no ControlNet model is configured", async () => {
    const provider = createComfyUiProvider({ baseUrl: "https://comfy.example.com", model: "m.safetensors", ...FAST_POLL });
    await expect(
      provider.generateImage({ ...REQUEST, controlImage: { mimeType: "image/png", data: Buffer.from([9, 9, 9]) } }),
    ).rejects.toThrow(/ControlNet model not configured/);
  });
});

describe("fetchObjectInfoOptions", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("extracts a COMBO input's option list from ComfyUI's object_info response", async () => {
    stubFetch((url) => {
      expect(url).toContain("/object_info/LoraLoader");
      return new Response(
        JSON.stringify({ LoraLoader: { input: { required: { lora_name: [["a.safetensors", "b.safetensors"]] } } } }),
        { status: 200 },
      );
    });
    const options = await fetchObjectInfoOptions({ baseUrl: "https://comfy.example.com", model: "m" }, "LoraLoader", "lora_name");
    expect(options).toEqual(["a.safetensors", "b.safetensors"]);
  });

  it("returns an empty array, not a throw, when the node/input isn't present in the response", async () => {
    stubFetch(() => new Response(JSON.stringify({ SomeOtherNode: {} }), { status: 200 }));
    const options = await fetchObjectInfoOptions({ baseUrl: "https://comfy.example.com", model: "m" }, "LoraLoader", "lora_name");
    expect(options).toEqual([]);
  });

  it("throws a safe ProviderError when ComfyUI itself is unreachable/errors", async () => {
    stubFetch(() => new Response("server error", { status: 500 }));
    await expect(
      fetchObjectInfoOptions({ baseUrl: "https://comfy.example.com", model: "m" }, "LoraLoader", "lora_name"),
    ).rejects.toThrow(/ComfyUI error/);
  });
});
