import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

loadEnv({ path: resolve(__dirname, "../../../.env") });

import { prisma } from "./index";

async function main() {
  console.log("Seeding database…");

  // Provider/model registry must exist before any Agent row (Agent.modelId FK).
  await seedLlmProviders();

  // Static defaults that don't depend on any user/team.
  await seedDefaultPages();
  await seedTeamPolicies();

  // Seed users first so team memberships have real User rows to link.
  // GitHub identifiers use a stable `seed-` prefix so they don't collide
  // with real OAuth-issued ids if the same database is later used by a real
  // GitHub login.
  const platformEngineerUser = await prisma.user.upsert({
    where: { email: "platform.engineer@example.com" },
    update: {},
    create: {
      githubId: "seed-platform-eng",
      githubLogin: "seed-platform-eng",
      email: "platform.engineer@example.com",
      displayName: "Platform Engineer",
      role: "member",
    },
  });

  const adaUser = await prisma.user.upsert({
    where: { email: "ada@example.com" },
    update: {},
    create: {
      githubId: "seed-ada",
      githubLogin: "seed-ada",
      email: "ada@example.com",
      displayName: "Ada Lovelace",
      role: "member",
    },
  });

  // Slug uniqueness is enforced by a partial unique index (live teams only),
  // so Prisma's generated WhereUniqueInput no longer accepts {slug}. Use
  // findFirst-then-create to keep the seed idempotent.
  const platformTeam =
    (await prisma.team.findFirst({ where: { slug: "platform", deletedAt: null } })) ??
    (await prisma.team.create({
      data: {
        slug: "platform",
        name: "Platform Team",
        description: "Owns shared infrastructure, CI, observability.",
      },
    }));

  const productTeam =
    (await prisma.team.findFirst({ where: { slug: "product", deletedAt: null } })) ??
    (await prisma.team.create({
      data: {
        slug: "product",
        name: "Product Team",
        description: "Builds customer-facing features.",
      },
    }));

  // Multi-team membership demo: Ada is also a member of platform.
  await prisma.teamMembership.createMany({
    data: [
      { teamId: platformTeam.id, userId: platformEngineerUser.id, role: "lead" },
      { teamId: platformTeam.id, userId: adaUser.id, role: "member" },
      { teamId: productTeam.id, userId: adaUser.id, role: "lead" },
    ],
    skipDuplicates: true,
  });

  await prisma.catalogEntity.upsert({
    where: { id: "seed-catalog-api" },
    update: { source: "seed" },
    create: {
      id: "seed-catalog-api",
      name: "platform-api",
      description: "Main REST API.",
      kind: "api",
      lifecycle: "production",
      repoUrl: "https://github.com/example/platform-api",
      tags: ["rest", "express", "typescript", "on-call"],
      source: "seed",
      yamlSpec: {
        metadata: {
          annotations: {
            "github.com/language": "TypeScript",
            "grafana.com/dashboard-url": "https://grafana.example.com/d/platform-api",
            "prometheus.io/url": "https://prom.example.com/graph?g0.expr=platform_api",
            "datadoghq.com/dashboard-url": "https://app.datadoghq.com/dashboard/platform-api",
            "slack.com/channel": "#team-platform",
            "slack.com/url": "https://example.slack.com/archives/C0123456789",
            "pagerduty.com/service-id": "P12345A",
            "on-call": "platform-oncall@example.com",
          },
          links: [
            { url: "https://runbooks.example.com/platform-api", title: "Runbook", type: "runbook" },
            { url: "https://docs.example.com/platform-api", title: "API Docs", type: "docs" },
          ],
        },
        spec: { type: "rest-api", lifecycle: "production" },
      },
    },
  });

  // Multi-team ownership demo: platform-api is co-owned by platform + product.
  await prisma.catalogEntityOwner.createMany({
    data: [
      { entityId: "seed-catalog-api", teamId: platformTeam.id },
      { entityId: "seed-catalog-api", teamId: productTeam.id },
    ],
    skipDuplicates: true,
  });

  await prisma.catalogEntity.upsert({
    where: { id: "seed-catalog-web" },
    update: { source: "seed" },
    create: {
      id: "seed-catalog-web",
      name: "platform-web",
      description: "Engineering portal frontend.",
      kind: "website",
      lifecycle: "production",
      repoUrl: "https://github.com/example/platform-web",
      tags: ["react", "vite", "tailwind"],
      source: "seed",
      yamlSpec: {
        metadata: {
          annotations: {
            "github.com/language": "TypeScript",
            "grafana.com/dashboard-url": "https://grafana.example.com/d/platform-web",
            "slack.com/channel": "#team-product",
            "on-call": "ada@example.com",
          },
          links: [
            { url: "https://docs.example.com/platform-web", title: "User Guide", type: "docs" },
          ],
        },
      },
    },
  });

  await prisma.catalogEntityOwner.upsert({
    where: { entityId_teamId: { entityId: "seed-catalog-web", teamId: productTeam.id } },
    update: {},
    create: { entityId: "seed-catalog-web", teamId: productTeam.id },
  });

  // Workspace seed data (projects/tasks/notes) was removed when the workspace
  // module became a Plane integration mirror. Connect a Plane workspace via
  // the Integrations page to populate /workspace.

  // Catalog enricher agent. The provider/model registry is created by the
  // agent_provider_registry migration with stable IDs, so we can reference
  // the Sonnet model row directly. The instructions string mirrors
  // ENRICHER_SYSTEM_PROMPT in features/agents/backend/src/executor.ts —
  // duplicated here because @internal/db cannot import from feature workspaces.
  // If you change one, change both.
  const enricherInstructions = `You are the Catalog Enricher agent.

You inspect a single software catalog entity and reconcile it against the
catalog-info.yaml file in the entity's repository. For every meaningful
divergence between the database row and what discovery returns, you call the
\`catalog_propose_drift\` tool to record the proposal for human review.

Rules:
- Always call \`catalog_lookup\` first to fetch the up-to-date entity.
- If the entity has a repoUrl, call \`catalog_discover\` to fetch the
  catalog-info.yaml. The discovery service already writes any new entities it
  finds; your job is to identify drift on the entity you were given.
- Compare the DB row against the discovered yamlSpec. Propose drift for any
  field that differs (description, ownerTeamIds, repoUrl, tags). Do not
  propose drift on fields the YAML omits — null in YAML means "unspecified",
  not "should be cleared".
- Bidirectional reconciliation: if the DB row's source is "manual" and was
  edited recently, prefer the DB; flag the YAML as outdated. If the DB
  row's source is "discovery" or "scaffolder", prefer the YAML.
- One drift per logical change, not per field. Bundle related field updates
  into a single proposal with kind="field-mismatch".
- If no catalog-info.yaml exists in the repo, propose a single drift with
  kind="missing-yaml" and a suggested YAML body in the diff.
- When you're done, respond with a one-sentence summary of what you found.
  Do not loop forever; aim for at most 5 tool calls per run.`;

  await upsertAgentBackingUser({
    id: "agentuser-seed-agent-catalog-enricher",
    agentId: "seed-agent-catalog-enricher",
    displayName: "Catalog Enricher",
  });

  await prisma.agent.upsert({
    where: { id: "seed-agent-catalog-enricher" },
    update: {
      instructions: enricherInstructions,
      modelId: "llmmodel_claude_sonnet_4_6",
      toolIds: ["catalog_lookup", "catalog_discover", "catalog_propose_drift"],
    },
    create: {
      id: "seed-agent-catalog-enricher",
      name: "Catalog Enricher",
      description: "Fills missing metadata on catalog entities using Claude.",
      kind: "catalog-enrichment",
      status: "idle",
      modelId: "llmmodel_claude_sonnet_4_6",
      instructions: enricherInstructions,
      toolIds: ["catalog_lookup", "catalog_discover", "catalog_propose_drift"],
      maxToolCalls: 6,
      userId: "agentuser-seed-agent-catalog-enricher",
    },
  });

  await seedPlatformAssistant();

  await seedScorecards();
  await seedDevDocs();

  console.log("Seed complete.");
}

// =============================================================================
// Platform Assistant agent
//
// Seeds the chatbot agent that drives /api/chat. Tool ids and the system
// prompt mirror features/chat/backend/src/prompts.ts and the read/write
// tool aggregator at features/chat/backend/src/tools/index.ts. Kept inline
// here (rather than imported) so @internal/db stays free of feature-backend
// dependencies — feature backends depend on @internal/db, not the other way
// around. If you change the prompt or tool list, update both places.
//
// Env overrides:
//   CHAT_LLM_MODEL_ID         — default llmmodel_qwen3_8b_local
//   CHAT_WRITE_TOOLS_ENABLED  — "false" omits write tools (read-only assistant)
// =============================================================================

async function seedPlatformAssistant() {
  const modelId = process.env.CHAT_LLM_MODEL_ID ?? "llmmodel_qwen3_8b_local";
  const writesEnabled = process.env.CHAT_WRITE_TOOLS_ENABLED !== "false";

  const readToolIds = [
    "whoami",
    "get_today",
    "workspace_my_work",
    "workspace_my_open_items",
    "workspace_get_workitem",
    "workspace_team_work",
    "workspace_list_sprints",
    "workspace_get_sprint",
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
You help the current user understand their work, teams, requests, and catalog,
and you help them perform self-service actions.

CRITICAL — HOW TOOLS WORK:
You have DIRECT ACCESS to a set of tools. When you need information or want
to take an action, you MUST invoke the tool yourself by emitting a tool_call.
The tools execute on the server and their results come back to you.

NEVER ask the user to run a tool. NEVER say things like:
  "Can you run the whoami tool for me?"
  "Please call get_today."
  "Could you check workspace_my_work?"
The user is a human; they cannot run tools. You are the only one who can.
If you find yourself about to ask the user to do something a tool can do,
stop and just call the tool instead.

PROSE IS NOT ACTION:
If you write text saying you "prepared", "submitted", "created", "sent",
or "registered" something but you did NOT emit a tool_call in the same
reply, you have lied to the user. The user sees no real-world effect from
your prose — only tool_calls produce effects. When you intend to do
something, EMIT THE TOOL_CALL — do not announce it, do not ask permission,
do not narrate.

READ behavior:
- Call whoami once at the start of a new conversation to learn who is asking
  — invoke the tool yourself, do not ask the user.
- Call get_today before answering any "today/this week" question — never
  guess the date, and never ask the user for it if get_today exists.
- Prefer calling tools over speculating. If a tool returns nothing, say so
  plainly.
- Never claim access to data outside what tools return.
- Multiple tools can be called in a single turn (in parallel for reads).
  Front-load tool calls when the answer needs several pieces of data.

WRITE behavior (slot-filling + confirmation loop):
When a user expresses intent to perform an action:
1. Identify the matching *_prepare tool.
2. Check which required parameters are missing from the conversation so far.
3. Ask follow-up questions to fill missing slots — one or two at a time, never
   a wall of questions. Quote the policy constraints from the tool description
   so the user knows the rules upfront.
4. AS SOON AS all required slots are filled, IMMEDIATELY emit a tool_call
   to *_prepare. Do NOT first ask "is this correct?" — *_prepare is
   read-only validation, not a destructive action. It returns a structured
   preview card the user reviews. The result includes a short handle like
   "prv_01".
5. After *_prepare returns, briefly note the preview is ready (the UI
   shows the card) and ask for explicit confirmation.
6. On EXPLICIT confirmation, IMMEDIATELY emit a tool_call to *_submit
   with { handle: "prv_NN" }. Do NOT first reply with prose like "I'll
   submit it now" — call the tool. Do not invent or guess handle values;
   use the one returned by *_prepare or the one listed in the system
   note about pending previews.
7. Report the result (request ID, link, what happens next) AFTER the
   *_submit tool has actually returned.

Confirmation rules:
- Treat as confirmation: "yes", "confirm", "submit", "go ahead", "do it",
  "proceed", "yes please", clicking the Confirm button (which sends
  "Confirm submission").
- Treat as cancellation: "no", "cancel", "stop", "wait", "let me change X",
  clicking the Cancel button.
- Anything ambiguous ("hmm okay", "sure I guess", "maybe") -> ask once more
  with a yes/no question. Never interpret ambiguous replies as confirmation.

Hard rules:
- Never call a *_submit tool without first calling *_prepare for the same
  action, in the same turn or earlier in the conversation.
- Never call a *_submit tool without explicit user confirmation between the
  prepare and the submit.
- If a prepare returns policy violations, surface them and either ask the
  user to correct the input or stop; do not attempt to bypass.
- When the user asks for multiple actions of the same kind in one request,
  prepare and submit them one at a time. Do not call the same *_prepare tool
  twice in a single turn — the second call would supersede the first.
- For githubIntegrationId on team_request_prepare: NEVER ask the user for
  a cuid — humans don't memorize them. The field accepts either the org
  login OR the cuid; the resolver matches accountLogin case-insensitively.
  Ask for the GitHub org/account name and pass it directly, or call
  integrations_list_github first if you need to confirm what's connected.
  If exactly one installation is enabled, proceed after confirming the
  org login in your reply. If the prepare check mirror_target_exists
  fails because nothing is connected, tell the user no GitHub App is
  connected yet (Settings → Integrations) — do NOT call this a wrong
  "id". If other orgs are connected but none match, list them and ask
  the user to pick one.

Examples of CORRECT behavior:

User: "hey"
You [emit tool_call to whoami with no arguments — do not respond with text yet]
[tool result arrives showing the user's name, role, teams]
You: "Hi <name>! What can I help you with — looking at your work today,
      checking on a request, or something else?"

User: "what's on my plate today?"
You [emit tool_call to get_today with no arguments]
You [emit tool_call to workspace_my_work with no arguments]
[tool results arrive]
You: "You have 3 items due today: <list>..."

User: "who owns billing-api?"
You [emit tool_call to catalog_search with { query: "billing-api" }]
[tool result arrives with one hit]
You [emit tool_call to catalog_get_entity with { entityId: "<id>" }]
[tool result arrives]
You: "billing-api is owned by the payments-team."`;

  await upsertAgentBackingUser({
    id: "agentuser-seed-agent-assistant",
    agentId: "seed-agent-assistant",
    displayName: "Platform Assistant",
  });

  await prisma.agent.upsert({
    where: { id: "seed-agent-assistant" },
    update: {
      instructions,
      modelId,
      toolIds,
    },
    create: {
      id: "seed-agent-assistant",
      name: "Platform Assistant",
      description: "Interactive chatbot for the engineering platform.",
      kind: "platform-assistant",
      status: "idle",
      modelId,
      instructions,
      toolIds,
      maxToolCalls: 12,
      userId: "agentuser-seed-agent-assistant",
    },
  });
}

// Class-table-inheritance backing User for an Agent (userKind='agent'). The
// agents_section_and_identity migration created these for pre-existing agents;
// seed agents need them created here before the agent.upsert can satisfy
// Agent.userId NOT NULL.
async function upsertAgentBackingUser(input: { id: string; agentId: string; displayName: string }) {
  await prisma.user.upsert({
    where: { id: input.id },
    update: {},
    create: {
      id: input.id,
      githubId: `agent-bot-${input.agentId}`,
      githubLogin: `agent-bot-${input.agentId}`,
      email: `${input.agentId}@agents.local`,
      displayName: input.displayName,
      role: "member",
      userKind: "agent",
    },
  });
}

async function seedDevDocs() {
  const samples: Array<{
    entityId: string;
    slug: string;
    path: string;
    title: string;
    body: string;
    daysOld: number;
    author: string;
  }> = [
    {
      entityId: "seed-catalog-api",
      slug: "index",
      path: "docs/index.md",
      title: "Platform API",
      body:
        "# Platform API\n\n" +
        "The platform API is the main REST surface for the engineering portal. It serves the catalog, scaffolder, observability, and DORA metrics features.\n\n" +
        "## Quickstart\n\n" +
        "```bash\nyarn workspace @internal/backend dev\n```\n\n" +
        "Then visit http://localhost:3010.\n\n" +
        "See [Architecture](?p=architecture) for a high-level overview.\n",
      daysOld: 4,
      author: "platform.engineer",
    },
    {
      entityId: "seed-catalog-api",
      slug: "architecture",
      path: "docs/architecture.md",
      title: "Architecture",
      body:
        "# Architecture\n\n" +
        "The platform API is an Express 5 server. Each feature contributes a Router that the api app mounts under `/api/<feature>`. Backends are framework-agnostic and may also expose background jobs via the catalog jobs registry.\n\n" +
        "## Data layer\n\n" +
        "Prisma against Postgres, accessed through `@internal/db`. Migrations live under `packages/db/prisma/migrations/`.\n\n" +
        "## Search\n\n" +
        "Postgres full-text search via `tsvector` + GIN. DevDocs pages are indexed alongside catalog/team/agent rows.\n",
      daysOld: 14,
      author: "platform.engineer",
    },
    {
      entityId: "seed-catalog-api",
      slug: "runbook",
      path: "docs/runbook.md",
      title: "Runbook",
      body:
        "# Runbook\n\n" +
        "## On-call escalations\n\n" +
        "1. Check the [latency dashboard](https://grafana.example.com/d/platform-api).\n" +
        "2. If 5xx > 1%, page the platform on-call rotation.\n" +
        "3. For database connection saturation, scale the app (HPA bumps to 10 replicas).\n\n" +
        "## Deploy rollback\n\n" +
        "Use `kubectl rollout undo deploy/platform-api`.\n",
      daysOld: 120,
      author: "platform.engineer",
    },
    {
      entityId: "seed-catalog-web",
      slug: "index",
      path: "README.md",
      title: "Overview",
      body:
        "# Engineering Portal\n\n" +
        "Vite + React frontend that renders the catalog, scorecards, scaffolder UI, DORA metrics, and DevDocs.\n\n" +
        "Run `yarn dev:app` to start.\n",
      daysOld: 2,
      author: "ada",
    },
  ];

  for (const s of samples) {
    const lastCommitAt = new Date(Date.now() - s.daysOld * 24 * 60 * 60 * 1000);
    await prisma.docPage.upsert({
      where: { entityId_slug: { entityId: s.entityId, slug: s.slug } },
      update: {
        path: s.path,
        title: s.title,
        body: s.body,
        sourceRef: `seed:${s.entityId}:${s.path}`,
        lastCommitAt,
        lastCommitBy: s.author,
        lastCommitSha: "seedseedseedseedseed",
      },
      create: {
        entityId: s.entityId,
        slug: s.slug,
        path: s.path,
        title: s.title,
        body: s.body,
        sourceRef: `seed:${s.entityId}:${s.path}`,
        lastCommitAt,
        lastCommitBy: s.author,
        lastCommitSha: "seedseedseedseedseed",
      },
    });
  }

  for (const entityId of ["seed-catalog-api", "seed-catalog-web"]) {
    const pageCount = samples.filter((s) => s.entityId === entityId).length;
    await prisma.docSyncState.upsert({
      where: { entityId },
      update: {
        status: "ok",
        pageCount,
        lastSyncedAt: new Date(),
        resolvedSource: {
          kind: pageCount > 1 ? "docs-dir" : "readme",
          path: pageCount > 1 ? "docs" : "README.md",
        } as object,
      },
      create: {
        entityId,
        status: "ok",
        pageCount,
        lastSyncedAt: new Date(),
        resolvedSource: {
          kind: pageCount > 1 ? "docs-dir" : "readme",
          path: pageCount > 1 ? "docs" : "README.md",
        } as object,
      },
    });
  }
}

async function seedScorecards() {
  // Production Readiness — stage style, services only.
  await upsertScorecard({
    slug: "production-readiness",
    name: "Production Readiness",
    description: "Bronze/silver/gold readiness for services running in production.",
    appliesTo: ["service"],
    tierStyle: "stage",
    rules: [
      {
        key: "has-owner",
        label: "Has an owner team",
        kind: "has_owner",
        config: {},
        tier: "bronze",
      },
      {
        key: "has-repo",
        label: "Repository URL is set",
        kind: "field_present",
        config: { field: "repoUrl" },
        tier: "bronze",
      },
      {
        key: "has-description",
        label: "Description is set",
        kind: "field_present",
        config: { field: "description" },
        tier: "bronze",
      },
      {
        key: "has-on-call",
        label: "On-call rotation tagged",
        kind: "tag_present",
        config: { tag: "on-call" },
        tier: "silver",
      },
      {
        key: "low-cfr",
        label: "Change Failure Rate ≤ 15%",
        kind: "dora_threshold",
        config: { metric: "changeFailureRate", op: "lte", value: 0.15, window: "latest" },
        tier: "gold",
      },
      {
        key: "low-mttr",
        label: "MTTR ≤ 4 hours",
        kind: "dora_threshold",
        config: { metric: "mttrHours", op: "lte", value: 4, window: "latest" },
        tier: "gold",
      },
    ],
  });

  // Catalog Hygiene — threshold style, every kind.
  await upsertScorecard({
    slug: "catalog-hygiene",
    name: "Catalog Hygiene",
    description: "Are this entity's catalog metadata and drift state up to date?",
    appliesTo: [],
    tierStyle: "threshold",
    rules: [
      {
        key: "no-drift-red",
        label: "Fewer than 5 open drifts",
        kind: "drift_count_max",
        config: { status: "open", max: 5 },
        tier: "red",
      },
      {
        key: "no-drift-orange",
        label: "Fewer than 3 open drifts",
        kind: "drift_count_max",
        config: { status: "open", max: 2 },
        tier: "orange",
      },
      {
        key: "no-drift-yellow",
        label: "At most 1 open drift",
        kind: "drift_count_max",
        config: { status: "open", max: 1 },
        tier: "yellow",
      },
      {
        key: "no-drift-green",
        label: "Zero open drift",
        kind: "drift_count_max",
        config: { status: "open", max: 0 },
        tier: "green",
      },
    ],
  });

  // API Maturity — stage style, APIs only.
  await upsertScorecard({
    slug: "api-maturity",
    name: "API Maturity",
    description: "Maturity of catalog-tracked APIs.",
    appliesTo: ["api"],
    tierStyle: "stage",
    rules: [
      {
        key: "has-owner",
        label: "Has an owner team",
        kind: "has_owner",
        config: {},
        tier: "bronze",
      },
      {
        key: "has-description",
        label: "Description is set",
        kind: "field_present",
        config: { field: "description" },
        tier: "silver",
      },
      {
        key: "tagged-public",
        label: "Tagged as public-API",
        kind: "tag_present",
        config: { tag: "public" },
        tier: "gold",
      },
    ],
  });
}

interface SeedScorecardInput {
  slug: string;
  name: string;
  description: string;
  appliesTo: Array<"service" | "api" | "library" | "website" | "database" | "infrastructure">;
  tierStyle: "stage" | "threshold";
  rules: Array<{
    key: string;
    label: string;
    kind: string;
    config: object;
    tier: string;
  }>;
}

async function upsertScorecard(input: SeedScorecardInput) {
  const sc = await prisma.scorecard.upsert({
    where: { slug: input.slug },
    update: {
      name: input.name,
      description: input.description,
      appliesTo: input.appliesTo,
      tierStyle: input.tierStyle,
    },
    create: {
      slug: input.slug,
      name: input.name,
      description: input.description,
      appliesTo: input.appliesTo,
      tierStyle: input.tierStyle,
    },
  });
  // Replace-all rules so the seed is idempotent and can evolve.
  await prisma.scorecardRule.deleteMany({ where: { scorecardId: sc.id } });
  await prisma.scorecardRule.createMany({
    data: input.rules.map((r) => ({ scorecardId: sc.id, ...r })),
  });
}

// =============================================================================
// LLM provider/model registry
//
// Static IDs (not cuids) so existing references in this file
// (`llmmodel_claude_sonnet_4_6`, `llmmodel_qwen3_8b_local`) keep working.
// Slug is unique; upsert by slug keeps re-runs idempotent. Cost is USD per 1k
// tokens; local Qwen leaves cost null.
// =============================================================================

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
        costPer1kIn: m.costPer1kIn,
        costPer1kOut: m.costPer1kOut,
      },
      create: m,
    });
  }
}

// =============================================================================
// Default sidebar pages
//
// Synthetic `__system__` user owns pages that pre-date any real user; admins
// can rename, reorder, or delete them like any other shared page. ORDER values
// use 1024 spacing (matching ORDER_STEP in the pages router) so admins can
// insert between them without renumbering. Hardcoded IDs are stable so re-runs
// don't duplicate.
// =============================================================================

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
    // Catalog
    { id: "__page_catalog__", section: "catalog", title: "Catalog", url: "/catalog", order: 1024 },
    {
      id: "__page_catalog_drift__",
      section: "catalog",
      title: "Drift inbox",
      url: "/catalog/drift",
      order: 2048,
    },
    {
      id: "__page_scorecards__",
      section: "catalog",
      title: "Scorecards",
      url: "/scorecards",
      order: 3072,
    },

    // Self-service
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
      id: "__page_scaffolder_drift__",
      section: "selfservice",
      title: "Drift inbox",
      url: "/scaffolder/drift",
      order: 3072,
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

    // Requests
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

    // Workspace
    {
      id: "__page_workspace__",
      section: "workspace",
      title: "Projects",
      url: "/workspace",
      order: 1024,
    },
    { id: "__page_agents__", section: "workspace", title: "Agents", url: "/agents", order: 2048 },
    { id: "__page_search__", section: "workspace", title: "Search", url: "/search", order: 3072 },

    // Teams
    { id: "__page_teams__", section: "teams", title: "All teams", url: "/teams", order: 1024 },

    // Observability
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

    // Admin
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

// =============================================================================
// Team policies
//
// Single starting policy is `name_pattern` (one row per kind, enforced by the
// unique constraint on TeamPolicy.kind). Adding a new kind = enum migration +
// new validator in features/teams/backend/src/policies.ts + new row here.
// =============================================================================

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
