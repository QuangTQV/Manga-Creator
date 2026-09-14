/**
 * Shared helper for reading a provider's `Retry-After` response header
 * (RFC 7231) off a 429. Providers send either a delta-seconds integer or an
 * HTTP-date; this normalizes both. Returns undefined if the header is
 * absent or unparseable, so callers fall back to their own default cooldown
 * instead of guessing.
 */
export function parseRetryAfterSeconds(response: Response): number | undefined {
  const header = response.headers.get("Retry-After")?.trim();
  if (!header) return undefined;

  const asSeconds = Number(header);
  if (Number.isFinite(asSeconds)) return Math.max(0, asSeconds);

  const asDate = Date.parse(header);
  if (!Number.isNaN(asDate)) return Math.max(0, (asDate - Date.now()) / 1000);

  return undefined;
}
