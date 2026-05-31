import type { ProviderKind } from "@internal/shared-types";
import { anthropicAdapter } from "./anthropic";
import { geminiAdapter } from "./gemini";
import { openaiCompatAdapter } from "./openaiCompat";
import type { ProviderAdapter } from "./providerAdapter";

// Provider adapter registry; every adapter returns an OpenAI-shaped AdapterResult.

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

// Unrecognized kinds fall back to openai_compat since seeded providers speak chat.completions.
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
