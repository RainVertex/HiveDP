import { z } from "zod";

const avatarUrlSchema = z
  .string()
  .max(1_500_000)
  .refine(
    (v) => v.startsWith("data:image/") || v.startsWith("/"),
    "avatarUrl must be an uploaded image or a root-relative path",
  )
  .nullable()
  .optional();

export const createAgentSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  avatarUrl: avatarUrlSchema,
  category: z.string().max(60).nullable().optional(),
  kind: z.string().min(1).max(60).default("custom"),
  runtime: z.enum(["chat", "code"]).default("chat"),
  modelId: z.string().min(1),
  instructions: z.string().min(1).max(20000),
  skillIds: z.array(z.string()).default([]),
  approvalMode: z.enum(["auto", "ask"]).default("ask"),
  maxToolCalls: z.number().int().min(1).max(50).default(10),
  tokenBudget: z.number().int().min(1).nullable().optional(),
  temperature: z.number().min(0).max(2).nullable().optional(),
  assignableToTasks: z.boolean().default(false),
});

export const updateAgentSchema = createAgentSchema.partial();

export const createSkillSchema = z.object({
  label: z.string().min(1).max(120),
  description: z.string().max(500).nullable().optional(),
  guidance: z.string().max(2000).nullable().optional(),
  toolIds: z.array(z.string()).default([]),
});

export const updateSkillSchema = createSkillSchema.partial();

export const testAgentSchema = z.object({ prompt: z.string().min(1).max(8000) });

export const runAgentSchema = z.object({ input: z.record(z.string(), z.unknown()).default({}) });

export const createMcpServerSchema = z.object({
  label: z.string().min(1).max(120),
  url: z.url().max(2000),
  authKind: z.enum(["none", "bearer", "oauth"]).default("none"),
  // Plaintext bearer token, write-only. null clears a stored token.
  bearerToken: z.string().max(8000).nullable().optional(),
  oauthScope: z.string().max(500).nullable().optional(),
  toolAllowlist: z.array(z.string().max(200)).max(500).default([]),
  toolPrefix: z.string().max(40).optional(),
  enabled: z.boolean().default(true),
});

// Defined explicitly rather than createMcpServerSchema.partial() because .partial() keeps the
// .default() values, so an absent field (e.g. a save that only changes toolAllowlist) would parse
// to authKind:"none"/enabled:true and silently overwrite the stored config.
export const updateMcpServerSchema = z.object({
  label: z.string().min(1).max(120).optional(),
  url: z.url().max(2000).optional(),
  authKind: z.enum(["none", "bearer", "oauth"]).optional(),
  bearerToken: z.string().max(8000).nullable().optional(),
  oauthScope: z.string().max(500).nullable().optional(),
  toolAllowlist: z.array(z.string().max(200)).max(500).optional(),
  toolPrefix: z.string().max(40).optional(),
  enabled: z.boolean().optional(),
});

export type CreateAgentInput = z.infer<typeof createAgentSchema>;
export type UpdateAgentInput = z.infer<typeof updateAgentSchema>;
export type CreateSkillInput = z.infer<typeof createSkillSchema>;
export type UpdateSkillInput = z.infer<typeof updateSkillSchema>;
export type TestAgentInput = z.infer<typeof testAgentSchema>;
// Named to avoid colliding with the executor's RunAgentInput that the package barrel re-exports.
export type RunAgentBody = z.infer<typeof runAgentSchema>;
export type CreateMcpServerInput = z.infer<typeof createMcpServerSchema>;
export type UpdateMcpServerInput = z.infer<typeof updateMcpServerSchema>;
