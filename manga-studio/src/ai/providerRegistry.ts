/**
 * Image provider registry: resolved BYOK/deployment config in, adapter out.
 * The editor never learns which vendor produced an image — capabilities and
 * results flow through the common ImageGenerationProvider interface.
 */

import type { ProviderConfig } from "@/server/providerSession";
import { createComfyUiProvider } from "./providers/comfyui";
import { createCustomImageProvider } from "./providers/customImage";
import { createGeminiProvider } from "./providers/gemini";
import { createGenericRestProvider } from "./providers/genericRest";
import { wrapImageProviderWithRotation } from "./providers/withRotation";
import type { ImageGenerationProvider } from "./types";

function buildAdapter(config: ProviderConfig): ImageGenerationProvider {
  switch (config.providerType) {
    case "custom":
      // The universal type: a declarative API description, not a vendor.
      return createCustomImageProvider(config);
    case "gemini":
      return createGeminiProvider(config);
    case "openai-compatible":
    case "generic-rest":
      return createGenericRestProvider(config);
    case "comfyui":
      return createComfyUiProvider(config);
    default:
      throw new Error(`Unsupported image provider type: ${config.providerType}`);
  }
}

/** Config in, adapter out — transparently multi-key-rotation-aware when the
 * config carries `backupApiKeys` (see withRotation.ts). Every caller goes
 * through here, so every one benefits without knowing rotation exists. */
export function createImageProvider(config: ProviderConfig): ImageGenerationProvider {
  return wrapImageProviderWithRotation(config, buildAdapter);
}
