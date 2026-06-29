// Idempotent database seed: LLM provider/model registry, built-in agents, and default pages.
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

loadEnv({ path: resolve(__dirname, "../../../.env") });

import { Prisma, prisma, type CatalogEntityKind, type ScorecardTierStyle } from "./index";
import { ensureAgentBackingUser } from "./agentUser";

async function main() {
  console.log("Seeding database…");

  // Provider/model registry must exist before any Agent row (Agent.modelId FK).
  await seedLlmProviders();

  await seedDefaultPages();
  await seedDefaultScorecards();
  await seedSkills();

  // Catalog Enricher system prompt. seed.ts is the sole source the agent reads it from the DB row at runtime.
  const enricherInstructions = `You are the Catalog Enricher.

Given a catalog entity id, make its repository's catalog-info.yaml complete,
exactly as a careful human contributor would, by opening a pull request. The
catalog-info.yaml is the source of truth; the platform database is derived from
it automatically once the PR merges.

All repo tools take a target; for this agent always pass target
{ kind: "entity", entityId } where entityId is the entity you were given.

Steps:
- Call catalog_lookup first to see the current entity (name, kind, description,
  owners, tags, repoUrl).
- Call repo_info to inspect the repository (description, topics, primary
  language, root entries). Call repo_read_file for the README, manifests
  (package.json, pyproject.toml, go.mod, etc.), CODEOWNERS, and any existing
  catalog-info.yaml.
- Compose a complete catalog-info.yaml in the flat schema: kind, name,
  description, ownerTeamIds, repoUrl, tags. Start from any existing
  catalog-info.yaml and fill only the blanks; never overwrite a value a human
  set. Infer kind from the manifests and structure, description from the README
  or repo description, tags from topics and language.
- Owners are sensitive: set ownerTeamIds only when CODEOWNERS maps unambiguously
  to a platform team. If unsure, leave owners empty and let scorecards flag it.
  Never invent an owner.
- If a complete, correct catalog-info.yaml already exists, do not open a PR;
  reply that nothing was needed.
- Otherwise call repo_open_yaml_pr with the entityId and the full yaml; it
  validates and opens (or updates) the PR. Then reply with one sentence and the
  PR URL.

Aim for at most 8 tool calls. Do not loop.`;

  await prisma.agent.upsert({
    where: { id: "catalog-enricher" },
    update: {
      instructions: enricherInstructions,
      skillIds: ["skill-catalog-enrich"],
      approvalMode: "auto",
      category: "Catalog & Quality",
      avatarUrl: "/agents/presets/catalog-enricher.svg",
    },
    create: {
      id: "catalog-enricher",
      name: "Catalog Enricher",
      description: "Fills missing metadata on catalog entities by opening a pull request.",
      kind: "catalog-enrichment",
      modelId: "llmmodel_openai_o4_mini",
      instructions: enricherInstructions,
      skillIds: ["skill-catalog-enrich"],
      approvalMode: "auto",
      maxToolCalls: 10,
      category: "Catalog & Quality",
      avatarUrl: "/agents/presets/catalog-enricher.svg",
    },
  });

  await seedPlatformAssistant();
  await seedTaskPlanner();
  await seedCodingAgent();

  // Backing User (userKind='agent') per agent so agents can be assigned to tasks and granted access like teammates. Idempotent; also backfills any agent created before the link existed.
  const allAgents = await prisma.agent.findMany({
    select: { id: true, name: true, avatarUrl: true },
  });
  for (const a of allAgents) {
    await ensureAgentBackingUser(a.id, { name: a.name, avatarUrl: a.avatarUrl });
  }

  console.log("Seed complete.");
}

// Built-in skills. These reproduce the exact tool sets the built-in agents used before skills existed,
// so behavior is unchanged. Admins can edit them or add their own.
async function seedSkills() {
  const skills: Array<{
    id: string;
    label: string;
    description: string;
    guidance: string;
    toolIds: string[];
  }> = [
    {
      id: "skill-platform-read",
      label: "Platform read",
      description: "Read-only access to the user, teams, catalog, org, and platform source.",
      guidance: "Use for general read-only questions about the user, their teams, and the catalog.",
      toolIds: [
        "whoami",
        "get_today",
        "teams_list_mine",
        "teams_get",
        "teams_list_members",
        "catalog_search",
        "catalog_get_entity",
        "catalog_owned_by_team",
        "org_list_departments",
        "org_get_department",
        "notifications_my_unread",
        "integrations_list_github",
        "repo_info",
        "repo_search",
        "repo_list_dir",
        "repo_read_file",
        "projects_get_task",
        "projects_search_tasks",
        "projects_list_my_tasks",
      ],
    },
    {
      id: "skill-catalog-enrich",
      label: "Catalog enrichment",
      description:
        "Inspect a catalog entity's repository and open a catalog-info.yaml pull request.",
      guidance:
        "Use to enrich a catalog entity by inspecting its repo and opening a catalog-info.yaml PR.",
      toolIds: ["catalog_lookup", "repo_info", "repo_read_file", "repo_open_yaml_pr"],
    },
    {
      id: "skill-project-planning",
      label: "Project planning",
      description: "Break an assigned project task into concrete subtasks, grounded in the repo.",
      guidance:
        "When assigned a project task, first call projects_list_subtasks to see what already exists. If the project has a connected repo, inspect it with the repo tools (repo_info / repo_search / repo_read_file, each with target { kind: 'project', projectId }) before planning, then call projects_create_subtask once per concrete subtask so you do not duplicate. If the task text asks to assign the subtasks to someone, pass assignee to projects_create_subtask or call projects_assign_task.",
      toolIds: [
        "whoami",
        "get_today",
        "projects_create_subtask",
        "projects_list_subtasks",
        "projects_get_task",
        "projects_assign_task",
        "projects_create_task",
        "projects_move_task",
        "projects_comment_on_task",
        "repo_info",
        "repo_search",
        "repo_list_dir",
        "repo_read_file",
      ],
    },
    {
      id: "skill-project-manage",
      label: "Project management",
      description: "Act on a project board: create and move tasks, comment, and set labels.",
      guidance:
        "Use to act on a project board. Find the task first with projects_search_tasks or projects_list_my_tasks to get its id. Create top-level work with projects_create_task and break it down with projects_create_subtask. Move a task between columns or complete it with projects_move_task. Leave updates with projects_comment_on_task, using @username to notify someone. Before projects_set_labels, call projects_list_labels to use titles that exist. Creating, moving, commenting, and labelling all require write access on the project.",
      toolIds: [
        "whoami",
        "get_today",
        "projects_search_tasks",
        "projects_list_my_tasks",
        "projects_get_task",
        "projects_create_task",
        "projects_create_subtask",
        "projects_list_subtasks",
        "projects_move_task",
        "projects_assign_task",
        "projects_comment_on_task",
        "projects_list_labels",
        "projects_set_labels",
      ],
    },
    {
      id: "skill-scaffolder",
      label: "Scaffolder",
      description: "Discover, plan, and run scaffolder templates to create new services and repos.",
      guidance:
        "To scaffold a new service or repo, first call scaffolder_list_templates to see what you can run and the parameters each template needs. Build a preview with scaffolder_plan, passing the template id and a params object that matches its schema. Show the user the plan summary (what it will create, whether it is irreversible) before applying. Then run scaffolder_apply_plan with the planId to execute. Use dryRun true to validate first. A plan can only be applied once and plans expire, so apply promptly after the user confirms.",
      toolIds: [
        "whoami",
        "get_today",
        "scaffolder_list_templates",
        "scaffolder_plan",
        "scaffolder_apply_plan",
      ],
    },
  ];

  for (const s of skills) {
    // toolIds are code-owned: re-applied every seed so tool-set changes land without a reset. The
    // human-facing fields (label, description, guidance) stay out of update so admin edits survive.
    await prisma.skill.upsert({
      where: { id: s.id },
      update: { toolIds: s.toolIds },
      create: {
        id: s.id,
        label: s.label,
        description: s.description,
        guidance: s.guidance,
        toolIds: s.toolIds,
        builtin: true,
      },
    });
  }
}

// The assistant is a normal agent now: it holds skill ids and chat resolves them like any agent.
// The instructions below ARE the prompt.
async function seedPlatformAssistant() {
  // Chat runs the assistant agent's own modelId FK (configured on the agent page like any other agent).
  // The assistant is treated as not-configured whenever this model is disabled or its provider has no key.
  const defaultModelId = "llmmodel_openai_o4_mini";

  const skillIds = ["skill-platform-read", "skill-project-manage", "skill-scaffolder"];

  const instructions = `You are the engineering platform assistant.
You help the current user with their work, teams, and catalog.

Tools execute on the server; the user cannot run them. Emit tool_calls
yourself — never ask the user to run one. When you intend to do something,
emit the tool_call; do not narrate that you will.

Reads:
- Call whoami once at the start of a new conversation.
- Call get_today before any "today/this week" question.
- Parallelize independent reads.

Acting (projects and scaffolding):
- You can act, not just read. Manage project boards with the projects_* tools
  (create or move tasks, comment, set labels). Resolve a task with
  projects_search_tasks or projects_list_my_tasks first to get its id, and call
  projects_list_labels before projects_set_labels.
- To create a new service or repo, list options with scaffolder_list_templates,
  preview with scaffolder_plan, show the user what it will do, then run
  scaffolder_apply_plan once they confirm.

Platform source code:
- For questions about how the platform itself works or how to change something in
  it (branding, a theme, a setting, a page, a route), investigate the platform's
  own repository with the repo tools and answer with concrete file paths and the
  exact edit to make. Always pass target { kind: "platform" }. These reads do not
  change anything, so never ask the user for permission to search, browse, or
  read, just do it and report findings.
- repo_search greps both file names and file contents and returns the matching
  files with line numbers. Use it first, with the most specific term you can (for
  example the brand text, a label, or a component name), then open the top hits
  with repo_read_file. Trust its results instead of listing directories one by one.
- Only fall back to repo_list_dir when search genuinely returns nothing. Do not
  stop or hand the task back to the user.
- The brand or name is usually plain text in a header component or the HTML title
  rather than an image file, so search for the visible name itself.
- If a tool returns code "not_configured" or "no_credentials", the platform source
  repository is not available yet, so say so plainly and answer from what you know.`;

  await prisma.agent.upsert({
    where: { id: "platform-assistant" },
    update: {
      instructions,
      skillIds,
      approvalMode: "ask",
      category: "Plan & Coordinate",
      avatarUrl: "/agents/presets/platform-assistant.svg",
    },
    create: {
      id: "platform-assistant",
      name: "Platform Assistant",
      description: "Interactive chatbot for the engineering platform.",
      kind: "platform-assistant",
      modelId: defaultModelId,
      instructions,
      skillIds,
      approvalMode: "ask",
      maxToolCalls: 12,
      category: "Plan & Coordinate",
      avatarUrl: "/agents/presets/platform-assistant.svg",
    },
  });
}

// The task worker, kept separate from the chat assistant. It is the only agent assignable to project
// tasks (the assignee picker filters on kind "task-planner"); when assigned it decomposes the task
// into subtasks via the projects tools and reports a summary back as a comment.
async function seedTaskPlanner() {
  const instructions = `You are the Task Planner for the engineering platform.

You are assigned to a project task. Your input is a JSON object with "task"
(id, title, description) and "project" (id, title, repoConnected). Break that
task into a small set of concrete, actionable subtasks.

Tools execute on the server; you cannot ask anyone to run them. Emit the
tool_calls yourself, never narrate that you will.

Steps:
- Call projects_list_subtasks with the task id first to see what already exists.
  Do not recreate a subtask that is already there.
- If project.repoConnected is true, inspect the repo before planning. The repo
  tools take a target, so always pass target { kind: "project", projectId } where
  projectId is project.id. Call repo_info first, then repo_search to find the
  relevant code and repo_read_file for the README and key manifests
  (package.json, pyproject.toml, go.mod, etc.). Ground the subtasks in what the
  codebase actually is. If repoConnected is false, plan from the task text alone.
- For each new subtask, call projects_create_subtask with parentTaskId set to
  the task id, a short concrete title, and an optional one line description.
- If the task text asks to assign the created subtasks to someone, set the
  assignee field on projects_create_subtask (or call projects_assign_task with
  the subtask id) for each subtask. The assignee can be a person or an agent,
  for example a coding agent. If a name does not resolve to exactly one
  assignable user, the tool returns the candidates, so retry with an exact
  username, and if you still cannot resolve it, say so in your summary instead
  of guessing.
- Keep the set focused, roughly five to eight subtasks. Split by real units of
  work, not by ceremony.
- When done, reply with one short paragraph that lists the subtasks you created
  and who they were assigned to. That reply is posted as a comment on the task,
  so write it for a human reader.

If the task is already fully broken down, create nothing and say so.`;

  await prisma.agent.upsert({
    where: { id: "task-planner" },
    update: {
      instructions,
      skillIds: ["skill-project-planning"],
      approvalMode: "auto",
      maxToolCalls: 35,
      assignableToTasks: true,
      category: "Plan & Coordinate",
      avatarUrl: "/agents/presets/agent-planning.svg",
    },
    create: {
      id: "task-planner",
      name: "Task Planner",
      description: "Breaks a project task into subtasks when assigned to it.",
      kind: "task-planner",
      modelId: "llmmodel_openai_o4_mini",
      instructions,
      skillIds: ["skill-project-planning"],
      approvalMode: "auto",
      maxToolCalls: 35,
      assignableToTasks: true,
      category: "Plan & Coordinate",
      avatarUrl: "/agents/presets/agent-planning.svg",
    },
  });
}

// The coding agent runs the "code" runtime: when assigned to a task (or run standalone on a project)
// it clones the connected repo in a sandbox, edits the working tree with Aider (model agnostic), and
// opens a draft pull request. Its instructions are passed to Aider as guidance with the task. Defaults
// to GPT-5.5; any supported provider works.
async function seedCodingAgent() {
  const instructions = `You are a coding agent working inside a cloned git repository.

Make the requested change directly in the working tree, then stop. Keep the
change minimal, correct, and consistent with the repo's existing structure and
conventions (read AGENTS.md, README, and neighboring files first).

Strict rules:
- Only create real, valid source files. NEVER create a file or directory whose
  name is a shell command or an example invocation. For instance, never create
  files or folders named "npm install", "npm run build", "npm run dev",
  "npm start", or "curl http://localhost:3000".
- To document how to run or use something, write it as prose inside README.md,
  never as a filename.
- When copying or adapting an existing template or directory, mirror its real
  structure exactly. Do not invent extra files or placeholders.
- Change only what the task needs. Do not touch unrelated files.
- If the project has a build, tests, or a linter, run them to verify your change
  compiles and passes.
- Before finishing, review what you created and delete any stray, accidental, or
  non-source files.

Your committed changes become a draft pull request for a human to review, so
leave the working tree clean and the change self-contained and reviewable.`;

  await prisma.agent.upsert({
    where: { id: "coding-agent" },
    update: {
      instructions,
      runtime: "code",
      approvalMode: "auto",
      maxToolCalls: 40,
      assignableToTasks: true,
      category: "Engineering",
      avatarUrl: "/agents/presets/agent-coding.svg",
    },
    create: {
      id: "coding-agent",
      name: "Coding Agent",
      description: "Writes code in a sandbox and opens a draft pull request when assigned.",
      kind: "custom",
      runtime: "code",
      modelId: "llmmodel_openai_gpt_5_5",
      instructions,
      skillIds: [],
      approvalMode: "auto",
      maxToolCalls: 40,
      assignableToTasks: true,
      category: "Engineering",
      avatarUrl: "/agents/presets/agent-coding.svg",
    },
  });
}

// Static IDs (not cuids) so in-file references keep working; upsert by unique slug stays idempotent. Cost is USD per 1k tokens.
async function seedLlmProviders() {
  const providers: Array<{
    id: string;
    slug: string;
    displayName: string;
    baseUrl: string;
    apiKeyEnvVar: string | null;
    kind: string;
  }> = [
    {
      id: "llmprov_ollama_local",
      slug: "ollama-local",
      displayName: "Ollama (local)",
      baseUrl: "http://localhost:11434/v1",
      apiKeyEnvVar: null,
      kind: "ollama",
    },
    {
      id: "llmprov_anthropic_cloud",
      slug: "anthropic-cloud",
      displayName: "Anthropic (cloud)",
      baseUrl: "https://api.anthropic.com/v1/",
      apiKeyEnvVar: "ANTHROPIC_API_KEY",
      kind: "anthropic-via-openai",
    },
    {
      id: "llmprov_openai_cloud",
      slug: "openai-cloud",
      displayName: "OpenAI (cloud)",
      baseUrl: "https://api.openai.com/v1",
      apiKeyEnvVar: "OPENAI_API_KEY",
      kind: "openai",
    },
    {
      id: "llmprov_google_cloud",
      slug: "google-cloud",
      displayName: "Google Gemini (cloud)",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      apiKeyEnvVar: "GEMINI_API_KEY",
      kind: "gemini",
    },
  ];

  for (const p of providers) {
    await prisma.llmProvider.upsert({
      where: { slug: p.slug },
      update: {
        displayName: p.displayName,
        baseUrl: p.baseUrl,
        apiKeyEnvVar: p.apiKeyEnvVar,
        kind: p.kind,
      },
      create: p,
    });
  }

  const models: Array<{
    id: string;
    slug: string;
    displayName: string;
    providerId: string;
    modelName: string;
    openrouterId: string | null;
    contextWindow: number;
    supportsTools: boolean;
    supportsVision: boolean;
    supportsReasoning: boolean;
    costPer1kIn: string | null;
    costPer1kOut: string | null;
    dailyTokenCap?: number | null;
  }> = [
    {
      id: "llmmodel_qwen3_8b_local",
      slug: "qwen3-8b-local",
      displayName: "Qwen3 8B (local, thinking)",
      providerId: "llmprov_ollama_local",
      modelName: "qwen3:8b",
      openrouterId: null,
      contextWindow: 32768,
      supportsTools: true,
      supportsVision: false,
      supportsReasoning: true,
      costPer1kIn: null,
      costPer1kOut: null,
    },
    {
      id: "llmmodel_qwen25vl_7b_local",
      slug: "qwen2.5vl-7b-local",
      displayName: "Qwen2.5 VL 7B (local, vision)",
      providerId: "llmprov_ollama_local",
      modelName: "qwen2.5vl:7b",
      openrouterId: null,
      contextWindow: 32768,
      supportsTools: false,
      supportsVision: true,
      supportsReasoning: false,
      costPer1kIn: null,
      costPer1kOut: null,
    },
    {
      id: "llmmodel_claude_opus_4_7",
      slug: "claude-opus-4-7",
      displayName: "Claude Opus 4.7",
      providerId: "llmprov_anthropic_cloud",
      modelName: "claude-opus-4-7",
      openrouterId: "anthropic/claude-opus-4.7",
      contextWindow: 200000,
      supportsTools: true,
      supportsVision: true,
      supportsReasoning: true,
      costPer1kIn: "0.005",
      costPer1kOut: "0.025",
    },
    {
      id: "llmmodel_claude_sonnet_4_6",
      slug: "claude-sonnet-4-6",
      displayName: "Claude Sonnet 4.6",
      providerId: "llmprov_anthropic_cloud",
      modelName: "claude-sonnet-4-6",
      openrouterId: "anthropic/claude-sonnet-4.6",
      contextWindow: 200000,
      supportsTools: true,
      supportsVision: true,
      supportsReasoning: true,
      costPer1kIn: "0.003",
      costPer1kOut: "0.015",
    },
    {
      id: "llmmodel_claude_haiku_4_5",
      slug: "claude-haiku-4-5-20251001",
      displayName: "Claude Haiku 4.5",
      providerId: "llmprov_anthropic_cloud",
      modelName: "claude-haiku-4-5-20251001",
      openrouterId: "anthropic/claude-haiku-4.5",
      contextWindow: 200000,
      supportsTools: true,
      supportsVision: true,
      supportsReasoning: true,
      costPer1kIn: "0.001",
      costPer1kOut: "0.005",
    },
    {
      id: "llmmodel_openai_gpt_4o",
      slug: "gpt-4o",
      displayName: "GPT-4o",
      providerId: "llmprov_openai_cloud",
      modelName: "gpt-4o",
      openrouterId: "openai/gpt-4o",
      contextWindow: 128000,
      supportsTools: true,
      supportsVision: true,
      supportsReasoning: false,
      costPer1kIn: "0.0025",
      costPer1kOut: "0.01",
      dailyTokenCap: 250_000,
    },
    {
      id: "llmmodel_openai_gpt_4o_mini",
      slug: "gpt-4o-mini",
      displayName: "GPT-4o mini",
      providerId: "llmprov_openai_cloud",
      modelName: "gpt-4o-mini",
      openrouterId: "openai/gpt-4o-mini",
      contextWindow: 128000,
      supportsTools: true,
      supportsVision: true,
      supportsReasoning: false,
      costPer1kIn: "0.00015",
      costPer1kOut: "0.0006",
      dailyTokenCap: 2_500_000,
    },
    {
      id: "llmmodel_openai_gpt_5_5",
      slug: "gpt-5.5",
      displayName: "GPT-5.5",
      providerId: "llmprov_openai_cloud",
      modelName: "gpt-5.5",
      openrouterId: "openai/gpt-5.5",
      contextWindow: 400000,
      supportsTools: true,
      supportsVision: true,
      supportsReasoning: true,
      costPer1kIn: "0.005",
      costPer1kOut: "0.03",
    },
    {
      id: "llmmodel_openai_gpt_5_4",
      slug: "gpt-5.4",
      displayName: "GPT-5.4",
      providerId: "llmprov_openai_cloud",
      modelName: "gpt-5.4",
      openrouterId: "openai/gpt-5.4",
      contextWindow: 400000,
      supportsTools: true,
      supportsVision: true,
      supportsReasoning: true,
      costPer1kIn: "0.0025",
      costPer1kOut: "0.015",
      dailyTokenCap: 250_000,
    },
    {
      id: "llmmodel_openai_gpt_5_4_mini",
      slug: "gpt-5.4-mini",
      displayName: "GPT-5.4 mini",
      providerId: "llmprov_openai_cloud",
      modelName: "gpt-5.4-mini",
      openrouterId: "openai/gpt-5.4-mini",
      contextWindow: 400000,
      supportsTools: true,
      supportsVision: true,
      supportsReasoning: true,
      costPer1kIn: "0.00075",
      costPer1kOut: "0.0045",
      dailyTokenCap: 2_500_000,
    },
    {
      id: "llmmodel_openai_gpt_5_4_nano",
      slug: "gpt-5.4-nano",
      displayName: "GPT-5.4 nano",
      providerId: "llmprov_openai_cloud",
      modelName: "gpt-5.4-nano",
      openrouterId: "openai/gpt-5.4-nano",
      contextWindow: 400000,
      supportsTools: true,
      supportsVision: true,
      supportsReasoning: true,
      costPer1kIn: "0.0002",
      costPer1kOut: "0.00125",
      dailyTokenCap: 2_500_000,
    },
    {
      id: "llmmodel_openai_o3",
      slug: "o3",
      displayName: "o3",
      providerId: "llmprov_openai_cloud",
      modelName: "o3",
      openrouterId: "openai/o3",
      contextWindow: 200000,
      supportsTools: true,
      supportsVision: true,
      supportsReasoning: true,
      costPer1kIn: "0.002",
      costPer1kOut: "0.008",
      dailyTokenCap: 250_000,
    },
    {
      id: "llmmodel_openai_o4_mini",
      slug: "o4-mini",
      displayName: "o4-mini",
      providerId: "llmprov_openai_cloud",
      modelName: "o4-mini",
      openrouterId: "openai/o4-mini",
      contextWindow: 200000,
      supportsTools: true,
      supportsVision: true,
      supportsReasoning: true,
      costPer1kIn: "0.00055",
      costPer1kOut: "0.0022",
      dailyTokenCap: 2_500_000,
    },
    {
      id: "llmmodel_openai_gpt_4_1",
      slug: "gpt-4.1",
      displayName: "GPT-4.1",
      providerId: "llmprov_openai_cloud",
      modelName: "gpt-4.1",
      openrouterId: "openai/gpt-4.1",
      contextWindow: 1000000,
      supportsTools: true,
      supportsVision: true,
      supportsReasoning: false,
      costPer1kIn: "0.002",
      costPer1kOut: "0.008",
      dailyTokenCap: 250_000,
    },
    {
      id: "llmmodel_openai_gpt_4_1_mini",
      slug: "gpt-4.1-mini",
      displayName: "GPT-4.1 mini",
      providerId: "llmprov_openai_cloud",
      modelName: "gpt-4.1-mini",
      openrouterId: "openai/gpt-4.1-mini",
      contextWindow: 1000000,
      supportsTools: true,
      supportsVision: true,
      supportsReasoning: false,
      costPer1kIn: "0.0004",
      costPer1kOut: "0.0016",
      dailyTokenCap: 2_500_000,
    },
    {
      id: "llmmodel_openai_gpt_4_1_nano",
      slug: "gpt-4.1-nano",
      displayName: "GPT-4.1 nano",
      providerId: "llmprov_openai_cloud",
      modelName: "gpt-4.1-nano",
      openrouterId: "openai/gpt-4.1-nano",
      contextWindow: 1000000,
      supportsTools: true,
      supportsVision: true,
      supportsReasoning: false,
      costPer1kIn: "0.0001",
      costPer1kOut: "0.0004",
      dailyTokenCap: 2_500_000,
    },
    {
      id: "llmmodel_google_gemini_3_1_pro",
      slug: "gemini-3.1-pro-preview",
      displayName: "Gemini 3.1 Pro",
      providerId: "llmprov_google_cloud",
      modelName: "gemini-3.1-pro-preview",
      openrouterId: "google/gemini-3.1-pro-preview",
      contextWindow: 1048576,
      supportsTools: true,
      supportsVision: true,
      supportsReasoning: true,
      costPer1kIn: "0.002",
      costPer1kOut: "0.012",
    },
    {
      id: "llmmodel_google_gemini_3_5_flash",
      slug: "gemini-3.5-flash",
      displayName: "Gemini 3.5 Flash",
      providerId: "llmprov_google_cloud",
      modelName: "gemini-3.5-flash",
      openrouterId: "google/gemini-3.5-flash",
      contextWindow: 1048576,
      supportsTools: true,
      supportsVision: true,
      supportsReasoning: true,
      costPer1kIn: "0.0015",
      costPer1kOut: "0.009",
    },
  ];

  for (const m of models) {
    await prisma.llmModel.upsert({
      where: { slug: m.slug },
      update: {
        displayName: m.displayName,
        providerId: m.providerId,
        modelName: m.modelName,
        openrouterId: m.openrouterId,
        contextWindow: m.contextWindow,
        supportsTools: m.supportsTools,
        supportsVision: m.supportsVision,
        supportsReasoning: m.supportsReasoning,
        dailyTokenCap: m.dailyTokenCap ?? null,
      },
      create: m,
    });
  }
}

// Synthetic `__system__` user owns the default shared pages; order uses 1024 spacing (ORDER_STEP) so admins can insert between.
async function seedDefaultPages() {
  await prisma.user.upsert({
    where: { id: "__system__" },
    update: {},
    create: {
      id: "__system__",
      githubId: "__system__",
      githubLogin: "system",
      email: "system@app.local",
      displayName: "System",
      role: "admin",
      status: "active",
    },
  });

  const defaults: Array<{
    id: string;
    section:
      | "catalog"
      | "selfservice"
      | "workspace"
      | "teams"
      | "observability"
      | "admin"
      | "agents";
    title: string;
    url: string;
    order: number;
  }> = [
    { id: "__page_catalog__", section: "catalog", title: "Catalog", url: "/catalog", order: 1024 },
    {
      id: "__page_scorecards__",
      section: "catalog",
      title: "Scorecards",
      url: "/scorecards",
      order: 3072,
    },

    {
      id: "__page_scaffolder__",
      section: "selfservice",
      title: "Templates",
      url: "/scaffolder",
      order: 1024,
    },
    {
      id: "__page_scaffolder_bindings__",
      section: "selfservice",
      title: "Bindings",
      url: "/scaffolder/bindings",
      order: 2048,
    },
    {
      id: "__page_workspace__",
      section: "workspace",
      title: "Projects",
      url: "/projects",
      order: 1024,
    },
    { id: "__page_agents__", section: "workspace", title: "Agents", url: "/agents", order: 2048 },
    { id: "__page_search__", section: "workspace", title: "Search", url: "/search", order: 3072 },

    { id: "__page_teams__", section: "teams", title: "All teams", url: "/teams", order: 1024 },

    {
      id: "__page_observability__",
      section: "observability",
      title: "Service health",
      url: "/observability",
      order: 1024,
    },
    {
      id: "__page_dora_metrics__",
      section: "observability",
      title: "DORA metrics",
      url: "/dora-metrics",
      order: 2048,
    },

    {
      id: "__page_admin_ai_models__",
      section: "admin",
      title: "AI / Models",
      url: "/admin/ai-models",
      order: 512,
    },
    {
      id: "__page_admin_users__",
      section: "admin",
      title: "Users",
      url: "/admin/users",
      order: 1024,
    },
    {
      id: "__page_admin_audit__",
      section: "admin",
      title: "Audit log",
      url: "/admin/audit",
      order: 2048,
    },
    { id: "__page_admin_jobs__", section: "admin", title: "Jobs", url: "/admin/jobs", order: 3072 },
    {
      id: "__page_admin_mcp__",
      section: "admin",
      title: "MCP tokens",
      url: "/admin/mcp-tokens",
      order: 4096,
    },
  ];

  for (const p of defaults) {
    await prisma.page.upsert({
      where: { id: p.id },
      update: {},
      create: {
        id: p.id,
        ownerUserId: "__system__",
        section: p.section,
        title: p.title,
        url: p.url,
        order: p.order,
        isFolder: false,
        type: "LINK",
        scope: "SHARED",
      },
    });
  }
}

// Starter scorecards. Idempotent by slug; rules are only seeded on first create so re-seeding keeps edits.
async function seedDefaultScorecards() {
  const scorecards: Array<{
    slug: string;
    name: string;
    description: string;
    appliesTo: CatalogEntityKind[];
    tierStyle: ScorecardTierStyle;
    rules: Array<{
      key: string;
      label: string;
      kind: string;
      config: Prisma.InputJsonValue;
      weight: number;
      tier: string;
    }>;
  }> = [
    {
      slug: "production-readiness",
      name: "Production Readiness",
      description:
        "Baseline ownership, metadata, and delivery signals every production service should meet.",
      appliesTo: ["service", "api"],
      tierStyle: "stage",
      rules: [
        {
          key: "has-owner",
          label: "Has an owning team",
          kind: "has_owner",
          config: {},
          weight: 3,
          tier: "bronze",
        },
        {
          key: "has-description",
          label: "Has a description",
          kind: "field_present",
          config: { field: "description" },
          weight: 1,
          tier: "bronze",
        },
        {
          key: "in-production",
          label: "Lifecycle is production",
          kind: "lifecycle_in",
          config: { values: ["production"] },
          weight: 2,
          tier: "silver",
        },
        {
          key: "tier-1-tag",
          label: "Tagged tier-1",
          kind: "tag_present",
          config: { tag: "tier-1" },
          weight: 1,
          tier: "silver",
        },
        {
          key: "deploy-frequency",
          label: "Deploys at least every 10 days",
          kind: "dora_threshold",
          config: { metric: "deployFrequencyPerDay", op: "gte", value: 0.1, window: "latest" },
          weight: 2,
          tier: "gold",
        },
      ],
    },
    {
      slug: "operational-health",
      name: "Operational Health",
      description: "DORA based delivery and reliability thresholds, from baseline to elite.",
      appliesTo: [],
      tierStyle: "threshold",
      rules: [
        {
          key: "cfr-baseline",
          label: "Change failure rate under 50%",
          kind: "dora_threshold",
          config: { metric: "changeFailureRate", op: "lte", value: 0.5, window: "30d" },
          weight: 1,
          tier: "red",
        },
        {
          key: "mttr-48h",
          label: "MTTR under 48 hours",
          kind: "dora_threshold",
          config: { metric: "mttrHours", op: "lte", value: 48, window: "30d" },
          weight: 1,
          tier: "orange",
        },
        {
          key: "cfr-good",
          label: "Change failure rate under 20%",
          kind: "dora_threshold",
          config: { metric: "changeFailureRate", op: "lte", value: 0.2, window: "30d" },
          weight: 2,
          tier: "yellow",
        },
        {
          key: "deploy-daily",
          label: "Deploys at least daily",
          kind: "dora_threshold",
          config: { metric: "deployFrequencyPerDay", op: "gte", value: 1, window: "latest" },
          weight: 2,
          tier: "green",
        },
      ],
    },
  ];

  for (const sc of scorecards) {
    await prisma.scorecard.upsert({
      where: { slug: sc.slug },
      update: {
        name: sc.name,
        description: sc.description,
        appliesTo: sc.appliesTo,
        tierStyle: sc.tierStyle,
      },
      create: {
        slug: sc.slug,
        name: sc.name,
        description: sc.description,
        appliesTo: sc.appliesTo,
        tierStyle: sc.tierStyle,
        rules: { create: sc.rules },
      },
    });
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
