// Resolves scaffolder capability policies for human, agent, and external-agent actors from env.
import { createPolicy, type Capability, type CapabilityPolicy } from "@internal/scaffolder-core";

const ALL_CAPABILITIES: Capability[] = [
  "fs:write",
  "fs:write:main",
  "db:write",
  "db:write:catalog",
  "repo:read",
  "network:external",
  "repo:public",
  "repo:private",
];

function parseCapabilities(raw: string | undefined, fallback: Capability[]): Capability[] {
  if (!raw) return fallback;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .filter((s): s is Capability => isKnownCapability(s));
}

function isKnownCapability(s: string): s is Capability {
  if (ALL_CAPABILITIES.includes(s as Capability)) return true;
  return s.startsWith("secrets:read:");
}

export function loadCapabilityPolicy(): CapabilityPolicy {
  return createPolicy({
    human: parseCapabilities(process.env.SCAFFOLDER_HUMAN_CAPABILITIES, [
      "fs:write",
      "fs:write:main",
      "db:write",
      "db:write:catalog",
      "repo:read",
    ]),
    agent: parseCapabilities(process.env.SCAFFOLDER_AGENT_CAPABILITIES, [
      "fs:write",
      "repo:read",
      "db:write:catalog",
    ]),
    externalAgent: parseCapabilities(process.env.SCAFFOLDER_EXTERNAL_AGENT_CAPABILITIES, []),
  });
}
