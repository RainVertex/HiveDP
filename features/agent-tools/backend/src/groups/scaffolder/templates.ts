import type { RegisteredTool, ToolContext } from "@internal/llm-core";
import {
  listExecutableTemplates,
  buildAndPersistPlan,
  applyPersistedPlan,
  registerTemplateDefFromSource,
} from "@feature/scaffolder-backend/contract";
import { requireUserId } from "../core";

// In-process platform agents act as the calling user with the "agent" actor kind, so template ACLs
// and audit attribute to the real person driving the conversation.
function agentActor(ctx: ToolContext) {
  return { kind: "agent" as const, userId: requireUserId(ctx), teamIds: ctx.teamIds };
}

export const scaffolderListTemplatesTool: RegisteredTool = {
  id: "scaffolder_list_templates",
  openaiDef: {
    type: "function",
    function: {
      name: "scaffolder_list_templates",
      description:
        "List the scaffolder templates the current user is allowed to run, each with its id, name, description, and parameter schema. Call this first to discover what you can scaffold and what scaffolder_plan expects for each template.",
      parameters: { type: "object", properties: {} },
    },
  },
  handler: async (_args, ctx) => {
    const actor = agentActor(ctx);
    const templates = await listExecutableTemplates({ actor, isAdmin: ctx.isAdmin });
    return { templates };
  },
};

export const scaffolderPlanTool: RegisteredTool = {
  id: "scaffolder_plan",
  openaiDef: {
    type: "function",
    function: {
      name: "scaffolder_plan",
      description:
        "Build a plan from a scaffolder template without changing anything yet. Pass the template id (from scaffolder_list_templates) and a params object matching that template's parameter schema. Returns a plan summary that you must apply separately with scaffolder_apply_plan. Show the user what it will do before applying. Plans expire, so apply promptly.",
      parameters: {
        type: "object",
        properties: {
          templateId: {
            type: "string",
            description: "Id of the template to plan, from scaffolder_list_templates.",
          },
          params: {
            type: "object",
            description: "Parameter values for the template, matching its parameter schema.",
          },
        },
        required: ["templateId", "params"],
      },
    },
  },
  handler: async (args, ctx) => {
    const actor = agentActor(ctx);
    const { templateId, params } = args as { templateId: string; params?: Record<string, unknown> };
    const plan = await buildAndPersistPlan({
      templateId,
      rawParams: params ?? {},
      actor,
      userId: actor.userId,
    });
    return {
      planId: plan.id,
      templateId: plan.templateId,
      mode: plan.mode,
      target: plan.target,
      capabilities: plan.capabilities,
      irreversible: plan.irreversible,
      expiresAt: plan.expiresAt,
      steps: plan.steps.map((s) => ({
        stepId: s.stepId,
        action: s.action,
        matched: s.matched,
        reversible: s.reversible,
      })),
    };
  },
};

export const scaffolderRegisterTemplateTool: RegisteredTool = {
  id: "scaffolder_register_template",
  openaiDef: {
    type: "function",
    function: {
      name: "scaffolder_register_template",
      description:
        "Register a new scaffolder template from its raw template.yaml source. Admin only. Read the template's template.yaml from the templates repo with repo_read_file (only after it is on the default branch, skeletons render from main) and pass the content verbatim. On success the template is immediately visible and runnable in the gallery. On a validation error, fix the YAML and retry.",
      parameters: {
        type: "object",
        properties: {
          source: {
            type: "string",
            description: "Full template.yaml content, passed verbatim.",
          },
        },
        required: ["source"],
      },
    },
  },
  handler: async (args, ctx) => {
    const userId = requireUserId(ctx);
    if (!ctx.isAdmin) {
      return { error: "Registering templates requires an admin user." };
    }
    const { source } = args as { source?: unknown };
    if (typeof source !== "string" || source.trim() === "") {
      return { error: "source must be the full template.yaml content." };
    }
    const result = await registerTemplateDefFromSource({ source, userId });
    if (!result.ok) return { error: result.error };
    return { registered: true, id: result.id, identifier: result.identifier };
  },
};

export const scaffolderApplyPlanTool: RegisteredTool = {
  id: "scaffolder_apply_plan",
  openaiDef: {
    type: "function",
    function: {
      name: "scaffolder_apply_plan",
      description:
        "Apply a plan created by scaffolder_plan, identified by its planId. This performs the real side effects (creating repos, opening PRs, registering catalog entities). Set dryRun true to validate without touching the live system. A plan can only be applied once.",
      parameters: {
        type: "object",
        properties: {
          planId: { type: "string", description: "Id of the plan returned by scaffolder_plan." },
          dryRun: {
            type: "boolean",
            description: "Optional. Validate the plan without making any real changes.",
          },
        },
        required: ["planId"],
      },
    },
  },
  handler: async (args, ctx) => {
    const actor = agentActor(ctx);
    const { planId, dryRun } = args as { planId: string; dryRun?: boolean };
    return applyPersistedPlan({ planId, dryRun: dryRun ?? false, actor, userId: actor.userId });
  },
};
