// A provider is "ready" when the key it needs is actually present. Local
// providers (Ollama) declare no apiKeyEnvVar and are always ready; cloud
// providers are ready only when their env var is set in this deployment.
export function isProviderReady(provider: { kind: string; apiKeyEnvVar: string | null }): boolean {
  if (!provider.apiKeyEnvVar) return true;
  return Boolean(process.env[provider.apiKeyEnvVar]);
}
