/**
 * Non-secret ComfyUI generation settings (sampler tuning + LoRA chain).
 * Sibling to `customApi/config.ts`'s pattern, but far simpler: nothing here
 * is a credential, so unlike `backupApiKeys` it needs no dedicated mutation
 * endpoint — it lives in the plain `ProviderConfig`/`ProviderSummary` and is
 * resubmitted wholesale on every AI Settings save, same as `rotationStrategy`.
 */

import { z } from "zod";

export const MAX_COMFYUI_LORAS = 4;

const comfyUiLoraSchema = z.object({
  name: z.string().min(1).max(200),
  // Applied to BOTH strength_model and strength_clip — LoraLoader's two
  // independent strengths are intentionally collapsed into one field,
  // matching how most simple LoRA UIs present a single slider.
  strength: z.number().min(0).max(2).optional(),
});

export const comfyUiConfigSchema = z.object({
  steps: z.number().int().min(1).max(150).optional(),
  cfg: z.number().min(0).max(30).optional(),
  samplerName: z.string().min(1).max(60).optional(),
  scheduler: z.string().min(1).max(60).optional(),
  loras: z.array(comfyUiLoraSchema).max(MAX_COMFYUI_LORAS).optional(),
  /** One configured ControlNet model, reused for every generation that
   * happens to include a control image — not a per-generation picker.
   * Switching ControlNet type (pose/edge/depth) means changing this field,
   * a deliberate scope cut for the first pass of ControlNet support. */
  controlNetModel: z.string().min(1).max(200).optional(),
  controlNetStrength: z.number().min(0).max(2).optional(),
});

export type ComfyUiLoraEntry = z.infer<typeof comfyUiLoraSchema>;
export type ComfyUiExtraConfig = z.infer<typeof comfyUiConfigSchema>;
