import { beforeEach, describe, expect, it } from "vitest";
import { clearLiveCalls, getLiveCalls, recordLiveCall, resetCallLogForTests, truncateForLog } from "./callLog";

beforeEach(() => {
  resetCallLogForTests();
});

function entry(overrides: Partial<Parameters<typeof recordLiveCall>[1]> = {}) {
  return {
    kind: "image" as const,
    route: "generate",
    startedAt: Date.now(),
    durationMs: 42,
    ok: true,
    request: { prompt: "a manga character" },
    ...overrides,
  };
}

describe("recordLiveCall / getLiveCalls", () => {
  it("returns entries for the session that recorded them, oldest first", () => {
    recordLiveCall("session-a", entry({ request: { prompt: "first" } }));
    recordLiveCall("session-a", entry({ request: { prompt: "second" } }));
    const entries = getLiveCalls("session-a");
    expect(entries.map((e) => e.request.prompt)).toEqual(["first", "second"]);
  });

  it("assigns each entry a unique id", () => {
    const a = recordLiveCall("session-a", entry());
    const b = recordLiveCall("session-a", entry());
    expect(a.id).not.toBe(b.id);
  });

  it("never mixes entries across sessions", () => {
    recordLiveCall("session-a", entry({ request: { prompt: "belongs to A" } }));
    recordLiveCall("session-b", entry({ request: { prompt: "belongs to B" } }));
    expect(getLiveCalls("session-a")).toHaveLength(1);
    expect(getLiveCalls("session-b")).toHaveLength(1);
    expect(getLiveCalls("session-a")[0].request.prompt).toBe("belongs to A");
  });

  it("returns an empty array for a session with no recorded calls", () => {
    expect(getLiveCalls("never-seen")).toEqual([]);
  });

  it("caps entries per session, dropping the oldest first", () => {
    for (let i = 0; i < 45; i++) {
      recordLiveCall("session-a", entry({ request: { prompt: `call-${i}` } }));
    }
    const entries = getLiveCalls("session-a");
    expect(entries.length).toBeLessThanOrEqual(40);
    // The earliest calls (call-0, call-1, ...) were evicted; the most recent survive.
    expect(entries.at(-1)?.request.prompt).toBe("call-44");
    expect(entries.map((e) => e.request.prompt)).not.toContain("call-0");
  });

  it("getLiveCalls returns a copy — mutating the result cannot corrupt the log", () => {
    recordLiveCall("session-a", entry());
    const entries = getLiveCalls("session-a");
    entries.pop();
    expect(getLiveCalls("session-a")).toHaveLength(1);
  });
});

describe("clearLiveCalls", () => {
  it("empties only the given session's entries", () => {
    recordLiveCall("session-a", entry());
    recordLiveCall("session-b", entry());
    clearLiveCalls("session-a");
    expect(getLiveCalls("session-a")).toEqual([]);
    expect(getLiveCalls("session-b")).toHaveLength(1);
  });

  it("is a no-op for a session that was never recorded to", () => {
    expect(() => clearLiveCalls("never-seen")).not.toThrow();
  });
});

describe("truncateForLog", () => {
  it("leaves short text untouched", () => {
    expect(truncateForLog("short prompt")).toBe("short prompt");
  });

  it("truncates long text and notes the original length", () => {
    const long = "x".repeat(5000);
    const result = truncateForLog(long, 100);
    expect(result.startsWith("x".repeat(100))).toBe(true);
    expect(result).toContain("truncated");
    expect(result).toContain("5000 chars total");
  });
});
