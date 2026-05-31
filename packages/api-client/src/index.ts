// Typed HTTP client for the platform backend, grouped by resource namespace.
import type {
  AdminUserRow,
  Agent,
  AdminAiModelsResponse,
  ActiveChatModelDto,
  AiRecommendationsDto,
  AgentRun,
  AgentToolsResponse,
  AuditEventRow,
  CatalogEntityKind,
  CatalogEntityOverview,
  CatalogEntityWithOwners,
  CatalogRelationsResponse,
  CreateAgentInput,
  CurrentUser,
  DocCommentRow,
  DocPageDetail,
  DocSearchHit,
  DocStaleReportRow,
  DocsTabResponse,
  DoraMetricsSnapshot,
  GithubDriftSummaryDto,
  GithubInstallationSummary,
  GithubReconciliationRunDto,
  Integration,
  IntegrationDetail,
  JobSummary,
  LlmModelSummary,
  MaintainerRequestDto,
  NotificationDto,
  PageDto,
  PageScope,
  PageSection,
  PageType,
  PageWidgetInstance,
  RunAgentResponse,
  ScaffolderBinding,
  ScaffolderDriftSummaryDto,
  ScaffolderPlan,
  ScaffolderTask,
  ScaffolderTemplateSummary,
  Scorecard,
  ScorecardSummary,
  SearchResults,
  EntityObservabilityConfigDto,
  LokiLogLine,
  ServiceHealthSample,
  TempoTrace,
  TeamDetail,
  TeamMemberRole,
  TeamPolicyDto,
  TeamPolicyKind,
  TeamRequestDto,
  TeamRequestStatus,
  TeamSummary,
  UserRole,
  UserStatus,
  UserSummary,
  UserTaskDto,
  UpdateAgentInput,
  WebhookDeliveryDto,
  WebhookSubscriptionDto,
  ChatConversationSummaryDto,
  ChatConversationDetailDto,
  ChatConfigDto,
  WorkflowRunRow,
  DeploymentRow,
} from "@internal/shared-types";

export interface CreateCatalogEntityInput {
  kind: CatalogEntityKind;
  name: string;
  description?: string;
  ownerTeamIds?: string[];
  repoUrl?: string;
  tags?: string[];
  accountLogin: string;
}

export interface PatchCatalogEntityInput {
  description?: string | null;
  ownerTeamIds?: string[] | null;
  repoUrl?: string | null;
  tags?: string[];
  autoApply?: boolean;
}

export interface ScaffolderTemplateDetail extends ScaffolderTemplateSummary {
  parametersJsonSchema: Record<string, unknown>;
  defaultTarget: { agent: "main" | "branch" | "worktree"; human: "main" | "branch" | "worktree" };
  planTtlSeconds: number;
}

export interface ScaffolderApplyResult {
  taskId: string;
  status: ScaffolderTask["status"];
  output: Record<string, unknown>;
  error: string | null;
  rolledBack: boolean;
}

export interface ApiClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
}

export interface ListResponse<T> {
  items: T[];
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function createApiClient(options: ApiClientOptions = {}) {
  const baseUrl = options.baseUrl ?? "";
  const f = options.fetch ?? fetch;

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await f(`${baseUrl}${path}`, {
      ...init,
      credentials: "include",
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new ApiError(res.status, body.error ?? res.statusText);
    }
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  async function requestAllowing401<T>(path: string): Promise<T | null> {
    const res = await f(`${baseUrl}${path}`, {
      credentials: "include",
      headers: { "content-type": "application/json" },
    });
    if (res.status === 401) return null;
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new ApiError(res.status, body.error ?? res.statusText);
    }
    return res.json() as Promise<T>;
  }

  return {
    health: () => request<{ status: string }>(`/health`),

    auth: {
      me: () => requestAllowing401<CurrentUser>(`/auth/me`),
      logout: () => request<void>(`/auth/logout`, { method: "POST" }),
      signInUrl: () => `${baseUrl}/auth/github`,
    },

    adminUsers: {
      list: () => request<ListResponse<AdminUserRow>>(`/api/admin/users`),
      update: (id: string, patch: { role?: UserRole; status?: UserStatus }) =>
        request<AdminUserRow>(`/api/admin/users/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify(patch),
        }),
      delete: (id: string) =>
        request<void>(`/api/admin/users/${encodeURIComponent(id)}`, {
          method: "DELETE",
        }),
    },

    adminScaffolderMcpTokens: {
      list: () =>
        request<
          ListResponse<{
            id: string;
            userId: string;
            name: string;
            scopes: string[];
            lastUsedAt: string | null;
            expiresAt: string;
            createdAt: string;
          }>
        >(`/api/admin/scaffolder/mcp-tokens`),
      mint: (body: { userId: string; name: string; scopes?: string[]; ttlSeconds?: number }) =>
        request<{ id: string; token: string; expiresAt: string }>(
          `/api/admin/scaffolder/mcp-tokens`,
          { method: "POST", body: JSON.stringify(body) },
        ),
      revoke: (id: string) =>
        request<void>(`/api/admin/scaffolder/mcp-tokens/${encodeURIComponent(id)}`, {
          method: "DELETE",
        }),
    },

    adminJobs: {
      list: () => request<ListResponse<JobSummary>>(`/api/admin/jobs`),
      run: (name: string) =>
        request<{ jobRunId: string }>(`/api/admin/jobs/${encodeURIComponent(name)}/run`, {
          method: "POST",
        }),
      toggle: (name: string, enabled: boolean) =>
        request<{ name: string; enabled: boolean }>(`/api/admin/jobs/${encodeURIComponent(name)}`, {
          method: "PATCH",
          body: JSON.stringify({ enabled }),
        }),
    },

    adminAudit: {
      list: (
        params: {
          kind?: string;
          actorUserId?: string;
          targetKind?: string;
          targetId?: string;
          limit?: number;
        } = {},
      ) => {
        const qs = new URLSearchParams();
        if (params.kind) qs.set("kind", params.kind);
        if (params.actorUserId) qs.set("actorUserId", params.actorUserId);
        if (params.targetKind) qs.set("targetKind", params.targetKind);
        if (params.targetId) qs.set("targetId", params.targetId);
        if (params.limit) qs.set("limit", String(params.limit));
        const q = qs.toString();
        return request<ListResponse<AuditEventRow>>(`/api/admin/audit${q ? `?${q}` : ""}`);
      },
    },

    agents: {
      list: () => request<ListResponse<Agent>>(`/api/agents`),
      get: (id: string) => request<Agent>(`/api/agents/${encodeURIComponent(id)}`),
      create: (body: CreateAgentInput) =>
        request<Agent>(`/api/agents`, { method: "POST", body: JSON.stringify(body) }),
      update: (id: string, body: UpdateAgentInput) =>
        request<Agent>(`/api/agents/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        }),
      delete: (id: string) =>
        request<void>(`/api/agents/${encodeURIComponent(id)}`, { method: "DELETE" }),
      run: (id: string, input: Record<string, unknown> = {}) =>
        request<RunAgentResponse>(`/api/agents/${encodeURIComponent(id)}/run`, {
          method: "POST",
          body: JSON.stringify({ input }),
        }),
      test: (id: string, prompt: string) =>
        request<{
          status: "succeeded" | "failed";
          finalText: string | null;
          tokensInput: number;
          tokensOutput: number;
          costUsd: number | null;
          error: string | null;
          toolCalls: Array<{
            name: string;
            input: unknown;
            output: unknown;
            durationMs: number;
            isError: boolean;
          }>;
        }>(`/api/agents/${encodeURIComponent(id)}/test`, {
          method: "POST",
          body: JSON.stringify({ prompt }),
        }),
      getRun: (id: string, runId: string) =>
        request<AgentRun>(
          `/api/agents/${encodeURIComponent(id)}/runs/${encodeURIComponent(runId)}`,
        ),
      listTools: () => request<AgentToolsResponse>(`/api/agents/tools`),
    },

    llm: {
      listModels: () => request<ListResponse<LlmModelSummary>>(`/api/llm/models`),
      recommendations: (kind: string) =>
        request<AiRecommendationsDto>(`/api/llm/recommendations?kind=${encodeURIComponent(kind)}`),
    },

    adminAi: {
      listModels: () => request<AdminAiModelsResponse>(`/api/admin/ai/models`),
      setModelEnabled: (id: string, enabled: boolean) =>
        request<void>(`/api/admin/ai/models/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify({ enabled }),
        }),
      getActiveChatModel: () => request<ActiveChatModelDto>(`/api/admin/ai/active-chat-model`),
      setActiveChatModel: (modelId: string | null) =>
        request<void>(`/api/admin/ai/active-chat-model`, {
          method: "PUT",
          body: JSON.stringify({ modelId }),
        }),
      setProviderKey: (slug: string, apiKey: string) =>
        request<void>(`/api/admin/ai/providers/${encodeURIComponent(slug)}/key`, {
          method: "PUT",
          body: JSON.stringify({ apiKey }),
        }),
      clearProviderKey: (slug: string) =>
        request<void>(`/api/admin/ai/providers/${encodeURIComponent(slug)}/key`, {
          method: "DELETE",
        }),
    },

    catalog: {
      list: (opts: { allOrgs?: boolean } = {}) => {
        const qs = opts.allOrgs ? "?allOrgs=1" : "";
        return request<ListResponse<CatalogEntityWithOwners>>(`/api/catalog${qs}`);
      },
      get: (id: string) =>
        request<CatalogEntityWithOwners>(`/api/catalog/${encodeURIComponent(id)}`),
      overview: (id: string) =>
        request<CatalogEntityOverview>(`/api/catalog/${encodeURIComponent(id)}/overview`),
      relations: (id: string) =>
        request<CatalogRelationsResponse>(`/api/catalog/${encodeURIComponent(id)}/relations`),
      scorecardsFor: (id: string) =>
        request<ListResponse<ScorecardSummary>>(
          `/api/catalog/${encodeURIComponent(id)}/scorecards`,
        ),
      recomputeScorecards: (id: string) =>
        request<ListResponse<ScorecardSummary>>(
          `/api/catalog/${encodeURIComponent(id)}/scorecards/recompute`,
          { method: "POST" },
        ),
      auditFor: (id: string, limit = 200) =>
        request<ListResponse<AuditEventRow>>(
          `/api/catalog/${encodeURIComponent(id)}/audit?limit=${limit}`,
        ),
      create: (body: CreateCatalogEntityInput) =>
        request<CatalogEntityWithOwners & { action: "created" | "updated" | "noop" }>(
          `/api/catalog`,
          { method: "POST", body: JSON.stringify(body) },
        ),
      update: (id: string, body: PatchCatalogEntityInput) =>
        request<CatalogEntityWithOwners & { action: "created" | "updated" | "noop" }>(
          `/api/catalog/${encodeURIComponent(id)}`,
          { method: "PATCH", body: JSON.stringify(body) },
        ),
      delete: (id: string) =>
        request<void>(`/api/catalog/${encodeURIComponent(id)}`, { method: "DELETE" }),
      applyDrift: (id: string) =>
        request<{ id: string; status: "applied"; entityId: string; action: string }>(
          `/api/catalog/drifts/${encodeURIComponent(id)}/apply`,
          { method: "POST" },
        ),
      ignoreDrift: (id: string) =>
        request<{ id: string; status: "ignored" }>(
          `/api/catalog/drifts/${encodeURIComponent(id)}/ignore`,
          { method: "POST" },
        ),
      listStars: () => request<ListResponse<string>>(`/api/catalog/stars`),
      star: (id: string) =>
        request<void>(`/api/catalog/${encodeURIComponent(id)}/star`, { method: "PUT" }),
      unstar: (id: string) =>
        request<void>(`/api/catalog/${encodeURIComponent(id)}/star`, { method: "DELETE" }),
      pipelineRuns: (id: string, opts?: { limit?: number; branch?: string }) => {
        const params = new URLSearchParams();
        if (opts?.limit) params.set("limit", String(opts.limit));
        if (opts?.branch) params.set("branch", opts.branch);
        const qs = params.toString();
        return request<ListResponse<WorkflowRunRow>>(
          `/api/catalog/${encodeURIComponent(id)}/pipeline-runs${qs ? `?${qs}` : ""}`,
        );
      },
      deployments: (id: string, opts?: { limit?: number; environment?: string }) => {
        const params = new URLSearchParams();
        if (opts?.limit) params.set("limit", String(opts.limit));
        if (opts?.environment) params.set("environment", opts.environment);
        const qs = params.toString();
        return request<ListResponse<DeploymentRow>>(
          `/api/catalog/${encodeURIComponent(id)}/deployments${qs ? `?${qs}` : ""}`,
        );
      },
      refreshPipelines: (id: string) =>
        request<{
          ok: boolean;
          entityId: string;
          runsUpserted: number;
          deploymentsUpserted: number;
          error: string | null;
        }>(`/api/catalog/${encodeURIComponent(id)}/pipelines/refresh`, { method: "POST" }),
    },

    scorecards: {
      list: () => request<ListResponse<Scorecard>>(`/api/scorecards`),
      get: (id: string) => request<Scorecard>(`/api/scorecards/${encodeURIComponent(id)}`),
      create: (body: Partial<Scorecard>) =>
        request<Scorecard>(`/api/scorecards`, {
          method: "POST",
          body: JSON.stringify(body),
        }),
      update: (id: string, body: Partial<Scorecard>) =>
        request<Scorecard>(`/api/scorecards/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        }),
      delete: (id: string) =>
        request<void>(`/api/scorecards/${encodeURIComponent(id)}`, { method: "DELETE" }),
      evaluate: (id: string) =>
        request<{ entities: number; results: number }>(
          `/api/scorecards/${encodeURIComponent(id)}/evaluate`,
          { method: "POST" },
        ),
    },

    doraMetrics: {
      list: () => request<ListResponse<DoraMetricsSnapshot>>(`/api/dora-metrics`),
      forEntity: (entityId: string) =>
        request<ListResponse<DoraMetricsSnapshot>>(
          `/api/dora-metrics/entity/${encodeURIComponent(entityId)}`,
        ),
    },

    integrations: {
      list: () => request<ListResponse<Integration>>(`/api/integrations`),
      get: (id: string) =>
        request<IntegrationDetail>(`/api/integrations/${encodeURIComponent(id)}`),
      probeGrafana: (body: { baseUrl: string; apiToken: string }) =>
        request<{
          datasources: {
            prometheus: Array<{ uid: string; name: string; isDefault: boolean }>;
            loki: Array<{ uid: string; name: string; isDefault: boolean }>;
            tempo: Array<{ uid: string; name: string; isDefault: boolean }>;
          };
          imageRendererAvailable: boolean;
        }>(`/api/integrations/grafana/probe`, { method: "POST", body: JSON.stringify(body) }),
      connectGrafana: (body: {
        name: string;
        baseUrl: string;
        apiToken: string;
        dsUid: { prometheus: string; loki?: string; tempo?: string };
        alertRefireSuppressionMs?: number;
      }) =>
        request<{
          integration: Integration;
          dsUid: { prometheus: string; loki?: string; tempo?: string };
          imageRendererAvailable: boolean;
          webhookSecret: string;
          webhookUrl: string;
        }>(`/api/integrations/grafana`, { method: "POST", body: JSON.stringify(body) }),
      rotateGrafanaToken: (id: string, body: { apiToken: string }) =>
        request<Integration>(`/api/integrations/grafana/${encodeURIComponent(id)}/credentials`, {
          method: "PATCH",
          body: JSON.stringify(body),
        }),
      reprobeGrafana: (id: string) =>
        request<{
          datasources: {
            prometheus: Array<{ uid: string; name: string; isDefault: boolean }>;
            loki: Array<{ uid: string; name: string; isDefault: boolean }>;
            tempo: Array<{ uid: string; name: string; isDefault: boolean }>;
          };
          imageRendererAvailable: boolean;
        }>(`/api/integrations/grafana/${encodeURIComponent(id)}/probe`),
      updateGrafanaConfig: (
        id: string,
        body: {
          dsUid?: { prometheus: string; loki?: string; tempo?: string };
          alertRefireSuppressionMs?: number;
        },
      ) =>
        request<void>(`/api/integrations/grafana/${encodeURIComponent(id)}/config`, {
          method: "PATCH",
          body: JSON.stringify(body),
        }),
      rotateGrafanaWebhookSecret: (id: string) =>
        request<{ webhookSecret: string; webhookUrl: string }>(
          `/api/integrations/grafana/${encodeURIComponent(id)}/rotate-webhook-secret`,
          { method: "POST" },
        ),
      disconnect: (id: string) =>
        request<void>(`/api/integrations/${encodeURIComponent(id)}`, { method: "DELETE" }),
      setEnabled: (id: string, enabled: boolean) =>
        request<Integration>(`/api/integrations/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify({ enabled }),
        }),
      setWebhookSecret: (id: string, webhookSecret: string) =>
        request<void>(`/api/integrations/${encodeURIComponent(id)}/webhook-secret`, {
          method: "PATCH",
          body: JSON.stringify({ webhookSecret }),
        }),
      githubResync: (id: string) =>
        request<GithubReconciliationRunDto>(
          `/api/integrations/github/${encodeURIComponent(id)}/resync`,
          { method: "POST" },
        ),
      githubDrift: (id: string) =>
        request<GithubDriftSummaryDto>(`/api/integrations/github/${encodeURIComponent(id)}/drift`),
      githubInstallations: () =>
        request<ListResponse<GithubInstallationSummary>>(`/api/integrations/github/installations`),
    },

    observability: {
      healthSamples: () =>
        request<ListResponse<ServiceHealthSample>>(`/api/observability/health-samples`),
      healthSamplesForEntity: (entityId: string) =>
        request<ListResponse<ServiceHealthSample>>(
          `/api/observability/health-samples/${encodeURIComponent(entityId)}`,
        ),
      logs: (entityId: string, opts: { minutes?: number; limit?: number } = {}) => {
        const qs = new URLSearchParams({ entityId });
        if (opts.minutes !== undefined) qs.set("minutes", String(opts.minutes));
        if (opts.limit !== undefined) qs.set("limit", String(opts.limit));
        return request<ListResponse<LokiLogLine>>(`/api/observability/logs?${qs.toString()}`);
      },
      trace: (traceId: string, opts: { entityId: string }) => {
        const qs = new URLSearchParams({ entityId: opts.entityId });
        return request<TempoTrace>(
          `/api/observability/traces/${encodeURIComponent(traceId)}?${qs.toString()}`,
        );
      },
      // URL only; the <img> fetch carries the backend-held token. Non-admins must pass entityId to authorize.
      dashboardImageUrl: (params: {
        dashboardUid: string;
        panelId: number;
        from?: string;
        to?: string;
        w?: number;
        h?: number;
        entityId?: string;
      }) => {
        const qs = new URLSearchParams({
          dashboardUid: params.dashboardUid,
          panelId: String(params.panelId),
        });
        if (params.from) qs.set("from", params.from);
        if (params.to) qs.set("to", params.to);
        if (params.w) qs.set("w", String(params.w));
        if (params.h) qs.set("h", String(params.h));
        if (params.entityId) qs.set("entityId", params.entityId);
        return `/api/observability/dashboard-image?${qs.toString()}`;
      },
      getEntityConfig: (entityId: string) =>
        request<EntityObservabilityConfigDto>(
          `/api/observability/entities/${encodeURIComponent(entityId)}/config`,
        ),
      putEntityConfig: (
        entityId: string,
        body: {
          integrationId: string;
          upQuery?: string | null;
          latencyQuery?: string | null;
          errorQuery?: string | null;
          logsSelector?: string | null;
          dashboardUid?: string | null;
          traceIdRegex?: string | null;
        },
      ) =>
        request<EntityObservabilityConfigDto>(
          `/api/observability/entities/${encodeURIComponent(entityId)}/config`,
          { method: "PUT", body: JSON.stringify(body) },
        ),
      deleteEntityConfig: (entityId: string) =>
        request<void>(`/api/observability/entities/${encodeURIComponent(entityId)}/config`, {
          method: "DELETE",
        }),
    },

    search: {
      query: (q: string) => request<SearchResults>(`/api/search?q=${encodeURIComponent(q)}`),
    },

    devdocs: {
      list: (entityId: string) =>
        request<DocsTabResponse>(`/api/catalog/${encodeURIComponent(entityId)}/docs`),
      get: (entityId: string, slug: string) =>
        request<DocPageDetail>(
          `/api/catalog/${encodeURIComponent(entityId)}/docs/${encodeURIComponent(slug)}`,
        ),
      sync: (entityId: string) =>
        request<{
          entityId: string;
          status: "ok" | "partial" | "failed" | "skipped";
          pageCount: number;
        }>(`/api/catalog/${encodeURIComponent(entityId)}/docs/sync`, { method: "POST" }),
      verify: (pageId: string) =>
        request<{ pageId: string; verifiedAt: string | null; verifiedBy: string | null }>(
          `/api/devdocs/pages/${encodeURIComponent(pageId)}/verify`,
          { method: "POST" },
        ),
      listComments: (pageId: string) =>
        request<ListResponse<DocCommentRow>>(
          `/api/devdocs/pages/${encodeURIComponent(pageId)}/comments`,
        ),
      postComment: (pageId: string, body: { body: string; anchor?: string }) =>
        request<DocCommentRow>(`/api/devdocs/pages/${encodeURIComponent(pageId)}/comments`, {
          method: "POST",
          body: JSON.stringify(body),
        }),
      deleteComment: (id: string) =>
        request<void>(`/api/devdocs/comments/${encodeURIComponent(id)}`, {
          method: "DELETE",
        }),
      reportStale: (pageId: string, reason?: string) =>
        request<DocStaleReportRow>(
          `/api/devdocs/pages/${encodeURIComponent(pageId)}/stale-reports`,
          { method: "POST", body: JSON.stringify({ reason }) },
        ),
      search: (q: string, opts: { entityId?: string; limit?: number } = {}) => {
        const qs = new URLSearchParams();
        qs.set("q", q);
        if (opts.entityId) qs.set("entityId", opts.entityId);
        if (opts.limit) qs.set("limit", String(opts.limit));
        return request<{ query: string; hits: DocSearchHit[] }>(
          `/api/devdocs/search?${qs.toString()}`,
        );
      },
    },

    teams: {
      list: (opts: { includeDeleted?: boolean; allOrgs?: boolean } = {}) => {
        const params = new URLSearchParams();
        if (opts.includeDeleted) params.set("includeDeleted", "true");
        if (opts.allOrgs) params.set("allOrgs", "1");
        const qs = params.toString();
        return request<ListResponse<TeamSummary>>(`/api/teams${qs ? `?${qs}` : ""}`);
      },
      get: (slug: string) => request<TeamDetail>(`/api/teams/${encodeURIComponent(slug)}`),
      create: (body: {
        slug: string;
        name: string;
        description?: string;
        leadUserId?: string;
        accountLogin: string;
      }) => request<TeamDetail>(`/api/teams`, { method: "POST", body: JSON.stringify(body) }),
      update: (slug: string, body: { slug?: string; name?: string; description?: string | null }) =>
        request<TeamDetail>(`/api/teams/${encodeURIComponent(slug)}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        }),
      delete: (slug: string) =>
        request<void>(`/api/teams/${encodeURIComponent(slug)}`, { method: "DELETE" }),
      restore: (slug: string) =>
        request<TeamDetail>(`/api/teams/${encodeURIComponent(slug)}/restore`, {
          method: "POST",
        }),
      transferOwnership: (slug: string, targetTeamSlug: string) =>
        request<{
          from: { teamId: string; slug: string };
          to: { teamId: string; slug: string };
          entityCount: number;
        }>(`/api/teams/${encodeURIComponent(slug)}/transfer-ownership`, {
          method: "POST",
          body: JSON.stringify({ targetTeamSlug }),
        }),
      addMember: (slug: string, body: { userId: string; role?: TeamMemberRole }) =>
        request<TeamDetail>(`/api/teams/${encodeURIComponent(slug)}/members`, {
          method: "POST",
          body: JSON.stringify(body),
        }),
      setMemberRole: (slug: string, userId: string, role: TeamMemberRole) =>
        request<TeamDetail>(
          `/api/teams/${encodeURIComponent(slug)}/members/${encodeURIComponent(userId)}`,
          { method: "PATCH", body: JSON.stringify({ role }) },
        ),
      removeMember: (slug: string, userId: string) =>
        request<void>(
          `/api/teams/${encodeURIComponent(slug)}/members/${encodeURIComponent(userId)}`,
          { method: "DELETE" },
        ),
    },

    teamRequests: {
      list: (opts: { status?: TeamRequestStatus } = {}) => {
        const qs = opts.status ? `?status=${encodeURIComponent(opts.status)}` : "";
        return request<ListResponse<TeamRequestDto>>(`/api/teams/requests${qs}`);
      },
      get: (id: string) => request<TeamRequestDto>(`/api/teams/requests/${encodeURIComponent(id)}`),
      submit: (body: {
        slug: string;
        name: string;
        description?: string;
        mirrorToGithub: boolean;
        githubIntegrationId?: string;
        proposedMaintainerUserIds?: string[];
        proposedMemberUserIds?: string[];
      }) =>
        request<TeamRequestDto>(`/api/teams/requests`, {
          method: "POST",
          body: JSON.stringify(body),
        }),
      // Admin-side proposal, bumps round, transitions to awaiting_user_confirmation.
      propose: (
        id: string,
        body: {
          slug?: string;
          name?: string;
          description?: string | null;
          mirrorToGithub?: boolean;
          githubIntegrationId?: string | null;
        },
      ) =>
        request<TeamRequestDto>(`/api/teams/requests/${encodeURIComponent(id)}/propose`, {
          method: "POST",
          body: JSON.stringify(body),
        }),
      // Requester-side response: confirm runs the approval, counter bumps the round.
      respond: (
        id: string,
        body:
          | { action: "confirm" }
          | {
              action: "counter";
              slug?: string;
              name?: string;
              description?: string | null;
              mirrorToGithub?: boolean;
              githubIntegrationId?: string | null;
            },
      ) =>
        request<TeamRequestDto>(`/api/teams/requests/${encodeURIComponent(id)}/respond`, {
          method: "POST",
          body: JSON.stringify(body),
        }),
      approve: (id: string) =>
        request<TeamRequestDto>(`/api/teams/requests/${encodeURIComponent(id)}/approve`, {
          method: "POST",
        }),
      reject: (id: string, reason: string) =>
        request<TeamRequestDto>(`/api/teams/requests/${encodeURIComponent(id)}/reject`, {
          method: "POST",
          body: JSON.stringify({ reason }),
        }),
      cancel: (id: string) =>
        request<TeamRequestDto>(`/api/teams/requests/${encodeURIComponent(id)}/cancel`, {
          method: "POST",
        }),
      forMeAsApprover: () =>
        request<ListResponse<TeamRequestDto>>(`/api/teams/requests/for-me-as-approver`),
    },

    maintainerRequests: {
      list: () => request<ListResponse<MaintainerRequestDto>>(`/api/teams/maintainer-requests`),
      pendingForMe: () =>
        request<ListResponse<MaintainerRequestDto>>(
          `/api/teams/maintainer-requests/pending-for-me`,
        ),
      forMeAsApprover: () =>
        request<ListResponse<MaintainerRequestDto>>(
          `/api/teams/maintainer-requests/for-me-as-approver`,
        ),
      get: (id: string) =>
        request<MaintainerRequestDto>(`/api/teams/maintainer-requests/${encodeURIComponent(id)}`),
      submit: (body: { teamSlug: string; reason?: string }) =>
        request<MaintainerRequestDto>(`/api/teams/maintainer-requests`, {
          method: "POST",
          body: JSON.stringify(body),
        }),
      approve: (id: string) =>
        request<MaintainerRequestDto>(
          `/api/teams/maintainer-requests/${encodeURIComponent(id)}/approve`,
          { method: "POST" },
        ),
      reject: (id: string, reason: string) =>
        request<MaintainerRequestDto>(
          `/api/teams/maintainer-requests/${encodeURIComponent(id)}/reject`,
          { method: "POST", body: JSON.stringify({ reason }) },
        ),
      cancel: (id: string) =>
        request<MaintainerRequestDto>(
          `/api/teams/maintainer-requests/${encodeURIComponent(id)}/cancel`,
          { method: "POST" },
        ),
    },

    requests: {
      pendingSummary: () =>
        request<{
          myRequestsPending: number;
          myApprovalsPending: number;
          canApprove: boolean;
        }>(`/api/requests/pending-summary`),
    },

    teamPolicies: {
      list: () => request<ListResponse<TeamPolicyDto>>(`/api/teams/policies`),
      update: (
        kind: TeamPolicyKind,
        body: {
          enabled?: boolean;
          config?: Record<string, unknown>;
          description?: string | null;
        },
      ) =>
        request<TeamPolicyDto>(`/api/teams/policies/${encodeURIComponent(kind)}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        }),
    },

    users: {
      search: (query: string, limit = 20) => {
        const qs = new URLSearchParams();
        if (query) qs.set("query", query);
        qs.set("limit", String(limit));
        return request<ListResponse<UserSummary>>(`/api/users?${qs.toString()}`);
      },
    },

    pages: {
      list: (section: PageSection) =>
        request<ListResponse<PageDto>>(`/api/pages?section=${encodeURIComponent(section)}`),
      get: (id: string) => request<PageDto>(`/api/pages/${encodeURIComponent(id)}`),
      create: (body: {
        section: PageSection;
        title: string;
        parentId?: string | null;
        icon?: string | null;
        url?: string;
        isFolder?: boolean;
        type?: PageType;
        scope?: PageScope;
        afterId?: string;
      }) =>
        request<PageDto>(`/api/pages`, {
          method: "POST",
          body: JSON.stringify(body),
        }),
      update: (id: string, body: { title?: string; icon?: string | null; url?: string | null }) =>
        request<PageDto>(`/api/pages/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        }),
      updateLayout: (id: string, layout: PageWidgetInstance[]) =>
        request<PageDto>(`/api/pages/${encodeURIComponent(id)}/layout`, {
          method: "PATCH",
          body: JSON.stringify({ layout }),
        }),
      move: (id: string, body: { parentId?: string | null; afterId?: string; beforeId?: string }) =>
        request<PageDto>(`/api/pages/${encodeURIComponent(id)}/move`, {
          method: "POST",
          body: JSON.stringify(body),
        }),
      delete: (id: string) =>
        request<void>(`/api/pages/${encodeURIComponent(id)}`, { method: "DELETE" }),
    },

    onboarding: {
      listTasks: () => request<ListResponse<UserTaskDto>>(`/api/onboarding/tasks`),
      completeTask: (id: string) =>
        request<UserTaskDto>(`/api/onboarding/tasks/${encodeURIComponent(id)}/complete`, {
          method: "POST",
        }),
      dismissTask: (id: string) =>
        request<UserTaskDto>(`/api/onboarding/tasks/${encodeURIComponent(id)}/dismiss`, {
          method: "POST",
        }),
    },

    chat: {
      listConversations: () => request<ChatConversationSummaryDto[]>(`/api/chat/conversations`),
      createConversation: (body: { title?: string } = {}) =>
        request<ChatConversationSummaryDto>(`/api/chat/conversations`, {
          method: "POST",
          body: JSON.stringify(body),
        }),
      getConfig: () => request<ChatConfigDto>(`/api/chat/config`),
      getConversation: (id: string) =>
        request<ChatConversationDetailDto>(`/api/chat/conversations/${encodeURIComponent(id)}`),
      deleteConversation: (id: string) =>
        request<void>(`/api/chat/conversations/${encodeURIComponent(id)}`, {
          method: "DELETE",
        }),
    },

    notifications: {
      list: (opts: { unread?: boolean; limit?: number } = {}) => {
        const qs = new URLSearchParams();
        if (opts.unread) qs.set("unread", "true");
        if (opts.limit) qs.set("limit", String(opts.limit));
        const q = qs.toString();
        return request<ListResponse<NotificationDto>>(`/api/notifications${q ? `?${q}` : ""}`);
      },
      unreadCount: () => request<{ count: number }>(`/api/notifications/unread-count`),
      markRead: (id: string) =>
        request<void>(`/api/notifications/${encodeURIComponent(id)}/read`, { method: "POST" }),
      markAllRead: () =>
        request<{ count: number }>(`/api/notifications/read-all`, { method: "POST" }),
    },

    webhooks: {
      list: (opts: { teamSlug?: string } = {}) => {
        const qs = opts.teamSlug ? `?teamSlug=${encodeURIComponent(opts.teamSlug)}` : "";
        return request<ListResponse<WebhookSubscriptionDto>>(`/api/webhooks${qs}`);
      },
      create: (body: { url: string; eventKinds: string[]; teamSlug?: string }) =>
        request<WebhookSubscriptionDto>(`/api/webhooks`, {
          method: "POST",
          body: JSON.stringify(body),
        }),
      update: (id: string, body: { active?: boolean; eventKinds?: string[] }) =>
        request<WebhookSubscriptionDto>(`/api/webhooks/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        }),
      delete: (id: string) =>
        request<void>(`/api/webhooks/${encodeURIComponent(id)}`, { method: "DELETE" }),
      test: (id: string) =>
        request<{ deliveryId: string }>(`/api/webhooks/${encodeURIComponent(id)}/test`, {
          method: "POST",
        }),
      deliveries: (id: string) =>
        request<ListResponse<WebhookDeliveryDto>>(
          `/api/webhooks/${encodeURIComponent(id)}/deliveries`,
        ),
    },

    scaffolder: {
      listTemplates: () =>
        request<ListResponse<ScaffolderTemplateSummary>>(`/api/scaffolder/templates`),
      getTemplate: (id: string) =>
        request<ScaffolderTemplateDetail>(`/api/scaffolder/templates/${encodeURIComponent(id)}`),
      createPlan: (body: {
        templateId: string;
        params: Record<string, unknown>;
        target?: "main" | "branch" | "worktree";
      }) =>
        request<ScaffolderPlan>(`/api/scaffolder/plans`, {
          method: "POST",
          body: JSON.stringify(body),
        }),
      getPlan: (id: string) =>
        request<ScaffolderPlan>(`/api/scaffolder/plans/${encodeURIComponent(id)}`),
      applyPlan: (id: string, opts: { dryRun?: boolean } = {}) =>
        request<ScaffolderApplyResult>(`/api/scaffolder/plans/${encodeURIComponent(id)}/apply`, {
          method: "POST",
          body: JSON.stringify(opts),
        }),
      approvePlan: (id: string, capabilities: string[]) =>
        request<{ plan: ScaffolderPlan; approvalsGranted: unknown[] }>(
          `/api/scaffolder/approvals/${encodeURIComponent(id)}`,
          {
            method: "POST",
            body: JSON.stringify({ capabilities }),
          },
        ),
      getTask: (id: string) =>
        request<ScaffolderTask>(`/api/scaffolder/tasks/${encodeURIComponent(id)}`),
      taskEventsUrl: (id: string) =>
        `${baseUrl}/api/scaffolder/tasks/${encodeURIComponent(id)}/events`,
      listBindings: () => request<ListResponse<ScaffolderBinding>>(`/api/scaffolder/bindings`),
      replanBinding: (id: string) =>
        request<ScaffolderPlan>(`/api/scaffolder/bindings/${encodeURIComponent(id)}/replan`, {
          method: "POST",
          body: JSON.stringify({}),
        }),
      driftSummary: (filter: { bindingId?: string; templateId?: string } = {}) => {
        const qs = new URLSearchParams();
        if (filter.bindingId) qs.set("bindingId", filter.bindingId);
        if (filter.templateId) qs.set("templateId", filter.templateId);
        const suffix = qs.toString() ? `?${qs.toString()}` : "";
        return request<ScaffolderDriftSummaryDto>(`/api/scaffolder/drift/summary${suffix}`);
      },
      updateDrift: (id: string, status: "ignored" | "applied" | "superseded") =>
        request<{ id: string; status: string }>(`/api/scaffolder/drift/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify({ status }),
        }),
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
