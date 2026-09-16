import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createImageProvider } from "@/ai/providerRegistry";
import { createAgentProvider } from "@/agent/providers/registry";
import { buildRequestPreview } from "@/server/customApi/preview";
import { readSessionConfig, type ProviderConfig } from "@/server/providerSession";
import { createBackgroundRemovalProvider } from "@/assets/providers/registry";

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({
  kind: z.enum(["agent", "image", "background"]),
  /** "primary" or one specific backup key, addressed by its position in
   * the stored `backupApiKeys` array — never by value, since the client
   * never has the value to send. */
  target: z.union([z.literal("primary"), z.object({ backupIndex: z.number().int().min(0) })]),
});

/**
 * Test ONE specific key already stored in the session — the primary, or a
 * backup by index — without the key value ever reaching the browser. Same
 * "cheap round-trip, never a full generation" contract as
 * `app/api/provider/test/route.ts`, just resolving `apiKey` from a
 * specific slot in the session's own already-decrypted config instead of
 * always the primary `resolveProvider` would pick.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
  }
  const { kind, target } = parsed.data;

  const stored = readSessionConfig(request, kind);
  if (!stored) {
    return NextResponse.json({ ok: false, error: "Not configured" }, { status: 503 });
  }

  let config: ProviderConfig;
  if (target === "primary") {
    config = stored;
  } else {
    const entry = stored.backupApiKeys?.[target.backupIndex];
    if (!entry) return NextResponse.json({ ok: false, error: "No such backup key" }, { status: 404 });
    // A one-off attempt: no pool fields, so this reads to the adapter
    // exactly like any single-key config would.
    config = { ...stored, apiKey: entry.key, backupApiKeys: undefined, fallbackProviders: undefined };
  }

  const preview = buildRequestPreview(config);
  try {
    const status =
      kind === "agent"
        ? await createAgentProvider(config).testConnection()
        : kind === "image"
          ? await createImageProvider(config).testConnection()
          : (await createBackgroundRemovalProvider(config).testConnection?.()) ?? { ok: true };
    return NextResponse.json(
      status.ok
        ? { ok: true, status: "Connected", detail: status.message, preview }
        : { ok: false, error: status.message ?? "Connection failed", preview },
    );
  } catch (error) {
    const message =
      error instanceof Error && "safeMessage" in error ? (error as { safeMessage: string }).safeMessage : "Endpoint unreachable";
    return NextResponse.json({ ok: false, error: message, preview });
  }
}
