export { registerAllTools } from "./registry";
export { requireUserId } from "./groups/core";

import type { FeatureManifest } from "@internal/feature-host";
import { registerAllTools as registerAllToolsForManifest } from "./registry";

export const featureManifest: FeatureManifest = {
  onBoot: registerAllToolsForManifest,
};
