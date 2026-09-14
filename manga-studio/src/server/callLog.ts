/**
 * Live AI call log: an in-memory, per-browser record of what was actually
 * sent to an AI provider and what it sent back — for the "Live AI" panel
 * (`LiveAiPanel.tsx`), not for durable history. Polled, not pushed (see
 * `/api/live/log`): a long-lived SSE/WebSocket connection would get cut off
 * mid-generation by a serverless platform's function-duration limit, so a
 * short poll while the panel is open is the choice that actually works the
 * same in `npm run dev` and on Vercel.
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

interface SessionBucket {
  entries: LiveCallLogEntry[];
  lastTouchedAt: number;
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
    bucket = { entries: [], lastTouchedAt: now };
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
  return full;
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
