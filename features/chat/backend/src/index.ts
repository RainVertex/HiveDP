export { chatRouter } from "./routes";

import type { FeatureManifest } from "@internal/feature-host";
import { chatRouter as chatRouterForManifest } from "./routes";

export const featureManifest: FeatureManifest = {
  mounts: [{ path: "/api/chat", router: chatRouterForManifest }],
};
