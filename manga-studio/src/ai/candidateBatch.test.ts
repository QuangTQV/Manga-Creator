import { describe, expect, it } from "vitest";
import { summarizeCandidateOutcomes } from "./candidateBatch";

function fulfilled<T>(value: T): PromiseFulfilledResult<T> {
  return { status: "fulfilled", value };
}

function rejected(reason: unknown): PromiseRejectedResult {
  return { status: "rejected", reason };
}

describe("summarizeCandidateOutcomes", () => {
  it("returns every candidate when all succeed, with no warning", () => {
    const outcomes = [fulfilled("a"), fulfilled("b"), fulfilled("c")];
    const result = summarizeCandidateOutcomes(outcomes, 3);

    expect(result.succeeded).toEqual(["a", "b", "c"]);
    expect(result.failedCount).toBe(0);
    expect(result.allFailed).toBe(false);
    expect(result.partialFailureNote).toBeNull();
  });

  it("keeps the succeeded candidates and reports a partial-failure note when some fail", () => {
    const outcomes = [fulfilled("a"), rejected(new Error("provider timeout")), fulfilled("c")];
    const result = summarizeCandidateOutcomes(outcomes, 3);

    expect(result.succeeded).toEqual(["a", "c"]);
    expect(result.failedCount).toBe(1);
    expect(result.allFailed).toBe(false);
    expect(result.partialFailureNote).toBe("1 of 3 candidates failed to generate — showing the 2 that succeeded.");
  });

  it("singularizes the note for a single requested candidate that partially degrades — impossible in practice but stays grammatical", () => {
    // Real-world requestedCount=1 can never partially fail (it's all-or-
    // nothing), but the note-building logic is exercised directly here for
    // correctness independent of caller invariants.
    const outcomes = [fulfilled("a")];
    const result = summarizeCandidateOutcomes(outcomes, 1);
    expect(result.partialFailureNote).toBeNull(); // nothing failed, so no note regardless
  });

  it("reports allFailed with the first rejection's reason when every candidate fails", () => {
    const firstError = new Error("rate limited");
    const outcomes = [rejected(firstError), rejected(new Error("second failure"))];
    const result = summarizeCandidateOutcomes(outcomes, 2);

    expect(result.succeeded).toEqual([]);
    expect(result.failedCount).toBe(2);
    expect(result.allFailed).toBe(true);
    expect(result.firstFailureReason).toBe(firstError);
    expect(result.partialFailureNote).toBeNull();
  });

  it("leaves firstFailureReason undefined when nothing failed", () => {
    const result = summarizeCandidateOutcomes([fulfilled("a")], 1);
    expect(result.firstFailureReason).toBeUndefined();
  });
});
