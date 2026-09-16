import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  MAX_BACKUP_API_KEYS,
  buildProviderConfig,
  readSessionConfig,
  summarize,
  writeSessionConfig,
  type BackupKeyEntry,
} from "@/server/providerSession";

export const runtime = "nodejs";

const kindSchema = z.enum(["agent", "image", "background"]);

const bodySchema = z.discriminatedUnion("action", [
  z.object({ kind: kindSchema, action: z.literal("add"), key: z.string().min(4).max(4096) }),
  z.object({
    kind: kindSchema,
    action: z.literal("update"),
    index: z.number().int().min(0),
    weight: z.number().min(0.1).max(100).optional(),
    enabled: z.boolean().optional(),
  }),
  z.object({ kind: kindSchema, action: z.literal("remove"), index: z.number().int().min(0) }),
  z.object({
    kind: kindSchema,
    action: z.literal("reorder"),
    fromIndex: z.number().int().min(0),
    toIndex: z.number().int().min(0),
  }),
]);

/**
 * Manage ONE backup key at a time on the primary provider — add / update
 * (weight, enabled) / remove / reorder — without ever requiring the whole
 * list to be retyped, and without the client needing an existing key's
 * value for anything (a stored key is never sent back to the browser —
 * "update" only ever touches `weight`/`enabled`, which are not secrets).
 *
 * Same read → mutate → rebuild → write shape as `../config/route.ts`,
 * scoped to one array instead of the whole config. Fallback providers'
 * own backup keys are out of scope here — they keep the bulk textarea in
 * `AiSettingsDialog.tsx` until Phase 2 unifies the two.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { kind } = parsed.data;
  const existing = readSessionConfig(request, kind);
  if (!existing) {
    return NextResponse.json({ error: "No provider configured yet" }, { status: 404 });
  }

  const current = existing.backupApiKeys ?? [];
  let next: BackupKeyEntry[];

  switch (parsed.data.action) {
    case "add": {
      if (current.length >= MAX_BACKUP_API_KEYS) {
        return NextResponse.json({ error: `You can store up to ${MAX_BACKUP_API_KEYS} backup keys` }, { status: 400 });
      }
      const key = parsed.data.key.trim();
      if (!key || key === existing.apiKey || current.some((entry) => entry.key === key)) {
        return NextResponse.json({ error: "That key is already in the pool" }, { status: 400 });
      }
      next = [...current, { key }];
      break;
    }
    case "update": {
      const { index, weight, enabled } = parsed.data;
      if (!current[index]) return NextResponse.json({ error: "No such backup key" }, { status: 404 });
      next = current.map((entry, i) =>
        i === index ? { ...entry, weight: weight ?? entry.weight, enabled: enabled ?? entry.enabled } : entry,
      );
      break;
    }
    case "remove": {
      const { index } = parsed.data;
      if (!current[index]) return NextResponse.json({ error: "No such backup key" }, { status: 404 });
      next = current.filter((_, i) => i !== index);
      break;
    }
    case "reorder": {
      const { fromIndex, toIndex } = parsed.data;
      if (!current[fromIndex] || !current[toIndex]) {
        return NextResponse.json({ error: "No such backup key" }, { status: 404 });
      }
      next = [...current];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      break;
    }
  }

  try {
    const config = buildProviderConfig(
      {
        kind,
        providerType: existing.providerType,
        baseUrl: existing.baseUrl,
        model: existing.model,
        custom: existing.custom,
        backupApiKeys: next,
      },
      existing,
    );
    const response = NextResponse.json(summarize({ config, source: "session" }));
    writeSessionConfig(response, config);
    return response;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Update failed" }, { status: 400 });
  }
}
