import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderConfig } from "@/server/providerSession";
import { createCustomAgentProvider } from "./customAgent";

// The egress boundary's DNS check must not hit the real resolver here —
// these tests stub fetch and exercise timeout/streaming semantics only.
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("custom OpenAI-style agent adapter", () => {
  it("enables Qwen streaming/non-thinking planner mode and parses SSE", async () => {
    let requestBody: Record<string, unknown> | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_url, init: RequestInit) => {
      requestBody = JSON.parse(String(init.body));
      return new Response('data: {"choices":[{"delta":{"content":"{\\"summary\\":\\"fast\\",\\"steps\\":[]}"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', {
        headers: { "content-type": "text/event-stream" },
      });
    }));
    const result = await createCustomAgentProvider(config()).completeJson("Return JSON", "Plan this");
    expect(result.text).toBe('{"summary":"fast","steps":[]}');
    expect(result.responseMode).toBe("stream");
    expect(requestBody).toMatchObject({ stream: true, enable_thinking: false, max_tokens: 2048 });
  });

  it("retries with max_completion_tokens when the provider rejects max_tokens", async () => {
    const requestBodies: Record<string, unknown>[] = [];
    let call = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url, init: RequestInit) => {
      requestBodies.push(JSON.parse(String(init.body)));
      call += 1;
      if (call === 1) {
        return new Response(
          '{"error":{"message":"Unsupported parameter: \'max_tokens\' is not supported with this model. Use \'max_completion_tokens\' instead.","type":"invalid_request_error","param":"max_tokens"}}',
          { status: 400, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"summary":"ok","steps":[]}' }, finish_reason: "stop" }] }), {
        headers: { "content-type": "application/json" },
      });
    }));
    const result = await createCustomAgentProvider(config()).completeJson("Return JSON", "Plan this");
    expect(result.text).toBe('{"summary":"ok","steps":[]}');
    expect(requestBodies).toHaveLength(2);
    expect(requestBodies[0]).toMatchObject({ max_tokens: 2048 });
    expect(requestBodies[1]).toMatchObject({ max_completion_tokens: 2048 });
    expect(requestBodies[1]).not.toHaveProperty("max_tokens");
  });

  it("does not retry a max_tokens-shaped 400 that isn't the max_completion_tokens hint", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response('{"error":{"message":"Invalid request","type":"invalid_request_error"}}', {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    ));
    await expect(createCustomAgentProvider(config()).completeJson("Return JSON", "Plan this")).rejects.toMatchObject({
      safeMessage: expect.stringContaining("Invalid request"),
    });
  });

  it("normalizes its historical CustomApiError timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })));
    const pending = createCustomAgentProvider(config()).completeJson("Return JSON", "Plan this", { timeoutMs: 25 });
    const assertion = expect(pending).rejects.toMatchObject({
      safeMessage: "Agent model timed out while planning.",
      status: 504,
    });
    await vi.advanceTimersByTimeAsync(25);
    await assertion;
  });
});

function config(): ProviderConfig {
  return {
    kind: "agent",
    providerType: "custom",
    name: "Qwen",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    apiKey: "secret-test-key",
    model: "qwen-plus",
    custom: {
      method: "POST",
      auth: { mode: "bearer" },
      headers: [],
      requestTemplate: '{"model":"{{model}}","messages":"{{messages}}","temperature":"{{temperature}}","response_format":{"type":"json_object"}}',
      referenceMode: "none",
      execution: "sync",
      responseTextPath: "choices[0].message.content",
    },
  };
}
