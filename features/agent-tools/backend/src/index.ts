export { registerAllTools } from "./registry";
export { requireUserId } from "./groups/core";

import type { FeatureManifest } from "@internal/feature-host";
import { registerAllTools, validateBuiltinSkillToolIds } from "./registry";

export const featureManifest: FeatureManifest = {
  onBoot: async () => {
    registerAllTools();
    await validateBuiltinSkillToolIds();
  },
};
