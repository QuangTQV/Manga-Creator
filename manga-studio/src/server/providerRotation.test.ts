import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderConfig } from "./providerSession";
import {
  allCoolingDownMessage,
  buildCandidates,
  classifyStatus,
  cooldownRemainingSeconds,
  markCooldown,
  orderCandidates,
  resetRotationStateForTests,
} from "./providerRotation";

function config(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    kind: "image",
    providerType: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com",
    apiKey: "primary-key",
    model: "gemini-2.5-flash-image",
    ...overrides,
  };
}

beforeEach(() => {
  resetRotationStateForTests();
});

describe("classifyStatus", () => {
  it.each([
    [429, "rate_limit"],
    [402, "credit"],
    [401, "auth"],
    [400, "fatal"],
    [404, "fatal"],
    [502, "fatal"],
  ] as const)("maps %d to %s", (status, expected) => {
    expect(classifyStatus(status)).toBe(expected);
  });
});

describe("buildCandidates", () => {
  it("yields the primary alone when there are no backups", () => {
    expect(buildCandidates(config()).map((c) => c.apiKey)).toEqual(["primary-key"]);
  });

  it("yields the primary then each backup key, in order", () => {
    const candidates = buildCandidates(config({ backupApiKeys: ["backup-1", "backup-2"] }));
    expect(candidates.map((c) => c.apiKey)).toEqual(["primary-key", "backup-1", "backup-2"]);
    // Every non-primary candidate carries no further backups of its own —
    // rotating past the primary must not re-expand the same list forever.
    expect(candidates[1].backupApiKeys).toBeUndefined();
  });

  it("skips a backup key identical to the primary or to an earlier backup", () => {
    const candidates = buildCandidates(
      config({ backupApiKeys: ["primary-key", "backup-1", "backup-1", ""] }),
    );
    expect(candidates.map((c) => c.apiKey)).toEqual(["primary-key", "backup-1"]);
  });
});

describe("cooldown tracking", () => {
  it("reports zero remaining for a candidate never marked", () => {
    expect(cooldownRemainingSeconds(config())).toBe(0);
  });

  it("benches a rate-limited candidate for the configured cooldown by default", () => {
    const c = config({ cooldownSeconds: 20 });
    markCooldown(c, "rate_limit");
    const remaining = cooldownRemainingSeconds(c);
    expect(remaining).toBeGreaterThan(15);
    expect(remaining).toBeLessThanOrEqual(20);
  });

  it("prefers a provider-reported Retry-After over the configured cooldown, clamped to 900s", () => {
    const c = config({ cooldownSeconds: 5 });
    markCooldown(c, "rate_limit", 5000); // provider asked for an absurd 5000s
    const remaining = cooldownRemainingSeconds(c);
    expect(remaining).toBeGreaterThan(890);
    expect(remaining).toBeLessThanOrEqual(900);
  });

  it("benches a credit failure far longer than an ordinary rate limit", () => {
    const c = config({ cooldownSeconds: 5 });
    markCooldown(c, "credit");
    expect(cooldownRemainingSeconds(c)).toBeGreaterThan(800);
  });

  it("never benches a fatal failure", () => {
    const c = config();
    markCooldown(c, "fatal");
    expect(cooldownRemainingSeconds(c)).toBe(0);
  });

  it("scopes cooldowns per key, not per provider — a different key on the same provider stays ready", () => {
    const primary = config({ backupApiKeys: ["backup-1"] });
    markCooldown(primary, "rate_limit");
    const backup = buildCandidates(primary)[1];
    expect(cooldownRemainingSeconds(primary)).toBeGreaterThan(0);
    expect(cooldownRemainingSeconds(backup)).toBe(0);
  });

  it("scopes cooldowns per model — the same key on a different model stays ready", () => {
    const onOneModel = config({ model: "model-a" });
    markCooldown(onOneModel, "rate_limit");
    expect(cooldownRemainingSeconds(config({ model: "model-b" }))).toBe(0);
  });
});

describe("orderCandidates", () => {
  it("skips candidates currently cooling down and reports how soon the soonest clears", () => {
    const c = config({ backupApiKeys: ["backup-1", "backup-2"], cooldownSeconds: 30 });
    const candidates = buildCandidates(c);
    markCooldown(candidates[0], "rate_limit"); // bench the primary only
    const { ready, coolingCount, soonestReadySeconds } = orderCandidates(c);
    expect(ready.map((r) => r.apiKey)).toEqual(["backup-1", "backup-2"]);
    expect(coolingCount).toBe(1);
    expect(soonestReadySeconds).toBeGreaterThan(0);
  });

  it("sequential strategy always starts at the primary", () => {
    const c = config({ backupApiKeys: ["backup-1", "backup-2"], rotationStrategy: "sequential" });
    expect(orderCandidates(c).ready.map((r) => r.apiKey)).toEqual([
      "primary-key",
      "backup-1",
      "backup-2",
    ]);
    // Repeated calls never advance — sequential is stateless.
    expect(orderCandidates(c).ready.map((r) => r.apiKey)).toEqual([
      "primary-key",
      "backup-1",
      "backup-2",
    ]);
  });

  it("round_robin (default) advances a shared cursor across consecutive calls", () => {
    const c = config({ backupApiKeys: ["backup-1", "backup-2"] });
    const first = orderCandidates(c).ready.map((r) => r.apiKey);
    const second = orderCandidates(c).ready.map((r) => r.apiKey);
    const third = orderCandidates(c).ready.map((r) => r.apiKey);
    // Three distinct rotations of the same 3-candidate pool, and back to
    // start on the fourth — proves every key gets a turn at the front.
    expect(new Set([first[0], second[0], third[0]]).size).toBe(3);
    expect(orderCandidates(c).ready.map((r) => r.apiKey)).toEqual(first);
  });

  it("random strategy only ever reorders the ready set, never drops or invents one", () => {
    const c = config({ backupApiKeys: ["backup-1", "backup-2"], rotationStrategy: "random" });
    const { ready } = orderCandidates(c);
    expect(ready.map((r) => r.apiKey).sort()).toEqual(["backup-1", "backup-2", "primary-key"]);
  });

  it("does not reorder a single-candidate pool regardless of strategy", () => {
    const c = config({ rotationStrategy: "random" });
    expect(orderCandidates(c).ready.map((r) => r.apiKey)).toEqual(["primary-key"]);
  });
});

describe("allCoolingDownMessage", () => {
  it("reports the total candidate count and a rounded-up wait time", () => {
    expect(allCoolingDownMessage(3, 12.2)).toBe(
      "All 3 configured API key(s) for this provider are cooling down after a recent rate limit/credit failure. Try again in about 13s.",
    );
  });
});

describe("Math.random determinism guard", () => {
  const spy = vi.spyOn(Math, "random");
  afterEach(() => spy.mockRestore());

  it("random strategy with a fixed draw is reproducible", () => {
    // Fisher-Yates with random()=0 always swaps index i with index 0:
    // [p, b1, b2] --i=2--> [b2, b1, p] --i=1--> [b1, b2, p]
    spy.mockReturnValue(0);
    const c = config({ backupApiKeys: ["backup-1", "backup-2"], rotationStrategy: "random" });
    expect(orderCandidates(c).ready.map((r) => r.apiKey)).toEqual([
      "backup-1",
      "backup-2",
      "primary-key",
    ]);
  });
});
