import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { fetchObjectInfoOptions } from "@/ai/providers/comfyui";
import { resolveProvider } from "@/server/providerSession";

export const runtime = "nodejs";

const requestSchema = z.object({
  kind: z.literal("image"),
  nodeClass: z.enum(["LoraLoader", "ControlNetLoader"]),
  inputName: z.enum(["lora_name", "control_net_name"]),
});

/**
 * Best-effort dropdown discovery for ComfyUI COMBO/enum inputs (LoRA
 * filenames, ControlNet models) — same "never a hard failure, just an
 * empty list" philosophy as `provider/models/route.ts`'s OpenAI-compatible
 * model discovery. `nodeClass`/`inputName` are enum-restricted, not an
 * open node-name probe.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ options: [] });

  const resolved = resolveProvider(request, "image");
  if (!resolved || resolved.config.providerType !== "comfyui") {
    return NextResponse.json({ options: [] });
  }

  try {
    const options = await fetchObjectInfoOptions(resolved.config, parsed.data.nodeClass, parsed.data.inputName);
    return NextResponse.json({ options: options.slice(0, 500) });
  } catch {
    return NextResponse.json({ options: [] });
  }
}
