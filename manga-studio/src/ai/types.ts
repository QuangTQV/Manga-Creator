/**
 * Image-generation provider abstraction. The editor never talks to a
 * provider directly — the browser calls our server API, which resolves a
 * provider adapter from environment configuration. Adapters translate the
 * internal request model into provider-specific calls.
 */

export type GeneratedAssetType =
  | "character"
  | "character-pose"
  | "character-expression"
  | "background"
  | "prop"
  /** A manga-language visual: emotion mark, decoration, custom bubble shape. */
  | "manga-effect"
  /** A screentone overlay: texture, atmosphere, decorative or repeating pattern. */
  | "tone";

export type GenerationTraceDetails = Record<string, string | number | boolean | undefined>;
export type GenerationTrace = (stage: string, details?: GenerationTraceDetails) => void;

export interface ImageGenerationRequest {
  prompt: string;
  negativePrompt?: string;
  assetType: GeneratedAssetType;
  width?: number;
  height?: number;
  /** Ask capable providers for real alpha output; post-processing still verifies it. */
  transparentBackground?: boolean;
  /** Raw reference images (already fetched & validated by the server layer). */
  referenceImages?: { mimeType: string; data: Buffer }[];
  /** The validated storage URLs of those references (custom APIs in URL mode). */
  referenceUrls?: string[];
  /** A structural/pose control image (ComfyUI ControlNet), purpose-distinct
   * from `referenceImages` (identity/style/layout) — deliberately its own
   * field, not folded into that array. The user supplies this already
   * pre-processed (e.g. an OpenPose skeleton render); no adapter runs any
   * preprocessing itself. Ignored by every adapter except ComfyUI. */
  controlImage?: { mimeType: string; data: Buffer };
  /** Server-only observability hook. It is never serialized or exposed to providers. */
  trace?: GenerationTrace;
}

export interface ImageGenerationResult {
  mimeType: string;
  data: Buffer;
}

export interface ImageEditRequest {
  instruction: string;
  image: { mimeType: string; data: Buffer; url?: string };
  /** White = editable, black = protected, at the source image's own pixel
   * dimensions. Optional and purely additive: existing adapters (Gemini,
   * customImage) never read it — they rely entirely on the caller's own
   * post-hoc pixel compositing (`assets/localEdit.ts`) for locality.
   * Adapters that understand real provider-side masking (ComfyUI) can use
   * it for genuinely region-limited inpainting instead. */
  mask?: { mimeType: string; data: Buffer };
  /** Extra identity/style references sent ALONGSIDE the edit source (e.g. a
   * character's existing canonical render, so the provider has a stronger
   * identity anchor than the edit source alone) — same shape/purpose as
   * `ImageGenerationRequest.referenceImages`/`referenceUrls`, kept as its
   * own pair of fields since editing's primary "reference" is `image`
   * itself. Optional: adapters that have no slot for a second reference
   * during an edit (e.g. ComfyUI, whose edit graph already spends its one
   * image input on the edit source) may ignore it. */
  referenceImages?: { mimeType: string; data: Buffer }[];
  referenceUrls?: string[];
  trace?: GenerationTrace;
}

/** How an adapter physically transports reference images to the provider. */
export type ReferenceTransport =
  | "none"
  | "json-inline-base64"
  | "multipart-file"
  | "url"
  | "provider-native";

/**
 * Reference-image capability contract. `supported: true` is a PROMISE: the
 * adapter must really transmit the image (contract tests enforce it) — never
 * a UI permission slip alone.
 */
export interface ReferenceImageCapability {
  supported: boolean;
  transport: ReferenceTransport;
  maxImages?: number;
  acceptedMimeTypes?: string[];
  /** "edit" = references switch the call to the provider's edit endpoint. */
  endpointMode?: "generation" | "edit" | "same-endpoint";
}

export interface ProviderCapabilities {
  textToImage: boolean;
  /** Canonical capability names used by the processing cascade. */
  supportsReferenceImage: boolean;
  supportsTransparentBackground: boolean;
  supportsImageEditing: boolean;
  /** Reference transport contract — the binding behind supportsReferenceImage. */
  reference: ReferenceImageCapability;
  /** Compatibility aliases retained for existing clients and stored tests. */
  referenceImage: boolean;
  imageVariation: boolean;
  transparentOutput: boolean;
  asyncGeneration: boolean;
  /** A second, purpose-distinct structural/pose control image (ComfyUI
   * ControlNet) — optional so every other adapter is unaffected. */
  supportsControlImage?: boolean;
}

export interface ProviderStatus {
  ok: boolean;
  message?: string;
}

export interface ImageGenerationProvider {
  id: string;
  label: string;
  model: string;
  capabilities: ProviderCapabilities;
  testConnection(): Promise<ProviderStatus>;
  generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult>;
  editImage?(request: ImageEditRequest): Promise<ImageGenerationResult>;
}

/** Thrown by adapters; `safeMessage` is what may reach the browser. */
export class ProviderError extends Error {
  readonly safeMessage: string;
  readonly status: number;
  readonly details?: Record<string, string | number | boolean>;
  /** Provider-reported `Retry-After`, when it sent one on a 429 — lets
   * rotation cool down for the real duration instead of a blind guess. */
  readonly retryAfterSeconds?: number;

  constructor(
    safeMessage: string,
    status = 502,
    details?: Record<string, string | number | boolean>,
    retryAfterSeconds?: number,
  ) {
    super(safeMessage);
    this.safeMessage = safeMessage;
    this.status = status;
    this.details = details;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
