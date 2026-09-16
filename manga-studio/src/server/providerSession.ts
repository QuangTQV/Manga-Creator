/**
 * BYOK provider configuration — the harness does not own a fixed AI vendor.
 *
 * Users configure their own agent + image providers in AI Settings; configs
 * are encrypted into HttpOnly cookies (see secretBox.ts). Resolution order:
 *
 *   1. session (user's BYOK cookie)
 *   2. deployment environment variables (optional operator fallback)
 *   3. not configured
 *
 * Credentials are never stored in project data and never returned to the
 * browser — status endpoints get the summaries built here, which carry no key.
 */

import { z } from "zod";
import type { NextRequest, NextResponse } from "next/server";
import { assertSafeProviderUrl } from "@/ai/security";
import { comfyUiConfigSchema, type ComfyUiExtraConfig } from "./comfyui/config";
import { customApiSchema, validateCustomApi, type CustomApiConfig } from "./customApi/config";
import { isEncryptionConfigured, openSecret, sealSecret } from "./secretBox";

export const AGENT_COOKIE = "ms_agent_provider";
export const IMAGE_COOKIE = "ms_image_provider";
export const BACKGROUND_COOKIE = "ms_background_provider";

export type ProviderKind = "agent" | "image" | "background";

// "custom" is the universal, declarative provider type — presets are
// conveniences layered on top, never the capability boundary.
const agentTypes = ["custom", "openai-compatible", "anthropic-compatible", "gemini"] as const;
// "generic-rest" is a legacy alias for openai-compatible image endpoints.
// "comfyui" is a dedicated coded adapter (local self-hosted ComfyUI) — not
// expressible via "custom" (dynamic prompt_id history key, oversized
// workflow graph); see src/ai/providers/comfyui.ts.
const imageTypes = ["custom", "gemini", "openai-compatible", "generic-rest", "comfyui"] as const;
const backgroundTypes = ["custom", "remove-bg"] as const;

export type AgentProviderType = (typeof agentTypes)[number];
export type ImageProviderType = (typeof imageTypes)[number];

/** Which ready candidate (primary key + backups) a request tries first —
 * rotation-on-failure below always walks the rest in this order afterward. */
export const rotationStrategies = ["round_robin", "random", "sequential"] as const;
export type RotationStrategy = (typeof rotationStrategies)[number];
export const DEFAULT_ROTATION_STRATEGY: RotationStrategy = "round_robin";
export const DEFAULT_COOLDOWN_SECONDS = 15;
export const MAX_BACKUP_API_KEYS = 8;
export const MAX_FALLBACK_PROVIDERS = 3;

/**
 * One backup key, with its own rotation metadata (§Phase 1 rich rotation
 * management). `weight` only matters under the `"random"` rotation
 * strategy — it is the relative chance this key is picked first among the
 * still-ready candidates; absent means 1 (the same as every other key,
 * i.e. today's plain uniform-random behavior). `enabled: false` removes
 * the key from the rotation pool entirely (not just deprioritizes it) —
 * for pausing a key that's out of credit without deleting and re-typing it
 * later, since a stored key value is never sent back to the browser.
 */
export interface BackupKeyEntry {
  key: string;
  weight?: number;
  enabled?: boolean;
}

/**
 * A completely different provider to fall back to after the primary
 * provider (and all of ITS backup keys) are exhausted — not just another
 * key on the same account, a different vendor/endpoint entirely. Can carry
 * its own `backupApiKeys` too, but never its own `fallbackProviders`: the
 * chain is flat (primary → primary's backups → fallback 1 → fallback 1's
 * backups → fallback 2 → ...), never a tree.
 */
export interface FallbackProviderConfig {
  providerType: string;
  name?: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  custom?: CustomApiConfig;
  backupApiKeys?: BackupKeyEntry[];
  // Deliberate scope cut: a ComfyUI fallback gets v1 defaults only (no
  // per-fallback LoRA/sampler tuning) — `comfyui` extras are primary-only
  // for now, same bounded-effort cut fallback custom providers already
  // accept elsewhere in this file.
}

export interface ProviderConfig {
  kind: ProviderKind;
  providerType: string;
  name?: string;
  /** For custom providers this is the full request endpoint URL. */
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Declarative API description — present when providerType === "custom". */
  custom?: CustomApiConfig;
  /** Sampler/LoRA tuning — present only when providerType === "comfyui".
   * Nothing here is secret (unlike backupApiKeys), so it needs no dedicated
   * mutation endpoint: it round-trips through ProviderSummary and is
   * resubmitted wholesale on every save, same as rotationStrategy. */
  comfyui?: ComfyUiExtraConfig;
  /**
   * Extra keys for the SAME provider/model, tried on rate limit / no
   * credit / auth failure instead of failing the request outright. Multiple
   * free-tier keys on the same provider multiply effective throughput this
   * way, since rotation spreads requests across all of them proactively
   * (see "round_robin" below) rather than only reacting once the primary
   * key starts failing.
   */
  backupApiKeys?: BackupKeyEntry[];
  /**
   * Relative chance THIS candidate is picked first under the `"random"`
   * rotation strategy, once `providerRotation.ts`'s `buildCandidates` has
   * flattened the primary/backups/fallbacks into one list — set from the
   * originating `BackupKeyEntry.weight` for a backup candidate; absent
   * (= 1) for the primary and for anything without one, so an all-default
   * pool behaves exactly like the old uniform-random shuffle.
   */
  weight?: number;
  /** Which candidate a request tries first; "round_robin" (default) spreads
   * load evenly across primary + backups instead of hammering the first
   * one until it fails. See providerRotation.ts. */
  rotationStrategy?: RotationStrategy;
  /** Blind cooldown applied when a rate-limited provider sends no
   * `Retry-After` header. A provider-supplied header is preferred when
   * present (see retryAfter.ts), clamped by providerRotation.ts. */
  cooldownSeconds?: number;
  /** Entirely different providers to try, in order, once the primary
   * provider and its own backup keys are all rate limited/out of credit —
   * e.g. Gemini exhausted → fall through to an OpenAI-compatible key. */
  fallbackProviders?: FallbackProviderConfig[];
}

export interface ResolvedProvider {
  config: ProviderConfig;
  source: "session" | "deployment";
}

export type ProviderResolutionTrace = (
  stage: string,
  details?: Record<string, string | number | boolean | undefined>,
) => void;

/** Base URLs users usually don't need to type. */
export const DEFAULT_BASE_URLS: Record<string, string> = {
  gemini: "https://generativelanguage.googleapis.com",
  "anthropic-compatible": "https://api.anthropic.com",
  "remove-bg": "https://api.remove.bg/v1.0/removebg",
  comfyui: "http://127.0.0.1:8188",
};

// ─── Save payload validation ────────────────────────────────────────────────

/** One backup key as sent by the client — see `BackupKeyEntry`'s own
 * docstring for what `weight`/`enabled` mean. `weight` is deliberately a
 * loose range (not just small integers): a creator may reasonably want a
 * 10:1 preference between two keys, not just 1..8-ish ratios. */
const backupKeyEntrySchema = z.object({
  key: z.string().min(4).max(4096),
  weight: z.number().min(0.1).max(100).optional(),
  enabled: z.boolean().optional(),
});

/** A fallback entry is always sent whole on save (no per-field "keep the
 * stored value" merge — the client holds the chain in memory for the
 * editing session, same limitation the primary key already has). */
const fallbackProviderPayloadSchema = z.object({
  providerType: z.string().min(1).max(40),
  name: z.string().max(60).optional(),
  baseUrl: z.string().max(1024).optional(),
  apiKey: z.string().min(4).max(4096).optional(),
  model: z.string().max(200).default(""),
  custom: customApiSchema.optional(),
  backupApiKeys: z.array(backupKeyEntrySchema).max(MAX_BACKUP_API_KEYS).optional(),
});

export type FallbackProviderPayload = z.infer<typeof fallbackProviderPayloadSchema>;

export const configPayloadSchema = z.object({
  kind: z.enum(["agent", "image", "background"]),
  providerType: z.string().min(1).max(40),
  name: z.string().max(60).optional(),
  baseUrl: z.string().max(1024).optional(),
  /** Omitted on save = keep the previously stored key (replace-fields flow). */
  apiKey: z.string().min(4).max(4096).optional(),
  model: z.string().max(200).default(""),
  custom: customApiSchema.optional(),
  /** Sampler/LoRA tuning, providerType === "comfyui" only. Omitted or all-
   * default = keep whatever is already stored (not secret, safe to echo). */
  comfyui: comfyUiConfigSchema.optional(),
  /** Omitted on save = keep the previously stored backups; `[]` clears them.
   * The main AI Settings save no longer sends this (backup keys are now
   * managed live through `/api/provider/backup-keys`) — still accepted here
   * for the fallback-provider editor, which keeps its own bulk textarea. */
  backupApiKeys: z.array(backupKeyEntrySchema).max(MAX_BACKUP_API_KEYS).optional(),
  rotationStrategy: z.enum(rotationStrategies).optional(),
  cooldownSeconds: z.number().min(1).max(900).optional(),
  /** Omitted on save = keep the previously stored fallback chain; `[]` clears it. */
  fallbackProviders: z.array(fallbackProviderPayloadSchema).max(MAX_FALLBACK_PROVIDERS).optional(),
});

export type ConfigPayload = z.infer<typeof configPayloadSchema>;

// ─── Shared field resolution — used for both the primary provider and each
// fallback provider, so every candidate in the rotation chain is validated
// identically (its own SSRF check, its own custom-API mapping, its own
// required key). ────────────────────────────────────────────────────────────

function resolveProviderType(kind: ProviderKind, providerType: string): string {
  const allowed: readonly string[] = kind === "agent" ? agentTypes : kind === "image" ? imageTypes : backgroundTypes;
  if (!allowed.includes(providerType)) {
    throw new Error(`Unsupported ${kind} provider type: ${providerType}`);
  }
  // "generic-rest" is a legacy alias for openai-compatible image endpoints.
  return providerType === "generic-rest" ? "openai-compatible" : providerType;
}

function resolveBaseUrl(providerType: string, rawBaseUrl: string | undefined): string {
  const baseUrl = (rawBaseUrl?.trim() || DEFAULT_BASE_URLS[providerType]) ?? "";
  if (!baseUrl) throw new Error("Base URL is required for this provider type");
  assertSafeProviderUrl(baseUrl); // SSRF guard on every user-supplied endpoint
  return baseUrl.replace(/\/$/, "");
}

function resolveApiKey(
  rawApiKey: string | undefined,
  existingApiKey: string | undefined,
  providerType: string,
  custom: CustomApiConfig | undefined,
): string {
  const apiKey = rawApiKey ?? existingApiKey ?? "";
  // Custom APIs with auth mode "none" legitimately have no key, and ComfyUI
  // has no built-in auth at all (see src/ai/providers/comfyui.ts).
  const keyOptional = (providerType === "custom" && custom?.auth.mode === "none") || providerType === "comfyui";
  if (!apiKey && !keyOptional) {
    throw new Error("API key is required");
  }
  return apiKey;
}

/** Drops blanks and anything identical to the primary key or an earlier
 * entry — a backup that duplicates the primary would just retry the same
 * rate-limited account. Preserves each survivor's `weight`/`enabled`. */
function dedupeBackupKeys(
  rawBackups: BackupKeyEntry[] | undefined,
  existingBackups: BackupKeyEntry[] | undefined,
  primaryKey: string,
): BackupKeyEntry[] | undefined {
  const seen = new Set<string>();
  const backups: BackupKeyEntry[] = [];
  for (const entry of rawBackups ?? existingBackups ?? []) {
    const key = entry.key.trim();
    if (!key || key === primaryKey || seen.has(key)) continue;
    seen.add(key);
    backups.push({ key, weight: entry.weight, enabled: entry.enabled });
  }
  return backups.length > 0 ? backups : undefined;
}

function buildFallbackProviderConfig(kind: ProviderKind, payload: FallbackProviderPayload): FallbackProviderConfig {
  const providerType = resolveProviderType(kind, payload.providerType);
  const baseUrl = resolveBaseUrl(providerType, payload.baseUrl);
  const isCustom = providerType === "custom";
  if (isCustom) {
    if (!payload.custom) throw new Error("Custom API configuration is required for a fallback provider");
    validateCustomApi(payload.custom, kind === "background" ? "image" : kind);
  }
  const apiKey = resolveApiKey(payload.apiKey, undefined, providerType, payload.custom);
  return {
    providerType,
    name: payload.name?.trim() || undefined,
    baseUrl,
    apiKey,
    model: payload.model.trim(),
    custom: isCustom ? payload.custom : undefined,
    backupApiKeys: dedupeBackupKeys(payload.backupApiKeys, undefined, apiKey),
  };
}

/** Collapses an all-unset comfyui payload (steps/cfg/samplerName/scheduler
 * all absent AND no loras) to `undefined` — avoids writing `comfyui: {}`
 * noise into every ComfyUI save for users who never open the Advanced
 * section. */
function normalizeComfyUiConfig(raw: ComfyUiExtraConfig | undefined): ComfyUiExtraConfig | undefined {
  if (!raw) return undefined;
  const loras = raw.loras?.filter((l) => l.name.trim()) ?? [];
  const hasScalar = raw.steps !== undefined || raw.cfg !== undefined || raw.samplerName !== undefined || raw.scheduler !== undefined;
  if (!hasScalar && loras.length === 0) return undefined;
  return { ...raw, loras: loras.length > 0 ? loras : undefined };
}

/**
 * Validate a payload into a full config. `existing` supplies the kept API key
 * (and kept fallback chain) when the user edits other fields without
 * re-entering the secret(s).
 */
export function buildProviderConfig(payload: ConfigPayload, existing: ProviderConfig | null): ProviderConfig {
  const providerType = resolveProviderType(payload.kind, payload.providerType);
  const baseUrl = resolveBaseUrl(providerType, payload.baseUrl);
  const isCustom = providerType === "custom";
  const isComfyUi = providerType === "comfyui";
  if (isCustom) {
    if (!payload.custom) throw new Error("Custom API configuration is required");
    validateCustomApi(payload.custom, payload.kind === "background" ? "image" : payload.kind);
  }

  const apiKey = resolveApiKey(payload.apiKey, existing?.apiKey, providerType, payload.custom);
  const backupApiKeys = dedupeBackupKeys(payload.backupApiKeys, existing?.backupApiKeys, apiKey);
  const fallbackProviders = (payload.fallbackProviders ?? existing?.fallbackProviders ?? []).map((fb) =>
    buildFallbackProviderConfig(payload.kind, fb),
  );

  const config: ProviderConfig = {
    kind: payload.kind,
    providerType,
    name: payload.name?.trim() || undefined,
    baseUrl,
    apiKey,
    model: payload.model.trim() || (payload.kind === "background" ? "background-removal" : ""),
    custom: isCustom ? payload.custom : undefined,
    // Not secret — safe to fall back to whatever is already stored, same as rotationStrategy below.
    comfyui: isComfyUi ? normalizeComfyUiConfig(payload.comfyui) ?? existing?.comfyui : undefined,
    backupApiKeys,
    rotationStrategy: payload.rotationStrategy ?? existing?.rotationStrategy,
    cooldownSeconds: payload.cooldownSeconds ?? existing?.cooldownSeconds,
    fallbackProviders: fallbackProviders.length > 0 ? fallbackProviders : undefined,
  };

  // Cookies cap at ~4KB; fail loudly instead of silently truncating a config.
  if (JSON.stringify(config).length > 3500) {
    throw new Error(
      "Configuration too large — shorten custom request templates/headers, or remove a backup key / fallback provider",
    );
  }
  return config;
}

// ─── Cookie round-trip ──────────────────────────────────────────────────────

export function cookieNameFor(kind: ProviderKind): string {
  return kind === "agent" ? AGENT_COOKIE : kind === "image" ? IMAGE_COOKIE : BACKGROUND_COOKIE;
}

/**
 * A cookie written before backup keys carried weight/enabled metadata
 * stored a plain string per key. Coerce those into the current shape —
 * same tolerant-old-data spirit as `domain/bubbleStyles.ts`'s
 * `normalizeBubbleStyle` — so an existing session keeps working exactly as
 * before (weight 1, enabled) with no forced re-entry; the next save
 * persists the richer shape.
 */
function coerceBackupKeys(raw: unknown): BackupKeyEntry[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  return raw.map((entry) =>
    typeof entry === "string" ? { key: entry, weight: 1, enabled: true } : (entry as BackupKeyEntry),
  );
}

export function readSessionConfig(
  request: NextRequest,
  kind: ProviderKind,
  trace?: ProviderResolutionTrace,
): ProviderConfig | null {
  const sealed = request.cookies.get(cookieNameFor(kind))?.value;
  trace?.("credential_lookup", { kind, cookiePresent: Boolean(sealed) });
  if (!sealed) {
    trace?.("credential_not_found", { kind });
    return null;
  }
  trace?.("encryption_key_checked", { configured: isEncryptionConfigured() });
  const opened = openSecret(sealed);
  if (!opened) {
    trace?.("credential_decryption_failed", { kind });
    return null;
  }
  trace?.("credential_decrypted", { kind });
  try {
    const parsed = JSON.parse(opened) as ProviderConfig;
    parsed.backupApiKeys = coerceBackupKeys(parsed.backupApiKeys);
    parsed.fallbackProviders = parsed.fallbackProviders?.map((fb) => ({
      ...fb,
      backupApiKeys: coerceBackupKeys(fb.backupApiKeys),
    }));
    const hasCredential = Boolean(parsed.apiKey) || parsed.custom?.auth.mode === "none";
    const valid = Boolean(parsed.kind === kind && hasCredential && parsed.baseUrl && parsed.model);
    trace?.(valid ? "credential_deserialized" : "credential_validation_failed", {
      kind,
      providerType: valid ? parsed.providerType : undefined,
    });
    return valid ? parsed : null;
  } catch {
    trace?.("credential_deserialization_failed", { kind });
    return null;
  }
}

export function writeSessionConfig(response: NextResponse, config: ProviderConfig): void {
  response.cookies.set(cookieNameFor(config.kind), sealSecret(JSON.stringify(config)), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export function clearSessionConfig(response: NextResponse, kind: ProviderKind): void {
  response.cookies.set(cookieNameFor(kind), "", { httpOnly: true, path: "/", maxAge: 0 });
}

// ─── Resolution: session first, deployment env second ───────────────────────

export function resolveProvider(
  request: NextRequest,
  kind: ProviderKind,
  trace?: ProviderResolutionTrace,
): ResolvedProvider | null {
  trace?.("provider_resolution_start", { kind });
  const session = readSessionConfig(request, kind, trace);
  if (session) {
    trace?.("provider_config_loaded", { kind, source: "session", providerType: session.providerType });
    return { config: session, source: "session" };
  }
  const env = kind === "agent" ? envAgentConfig() : kind === "image" ? envImageConfig() : envBackgroundConfig();
  if (env) {
    trace?.("provider_config_loaded", { kind, source: "deployment", providerType: env.providerType });
    return { config: env, source: "deployment" };
  }
  trace?.("provider_config_missing", { kind });
  return null;
}

export function envAgentConfig(): ProviderConfig | null {
  const apiKey = process.env.AGENT_API_KEY;
  if (!apiKey) return null;
  return {
    kind: "agent",
    providerType: "openai-compatible",
    baseUrl: (process.env.AGENT_API_BASE_URL || "https://api.deepseek.com").replace(/\/$/, ""),
    apiKey,
    model: process.env.AGENT_MODEL || "deepseek-chat",
  };
}

export function envImageConfig(): ProviderConfig | null {
  const selected = process.env.IMAGE_PROVIDER || "gemini";
  if (selected === "gemini") {
    const apiKey = process.env.GEMINI_API_KEY || process.env.IMAGE_API_KEY;
    if (!apiKey) return null;
    return {
      kind: "image",
      providerType: "gemini",
      baseUrl: (process.env.IMAGE_API_BASE_URL || DEFAULT_BASE_URLS.gemini).replace(/\/$/, ""),
      apiKey,
      model: process.env.IMAGE_MODEL || "gemini-2.5-flash-image",
    };
  }
  const apiKey = process.env.IMAGE_API_KEY;
  const baseUrl = process.env.IMAGE_API_BASE_URL;
  if (!apiKey || !baseUrl) return null;
  return {
    kind: "image",
    providerType: "openai-compatible",
    baseUrl: baseUrl.replace(/\/$/, ""),
    apiKey,
    model: process.env.IMAGE_MODEL || "",
  };
}

export function envBackgroundConfig(): ProviderConfig | null {
  const apiKey = process.env.BACKGROUND_REMOVAL_API_KEY;
  if (!apiKey) return null;
  return {
    kind: "background",
    providerType: process.env.BACKGROUND_REMOVAL_PROVIDER || "remove-bg",
    baseUrl: (process.env.BACKGROUND_REMOVAL_API_BASE_URL || DEFAULT_BASE_URLS["remove-bg"]).replace(/\/$/, ""),
    apiKey,
    model: process.env.BACKGROUND_REMOVAL_MODEL || "background-removal",
  };
}

// ─── Safe status (what the browser is allowed to know) ──────────────────────

/** Safe (non-secret) description of one fallback provider. */
export interface FallbackProviderSummary {
  providerType: string;
  name?: string;
  model: string;
  backupKeyCount: number;
}

/** Safe (non-secret) description of one stored backup key, index-ordered
 * to match the real `backupApiKeys` array — the index IS the handle the
 * `/api/provider/backup-keys` actions address an entry by, since the key
 * value itself is never in here to identify it by. */
export interface BackupKeySummary {
  weight: number;
  enabled: boolean;
}

export interface ProviderSummary {
  configured: boolean;
  source?: "session" | "deployment";
  providerType?: string;
  name?: string;
  baseUrl?: string;
  model?: string;
  /** Non-secret API description (custom providers) so users can re-edit it. */
  custom?: CustomApiConfig;
  /** Sampler/LoRA tuning (comfyui providers) — nothing secret, safe to echo. */
  comfyui?: ComfyUiExtraConfig;
  /** How many backup keys are stored — never the keys themselves. */
  backupKeyCount?: number;
  /** Per-key weight/enabled, index-ordered — see `BackupKeySummary`. */
  backupKeys?: BackupKeySummary[];
  rotationStrategy?: RotationStrategy;
  cooldownSeconds?: number;
  /** Other providers configured to try once the primary is exhausted. */
  fallbackProviders?: FallbackProviderSummary[];
}

/** Never include apiKey, backupApiKeys, or a fallback's apiKey/backupApiKeys
 * here — not even masked/counted-as-keys. */
export function summarize(resolved: ResolvedProvider | null): ProviderSummary {
  if (!resolved) return { configured: false };
  const { config, source } = resolved;
  return {
    configured: true,
    source,
    providerType: config.providerType,
    name: config.name,
    baseUrl: config.baseUrl,
    model: config.model,
    // The custom block is declarative non-secret configuration; the key
    // lives only in ProviderConfig.apiKey, which never enters a summary.
    custom: config.custom,
    comfyui: config.comfyui,
    backupKeyCount: config.backupApiKeys?.length ?? 0,
    backupKeys: config.backupApiKeys?.map((entry) => ({
      weight: entry.weight ?? 1,
      enabled: entry.enabled ?? true,
    })),
    rotationStrategy: config.rotationStrategy ?? DEFAULT_ROTATION_STRATEGY,
    cooldownSeconds: config.cooldownSeconds ?? DEFAULT_COOLDOWN_SECONDS,
    fallbackProviders: config.fallbackProviders?.map((fb) => ({
      providerType: fb.providerType,
      name: fb.name,
      model: fb.model,
      backupKeyCount: fb.backupApiKeys?.length ?? 0,
    })),
  };
}
