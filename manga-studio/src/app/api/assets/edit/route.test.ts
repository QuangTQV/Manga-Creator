import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import sharp from "sharp";
import { loadStoredAsset } from "@/assets/loadStoredAsset";
import { loadReferences } from "@/ai/generate";
import { createImageProvider } from "@/ai/providerRegistry";
import { resolveProvider } from "@/server/providerSession";
import { POST } from "./route";

vi.mock("@/assets/loadStoredAsset", () => ({ loadStoredAsset: vi.fn() }));
vi.mock("@/ai/generate", () => ({ loadReferences: vi.fn() }));
vi.mock("@/ai/providerRegistry", () => ({ createImageProvider: vi.fn() }));
vi.mock("@/server/providerSession", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/providerSession")>();
  return { ...actual, resolveProvider: vi.fn() };
});
vi.mock("@/storage/objectStore", () => ({ putObject: vi.fn().mockResolvedValue({ url: "https://blob.example/edited.png" }) }));

const loadMock = vi.mocked(loadStoredAsset);
const loadReferencesMock = vi.mocked(loadReferences);
const createProviderMock = vi.mocked(createImageProvider);
const resolveProviderMock = vi.mocked(resolveProvider);

const WIDTH = 4;
const HEIGHT = 4;

async function solidPng(r: number, g: number, b: number, a: number): Promise<Buffer> {
  const raw = Buffer.alloc(WIDTH * HEIGHT * 4);
  for (let i = 0; i < WIDTH * HEIGHT; i++) raw.set([r, g, b, a], i * 4);
  return sharp(raw, { raw: { width: WIDTH, height: HEIGHT, channels: 4 } }).png().toBuffer();
}

/** White (editable) in the top-left half, transparent (protected) elsewhere —
 * matches AssetDetailEditor.tsx's own paint convention. */
async function halfMaskPng(): Promise<string> {
  const raw = Buffer.alloc(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const i = (y * WIDTH + x) * 4;
      if (x < 2) raw.set([255, 255, 255, 255], i);
      else raw.set([0, 0, 0, 0], i);
    }
  }
  const png = await sharp(raw, { raw: { width: WIDTH, height: HEIGHT, channels: 4 } }).png().toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

function request(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/assets/edit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  loadMock.mockReset();
  loadReferencesMock.mockReset();
  createProviderMock.mockReset();
  resolveProviderMock.mockReset();
});

describe("POST /api/assets/edit — mask forwarding to provider.editImage", () => {
  it("passes the painted mask through to provider.editImage as a real PNG, at the source's own dimensions", async () => {
    const sourcePng = await solidPng(200, 50, 50, 255);
    loadMock.mockResolvedValue({ data: sourcePng, mimeType: "image/png" });
    resolveProviderMock.mockReturnValue({ config: { kind: "image", providerType: "comfyui", baseUrl: "https://comfy.example.com", apiKey: "", model: "m" }, source: "session" });

    const editImageMock = vi.fn().mockResolvedValue({ mimeType: "image/png", data: await solidPng(0, 200, 0, 255) });
    createProviderMock.mockReturnValue({
      id: "comfyui",
      label: "ComfyUI",
      model: "m",
      capabilities: { supportsImageEditing: true } as never,
      editImage: editImageMock,
    } as never);

    const response = await POST(
      request({
        sourceUrl: "https://blob.example/source.png",
        maskPng: await halfMaskPng(),
        instruction: "add a hat",
      }),
    );

    expect(response.status).toBe(200);
    expect(editImageMock).toHaveBeenCalledTimes(1);
    const call = editImageMock.mock.calls[0][0];
    expect(call.instruction).toBe("add a hat");
    expect(call.mask).toBeDefined();
    expect(call.mask.mimeType).toBe("image/png");

    // The forwarded mask must decode back to the SAME shape the creator
    // painted (white/opaque left half, transparent right half) at the
    // source image's own pixel dimensions — not a stale/mismatched size.
    const decoded = await sharp(call.mask.data).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(decoded.info.width).toBe(WIDTH);
    expect(decoded.info.height).toBe(HEIGHT);
    const topLeftAlpha = decoded.data[(0 * WIDTH + 0) * 4 + 3];
    const topRightAlpha = decoded.data[(0 * WIDTH + 3) * 4 + 3];
    expect(topLeftAlpha).toBeGreaterThan(200); // editable region: opaque
    expect(topRightAlpha).toBeLessThan(50); // protected region: transparent
  });

  it("still works for a provider that never reads mask (e.g. Gemini) — no behavior change for it", async () => {
    const sourcePng = await solidPng(200, 50, 50, 255);
    loadMock.mockResolvedValue({ data: sourcePng, mimeType: "image/png" });
    resolveProviderMock.mockReturnValue({ config: { kind: "image", providerType: "gemini", baseUrl: "https://x", apiKey: "k", model: "m" }, source: "session" });

    const editImageMock = vi.fn().mockResolvedValue({ mimeType: "image/png", data: await solidPng(0, 200, 0, 255) });
    createProviderMock.mockReturnValue({
      id: "gemini",
      label: "Gemini",
      model: "m",
      capabilities: { supportsImageEditing: true } as never,
      editImage: editImageMock,
    } as never);

    const response = await POST(request({ sourceUrl: "https://blob.example/source.png", maskPng: await halfMaskPng(), instruction: "add a hat" }));
    expect(response.status).toBe(200);
    // Still receives a mask field in the call (harmless — Gemini's real
    // adapter implementation simply never destructures it).
    expect(editImageMock.mock.calls[0][0].mask).toBeDefined();
  });
});

describe("POST /api/assets/edit — extra identity references alongside the edit source", () => {
  it("loads referenceUrls and forwards both the bytes and the URLs to provider.editImage", async () => {
    const sourcePng = await solidPng(200, 50, 50, 255);
    loadMock.mockResolvedValue({ data: sourcePng, mimeType: "image/png" });
    loadReferencesMock.mockResolvedValue([{ mimeType: "image/png", data: Buffer.from("canonical-render") }]);
    resolveProviderMock.mockReturnValue({
      config: { kind: "image", providerType: "gemini", baseUrl: "https://x", apiKey: "k", model: "m" },
      source: "session",
    });

    const editImageMock = vi.fn().mockResolvedValue({ mimeType: "image/png", data: await solidPng(0, 200, 0, 255) });
    createProviderMock.mockReturnValue({
      id: "gemini",
      label: "Gemini",
      model: "m",
      capabilities: { supportsImageEditing: true, supportsReferenceImage: true } as never,
      editImage: editImageMock,
    } as never);

    const response = await POST(
      request({
        sourceUrl: "https://blob.example/source.png",
        maskPng: await halfMaskPng(),
        instruction: "add a hat",
        referenceUrls: ["https://blob.example/character-canonical.png"],
      }),
    );

    expect(response.status).toBe(200);
    expect(loadReferencesMock).toHaveBeenCalledWith(["https://blob.example/character-canonical.png"]);
    const call = editImageMock.mock.calls[0][0];
    expect(call.referenceImages).toEqual([{ mimeType: "image/png", data: Buffer.from("canonical-render") }]);
    expect(call.referenceUrls).toEqual(["https://blob.example/character-canonical.png"]);
  });

  it("never loads or forwards references when the provider does not support them", async () => {
    const sourcePng = await solidPng(200, 50, 50, 255);
    loadMock.mockResolvedValue({ data: sourcePng, mimeType: "image/png" });
    resolveProviderMock.mockReturnValue({
      config: { kind: "image", providerType: "comfyui", baseUrl: "https://comfy.example.com", apiKey: "", model: "m" },
      source: "session",
    });

    const editImageMock = vi.fn().mockResolvedValue({ mimeType: "image/png", data: await solidPng(0, 200, 0, 255) });
    createProviderMock.mockReturnValue({
      id: "comfyui",
      label: "ComfyUI",
      model: "m",
      capabilities: { supportsImageEditing: true, supportsReferenceImage: false } as never,
      editImage: editImageMock,
    } as never);

    const response = await POST(
      request({
        sourceUrl: "https://blob.example/source.png",
        maskPng: await halfMaskPng(),
        instruction: "add a hat",
        referenceUrls: ["https://blob.example/character-canonical.png"],
      }),
    );

    expect(response.status).toBe(200);
    expect(loadReferencesMock).not.toHaveBeenCalled();
    const call = editImageMock.mock.calls[0][0];
    expect(call.referenceImages).toBeUndefined();
    expect(call.referenceUrls).toBeUndefined();
  });
});
