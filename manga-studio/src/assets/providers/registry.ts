import type { ProviderConfig } from "@/server/providerSession";
import { createCustomBackgroundRemovalProvider } from "./custom";
import { createRemoveBgProvider } from "./removeBg";
import type { BackgroundRemovalProvider } from "./types";
import { wrapBackgroundRemovalProviderWithRotation } from "./withRotation";

function buildAdapter(config: ProviderConfig): BackgroundRemovalProvider {
  if (config.providerType === "custom") return createCustomBackgroundRemovalProvider(config);
  if (config.providerType === "remove-bg") return createRemoveBgProvider(config);
  throw new Error(`Unsupported background-removal provider type: ${config.providerType}`);
}

/** Config in, adapter out — transparently multi-key-rotation-aware when the
 * config carries `backupApiKeys`/`fallbackProviders` (see withRotation.ts). */
export function createBackgroundRemovalProvider(config: ProviderConfig): BackgroundRemovalProvider {
  return wrapBackgroundRemovalProviderWithRotation(config, buildAdapter);
}
