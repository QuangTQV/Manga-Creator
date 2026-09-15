/**
 * Pure summary of a "generate N candidates" batch — split out of
 * `GeneratorDialog.tsx` so the succeed/fail bookkeeping is unit-testable
 * without a browser, the same reasoning `checkWebtoonCanvasLimit` and
 * `computePrintScale` were pulled out of their own "use client" callers for.
 *
 * Each candidate is an independent `generateImage()` call (no provider
 * supports batching multiple images in one request — see the docstring in
 * `GeneratorDialog.tsx`'s `generate()`), fired with `Promise.allSettled` so
 * one candidate failing never hides the others that succeeded.
 */
export interface CandidateBatchResult<T> {
  /** Every candidate that generated successfully, in request order. */
  succeeded: T[];
  failedCount: number;
  /** True only when EVERY candidate failed — nothing to show at all. */
  allFailed: boolean;
  /** The first rejection's reason, for building an error message/detail
   * view when `allFailed` is true. Undefined when nothing failed. */
  firstFailureReason: unknown;
  /** A soft warning to show alongside a partially-successful batch — null
   * when every candidate succeeded (nothing to warn about) or every
   * candidate failed (the caller shows a hard error instead, not this). */
  partialFailureNote: string | null;
}

export function summarizeCandidateOutcomes<T>(
  outcomes: PromiseSettledResult<T>[],
  requestedCount: number,
): CandidateBatchResult<T> {
  const succeeded = outcomes
    .filter((outcome): outcome is PromiseFulfilledResult<T> => outcome.status === "fulfilled")
    .map((outcome) => outcome.value);
  const failed = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");

  return {
    succeeded,
    failedCount: failed.length,
    allFailed: succeeded.length === 0,
    firstFailureReason: failed[0]?.reason,
    partialFailureNote:
      succeeded.length > 0 && failed.length > 0
        ? `${failed.length} of ${requestedCount} candidate${requestedCount === 1 ? "" : "s"} failed to generate — showing the ${succeeded.length} that succeeded.`
        : null,
  };
}
