// Preset agent avatar entry. The actual set is discovered by apps/web from public/agents/presets
// and passed into AgentFormPage as a prop, so the feature stays bundler-agnostic.
export interface AvatarPreset {
  id: string;
  label: string;
  src: string;
}
