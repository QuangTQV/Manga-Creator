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

/** The exact, current preset strings `IPAdapterUnifiedLoader` accepts —
 * verified against `cubiq/ComfyUI_IPAdapter_plus`'s own source
 * (`IPAdapterPlus.py`), not guessed. Two of the six are SD1.5-only and
 * will fail ("IPAdapter model not found") on an SDXL checkpoint — the
 * other four resolve per-architecture automatically. */
export const IP_ADAPTER_PRESETS = [
  "LIGHT - SD1.5 only (low strength)",
  "STANDARD (medium strength)",
  "VIT-G (medium strength)",
  "PLUS (high strength)",
  "PLUS FACE (portraits)",
  "FULL FACE - SD1.5 only (portraits stronger)",
] as const;
export const DEFAULT_IP_ADAPTER_PRESET: (typeof IP_ADAPTER_PRESETS)[number] = "STANDARD (medium strength)";

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
  /** Overrides the default IPAdapter preset used when a local edit carries
   * an extra identity reference — see `IP_ADAPTER_PRESETS`. Unlike
   * ControlNet, this needs no required config to activate: a sensible
   * architecture-agnostic default (`DEFAULT_IP_ADAPTER_PRESET`) applies
   * automatically whenever a reference is present. */
  ipAdapterPreset: z.enum(IP_ADAPTER_PRESETS).optional(),
  ipAdapterWeight: z.number().min(-1).max(5).optional(),
});

export type ComfyUiLoraEntry = z.infer<typeof comfyUiLoraSchema>;
export type ComfyUiExtraConfig = z.infer<typeof comfyUiConfigSchema>;
