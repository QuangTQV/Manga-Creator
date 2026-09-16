import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createAgentProvider } from "@/agent/providers/registry";
import { AGENT_COOKIE, type ProviderConfig } from "@/server/providerSession";
import { sealSecret } from "@/server/secretBox";
import { POST } from "./route";

const testConnectionMock = vi.fn();
vi.mock("@/agent/providers/registry", () => ({
  createAgentProvider: vi.fn(() => ({ testConnection: testConnectionMock })),
}));
const createMock = vi.mocked(createAgentProvider);

const ENV_KEYS = ["APP_ENCRYPTION_KEY"];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  process.env.APP_ENCRYPTION_KEY = "test-encryption-key-for-test-key-route";
  testConnectionMock.mockReset();
  createMock.mockClear();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

function cookieHeader(config: ProviderConfig): string {
  return `${AGENT_COOKIE}=${sealSecret(JSON.stringify(config))}`;
}

function request(body: unknown, cookie?: string): NextRequest {
  return new NextRequest("http://localhost/api/provider/test-key", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

const config: ProviderConfig = {
  kind: "agent",
  providerType: "openai-compatible",
  baseUrl: "https://api.example.com/v1",
  apiKey: "primary-secret",
  model: "some-model",
  backupApiKeys: [{ key: "backup-secret-1" }, { key: "backup-secret-2" }],
};

describe("POST /api/provider/test-key", () => {
  it("returns 503 when no provider is configured", async () => {
    const response = await POST(request({ kind: "agent", target: "primary" }));
    expect(response.status).toBe(503);
  });

  it("tests the primary key when target is 'primary'", async () => {
    testConnectionMock.mockResolvedValue({ ok: true, message: "all good" });
    const response = await POST(request({ kind: "agent", target: "primary" }, cookieHeader(config)));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, status: "Connected" });
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "primary-secret" }));
  });

  it("tests a specific backup key by index, not the primary", async () => {
    testConnectionMock.mockResolvedValue({ ok: true });
    await POST(request({ kind: "agent", target: { backupIndex: 1 } }, cookieHeader(config)));
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "backup-secret-2" }));
    // A one-off attempt never carries the pool fields that produced it.
    const passedConfig = createMock.mock.calls[0][0];
    expect(passedConfig.backupApiKeys).toBeUndefined();
  });

  it("404s for a backup index that doesn't exist", async () => {
    const response = await POST(request({ kind: "agent", target: { backupIndex: 9 } }, cookieHeader(config)));
    expect(response.status).toBe(404);
  });

  it("reports a failed connection without throwing", async () => {
    testConnectionMock.mockResolvedValue({ ok: false, message: "invalid key" });
    const response = await POST(request({ kind: "agent", target: "primary" }, cookieHeader(config)));
    const body = await response.json();
    expect(body).toEqual({ ok: false, error: "invalid key", preview: null });
  });

  it("never leaks the tested key value in the response", async () => {
    testConnectionMock.mockResolvedValue({ ok: true });
    const response = await POST(request({ kind: "agent", target: { backupIndex: 0 } }, cookieHeader(config)));
    const serialized = JSON.stringify(await response.json());
    expect(serialized).not.toContain("backup-secret-1");
    expect(serialized).not.toContain("primary-secret");
  });
});
