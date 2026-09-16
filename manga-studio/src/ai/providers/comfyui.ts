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
 * server-side from typed fields (checkpoint-only txt2img, no LoRA/reference
 * image in this pass) instead of accepted as user-supplied JSON, and the
 * dynamic history key is read with plain object access, never `getAtPath`.
 */

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

interface ComfyUiConfig {
  apiKey?: string;
  baseUrl: string;
  model: string;
  name?: string;
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

/**
 * Pure, testable without network: the standard ComfyUI txt2img graph in API
 * format (the same shape ComfyUI itself ships as its default example
 * workflow). Node id "9" (SaveImage) is fixed since we build the graph
 * ourselves — no output-node discovery needed.
 */
export function buildWorkflow(
  request: Pick<ImageGenerationRequest, "prompt" | "negativePrompt" | "width" | "height">,
  checkpointModel: string,
): Record<string, unknown> {
  const seed = Math.floor(Math.random() * 2 ** 31);
  return {
    "3": {
      class_type: "KSampler",
      inputs: {
        seed,
        steps: 20,
        cfg: 7,
        sampler_name: "euler",
        scheduler: "normal",
        denoise: 1,
        model: ["4", 0],
        positive: ["6", 0],
        negative: ["7", 0],
        latent_image: ["5", 0],
      },
    },
    "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: checkpointModel } },
    "5": {
      class_type: "EmptyLatentImage",
      inputs: { width: request.width ?? 1024, height: request.height ?? 1024, batch_size: 1 },
    },
    "6": { class_type: "CLIPTextEncode", inputs: { text: request.prompt, clip: ["4", 1] } },
    "7": { class_type: "CLIPTextEncode", inputs: { text: request.negativePrompt ?? "", clip: ["4", 1] } },
    "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 2] } },
    [SAVE_IMAGE_NODE_ID]: { class_type: "SaveImage", inputs: { filename_prefix: "kumanga", images: ["8", 0] } },
  };
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
      supportsReferenceImage: false,
      supportsTransparentBackground: false,
      supportsImageEditing: false,
      reference: { supported: false, transport: "none" },
      referenceImage: false,
      imageVariation: false,
      transparentOutput: false,
      asyncGeneration: true,
    },

    async testConnection(): Promise<ProviderStatus> {
      const response = await boundedFetch(`${base}/system_stats`, { method: "GET", headers: authHeaders(config.apiKey) });
      if (response.ok) return { ok: true };
      return { ok: false, message: await safeErrorMessage(response, config.apiKey) };
    },

    async generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
      const workflow = buildWorkflow(request, config.model);
      request.trace?.("outbound_request_start", {
        provider: "comfyui",
        operation: "generate_image",
        endpointPath: "/prompt",
        model: config.model,
      });
      const started = Date.now();
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
