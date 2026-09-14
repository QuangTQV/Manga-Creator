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
const imageTypes = ["custom", "gemini", "openai-compatible", "generic-rest"] as const;
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
  backupApiKeys?: string[];
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
  /**
   * Extra keys for the SAME provider/model, tried on rate limit / no
   * credit / auth failure instead of failing the request outright. Multiple
   * free-tier keys on the same provider multiply effective throughput this
   * way, since rotation spreads requests across all of them proactively
   * (see "round_robin" below) rather than only reacting once the primary
   * key starts failing.
   */
  backupApiKeys?: string[];
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
};

// ─── Save payload validation ────────────────────────────────────────────────

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
  backupApiKeys: z.array(z.string().min(4).max(4096)).max(MAX_BACKUP_API_KEYS).optional(),
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
  /** Omitted on save = keep the previously stored backups; `[]` clears them. */
  backupApiKeys: z.array(z.string().min(4).max(4096)).max(MAX_BACKUP_API_KEYS).optional(),
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
  isCustom: boolean,
  custom: CustomApiConfig | undefined,
): string {
  const apiKey = rawApiKey ?? existingApiKey ?? "";
  // Custom APIs with auth mode "none" legitimately have no key.
  if (!apiKey && !(isCustom && custom?.auth.mode === "none")) {
    throw new Error("API key is required");
  }
  return apiKey;
}

/** Drops blanks and anything identical to the primary key — a backup that
 * duplicates the primary would just retry the same rate-limited account. */
function dedupeBackupKeys(
  rawBackups: string[] | undefined,
  existingBackups: string[] | undefined,
  primaryKey: string,
): string[] | undefined {
  const backups = (rawBackups ?? existingBackups ?? [])
    .map((key) => key.trim())
    .filter((key, index, all) => key && key !== primaryKey && all.indexOf(key) === index);
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
  const apiKey = resolveApiKey(payload.apiKey, undefined, isCustom, payload.custom);
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

/**
 * Validate a payload into a full config. `existing` supplies the kept API key
 * (and kept fallback chain) when the user edits other fields without
 * re-entering the secret(s).
 */
export function buildProviderConfig(payload: ConfigPayload, existing: ProviderConfig | null): ProviderConfig {
  const providerType = resolveProviderType(payload.kind, payload.providerType);
  const baseUrl = resolveBaseUrl(providerType, payload.baseUrl);
  const isCustom = providerType === "custom";
  if (isCustom) {
    if (!payload.custom) throw new Error("Custom API configuration is required");
    validateCustomApi(payload.custom, payload.kind === "background" ? "image" : payload.kind);
  }

  const apiKey = resolveApiKey(payload.apiKey, existing?.apiKey, isCustom, payload.custom);
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

export interface ProviderSummary {
  configured: boolean;
  source?: "session" | "deployment";
  providerType?: string;
  name?: string;
  baseUrl?: string;
  model?: string;
  /** Non-secret API description (custom providers) so users can re-edit it. */
  custom?: CustomApiConfig;
  /** How many backup keys are stored — never the keys themselves. */
  backupKeyCount?: number;
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
    backupKeyCount: config.backupApiKeys?.length ?? 0,
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
