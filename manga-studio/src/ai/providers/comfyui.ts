/**
 * ComfyUI adapter — a dedicated coded provider (not the declarative Custom
 * API path) for a local, self-hosted ComfyUI instance.
 *
 * Why not Custom API: ComfyUI's `GET /history/{prompt_id}` nests its result
 * under a key equal to the submitted `prompt_id` (a hyphenated UUID) — a
 * dynamic path segment the declarative polling mechanism's static
 * `jsonPath.ts` grammar cannot express. And a real ComfyUI workflow graph is
 * typically several KB, too large for the 6000-char request-template cap or
 * the ~3500-char total cookie budget. So the workflow graph is built
 * server-side from typed fields instead of accepted as user-supplied JSON,
 * and the dynamic history key is read with plain object access, never
 * `getAtPath`.
 *
 * Node id ranges (documented once so a future addition doesn't have to
 * reverse-engineer the scheme from several separate changes):
 *   3-9   core txt2img (v1) — KSampler/CheckpointLoaderSimple/
 *         EmptyLatentImage/CLIPTextEncode x2/VAEDecode/SaveImage.
 *   20-23 LoRA chain (v2, up to MAX_COMFYUI_LORAS entries) — shared by
 *         both buildWorkflow (generation) and buildEditWorkflow (edit).
 *   30-32 img2img (v2, generation path) — LoadImage/VAEEncode/ImageScale.
 *   30,31,33,34 edit path (v3 PR2) — LoadImage/VAEEncode/LoadImageMask/
 *         SetLatentNoiseMask. Never both graphs at once, so the 30/31
 *         reuse across the two functions is not a real collision.
 *   40-42 ControlNet (v3 PR3, generation path only) — LoadImage/
 *         ControlNetLoader/ControlNetApplyAdvanced.
 *   50-52 IPAdapter (edit path only) — LoadImage/IPAdapterUnifiedLoader/
 *         IPAdapterAdvanced, from the `ComfyUI_IPAdapter_plus` custom node
 *         pack (NOT part of a vanilla ComfyUI install — see comment at
 *         its use site). Wraps the LoRA-chained model so KSampler reads
 *         an IPAdapter-conditioned model instead of the raw chain output.
 *   43-49, 53+ reserved for any future stage.
 */

import { DEFAULT_IP_ADAPTER_PRESET, type ComfyUiExtraConfig } from "@/server/comfyui/config";
import { assertSafeProviderUrl, redactSecrets } from "../security";
import { outboundFetch, readBodyBytes, readBodyText, UnsafeOutboundUrlError } from "@/server/outboundFetch";
import { detectImageType } from "@/storage/imageValidation";
import {
  ProviderError,
  type ImageEditRequest,
  type ImageGenerationProvider,
  type ImageGenerationRequest,
  type ImageGenerationResult,
  type ProviderStatus,
} from "../types";

const REQUEST_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 180_000; // local/dev hardware can be materially slower than a cloud API
const MAX_RESPONSE_BYTES = 40 * 1024 * 1024;
const MAX_ERROR_BODY_BYTES = 64 * 1024;
const SAVE_IMAGE_NODE_ID = "9";
const LORA_NODE_IDS = ["20", "21", "22", "23"];

export interface ComfyUiConfig {
  apiKey?: string;
  baseUrl: string;
  model: string;
  name?: string;
  comfyui?: ComfyUiExtraConfig;
  /** Test-only override of the poll interval/deadline (real production
   * config never sets these — kept out of ProviderConfig/the cookie
   * schema). Lets tests use real timers with tiny values instead of
   * fighting fake-timer/real-DNS interaction inside outboundFetch. */
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
}

interface ComfyUiImageRef {
  filename: string;
  subfolder?: string;
  type?: string;
}

/** What `/upload/image` reports back — the AUTHORITATIVE name/subfolder to
 * reference in the workflow graph, never the client-sent filename (ComfyUI
 * auto-dedupes/renames on collision). */
interface UploadedImageRef {
  name: string;
  subfolder?: string;
  type?: string;
}

/** Chains LoraLoader nodes (ids `20`-`23`) from the checkpoint into `graph`
 * (mutated in place), returning where the model/clip sources now point —
 * `["4",0]`/`["4",1]` unchanged when `loras` is empty. Shared by both
 * `buildWorkflow` and `buildEditWorkflow` so this wiring is written once.
 * `strength_model`/`strength_clip` are collapsed into one `strength` field
 * per entry — an intentional simplification, not the node's real
 * two-independent-strengths shape. */
function addLoraChain(
  graph: Record<string, unknown>,
  loras: ComfyUiExtraConfig["loras"],
): { modelSource: [string, number]; clipSource: [string, number] } {
  const loraIds = LORA_NODE_IDS.slice(0, loras?.length ?? 0);
  let modelSource: [string, number] = ["4", 0];
  let clipSource: [string, number] = ["4", 1];
  loraIds.forEach((nodeId, index) => {
    const entry = loras![index];
    graph[nodeId] = {
      class_type: "LoraLoader",
      inputs: {
        lora_name: entry.name,
        strength_model: entry.strength ?? 1,
        strength_clip: entry.strength ?? 1,
        model: modelSource,
        clip: clipSource,
      },
    };
    modelSource = [nodeId, 0];
    clipSource = [nodeId, 1];
  });
  return { modelSource, clipSource };
}

/**
 * Pure, testable without network: the ComfyUI API-format graph for this
 * request. Base shape (no LoRA, no reference image) is the same standard
 * txt2img graph ComfyUI itself ships as its default example workflow —
 * byte-identical to v1 when `extra`/`uploadedImage` are both absent.
 */
export function buildWorkflow(
  request: Pick<ImageGenerationRequest, "prompt" | "negativePrompt" | "width" | "height">,
  checkpointModel: string,
  extra?: ComfyUiExtraConfig,
  uploadedImage?: UploadedImageRef,
  uploadedControlImage?: UploadedImageRef,
): Record<string, unknown> {
  const seed = Math.floor(Math.random() * 2 ** 31);

  const graph: Record<string, unknown> = {
    "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: checkpointModel } },
  };
  const { modelSource, clipSource } = addLoraChain(graph, extra?.loras);

  graph["6"] = { class_type: "CLIPTextEncode", inputs: { text: request.prompt, clip: clipSource } };
  graph["7"] = { class_type: "CLIPTextEncode", inputs: { text: request.negativePrompt ?? "", clip: clipSource } };

  // ControlNet composes orthogonally with the LoRA chain (model/clip source
  // above) and img2img (latent source below) — it only affects which
  // conditioning KSampler's positive/negative actually read.
  let positiveSource: [string, number] = ["6", 0];
  let negativeSource: [string, number] = ["7", 0];
  if (uploadedControlImage && extra?.controlNetModel) {
    const controlPath = uploadedControlImage.subfolder
      ? `${uploadedControlImage.subfolder}/${uploadedControlImage.name}`
      : uploadedControlImage.name;
    graph["40"] = { class_type: "LoadImage", inputs: { image: controlPath } };
    graph["41"] = { class_type: "ControlNetLoader", inputs: { control_net_name: extra.controlNetModel } };
    // start_percent/end_percent are REQUIRED inputs on this node's raw
    // API-format graph (the ComfyUI UI defaults them; a hand-built graph
    // must supply them explicitly or /prompt rejects it) — full range.
    graph["42"] = {
      class_type: "ControlNetApplyAdvanced",
      inputs: {
        positive: positiveSource,
        negative: negativeSource,
        control_net: ["41", 0],
        image: ["40", 0],
        strength: extra.controlNetStrength ?? 1,
        start_percent: 0,
        end_percent: 1,
      },
    };
    positiveSource = ["42", 0];
    negativeSource = ["42", 1];
  }

  let latentSource: [string, number] = ["5", 0];
  let denoise = 1;
  if (uploadedImage) {
    // ComfyUI's LoadImage widget wants the subfolder-joined relative path
    // when the upload landed in a non-empty subfolder, not the bare name.
    const imagePath = uploadedImage.subfolder ? `${uploadedImage.subfolder}/${uploadedImage.name}` : uploadedImage.name;
    graph["30"] = { class_type: "LoadImage", inputs: { image: imagePath } };
    // Without this resize, output resolution would silently follow the
    // reference image's own native size instead of request.width/height —
    // nothing downstream re-scales provider output.
    graph["32"] = {
      class_type: "ImageScale",
      inputs: {
        image: ["30", 0],
        width: request.width ?? 1024,
        height: request.height ?? 1024,
        upscale_method: "lanczos",
        crop: "disabled",
      },
    };
    graph["31"] = { class_type: "VAEEncode", inputs: { pixels: ["32", 0], vae: ["4", 2] } };
    latentSource = ["31", 0];
    denoise = 0.6; // fixed: preserves reference identity while still allowing pose/expression variation
  } else {
    graph["5"] = {
      class_type: "EmptyLatentImage",
      inputs: { width: request.width ?? 1024, height: request.height ?? 1024, batch_size: 1 },
    };
  }

  graph["3"] = {
    class_type: "KSampler",
    inputs: {
      seed,
      steps: extra?.steps ?? 20,
      cfg: extra?.cfg ?? 7,
      sampler_name: extra?.samplerName ?? "euler",
      scheduler: extra?.scheduler ?? "normal",
      denoise,
      model: modelSource,
      positive: positiveSource,
      negative: negativeSource,
      latent_image: latentSource,
    },
  };
  graph["8"] = { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 2] } };
  graph[SAVE_IMAGE_NODE_ID] = { class_type: "SaveImage", inputs: { filename_prefix: "kumanga", images: ["8", 0] } };

  return graph;
}

/**
 * Pure, testable without network: the edit-path graph. Deliberately
 * separate from `buildWorkflow` — editing always has a source image (no
 * `EmptyLatentImage`/img2img choice), `ImageEditRequest` has no width/
 * height (the caller re-resizes provider output to the source's own
 * dimensions afterward regardless, so no `ImageScale` here either), and
 * optionally has a mask.
 *
 * When `maskImage` is present: `LoadImageMask` with `channel: "red"` — NOT
 * `"alpha"`. `AssetDetailEditor.tsx` paints opaque white circles on an
 * initially-transparent canvas, so editable pixels are alpha=255; ComfyUI's
 * `channel: "alpha"` computes `mask = 1 - alpha` (a legacy cutout-mask
 * convention), which would invert polarity and PROTECT exactly the region
 * meant to change. `"red"` passes straight through (R=255 → mask=1.0).
 * `SetLatentNoiseMask` then lets KSampler discard/resample only the masked
 * latent region. Denoise is `1.0` when masked (matches ComfyUI's own
 * official inpainting example: the mask already fully protects everything
 * outside it, so the masked region should be resampled entirely from the
 * instruction, not biased toward the original content) — `0.6` when no
 * mask (a gentler whole-image nudge; only reachable if some future caller
 * of `editImage` other than `/api/assets/edit` omits a mask, since that
 * route always supplies one today).
 *
 * When `referenceImage` is present (an extra identity reference sent
 * alongside the edit source, e.g. a character's canonical render): wired
 * through `IPAdapterUnifiedLoader` + `IPAdapterAdvanced`, from the
 * `ComfyUI_IPAdapter_plus` custom node pack. **This is NOT part of a
 * vanilla ComfyUI install** — a user without it gets a clear `/prompt`
 * rejection (ComfyUI's own "unknown node type" error), not silent wrong
 * output, same safety net as every other unverified-node-shape risk in
 * this file. Node names/inputs verified directly against that pack's
 * source (`IPAdapterPlus.py`), not guessed. Unlike ControlNet, no
 * required config: `extra?.ipAdapterPreset` defaults to
 * `DEFAULT_IP_ADAPTER_PRESET` ("STANDARD (medium strength)", the one
 * preset choice that resolves correctly on both SD1.5 and SDXL
 * checkpoints — two of the six real presets are SD1.5-only and fail on
 * SDXL) so this activates automatically whenever a reference is given.
 */
export function buildEditWorkflow(
  instruction: string,
  checkpointModel: string,
  sourceImage: UploadedImageRef,
  maskImage: UploadedImageRef | undefined,
  extra?: ComfyUiExtraConfig,
  referenceImage?: UploadedImageRef,
): Record<string, unknown> {
  const seed = Math.floor(Math.random() * 2 ** 31);

  const graph: Record<string, unknown> = {
    "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: checkpointModel } },
  };
  const { modelSource: loraModelSource, clipSource } = addLoraChain(graph, extra?.loras);

  let modelSource = loraModelSource;
  if (referenceImage) {
    const referencePath = referenceImage.subfolder ? `${referenceImage.subfolder}/${referenceImage.name}` : referenceImage.name;
    graph["50"] = { class_type: "LoadImage", inputs: { image: referencePath } };
    graph["51"] = {
      class_type: "IPAdapterUnifiedLoader",
      inputs: { model: loraModelSource, preset: extra?.ipAdapterPreset ?? DEFAULT_IP_ADAPTER_PRESET },
    };
    graph["52"] = {
      class_type: "IPAdapterAdvanced",
      inputs: {
        model: ["51", 0],
        ipadapter: ["51", 1],
        image: ["50", 0],
        weight: extra?.ipAdapterWeight ?? 1,
        // Defaults verified from IPAdapterAdvanced's own Python function
        // signature — not exposed as config, a single reference image
        // doesn't need combine_embeds/embeds_scaling tuning.
        weight_type: "linear",
        combine_embeds: "concat",
        start_at: 0,
        end_at: 1,
        embeds_scaling: "V only",
      },
    };
    modelSource = ["52", 0];
  }

  graph["6"] = { class_type: "CLIPTextEncode", inputs: { text: instruction, clip: clipSource } };
  graph["7"] = { class_type: "CLIPTextEncode", inputs: { text: "", clip: clipSource } };

  const sourcePath = sourceImage.subfolder ? `${sourceImage.subfolder}/${sourceImage.name}` : sourceImage.name;
  graph["30"] = { class_type: "LoadImage", inputs: { image: sourcePath } };
  graph["31"] = { class_type: "VAEEncode", inputs: { pixels: ["30", 0], vae: ["4", 2] } };

  let latentSource: [string, number] = ["31", 0];
  let denoise = 0.6;
  if (maskImage) {
    const maskPath = maskImage.subfolder ? `${maskImage.subfolder}/${maskImage.name}` : maskImage.name;
    graph["33"] = { class_type: "LoadImageMask", inputs: { image: maskPath, channel: "red" } };
    graph["34"] = { class_type: "SetLatentNoiseMask", inputs: { samples: ["31", 0], mask: ["33", 0] } };
    latentSource = ["34", 0];
    denoise = 1;
  }

  graph["3"] = {
    class_type: "KSampler",
    inputs: {
      seed,
      steps: extra?.steps ?? 20,
      cfg: extra?.cfg ?? 7,
      sampler_name: extra?.samplerName ?? "euler",
      scheduler: extra?.scheduler ?? "normal",
      denoise,
      model: modelSource,
      positive: ["6", 0],
      negative: ["7", 0],
      latent_image: latentSource,
    },
  };
  graph["8"] = { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 2] } };
  graph[SAVE_IMAGE_NODE_ID] = { class_type: "SaveImage", inputs: { filename_prefix: "kumanga-edit", images: ["8", 0] } };

  return graph;
}

function authHeaders(apiKey: string | undefined): Record<string, string> {
  // ComfyUI itself has no built-in auth; a key here only matters if the
  // user put it behind an authenticating reverse proxy.
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

async function boundedFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await outboundFetch(url, init, { timeoutMs: REQUEST_TIMEOUT_MS });
  } catch (error) {
    if (error instanceof UnsafeOutboundUrlError) throw new ProviderError(error.message, 400);
    if (error instanceof Error && error.name === "AbortError") throw new ProviderError("Generation timed out", 504);
    throw new ProviderError("ComfyUI server unreachable", 502);
  }
}

async function safeErrorMessage(response: Response, apiKey?: string): Promise<string> {
  if (response.status === 401 || response.status === 403) return "Authentication failed — check the API key";
  const text = await readBodyText(response, MAX_ERROR_BODY_BYTES).catch(() => "");
  const redacted = redactSecrets(text);
  const scrubbed = apiKey && apiKey.length >= 4 ? redacted.split(apiKey).join("[redacted]") : redacted;
  return `ComfyUI error (HTTP ${response.status})${scrubbed ? `: ${scrubbed.slice(0, 300)}` : ""}`;
}

/** Uploads a reference image via ComfyUI's own `/upload/image`. Returns the
 * SERVER's name/subfolder — never assume the client-sent filename survives
 * (ComfyUI auto-dedupes/renames on collision). */
async function uploadImage(
  base: string,
  apiKey: string | undefined,
  ref: { mimeType: string; data: Buffer },
): Promise<UploadedImageRef> {
  const form = new FormData();
  form.append("image", new Blob([new Uint8Array(ref.data)], { type: ref.mimeType }), "reference.png");
  const response = await boundedFetch(`${base}/upload/image`, {
    method: "POST",
    // FormData sets its own multipart boundary — never hand-set Content-Type.
    headers: authHeaders(apiKey),
    body: form,
  });
  if (!response.ok) throw new ProviderError(await safeErrorMessage(response, apiKey), 502);
  const body = (await response.json().catch(() => null)) as { name?: unknown; subfolder?: unknown; type?: unknown } | null;
  if (typeof body?.name !== "string" || !body.name) {
    throw new ProviderError("ComfyUI did not return an uploaded image name");
  }
  return {
    name: body.name,
    subfolder: typeof body.subfolder === "string" ? body.subfolder : undefined,
    type: typeof body.type === "string" ? body.type : undefined,
  };
}

/**
 * Fetches the valid options for one COMBO/enum input on one ComfyUI node
 * type — e.g. every LoRA filename ComfyUI can see (`LoraLoader.lora_name`)
 * or every installed ControlNet model (`ControlNetLoader.control_net_name`).
 * Used to populate a dropdown instead of requiring free-text entry. Reuses
 * this file's own SSRF-guarded fetch plumbing — never a second, raw fetch
 * path to a user-configurable URL.
 */
export async function fetchObjectInfoOptions(config: ComfyUiConfig, nodeClass: string, inputName: string): Promise<string[]> {
  const base = assertSafeProviderUrl(config.baseUrl).toString().replace(/\/$/, "");
  const response = await boundedFetch(`${base}/object_info/${encodeURIComponent(nodeClass)}`, {
    method: "GET",
    headers: authHeaders(config.apiKey),
  });
  if (!response.ok) throw new ProviderError(await safeErrorMessage(response, config.apiKey), 502);
  const body = (await response.json().catch(() => null)) as Record<string, { input?: { required?: Record<string, unknown[]> } }> | null;
  const options = body?.[nodeClass]?.input?.required?.[inputName]?.[0];
  return Array.isArray(options) ? options.filter((o): o is string => typeof o === "string") : [];
}

async function submitPrompt(base: string, apiKey: string | undefined, workflow: Record<string, unknown>): Promise<string> {
  const response = await boundedFetch(`${base}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(apiKey) },
    body: JSON.stringify({ prompt: workflow }),
  });
  if (!response.ok) throw new ProviderError(await safeErrorMessage(response, apiKey), response.status === 400 ? 400 : 502);
  const body = (await response.json().catch(() => null)) as { prompt_id?: unknown } | null;
  const promptId = body?.prompt_id;
  if (typeof promptId !== "string" || !promptId) {
    throw new ProviderError("ComfyUI did not return a prompt_id");
  }
  return promptId;
}

/**
 * Polls `/history/{promptId}`. The result lives under a key EQUAL TO
 * `promptId` itself (a hyphenated UUID) — read with plain object access,
 * never `jsonPath.ts`'s `getAtPath`, whose static path grammar cannot
 * express a dynamic/hyphenated key. Written defensively: any non-completed
 * shape (including ComfyUI's documented `{}` for an unknown/pending id) is
 * treated as "still pending" rather than assumed to be one specific shape.
 */
async function pollHistory(
  base: string,
  apiKey: string | undefined,
  promptId: string,
  intervalMs: number,
  timeoutMs: number,
): Promise<ComfyUiImageRef> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(intervalMs);
    const response = await boundedFetch(`${base}/history/${encodeURIComponent(promptId)}`, {
      method: "GET",
      headers: authHeaders(apiKey),
    });
    if (!response.ok) throw new ProviderError(await safeErrorMessage(response, apiKey), 502);
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    const entry = body?.[promptId] as
      | { status?: { completed?: boolean; status_str?: string }; outputs?: Record<string, { images?: ComfyUiImageRef[] }> }
      | undefined;
    if (!entry) continue; // not in history yet — still pending
    if (entry.status?.status_str === "error") {
      throw new ProviderError("ComfyUI reported the generation as failed");
    }
    if (entry.status?.completed) {
      const image = entry.outputs?.[SAVE_IMAGE_NODE_ID]?.images?.[0];
      if (!image) throw new ProviderError("ComfyUI completed the task but returned no image");
      return image;
    }
  }
  throw new ProviderError("Timed out waiting for ComfyUI to finish generating", 504);
}

async function fetchImageBytes(base: string, apiKey: string | undefined, ref: ComfyUiImageRef): Promise<ImageGenerationResult> {
  const params = new URLSearchParams({ filename: ref.filename, type: ref.type || "output" });
  if (ref.subfolder) params.set("subfolder", ref.subfolder);
  const response = await boundedFetch(`${base}/view?${params.toString()}`, { method: "GET", headers: authHeaders(apiKey) });
  if (!response.ok) throw new ProviderError(await safeErrorMessage(response, apiKey), 502);
  const bytes = await readBodyBytes(response, MAX_RESPONSE_BYTES);
  const detected = detectImageType(bytes);
  if (!detected) throw new ProviderError("ComfyUI returned a file that is not a PNG/JPEG/WebP image");
  return { mimeType: detected.mimeType, data: Buffer.from(bytes) };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createComfyUiProvider(config: ComfyUiConfig): ImageGenerationProvider {
  // Validated at construction so a bad URL fails at configuration time, not
  // mid-generation — outboundFetch re-checks on every actual call regardless.
  const base = assertSafeProviderUrl(config.baseUrl).toString().replace(/\/$/, "");

  return {
    id: "comfyui",
    label: config.name || "ComfyUI",
    model: config.model,
    capabilities: {
      textToImage: true,
      supportsReferenceImage: true,
      supportsTransparentBackground: false,
      supportsImageEditing: true,
      reference: { supported: true, transport: "provider-native", maxImages: 1, endpointMode: "same-endpoint" },
      referenceImage: true,
      imageVariation: true,
      transparentOutput: false,
      asyncGeneration: true,
    },

    async testConnection(): Promise<ProviderStatus> {
      const response = await boundedFetch(`${base}/system_stats`, { method: "GET", headers: authHeaders(config.apiKey) });
      if (response.ok) return { ok: true };
      return { ok: false, message: await safeErrorMessage(response, config.apiKey) };
    },

    async generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
      const reference = request.referenceImages?.[0];
      if (request.controlImage && !config.comfyui?.controlNetModel) {
        throw new ProviderError("ControlNet model not configured — set one in AI Settings → Advanced → ComfyUI settings", 400);
      }
      request.trace?.("outbound_request_start", {
        provider: "comfyui",
        operation: "generate_image",
        endpointPath: "/prompt",
        model: config.model,
        referenceAttached: Boolean(reference),
        controlImageAttached: Boolean(request.controlImage),
      });
      const started = Date.now();
      const uploadedImage = reference ? await uploadImage(base, config.apiKey, reference) : undefined;
      const uploadedControlImage = request.controlImage ? await uploadImage(base, config.apiKey, request.controlImage) : undefined;
      const workflow = buildWorkflow(request, config.model, config.comfyui, uploadedImage, uploadedControlImage);
      const promptId = await submitPrompt(base, config.apiKey, workflow);
      const imageRef = await pollHistory(
        base,
        config.apiKey,
        promptId,
        config.pollIntervalMs ?? POLL_INTERVAL_MS,
        config.pollTimeoutMs ?? POLL_TIMEOUT_MS,
      );
      request.trace?.("outbound_response_received", {
        provider: "comfyui",
        httpStatus: 200,
        durationMs: Date.now() - started,
      });
      const result = await fetchImageBytes(base, config.apiKey, imageRef);
      request.trace?.("provider_response_parsed", { provider: "comfyui", imageFound: true });
      return result;
    },

    async editImage(request: ImageEditRequest): Promise<ImageGenerationResult> {
      // Only the FIRST extra reference is used (IPAdapterAdvanced takes one
      // image input) — a batch of identity references is a possible future
      // enhancement, not built now.
      const reference = request.referenceImages?.[0];
      request.trace?.("outbound_request_start", {
        provider: "comfyui",
        operation: "edit_image",
        endpointPath: "/prompt",
        model: config.model,
        maskAttached: Boolean(request.mask),
        referenceAttached: Boolean(reference),
      });
      const started = Date.now();
      const uploadedSource = await uploadImage(base, config.apiKey, request.image);
      const uploadedMask = request.mask ? await uploadImage(base, config.apiKey, request.mask) : undefined;
      const uploadedReference = reference ? await uploadImage(base, config.apiKey, reference) : undefined;
      const workflow = buildEditWorkflow(
        request.instruction,
        config.model,
        uploadedSource,
        uploadedMask,
        config.comfyui,
        uploadedReference,
      );
      const promptId = await submitPrompt(base, config.apiKey, workflow);
      const imageRef = await pollHistory(
        base,
        config.apiKey,
        promptId,
        config.pollIntervalMs ?? POLL_INTERVAL_MS,
        config.pollTimeoutMs ?? POLL_TIMEOUT_MS,
      );
      request.trace?.("outbound_response_received", {
        provider: "comfyui",
        httpStatus: 200,
        durationMs: Date.now() - started,
      });
      const result = await fetchImageBytes(base, config.apiKey, imageRef);
      request.trace?.("provider_response_parsed", { provider: "comfyui", imageFound: true });
      return result;
    },
  };
}
