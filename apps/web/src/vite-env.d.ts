/// <reference types="vite/client" />

declare module "virtual:agent-avatar-presets" {
  import type { AvatarPreset } from "@feature/agents-frontend";
  const presets: AvatarPreset[];
  export default presets;
}
