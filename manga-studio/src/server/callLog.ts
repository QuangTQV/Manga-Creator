/**
 * Live AI call log: an in-memory, per-browser record of what was actually
 * sent to an AI provider and what it sent back — for the "Live AI" panel
 * (`LiveAiPanel.tsx`), not for durable history. Polled, not pushed (see
 * `/api/live/log`): a long-lived SSE/WebSocket connection would get cut off
 * mid-generation by a serverless platform's function-duration limit, so a
 * short poll while the panel is open is the choice that actually works the
 * same in `npm run dev` and on Vercel.
 *
 * Also maintains `UsageStats` — call counts/durations by provider+model,
 * since the server process started. Deliberately never a dollar figure:
 * BYOK means this process only ever sees the call itself, never a bill, so
 * a "cost" number here would just be a made-up estimate wearing a real
 * one's clothes. Unlike the 40-entry `entries` ring buffer, usage counters
 * are never trimmed — only reset by a server restart or (for tests)
 * `resetCallLogForTests`.
 *
 * Scoped by `sessionTag` (see `sessionTag.ts`) so one visitor's prompts are
 * never visible to another's Live AI panel on a shared deployment.
 *
 * In-process only, like `providerRotation.ts`'s cooldown tracker: resets on
 * restart, and idle session buckets are evicted so a long-running server
 * doesn't accumulate memory from visitors who never come back.
 */

import { randomUUID } from "node:crypto";

export type LiveCallKind = "image" | "agent";

export interface LiveCallLogEntry {
  id: string;
  kind: LiveCallKind;
  /** Which route made the call, e.g. "generate", "agent", "agent-direct". */
  route: string;
  provider?: string;
  model?: string;
  startedAt: number; // epoch ms
  durationMs: number;
  ok: boolean;
  /** What was sent — redacted/truncated by the caller before logging. */
  request: Record<string, unknown>;
  /** What came back, when ok. */
  response?: Record<string, unknown>;
  /** What came back, when not ok. */
  error?: { message: string; status?: number };
}

const MAX_ENTRIES_PER_SESSION = 40;
/** Evict a session's bucket after this long with no activity and nobody
 * polling it — bounds memory for a server left running for days. */
const MAX_IDLE_MS = 2 * 60 * 60 * 1000;
/** Cap on any single string field stored — the point is to see what was
 * sent, not to keep an unbounded transcript archive in server memory. */
const DEFAULT_TRUNCATE_LENGTH = 4000;

export interface ProviderUsageStats {
  calls: number;
  ok: number;
  failed: number;
  totalDurationMs: number;
}

export interface UsageStats {
  /** Since the server process started (or the session bucket was last
   * evicted) — NOT a durable historical ledger. A real cost figure isn't
   * knowable from here at all: BYOK means this process never sees a bill,
   * only call counts and durations, so this deliberately never claims a
   * dollar amount. */
  since: number; // epoch ms
  totalCalls: number;
  totalOk: number;
  totalFailed: number;
  totalDurationMs: number;
  /** Keyed by "kind/route/provider/model" — fine-grained enough to see
   * which specific provider or model is actually absorbing the traffic
   * when rotation is spreading calls across several. */
  byKey: Record<string, ProviderUsageStats & { kind: LiveCallKind; route: string; provider?: string; model?: string }>;
}

interface SessionBucket {
  entries: LiveCallLogEntry[];
  usage: UsageStats;
  lastTouchedAt: number;
}

function emptyUsage(): UsageStats {
  return { since: Date.now(), totalCalls: 0, totalOk: 0, totalFailed: 0, totalDurationMs: 0, byKey: {} };
}

const buckets = new Map<string, SessionBucket>();

function evictStaleBuckets(now: number): void {
  for (const [tag, bucket] of buckets) {
    if (now - bucket.lastTouchedAt > MAX_IDLE_MS) buckets.delete(tag);
  }
}

function bucketFor(sessionTag: string): SessionBucket {
  const now = Date.now();
  evictStaleBuckets(now);
  let bucket = buckets.get(sessionTag);
  if (!bucket) {
    bucket = { entries: [], usage: emptyUsage(), lastTouchedAt: now };
    buckets.set(sessionTag, bucket);
  }
  bucket.lastTouchedAt = now;
  return bucket;
}

export function recordLiveCall(sessionTag: string, entry: Omit<LiveCallLogEntry, "id">): LiveCallLogEntry {
  const full: LiveCallLogEntry = { id: randomUUID(), ...entry };
  const bucket = bucketFor(sessionTag);
  bucket.entries.push(full);
  if (bucket.entries.length > MAX_ENTRIES_PER_SESSION) bucket.entries.shift();

  const usage = bucket.usage;
  usage.totalCalls += 1;
  usage.totalDurationMs += entry.durationMs;
  if (entry.ok) usage.totalOk += 1;
  else usage.totalFailed += 1;
  const key = `${entry.kind}/${entry.route}/${entry.provider ?? "—"}/${entry.model ?? "—"}`;
  const perKey = usage.byKey[key] ?? {
    kind: entry.kind,
    route: entry.route,
    provider: entry.provider,
    model: entry.model,
    calls: 0,
    ok: 0,
    failed: 0,
    totalDurationMs: 0,
  };
  perKey.calls += 1;
  perKey.totalDurationMs += entry.durationMs;
  if (entry.ok) perKey.ok += 1;
  else perKey.failed += 1;
  usage.byKey[key] = perKey;

  return full;
}

/** Since-server-start usage counts for this session, broken down by
 * provider/model — see UsageStats for why this is never a dollar cost. */
export function getUsageStats(sessionTag: string): UsageStats {
  return structuredClone(buckets.get(sessionTag)?.usage ?? emptyUsage());
}

/** Oldest first — the order a log/timeline reads naturally. */
export function getLiveCalls(sessionTag: string): LiveCallLogEntry[] {
  return [...(buckets.get(sessionTag)?.entries ?? [])];
}

export function clearLiveCalls(sessionTag: string): void {
  const bucket = buckets.get(sessionTag);
  if (bucket) bucket.entries = [];
}

export function truncateForLog(text: string, max: number = DEFAULT_TRUNCATE_LENGTH): string {
  return text.length > max ? `${text.slice(0, max)}\n… [truncated — ${text.length} chars total]` : text;
}

/** Test-only: clear all in-memory state between test cases. */
export function resetCallLogForTests(): void {
  buckets.clear();
}
