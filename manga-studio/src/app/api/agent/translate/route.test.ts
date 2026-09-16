import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { resolveProvider } from "@/server/providerSession";
import { createAgentProvider } from "@/agent/providers/registry";
import { AgentModelError } from "@/agent/providers/types";
import { POST } from "./route";

vi.mock("@/server/providerSession", () => ({ resolveProvider: vi.fn() }));
const completeJsonMock = vi.fn();
vi.mock("@/agent/providers/registry", () => ({
  createAgentProvider: vi.fn(() => ({ label: "mock-provider", model: "mock-model", completeJson: completeJsonMock })),
}));
vi.mock("@/server/callLog", () => ({ recordLiveCall: vi.fn(), truncateForLog: (s: string) => s }));

const resolveMock = vi.mocked(resolveProvider);
const createMock = vi.mocked(createAgentProvider);

beforeEach(() => {
  resolveMock.mockReset();
  createMock.mockClear();
  completeJsonMock.mockReset();
});

function request(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/agent/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/agent/translate", () => {
  it("returns translated items matched back by id", async () => {
    resolveMock.mockReturnValue({ config: {} as never, source: "session" });
    completeJsonMock.mockResolvedValue({
      text: JSON.stringify({
        translations: [
          { id: "b1", text: "Hello there" },
          { id: "b2", text: "Goodbye" },
        ],
      }),
    });

    const response = await POST(
      request({
        items: [
          { id: "b1", text: "Xin chào" },
          { id: "b2", text: "Tạm biệt" },
        ],
        targetLanguage: "English",
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.output.translations).toEqual([
      { id: "b1", text: "Hello there" },
      { id: "b2", text: "Goodbye" },
    ]);
  });

  it("returns 503 when no agent provider is connected", async () => {
    resolveMock.mockReturnValue(null);
    const response = await POST(request({ items: [{ id: "b1", text: "Hi" }], targetLanguage: "French" }));
    expect(response.status).toBe(503);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("returns 400 on a malformed request", async () => {
    const response = await POST(request({ items: [], targetLanguage: "French" }));
    expect(response.status).toBe(400);
  });

  it("returns 502 when the model's output fails schema validation", async () => {
    resolveMock.mockReturnValue({ config: {} as never, source: "session" });
    completeJsonMock.mockResolvedValue({ text: JSON.stringify({ nonsense: true }) });
    const response = await POST(request({ items: [{ id: "b1", text: "Hi" }], targetLanguage: "French" }));
    expect(response.status).toBe(502);
  });

  it("maps an AgentModelError to its own safe message and status", async () => {
    resolveMock.mockReturnValue({ config: {} as never, source: "session" });
    completeJsonMock.mockRejectedValue(new AgentModelError("Rate limited, try again", 429));
    const response = await POST(request({ items: [{ id: "b1", text: "Hi" }], targetLanguage: "French" }));
    expect(response.status).toBe(429);
    expect((await response.json()).error).toBe("Rate limited, try again");
  });
});
