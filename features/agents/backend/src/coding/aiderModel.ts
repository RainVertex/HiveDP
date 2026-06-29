// Maps a platform provider + model to how Aider should be invoked: the --model string (LiteLLM
// format), the env var Aider expects the key under, and an optional base URL for OpenAI-compatible
// endpoints. Aider is model-agnostic, so a coding agent can run GPT-5.5, Claude, Gemini, etc.

export interface AiderModelConfig {
  aiderModel: string;
  apiKeyEnvVar: string | null;
  apiBase: string | null;
}

const OFFICIAL_OPENAI = /(^|\/\/)api\.openai\.com/i;

export function buildAiderModelConfig(
  provider: { kind: string; baseUrl: string },
  modelName: string,
): AiderModelConfig | { error: string } {
  switch (provider.kind) {
    case "openai":
      return {
        // Prefix openai/ so LiteLLM routes to OpenAI even for a model it does not know yet (e.g. gpt-5.5).
        aiderModel: `openai/${modelName}`,
        apiKeyEnvVar: "OPENAI_API_KEY",
        // Official OpenAI needs no base override; a self-hosted OpenAI-compatible endpoint does.
        apiBase: OFFICIAL_OPENAI.test(provider.baseUrl) ? null : provider.baseUrl,
      };
    case "anthropic":
    case "anthropic-via-openai":
      return {
        aiderModel: `anthropic/${modelName}`,
        apiKeyEnvVar: "ANTHROPIC_API_KEY",
        apiBase: null,
      };
    case "gemini":
      return { aiderModel: `gemini/${modelName}`, apiKeyEnvVar: "GEMINI_API_KEY", apiBase: null };
    case "ollama":
      return { aiderModel: `ollama/${modelName}`, apiKeyEnvVar: null, apiBase: provider.baseUrl };
    default:
      return { error: `No Aider mapping for provider kind "${provider.kind}".` };
  }
}
