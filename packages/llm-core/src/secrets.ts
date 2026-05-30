// Resolve the API key a provider needs to authenticate. The lean model has no
// per-agent encrypted secret; keys come from the env var named on the
// LlmProvider row (e.g. OPENAI_API_KEY, ANTHROPIC_API_KEY). Providers that
// need no key (local Ollama) leave apiKeyEnvVar null and resolve to null.
export async function resolveProviderApiKey(args: {
  providerSlug: string;
  apiKeyEnvVar: string | null;
}): Promise<string | null> {
  if (args.apiKeyEnvVar) {
    const fromEnv = process.env[args.apiKeyEnvVar];
    if (!fromEnv) {
      throw new Error(
        `Missing env var ${args.apiKeyEnvVar} required by provider '${args.providerSlug}'`,
      );
    }
    return fromEnv;
  }
  return null;
}
