import type { ProviderKind } from "@internal/shared-types";
import { anthropicAdapter } from "./anthropic";
import { geminiAdapter } from "./gemini";
import { openaiCompatAdapter } from "./openaiCompat";
import type { ProviderAdapter } from "./providerAdapter";

// Adapter registry. selectAdapter(kind) is the only entry point streamExecutor
// and runAgent need to know about, every provider returns an OpenAI-shaped
// AdapterResult so the rest of the loop is model-agnostic.

const REGISTRY: Record<ProviderKind, ProviderAdapter> = {
  openai_compat: openaiCompatAdapter,
  anthropic: anthropicAdapter,
  gemini: geminiAdapter,
};

export function selectAdapter(kind: ProviderKind | string): ProviderAdapter {
  const adapter = REGISTRY[kind as ProviderKind];
  if (!adapter) {
    throw new Error(
      `Unknown provider kind '${kind}'. Expected one of: openai_compat, anthropic, gemini.`,
    );
  }
  return adapter;
}

// Map an LlmProvider row's `kind` to the adapter kind. The three seeded
// providers (Ollama local, OpenAI, Anthropic via its OpenAI-compatible
// endpoint) all speak the chat.completions wire format, so they resolve to
// openai_compat. Native anthropic/gemini adapters stay available for any
// provider explicitly registered with kind "anthropic" or "gemini".
export function providerKindFromProvider(provider: { kind: string }): ProviderKind {
  switch (provider.kind) {
    case "anthropic":
      return "anthropic";
    case "gemini":
      return "gemini";
    default:
      return "openai_compat";
  }
}

export type { ProviderAdapter, AdapterRequest, AdapterResult } from "./providerAdapter";
