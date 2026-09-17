/**
 * Runtime evidence capture — the live-gate instrumentation must record what
 * the provider boundary actually saw, without altering behavior.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callGenerateApi, generationEvidence, recordGenerationEvidence, storeGeneratedAsset, type GenerateApiResult } from "./clientGeneration";
import { createProjectDocument } from "@/domain/factory";
import { useEditorStore } from "@/editor/store";

describe("generation evidence capture", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("records the sanitized request and the response facts for a real call", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            url: "https://example.com/out.png",
            sourceUrl: "https://example.com/out.png",
            mimeType: "image/png",
            hasAlpha: true,
            backgroundRemoved: true,
            processingStatus: "ready",
            provider: "test-provider",
            model: "test-image-model-v1",
            referenceUsed: true,
            requestId: "req-1",
          }),
          { status: 200 },
        ),
      ),
    );
    recordGenerationEvidence({ kind: "camera-route", route: "character", generationCalls: 1 });
    const before = generationEvidence().length;

    await callGenerateApi({
      assetType: "character-pose",
      prompt: "FINAL PROMPT SENT TO PROVIDER",
      referenceUrls: ["https://example.com/ref.png"],
      size: "portrait",
    });

    const entries = generationEvidence().slice(before);
    const request = entries.find((e) => e.kind === "request");
    const response = entries.find((e) => e.kind === "response");
    expect(request?.prompt).toBe("FINAL PROMPT SENT TO PROVIDER");
    expect(request?.referenceUrls).toEqual(["https://example.com/ref.png"]);
    expect(response?.model).toBe("test-image-model-v1");
    expect(response?.hasAlpha).toBe(true);
    expect(response?.backgroundRemoved).toBe(true);
    // Sanitized by construction: no credential fields exist client-side.
    expect(JSON.stringify(entries)).not.toContain("apiKey");
  });

  it("records failures with the error and requestId", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "boom", requestId: "req-2" }), { status: 422 }),
      ),
    );
    const before = generationEvidence().length;
    await expect(callGenerateApi({ assetType: "background", prompt: "x" })).rejects.toThrow("boom");
    const error = generationEvidence().slice(before).find((e) => e.kind === "error");
    expect(error?.error).toBe("boom");
    expect(error?.requestId).toBe("req-2");
  });
});

describe("storeGeneratedAsset — background-removal failure message", () => {
  // recordFailedGeneration (called on the way to throwing) dispatches into
  // the editor store, which needs an open project — unrelated to what this
  // suite actually tests, just a real precondition of the code path.
  beforeEach(() => {
    useEditorStore.setState({ doc: createProjectDocument("Test") } as never);
  });

  const baseResult = (overrides: Partial<GenerateApiResult>): GenerateApiResult => ({
    url: "https://example.com/out.png",
    sourceUrl: "https://example.com/out.png",
    mimeType: "image/png",
    hasAlpha: false,
    backgroundRemoved: false,
    processingStatus: "failed",
    provider: "test-provider",
    model: "test-model",
    referenceUsed: false,
    ...overrides,
  });

  it("prefers the server's detailed processingReason over the generic 'did not complete' message", async () => {
    // This is the whole point: the generic verdict message only ever says
    // "did not complete" (it can only see processingStatus) -- it can never
    // tell a user WHICH fallback provider was tried or why each one failed.
    // The server already computes that detail (processingPipeline.ts's
    // `failures` array); this asserts it actually reaches the thrown error
    // instead of being discarded in favor of the generic string.
    const reason =
      "Foreground extraction fallback could not determine a reliable subject mask. comfyui-background: ComfyUI rejected the workflow (/prompt 400) · Local fallback: No stable edge-connected background was detected";
    await expect(
      storeGeneratedAsset({
        result: baseResult({ processingReason: reason }),
        assetType: "character",
        category: "character",
        name: "Haruto reference",
        prompt: "test prompt",
      }),
    ).rejects.toThrow(/comfyui-background: ComfyUI rejected the workflow/);
  });

  it("falls back to the generic message when the server has no detailed reason to give", async () => {
    await expect(
      storeGeneratedAsset({
        result: baseResult({}),
        assetType: "character",
        category: "character",
        name: "Haruto reference",
        prompt: "test prompt",
      }),
    ).rejects.toThrow("Background removal did not complete.");
  });
});
