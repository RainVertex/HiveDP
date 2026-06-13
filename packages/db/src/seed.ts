// Idempotent database seed: LLM provider/model registry, built-in agents, default pages, and team policies.
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
  await seedTeamPolicies();
  await seedDefaultScorecards();

  // Catalog Enricher system prompt. seed.ts is the sole source; the agent reads it from the DB row at runtime.
  const enricherInstructions = `You are the Catalog Enricher.

Given a catalog entity id, make its repository's catalog-info.yaml complete,
exactly as a careful human contributor would, by opening a pull request. The
catalog-info.yaml is the source of truth; the platform database is derived from
it automatically once the PR merges.

Steps:
- Call catalog_lookup first to see the current entity (name, kind, description,
  owners, tags, repoUrl).
- Call catalog_read_repo to inspect the repository (description, topics, primary
  language, root files). Call catalog_read_file for the README, manifests
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
- Otherwise call catalog_open_yaml_pr with the full yaml; it validates and opens
  (or updates) the PR. Then reply with one sentence and the PR URL.

Aim for at most 8 tool calls. Do not loop.`;

  await prisma.agent.upsert({
    where: { id: "seed-agent-catalog-enricher" },
    update: {
      instructions: enricherInstructions,
      modelId: "llmmodel_claude_sonnet_4_6",
      toolIds: ["catalog_lookup", "catalog_read_repo", "catalog_read_file", "catalog_open_yaml_pr"],
      approvalMode: "auto",
      category: "Catalog & Quality",
      avatarUrl: "/agents/presets/catalog-enricher.svg",
    },
    create: {
      id: "seed-agent-catalog-enricher",
      name: "Catalog Enricher",
      description: "Fills missing metadata on catalog entities using Claude.",
      kind: "catalog-enrichment",
      modelId: "llmmodel_claude_sonnet_4_6",
      instructions: enricherInstructions,
      toolIds: ["catalog_lookup", "catalog_read_repo", "catalog_read_file", "catalog_open_yaml_pr"],
      approvalMode: "auto",
      maxToolCalls: 10,
      category: "Catalog & Quality",
      avatarUrl: "/agents/presets/catalog-enricher.svg",
    },
  });

  await seedPlatformAssistant();

  // Backing User (userKind='agent') per agent so agents can be assigned to tasks and granted access like teammates. Idempotent; also backfills any agent created before the link existed.
  const allAgents = await prisma.agent.findMany({
    select: { id: true, name: true, avatarUrl: true },
  });
  for (const a of allAgents) {
    await ensureAgentBackingUser(a.id, { name: a.name, avatarUrl: a.avatarUrl });
  }

  console.log("Seed complete.");
}

// Prompt and tool ids mirror features/chat/backend/src/{prompts.ts,tools/index.ts}; keep both in sync.
async function seedPlatformAssistant() {
  // Chat resolves its model from SystemSetting "chat.activeModelId" at request time; this FK value is unused.
  // chat.activeModelId is deliberately left unseeded so the assistant stays not-configured until an admin picks a model.
  const placeholderModelId = "llmmodel_qwen3_8b_local";
  const writesEnabled = process.env.CHAT_WRITE_TOOLS_ENABLED !== "false";

  const readToolIds = [
    "whoami",
    "get_today",
    "teams_list_mine",
    "teams_get",
    "teams_list_members",
    "requests_my_pending",
    "requests_my_team_requests",
    "requests_my_maintainer_requests",
    "catalog_search",
    "catalog_get_entity",
    "catalog_owned_by_team",
    "org_list_departments",
    "org_get_department",
    "notifications_my_unread",
    "integrations_list_github",
  ];
  const writeToolIds = ["team_request_prepare", "team_request_submit"];
  const toolIds = writesEnabled ? [...readToolIds, ...writeToolIds] : [...readToolIds];

  const instructions = `You are the engineering platform assistant.
You help the current user with their work, teams, requests, and catalog,
and you handle self-service actions on their behalf.

Tools execute on the server; the user cannot run them. Emit tool_calls
yourself — never ask the user to run one. When you intend to do something,
emit the tool_call; do not narrate that you will.

Reads:
- Call whoami once at the start of a new conversation.
- Call get_today before any "today/this week" question.
- Parallelize independent reads.

Writes (prepare → confirm → submit):
1. Ask follow-ups only for missing required slots — one or two questions, not
   a wall.
2. Once required slots are filled, emit *_prepare immediately. It is read-only
   validation, not a write; do not pre-ask "is this correct?". The result
   includes a short handle like "prv_01".
3. After *_prepare returns, paraphrase its serverSummary and the key parsed
   parameters (e.g. slug, name, mirror target) in one short paragraph,
   briefly list the side effects, and ask the user to reply "confirm" or
   "cancel". There is no preview card UI — the user only sees your text.
4. On confirmation, emit *_submit({ handle: "prv_NN" }) using the handle
   from *_prepare or the system note about pending previews. Never invent
   one.
5. Report the result only after *_submit returns.

For githubIntegrationId on team_request_prepare: pass the GitHub org/account
login (e.g. "acme-corp") — the resolver matches accountLogin case-
insensitively. Never ask the user for a cuid. If unsure what's connected,
call integrations_list_github first. If mirror_target_exists fails because
nothing is connected, tell the user to install a GitHub App in Settings →
Integrations.`;

  await prisma.agent.upsert({
    where: { id: "seed-agent-assistant" },
    update: {
      instructions,
      toolIds,
      approvalMode: "ask",
      category: "Plan & Coordinate",
      avatarUrl: "/agents/presets/platform-assistant.svg",
    },
    create: {
      id: "seed-agent-assistant",
      name: "Platform Assistant",
      description: "Interactive chatbot for the engineering platform.",
      kind: "platform-assistant",
      modelId: placeholderModelId,
      instructions,
      toolIds,
      approvalMode: "ask",
      maxToolCalls: 12,
      category: "Plan & Coordinate",
      avatarUrl: "/agents/presets/platform-assistant.svg",
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
    contextWindow: number;
    supportsTools: boolean;
    supportsVision: boolean;
    costPer1kIn: string | null;
    costPer1kOut: string | null;
  }> = [
    {
      id: "llmmodel_qwen3_8b_local",
      slug: "qwen3-8b-local",
      displayName: "Qwen3 8B (local, thinking)",
      providerId: "llmprov_ollama_local",
      modelName: "qwen3:8b",
      contextWindow: 32768,
      supportsTools: true,
      supportsVision: false,
      costPer1kIn: null,
      costPer1kOut: null,
    },
    {
      id: "llmmodel_qwen25vl_7b_local",
      slug: "qwen2.5vl-7b-local",
      displayName: "Qwen2.5 VL 7B (local, vision)",
      providerId: "llmprov_ollama_local",
      modelName: "qwen2.5vl:7b",
      contextWindow: 32768,
      supportsTools: false,
      supportsVision: true,
      costPer1kIn: null,
      costPer1kOut: null,
    },
    {
      id: "llmmodel_claude_opus_4_7",
      slug: "claude-opus-4-7",
      displayName: "Claude Opus 4.7",
      providerId: "llmprov_anthropic_cloud",
      modelName: "claude-opus-4-7",
      contextWindow: 200000,
      supportsTools: true,
      supportsVision: true,
      costPer1kIn: "0.015",
      costPer1kOut: "0.075",
    },
    {
      id: "llmmodel_claude_sonnet_4_6",
      slug: "claude-sonnet-4-6",
      displayName: "Claude Sonnet 4.6",
      providerId: "llmprov_anthropic_cloud",
      modelName: "claude-sonnet-4-6",
      contextWindow: 200000,
      supportsTools: true,
      supportsVision: true,
      costPer1kIn: "0.003",
      costPer1kOut: "0.015",
    },
    {
      id: "llmmodel_claude_haiku_4_5",
      slug: "claude-haiku-4-5-20251001",
      displayName: "Claude Haiku 4.5",
      providerId: "llmprov_anthropic_cloud",
      modelName: "claude-haiku-4-5-20251001",
      contextWindow: 200000,
      supportsTools: true,
      supportsVision: true,
      costPer1kIn: "0.0008",
      costPer1kOut: "0.004",
    },
    {
      id: "llmmodel_openai_gpt_4o",
      slug: "gpt-4o",
      displayName: "GPT-4o",
      providerId: "llmprov_openai_cloud",
      modelName: "gpt-4o",
      contextWindow: 128000,
      supportsTools: true,
      supportsVision: true,
      costPer1kIn: "0.0025",
      costPer1kOut: "0.01",
    },
    {
      id: "llmmodel_openai_gpt_4o_mini",
      slug: "gpt-4o-mini",
      displayName: "GPT-4o mini",
      providerId: "llmprov_openai_cloud",
      modelName: "gpt-4o-mini",
      contextWindow: 128000,
      supportsTools: true,
      supportsVision: true,
      costPer1kIn: "0.00015",
      costPer1kOut: "0.0006",
    },
  ];

  for (const m of models) {
    await prisma.llmModel.upsert({
      where: { slug: m.slug },
      update: {
        displayName: m.displayName,
        providerId: m.providerId,
        modelName: m.modelName,
        contextWindow: m.contextWindow,
        supportsTools: m.supportsTools,
        supportsVision: m.supportsVision,
        costPer1kIn: m.costPer1kIn,
        costPer1kOut: m.costPer1kOut,
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
      | "requests"
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
      id: "__page_self_service_request_team__",
      section: "selfservice",
      title: "Request a team",
      url: "/self-service/request-team",
      order: 4096,
    },
    {
      id: "__page_self_service_request_maintainer__",
      section: "selfservice",
      title: "Request maintainership",
      url: "/self-service/request-maintainer",
      order: 5120,
    },

    {
      id: "__page_my_requests_team__",
      section: "requests",
      title: "My Requests",
      url: "/requests/team",
      order: 1024,
    },
    {
      id: "__page_my_approvals_team__",
      section: "requests",
      title: "My Approvals",
      url: "/approvals/team",
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
    {
      id: "__page_admin_team_requests__",
      section: "admin",
      title: "Team requests",
      url: "/admin/team-requests",
      order: 5120,
    },
    {
      id: "__page_admin_team_templates__",
      section: "admin",
      title: "Team templates",
      url: "/admin/team-templates",
      order: 6144,
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

// A new policy kind needs an enum migration, a validator in features/teams/backend/src/policies.ts, and a row here.
async function seedTeamPolicies() {
  await prisma.teamPolicy.upsert({
    where: { kind: "name_pattern" },
    update: {},
    create: {
      id: "seed_team_policy_name_pattern",
      kind: "name_pattern",
      enabled: true,
      config: { requireSuffix: "-team", requireHyphenSeparation: true },
      description:
        "Team slugs must use hyphens between words and end with -team (e.g. backend-team, data-platform-team).",
    },
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
