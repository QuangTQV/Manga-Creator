import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { IMAGE_COOKIE, type ProviderConfig } from "@/server/providerSession";
import { sealSecret } from "@/server/secretBox";
import { POST } from "./route";

const ENV_KEYS = ["APP_ENCRYPTION_KEY", "NODE_ENV", "ALLOW_PRIVATE_NETWORKS"];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  process.env.APP_ENCRYPTION_KEY = "test-encryption-key-for-object-info-route";
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.unstubAllGlobals();
});

function cookieHeader(config: ProviderConfig): string {
  return `${IMAGE_COOKIE}=${sealSecret(JSON.stringify(config))}`;
}

function request(body: unknown, cookie?: string): NextRequest {
  return new NextRequest("http://localhost/api/provider/comfyui-object-info", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

const comfyUiConfig: ProviderConfig = {
  kind: "image",
  providerType: "comfyui",
  baseUrl: "https://comfy.example.com",
  apiKey: "",
  model: "sd_xl_base_1.0.safetensors",
};

const openAiConfig: ProviderConfig = {
  kind: "image",
  providerType: "openai-compatible",
  baseUrl: "https://api.example.com/v1",
  apiKey: "sk-test",
  model: "gpt-image-1",
};

describe("POST /api/provider/comfyui-object-info", () => {
  it("returns an empty list when nothing is configured", async () => {
    const response = await POST(request({ kind: "image", nodeClass: "LoraLoader", inputName: "lora_name" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ options: [] });
  });

  it("returns an empty list for a non-comfyui provider, never calling out", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const response = await POST(
      request({ kind: "image", nodeClass: "LoraLoader", inputName: "lora_name" }, cookieHeader(openAiConfig)),
    );
    expect(await response.json()).toEqual({ options: [] });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fetches and returns the LoRA option list from ComfyUI's object_info", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response(
        JSON.stringify({ LoraLoader: { input: { required: { lora_name: [["a.safetensors", "b.safetensors"]] } } } }),
        { status: 200 },
      );
    });
    const response = await POST(
      request({ kind: "image", nodeClass: "LoraLoader", inputName: "lora_name" }, cookieHeader(comfyUiConfig)),
    );
    expect(await response.json()).toEqual({ options: ["a.safetensors", "b.safetensors"] });
    expect(calls.some((url) => url.includes("/object_info/LoraLoader"))).toBe(true);
  });

  it("returns an empty list, not an error, when the response shape is malformed", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ unexpected: true }), { status: 200 }));
    const response = await POST(
      request({ kind: "image", nodeClass: "ControlNetLoader", inputName: "control_net_name" }, cookieHeader(comfyUiConfig)),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ options: [] });
  });

  it("returns an empty list, not an error, when ComfyUI is unreachable", async () => {
    vi.stubGlobal("fetch", async () => new Response("nope", { status: 500 }));
    const response = await POST(
      request({ kind: "image", nodeClass: "LoraLoader", inputName: "lora_name" }, cookieHeader(comfyUiConfig)),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ options: [] });
  });

  it("rejects an invalid nodeClass/inputName combination before any network call", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const response = await POST(
      request({ kind: "image", nodeClass: "SomethingElse", inputName: "lora_name" }, cookieHeader(comfyUiConfig)),
    );
    expect(await response.json()).toEqual({ options: [] });
    expect(fetch).not.toHaveBeenCalled();
  });
});
