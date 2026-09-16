/**
 * Multi-key AND multi-provider rotation for BYOK providers: when a
 * `ProviderConfig` carries `backupApiKeys` and/or `fallbackProviders`,
 * spread requests across the primary key, its backups, and entirely
 * different fallback providers (each with their own backups) instead of
 * hammering one key/vendor until it fails. Shared by the image
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
  type FallbackProviderConfig,
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

function asCandidate(config: ProviderConfig, fields: Partial<ProviderConfig>): ProviderConfig {
  // A candidate is one concrete attempt — never carries the pool fields
  // that produced it, so nothing downstream mistakes it for a sub-pool.
  // `weight` resets to the primary's implicit 1 (undefined) unless `fields`
  // explicitly sets it from the backup entry that produced this candidate.
  return { ...config, backupApiKeys: undefined, fallbackProviders: undefined, weight: undefined, ...fields };
}

function fallbackAsConfig(config: ProviderConfig, fallback: FallbackProviderConfig): ProviderConfig {
  return asCandidate(config, {
    providerType: fallback.providerType,
    name: fallback.name,
    baseUrl: fallback.baseUrl,
    apiKey: fallback.apiKey,
    model: fallback.model,
    custom: fallback.custom,
  });
}

/**
 * The `ProviderConfig` variants to try, in configured order: the primary
 * exactly as given, then each of its backup keys, then each fallback
 * provider (a different vendor/endpoint entirely) with each of ITS backup
 * keys in turn.
 *
 * A `(providerType, model, key)` triple is only ever yielded once —
 * retrying the exact same account *and* model under a different label
 * wastes a rotation slot instead of reaching fresh quota, so duplicates
 * anywhere in the chain are skipped after the first. The same key against
 * a *different* model is NOT a duplicate (some providers meter rate limits
 * per model). A key-less candidate (custom API, auth mode "none") is never
 * treated as a duplicate of another key-less one — an empty key doesn't
 * identify an account.
 */
export function buildCandidates(config: ProviderConfig): ProviderConfig[] {
  const seen = new Set<string>();
  const candidates: ProviderConfig[] = [];

  function add(candidate: ProviderConfig): void {
    if (candidate.apiKey) {
      const identity = `${candidate.providerType}:${candidate.model}:${candidate.apiKey}`;
      if (seen.has(identity)) return;
      seen.add(identity);
    }
    candidates.push(candidate);
  }

  add(asCandidate(config, {}));
  for (const entry of config.backupApiKeys ?? []) {
    // enabled: false pulls the key out of the pool entirely — not just
    // deprioritized, never tried at all — so a creator can pause a key
    // that's out of credit without deleting and re-typing it later.
    if (entry.key && entry.enabled !== false) add(asCandidate(config, { apiKey: entry.key, weight: entry.weight }));
  }
  for (const fallback of config.fallbackProviders ?? []) {
    const base = fallbackAsConfig(config, fallback);
    add(base);
    for (const entry of fallback.backupApiKeys ?? []) {
      if (entry.key && entry.enabled !== false) add({ ...base, apiKey: entry.key, weight: entry.weight });
    }
  }
  return candidates;
}

/**
 * Given a failure on `ready[failedIndex]`, the next index to try — or -1 if
 * rotation should stop. Non-fatal failures (rate limit / credit / bad key)
 * always advance to the very next ready candidate, whatever provider it is.
 * A `fatal` failure (would repeat identically on any OTHER key for the SAME
 * provider — same request, same model) only continues if a LATER candidate
 * is a genuinely different provider; a fatal fallback misconfiguration must
 * not block trying an unrelated fallback that comes after it, but a fatal
 * primary failure must not waste every one of the primary's own backup
 * keys repeating the exact same doomed request.
 */
export function nextCandidateIndex(
  ready: ProviderConfig[],
  failedIndex: number,
  failure: RotationFailure,
): number {
  if (failedIndex >= ready.length - 1) return -1;
  if (failure !== "fatal") return failedIndex + 1;
  return ready.findIndex((c, j) => j > failedIndex && c.providerType !== ready[failedIndex].providerType);
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
// Round-robin cursor per `kind` (agent/image) — proactively spreads load
// across every configured key AND fallback provider instead of always
// trying the primary first and only reaching backups/fallbacks reactively
// once it fails. Two keys on the same free-tier rate cap effectively double
// combined throughput this way. Keyed by `kind` alone (not provider/model,
// now that the pool can span several providers): a session has exactly one
// configured rotation pool per kind, so this is already a stable identity.
const cursors = new Map<string, number>();

function poolKey(config: ProviderConfig): string {
  return config.kind;
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
 * A weighted random permutation: repeatedly draw one remaining candidate
 * proportional to its own `weight` (default 1), append it, remove it,
 * repeat. When every candidate's weight is equal (today's default — no
 * `BackupKeyEntry.weight` set anywhere) this reduces to a plain uniform
 * shuffle, byte-for-byte equivalent in distribution to the Fisher-Yates it
 * replaces — weight only changes behavior once a creator actually sets one.
 */
function weightedShuffle(items: ProviderConfig[]): ProviderConfig[] {
  const remaining = [...items];
  const result: ProviderConfig[] = [];
  while (remaining.length > 0) {
    const weights = remaining.map((item) => Math.max(0.0001, item.weight ?? 1));
    const total = weights.reduce((sum, w) => sum + w, 0);
    let draw = Math.random() * total;
    let index = 0;
    for (; index < weights.length - 1; index++) {
      draw -= weights[index];
      if (draw < 0) break;
    }
    result.push(remaining[index]);
    remaining.splice(index, 1);
  }
  return result;
}

/**
 * Resolve which candidates to try and in what order. Rotation-on-failure
 * (in the caller's try loop) always walks whatever order results from
 * here — this only decides where to start:
 *
 *   sequential   — always the primary first (simplest, concentrates load).
 *   random       — weighted random order among the ready candidates (see
 *                  `weightedShuffle`); uniform when no weight is set.
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
    return { ready: weightedShuffle(ready), coolingCount, soonestReadySeconds };
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
    `All ${total} configured API key(s)/provider(s) are cooling down after ` +
    `a recent rate limit/credit failure. Try again in about ` +
    `${Math.ceil(soonestReadySeconds)}s.`
  );
}
