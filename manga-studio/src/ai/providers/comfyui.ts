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
 *   20-23 LoRA chain (v2, up to MAX_COMFYUI_LORAS entries).
 *   30-32 img2img (v2) — LoadImage/VAEEncode/ImageScale.
 *   40+   reserved for any future stage (ControlNet, mask, upscale...).
 */

import type { ComfyUiExtraConfig } from "@/server/comfyui/config";
import { assertSafeProviderUrl, redactSecrets } from "../security";
import { outboundFetch, readBodyBytes, readBodyText, UnsafeOutboundUrlError } from "@/server/outboundFetch";
import { detectImageType } from "@/storage/imageValidation";
import {
  ProviderError,
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

interface ComfyUiConfig {
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
): Record<string, unknown> {
  const seed = Math.floor(Math.random() * 2 ** 31);
  const loras = extra?.loras ?? [];
  const loraIds = LORA_NODE_IDS.slice(0, loras.length);

  const graph: Record<string, unknown> = {
    "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: checkpointModel } },
  };

  // Chain LoraLoader nodes from the checkpoint; each hop's model/clip output
  // feeds the next. strength_model/strength_clip are collapsed into one
  // `strength` field per entry — an intentional simplification, not the
  // node's real two-independent-strengths shape.
  let modelSource: [string, number] = ["4", 0];
  let clipSource: [string, number] = ["4", 1];
  loraIds.forEach((nodeId, index) => {
    const entry = loras[index];
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

  graph["6"] = { class_type: "CLIPTextEncode", inputs: { text: request.prompt, clip: clipSource } };
  graph["7"] = { class_type: "CLIPTextEncode", inputs: { text: request.negativePrompt ?? "", clip: clipSource } };

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
      positive: ["6", 0],
      negative: ["7", 0],
      latent_image: latentSource,
    },
  };
  graph["8"] = { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 2] } };
  graph[SAVE_IMAGE_NODE_ID] = { class_type: "SaveImage", inputs: { filename_prefix: "kumanga", images: ["8", 0] } };

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
      supportsImageEditing: false,
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
      request.trace?.("outbound_request_start", {
        provider: "comfyui",
        operation: "generate_image",
        endpointPath: "/prompt",
        model: config.model,
        referenceAttached: Boolean(reference),
      });
      const started = Date.now();
      const uploadedImage = reference ? await uploadImage(base, config.apiKey, reference) : undefined;
      const workflow = buildWorkflow(request, config.model, config.comfyui, uploadedImage);
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
