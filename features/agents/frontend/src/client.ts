import { useMemo } from "react";
import { useApiCore } from "@internal/api-client/react";
import type { ApiCore, ListResponse } from "@internal/api-client";
import type {
  Agent,
  AgentRun,
  AgentToolsResponse,
  AgentMcpServerSummary,
  CreateAgentMcpServerInput,
  UpdateAgentMcpServerInput,
  McpProbeResult,
  CreateAgentInput,
  UpdateAgentInput,
  RunAgentResponse,
  CreateSkillInput,
  UpdateSkillInput,
  SkillSummary,
  LlmModelSummary,
  AiRecommendationsDto,
} from "@feature/agents-shared";

export function createAgentsClient(core: ApiCore) {
  return {
    agents: {
      list: () => core.request<ListResponse<Agent>>(`/api/agents`),
      get: (id: string) => core.request<Agent>(`/api/agents/${encodeURIComponent(id)}`),
      create: (body: CreateAgentInput) =>
        core.request<Agent>(`/api/agents`, { method: "POST", body: JSON.stringify(body) }),
      update: (id: string, body: UpdateAgentInput) =>
        core.request<Agent>(`/api/agents/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        }),
      delete: (id: string) =>
        core.request<void>(`/api/agents/${encodeURIComponent(id)}`, { method: "DELETE" }),
      run: (id: string, input: Record<string, unknown> = {}) =>
        core.request<RunAgentResponse>(`/api/agents/${encodeURIComponent(id)}/run`, {
          method: "POST",
          body: JSON.stringify({ input }),
        }),
      test: (id: string, prompt: string) =>
        core.request<{
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
        core.request<AgentRun>(
          `/api/agents/${encodeURIComponent(id)}/runs/${encodeURIComponent(runId)}`,
        ),
      cancelRun: (id: string, runId: string) =>
        core.request<{ ok: true }>(
          `/api/agents/${encodeURIComponent(id)}/runs/${encodeURIComponent(runId)}/cancel`,
          { method: "POST" },
        ),
      listTools: () => core.request<AgentToolsResponse>(`/api/agents/tools`),
      listMcpServers: (id: string) =>
        core.request<ListResponse<AgentMcpServerSummary>>(
          `/api/agents/${encodeURIComponent(id)}/mcp-servers`,
        ),
      createMcpServer: (id: string, body: CreateAgentMcpServerInput) =>
        core.request<AgentMcpServerSummary>(`/api/agents/${encodeURIComponent(id)}/mcp-servers`, {
          method: "POST",
          body: JSON.stringify(body),
        }),
      updateMcpServer: (id: string, sid: string, body: UpdateAgentMcpServerInput) =>
        core.request<AgentMcpServerSummary>(
          `/api/agents/${encodeURIComponent(id)}/mcp-servers/${encodeURIComponent(sid)}`,
          { method: "PATCH", body: JSON.stringify(body) },
        ),
      deleteMcpServer: (id: string, sid: string) =>
        core.request<void>(
          `/api/agents/${encodeURIComponent(id)}/mcp-servers/${encodeURIComponent(sid)}`,
          { method: "DELETE" },
        ),
      probeMcpServer: (id: string, sid: string) =>
        core.request<McpProbeResult>(
          `/api/agents/${encodeURIComponent(id)}/mcp-servers/${encodeURIComponent(sid)}/probe`,
          { method: "POST" },
        ),
    },

    skills: {
      list: () => core.request<ListResponse<SkillSummary>>(`/api/skills`),
      get: (id: string) => core.request<SkillSummary>(`/api/skills/${encodeURIComponent(id)}`),
      create: (body: CreateSkillInput) =>
        core.request<SkillSummary>(`/api/skills`, { method: "POST", body: JSON.stringify(body) }),
      update: (id: string, body: UpdateSkillInput) =>
        core.request<SkillSummary>(`/api/skills/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        }),
      delete: (id: string) =>
        core.request<void>(`/api/skills/${encodeURIComponent(id)}`, { method: "DELETE" }),
    },

    llm: {
      listModels: () => core.request<ListResponse<LlmModelSummary>>(`/api/llm/models`),
      recommendations: (kind: string, runtime?: string) =>
        core.request<AiRecommendationsDto>(
          `/api/llm/recommendations?kind=${encodeURIComponent(kind)}${
            runtime ? `&runtime=${encodeURIComponent(runtime)}` : ""
          }`,
        ),
    },
  };
}

export function useAgentsApi() {
  const core = useApiCore();
  return useMemo(() => createAgentsClient(core), [core]);
}
