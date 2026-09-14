/**
 * Multi-key rotation for BYOK providers: when a `ProviderConfig` carries
 * `backupApiKeys`, spread requests across the primary key and its backups
 * instead of hammering one key until it fails. Shared by the image
 * (`src/ai/providers/withRotation.ts`) and agent (`src/agent/providers/
 * withRotation.ts`) adapter wrappers — this module knows nothing about
 * HTTP calls or provider SDKs, only about `ProviderConfig` variants, in
 * failure order, and cooldown bookkeeping.
 *
 * In-process only: cooldowns and the round-robin cursor live in memory and
 * reset on restart. That is the whole point locally (`npm run dev` is one
 * long-lived process, this is a real optimization there) and an accepted,
 * documented trade-off on serverless (Vercel keeps a function instance warm
 * across a burst of requests, so it still helps there — it just is not
 * durable state, exactly like the deliberate choice the same pattern makes
 * in the sibling Manga-Translator-Extension project this was ported from).
 */

import {
  DEFAULT_COOLDOWN_SECONDS,
  DEFAULT_ROTATION_STRATEGY,
  type ProviderConfig,
} from "./providerSession";

export type RotationFailure = "rate_limit" | "credit" | "auth" | "fatal";

/** Bounds a provider-reported `Retry-After` so a multi-hour quota reset
 * doesn't bench a key for the rest of the process's life. */
const MAX_RATE_LIMIT_COOLDOWN_SECONDS = 900;
/** An empty/negative balance doesn't clear on a short timer — recheck it
 * far less often than an ordinary rate limit. */
const CREDIT_COOLDOWN_SECONDS = 900;

/**
 * Classify an HTTP status into a rotation decision. Every adapter in this
 * codebase already normalizes provider errors down to a small set of
 * statuses (see gemini.ts / genericRest.ts / agent/providers/http.ts), so
 * this needs no per-provider text matching:
 *
 *   429 → rate_limit  (transient — cool down, try the next candidate)
 *   402 → credit       (account exhausted — cool down much longer)
 *   401 → auth         (this exact key is bad — no point retrying it, but a
 *                        different key/backup may work fine)
 *   anything else → fatal (would fail identically on every candidate — a
 *                        bad prompt, a malformed request, a 5xx from an
 *                        actually-broken endpoint — so don't burn through
 *                        the whole rotation chain pretending it might help)
 */
export function classifyStatus(status: number): RotationFailure {
  if (status === 429) return "rate_limit";
  if (status === 402) return "credit";
  if (status === 401) return "auth";
  return "fatal";
}

/** The `ProviderConfig` variants to try, in configured order: the primary
 * exactly as given, then each backup key. Blank/duplicate backups (already
 * filtered at save time in providerSession.ts, but defended here too) are
 * skipped so a repeated key never wastes a rotation slot retrying itself. */
export function buildCandidates(config: ProviderConfig): ProviderConfig[] {
  const seen = new Set<string>(config.apiKey ? [config.apiKey] : []);
  const candidates: ProviderConfig[] = [config];
  for (const key of config.backupApiKeys ?? []) {
    if (!key || seen.has(key)) continue;
    seen.add(key);
    candidates.push({ ...config, apiKey: key, backupApiKeys: undefined });
  }
  return candidates;
}

// ─── Cooldown tracker ───────────────────────────────────────────────────────
// Keyed by (kind, providerType, model, key) — scoped to the model too, not
// just the account, since several providers (Gemini's free tier included)
// meter rate limits per model: a limit on one model doesn't mean a
// different model on the same key is also out of quota.
const cooldowns = new Map<string, number>(); // key -> epoch ms it clears at

function cooldownKey(config: ProviderConfig): string {
  return `${config.kind}:${config.providerType}:${config.model}:${config.apiKey}`;
}

export function cooldownRemainingSeconds(config: ProviderConfig): number {
  const expiresAt = cooldowns.get(cooldownKey(config));
  if (!expiresAt) return 0;
  return Math.max(0, (expiresAt - Date.now()) / 1000);
}

/** Bench a candidate after a failed attempt. `fatal` failures are never
 * benched — retrying the same request later wouldn't help, and cooling the
 * key down would only block *other*, unrelated requests from using it. */
export function markCooldown(
  config: ProviderConfig,
  failure: RotationFailure,
  retryAfterSeconds?: number,
): void {
  if (failure === "fatal") return;
  const configured = config.cooldownSeconds ?? DEFAULT_COOLDOWN_SECONDS;
  const seconds =
    failure === "credit"
      ? CREDIT_COOLDOWN_SECONDS
      : failure === "rate_limit" && retryAfterSeconds != null
        ? Math.min(Math.max(retryAfterSeconds, 1), MAX_RATE_LIMIT_COOLDOWN_SECONDS)
        : configured;
  cooldowns.set(cooldownKey(config), Date.now() + seconds * 1000);
}

/** Test-only: clear all in-memory rotation state between test cases. */
export function resetRotationStateForTests(): void {
  cooldowns.clear();
  cursors.clear();
}

// ─── Starting order ─────────────────────────────────────────────────────────
// Round-robin cursor per (kind, providerType, model) pool — proactively
// spreads load across every configured key instead of always trying the
// primary first and only reaching backups reactively once it fails. Two
// keys on the same free-tier rate cap effectively double combined
// throughput this way.
const cursors = new Map<string, number>();

function poolKey(config: ProviderConfig): string {
  return `${config.kind}:${config.providerType}:${config.model}`;
}

function nextRoundRobinOffset(pool: string, size: number): number {
  const current = cursors.get(pool) ?? 0;
  cursors.set(pool, current + 1);
  return size > 0 ? current % size : 0;
}

export interface OrderedCandidates {
  /** Candidates not currently cooling down, in the order to try them. */
  ready: ProviderConfig[];
  /** How many configured candidates were skipped for still cooling down. */
  coolingCount: number;
  /** Shortest remaining cooldown among the skipped ones, if any. */
  soonestReadySeconds: number;
}

/**
 * Resolve which candidates to try and in what order. Rotation-on-failure
 * (in the caller's try loop) always walks whatever order results from
 * here — this only decides where to start:
 *
 *   sequential   — always the primary first (simplest, concentrates load).
 *   random       — uniform random order among the ready candidates.
 *   round_robin  — advances a per-pool cursor so consecutive requests fan
 *                  out evenly (the default).
 */
export function orderCandidates(config: ProviderConfig): OrderedCandidates {
  const all = buildCandidates(config);
  const ready: ProviderConfig[] = [];
  let coolingCount = 0;
  let soonestReadySeconds = 0;
  for (const candidate of all) {
    const remaining = cooldownRemainingSeconds(candidate);
    if (remaining > 0) {
      coolingCount++;
      soonestReadySeconds =
        soonestReadySeconds === 0 ? remaining : Math.min(soonestReadySeconds, remaining);
    } else {
      ready.push(candidate);
    }
  }
  if (ready.length <= 1) return { ready, coolingCount, soonestReadySeconds };

  const strategy = config.rotationStrategy ?? DEFAULT_ROTATION_STRATEGY;
  if (strategy === "random") {
    const shuffled = [...ready];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return { ready: shuffled, coolingCount, soonestReadySeconds };
  }
  if (strategy === "sequential") {
    return { ready, coolingCount, soonestReadySeconds };
  }
  const offset = nextRoundRobinOffset(poolKey(config), ready.length);
  const rotated = offset > 0 ? [...ready.slice(offset), ...ready.slice(0, offset)] : ready;
  return { ready: rotated, coolingCount, soonestReadySeconds };
}

/** Message for "every configured key is cooling down" — the one case a
 * rotation wrapper cannot fall through to a real provider error for. */
export function allCoolingDownMessage(total: number, soonestReadySeconds: number): string {
  return (
    `All ${total} configured API key(s) for this provider are cooling down ` +
    `after a recent rate limit/credit failure. Try again in about ` +
    `${Math.ceil(soonestReadySeconds)}s.`
  );
}
