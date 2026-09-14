/**
 * A lightweight, non-secret correlation id — one per browser, set by
 * `middleware.ts` on first visit — used ONLY to scope the in-memory Live AI
 * call log (`callLog.ts`) to the browser that made the call. It carries no
 * credentials and needs no encryption, but IS unguessable (128-bit random),
 * because guessing it would let a stranger read another visitor's prompts.
 */

import type { NextRequest } from "next/server";

export const SESSION_TAG_COOKIE = "ms_session";

/** Falls back to a shared bucket in the rare case a request arrives before
 * the cookie round-trips (e.g. the very first request of a fresh browser,
 * before middleware's Set-Cookie has come back) — the call still gets
 * logged, just not attributable to a specific viewer. */
export function readSessionTag(request: NextRequest): string {
  return request.cookies.get(SESSION_TAG_COOKIE)?.value || "unattributed";
}
