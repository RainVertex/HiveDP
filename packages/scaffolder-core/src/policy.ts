// Capability policy and approval-requirement computation per actor kind.
import type { Actor, ApprovalRequirement, Capability } from "./types";

// What each actor kind may use without an approval token.
export interface CapabilityPolicy {
  human: Set<Capability>;
  agent: Set<Capability>;
  externalAgent: Set<Capability>;
}

export function createPolicy(input: {
  human: Capability[];
  agent: Capability[];
  externalAgent: Capability[];
}): CapabilityPolicy {
  return {
    human: new Set(input.human),
    agent: new Set(input.agent),
    externalAgent: new Set(input.externalAgent),
  };
}

function bucketFor(actor: Actor, policy: CapabilityPolicy): Set<Capability> {
  switch (actor.kind) {
    case "human":
      return policy.human;
    case "agent":
      return policy.agent;
    case "external-agent":
      return policy.externalAgent;
  }
}

export function computeApprovalRequirements(
  required: Capability[],
  actor: Actor,
  policy: CapabilityPolicy,
): ApprovalRequirement[] {
  const allowed = bucketFor(actor, policy);
  const out: ApprovalRequirement[] = [];
  for (const cap of required) {
    if (!allowed.has(cap)) {
      out.push({ capability: cap, reason: `Actor ${actor.kind} lacks ${cap}` });
    }
  }
  return out;
}

// Static check: every capability used by a template's steps must be declared.
export function assertDeclaredCapabilitiesCover(
  declared: Capability[],
  actuallyUsed: Capability[],
  templateId: string,
): void {
  const decl = new Set(declared);
  const missing = actuallyUsed.filter((c) => !decl.has(c));
  if (missing.length > 0) {
    throw new Error(
      `Template "${templateId}" uses capabilities not declared in metadata: ${missing.join(", ")}`,
    );
  }
}
