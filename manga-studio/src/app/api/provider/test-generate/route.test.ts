import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createImageProvider } from "@/ai/providerRegistry";
import { ProviderError } from "@/ai/types";
import { resolveProvider } from "@/server/providerSession";
import { putObject } from "@/storage/objectStore";
import { POST } from "./route";

vi.mock("@/ai/providerRegistry", () => ({ createImageProvider: vi.fn() }));
vi.mock("@/server/providerSession", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/providerSession")>();
  return { ...actual, resolveProvider: vi.fn() };
});
vi.mock("@/storage/objectStore", () => ({ putObject: vi.fn().mockResolvedValue({ url: "https://blob.example/test.png" }) }));

const createProviderMock = vi.mocked(createImageProvider);
const resolveProviderMock = vi.mocked(resolveProvider);
const putObjectMock = vi.mocked(putObject);

beforeEach(() => {
  vi.clearAllMocks();
  putObjectMock.mockResolvedValue({ url: "https://blob.example/test.png" });
});

function request(): NextRequest {
  return new NextRequest("http://localhost/api/provider/test-generate", { method: "POST" });
}

describe("POST /api/provider/test-generate", () => {
  it("returns 503 when no image provider is configured", async () => {
    resolveProviderMock.mockReturnValue(null);
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(createProviderMock).not.toHaveBeenCalled();
  });

  it("runs a real generation and returns the raw, unprocessed image URL", async () => {
    resolveProviderMock.mockReturnValue({
      config: { kind: "image", providerType: "comfyui", baseUrl: "https://comfy.example.com", apiKey: "", model: "animagine-xl-4.0.safetensors" },
      source: "session",
    });
    const generateImage = vi.fn().mockResolvedValue({ mimeType: "image/png", data: Buffer.from("fake-png") });
    createProviderMock.mockReturnValue({
      id: "comfyui",
      label: "ComfyUI",
      model: "animagine-xl-4.0.safetensors",
      capabilities: {} as never,
      testConnection: vi.fn(),
      generateImage,
    });

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, url: "https://blob.example/test.png", mimeType: "image/png" });
    expect(typeof body.prompt).toBe("string");
    expect(body.prompt.length).toBeGreaterThan(0);
    // Real call, real bytes saved — never routed through background removal
    // or the character-asset contract (that pipeline is what this route
    // exists to bypass while tuning a config).
    expect(generateImage).toHaveBeenCalledTimes(1);
    expect(putObjectMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces a ProviderError's safe message and status without a 500", async () => {
    resolveProviderMock.mockReturnValue({
      config: { kind: "image", providerType: "comfyui", baseUrl: "https://comfy.example.com", apiKey: "", model: "m" },
      source: "session",
    });
    createProviderMock.mockReturnValue({
      id: "comfyui",
      label: "ComfyUI",
      model: "m",
      capabilities: {} as never,
      testConnection: vi.fn(),
      generateImage: vi.fn().mockRejectedValue(new ProviderError("Model or endpoint not found", 404)),
    });

    const response = await POST(request());
    const body = await response.json();
    expect(response.status).toBe(404);
    expect(body).toEqual({ ok: false, error: "Model or endpoint not found" });
    expect(putObjectMock).not.toHaveBeenCalled();
  });

  it("never leaks a raw error message for an unexpected failure", async () => {
    resolveProviderMock.mockReturnValue({
      config: { kind: "image", providerType: "comfyui", baseUrl: "https://comfy.example.com", apiKey: "secret-key", model: "m" },
      source: "session",
    });
    createProviderMock.mockReturnValue({
      id: "comfyui",
      label: "ComfyUI",
      model: "m",
      capabilities: {} as never,
      testConnection: vi.fn(),
      generateImage: vi.fn().mockRejectedValue(new Error("boom with secret-key inside")),
    });

    const response = await POST(request());
    const body = await response.json();
    expect(response.status).toBe(500);
    expect(body).toEqual({ ok: false, error: "Generation failed" });
  });
});
