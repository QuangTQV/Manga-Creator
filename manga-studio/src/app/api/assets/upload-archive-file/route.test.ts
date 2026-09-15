import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { putObject } from "@/storage/objectStore";
import { POST } from "./route";

vi.mock("@/storage/objectStore", () => ({ putObject: vi.fn() }));

const putMock = vi.mocked(putObject);

beforeEach(() => {
  putMock.mockReset();
});

function requestWithFile(bytes: number[], filename = "file"): NextRequest {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)]), filename);
  return new NextRequest("http://localhost/api/assets/upload-archive-file", { method: "POST", body: form });
}

describe("POST /api/assets/upload-archive-file", () => {
  it("restores a PNG by its own magic bytes, unprocessed, and never re-derives its type from the filename", async () => {
    putMock.mockResolvedValue({ url: "https://blob.example/restored/abc.png" });
    const png = [0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0];

    const response = await POST(requestWithFile(png, "definitely-not-a-font.ttf"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url: "https://blob.example/restored/abc.png" });
    expect(putMock).toHaveBeenCalledWith(expect.stringMatching(/^restored\/.+\.png$/), Buffer.from(png), "image/png");
  });

  it("restores a font by its own magic bytes when it isn't a recognized image", async () => {
    putMock.mockResolvedValue({ url: "https://blob.example/restored/def.ttf" });
    const ttf = [0x00, 0x01, 0x00, 0x00, 0, 0, 0, 0];

    const response = await POST(requestWithFile(ttf));

    expect(response.status).toBe(200);
    expect(putMock).toHaveBeenCalledWith(expect.stringMatching(/^restored\/.+\.ttf$/), Buffer.from(ttf), "font/ttf");
  });

  it("rejects a file whose bytes match neither a known image nor a known font format", async () => {
    const response = await POST(requestWithFile([0x00, 0x01, 0x02, 0x03, 0x04]));

    expect(response.status).toBe(415);
    expect(putMock).not.toHaveBeenCalled();
  });

  it("rejects a request with no file", async () => {
    const response = await POST(new NextRequest("http://localhost/api/assets/upload-archive-file", { method: "POST", body: new FormData() }));
    expect(response.status).toBe(400);
  });
});
