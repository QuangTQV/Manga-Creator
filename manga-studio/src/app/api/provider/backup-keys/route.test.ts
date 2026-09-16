import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { AGENT_COOKIE, type ProviderConfig } from "@/server/providerSession";
import { sealSecret } from "@/server/secretBox";
import { POST } from "./route";

const ENV_KEYS = ["APP_ENCRYPTION_KEY", "NODE_ENV"];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  process.env.APP_ENCRYPTION_KEY = "test-encryption-key-for-backup-keys-route";
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

/** A real session cookie header, same as a browser would send. */
function cookieHeader(config: ProviderConfig): string {
  return `${AGENT_COOKIE}=${sealSecret(JSON.stringify(config))}`;
}

function request(body: unknown, cookie?: string): NextRequest {
  return new NextRequest("http://localhost/api/provider/backup-keys", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

const baseConfig: ProviderConfig = {
  kind: "agent",
  providerType: "openai-compatible",
  baseUrl: "https://api.example.com/v1",
  apiKey: "primary-secret",
  model: "some-model",
};

describe("POST /api/provider/backup-keys", () => {
  it("404s when no provider is configured yet", async () => {
    const response = await POST(request({ kind: "agent", action: "add", key: "backup-secret-1" }));
    expect(response.status).toBe(404);
  });

  it("adds a new backup key and reflects it in the safe summary", async () => {
    const response = await POST(
      request({ kind: "agent", action: "add", key: "backup-secret-1" }, cookieHeader(baseConfig)),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.backupKeys).toEqual([{ weight: 1, enabled: true }]);
    // Never the key value, in any form.
    expect(JSON.stringify(body)).not.toContain("backup-secret-1");
    expect(JSON.stringify(body)).not.toContain("primary-secret");
  });

  it("rejects a duplicate of the primary key or an existing backup", async () => {
    const withOne: ProviderConfig = { ...baseConfig, backupApiKeys: [{ key: "backup-secret-1" }] };
    const dupOfBackup = await POST(
      request({ kind: "agent", action: "add", key: "backup-secret-1" }, cookieHeader(withOne)),
    );
    expect(dupOfBackup.status).toBe(400);

    const dupOfPrimary = await POST(
      request({ kind: "agent", action: "add", key: "primary-secret" }, cookieHeader(baseConfig)),
    );
    expect(dupOfPrimary.status).toBe(400);
  });

  it("rejects adding past the configured cap", async () => {
    const full: ProviderConfig = {
      ...baseConfig,
      backupApiKeys: Array.from({ length: 8 }, (_, i) => ({ key: `backup-${i}` })),
    };
    const response = await POST(request({ kind: "agent", action: "add", key: "one-too-many" }, cookieHeader(full)));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/up to 8/);
  });

  it("updates weight and enabled at an index without touching the key value", async () => {
    const withOne: ProviderConfig = { ...baseConfig, backupApiKeys: [{ key: "backup-secret-1" }] };
    const response = await POST(
      request({ kind: "agent", action: "update", index: 0, weight: 4, enabled: false }, cookieHeader(withOne)),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.backupKeys).toEqual([{ weight: 4, enabled: false }]);
  });

  it("404s updating an out-of-range index", async () => {
    const response = await POST(
      request({ kind: "agent", action: "update", index: 5, weight: 2 }, cookieHeader(baseConfig)),
    );
    expect(response.status).toBe(404);
  });

  it("removes the entry at an index", async () => {
    const withTwo: ProviderConfig = {
      ...baseConfig,
      backupApiKeys: [{ key: "backup-secret-1" }, { key: "backup-secret-2" }],
    };
    const response = await POST(request({ kind: "agent", action: "remove", index: 0 }, cookieHeader(withTwo)));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.backupKeys).toHaveLength(1);
  });

  it("reorders two entries", async () => {
    const withThree: ProviderConfig = {
      ...baseConfig,
      backupApiKeys: [
        { key: "backup-secret-1", weight: 1 },
        { key: "backup-secret-2", weight: 2 },
        { key: "backup-secret-3", weight: 3 },
      ],
    };
    const response = await POST(
      request({ kind: "agent", action: "reorder", fromIndex: 0, toIndex: 2 }, cookieHeader(withThree)),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    // backup-1 (weight 1) moved to the end; 2 and 3 shift up.
    expect(body.backupKeys.map((b: { weight: number }) => b.weight)).toEqual([2, 3, 1]);
  });

  it("persists the change in a real cookie a later request can read back", async () => {
    const first = await POST(
      request({ kind: "agent", action: "add", key: "backup-secret-1" }, cookieHeader(baseConfig)),
    );
    const setCookie = first.cookies.get(AGENT_COOKIE)?.value;
    expect(setCookie).toBeTruthy();

    const second = await POST(
      request({ kind: "agent", action: "update", index: 0, weight: 7 }, `${AGENT_COOKIE}=${setCookie}`),
    );
    expect(second.status).toBe(200);
    const body = await second.json();
    expect(body.backupKeys).toEqual([{ weight: 7, enabled: true }]);
  });
});
