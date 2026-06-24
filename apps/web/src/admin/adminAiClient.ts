import { useMemo } from "react";
import { useApiCore } from "@internal/api-client/react";
import type { ApiCore } from "@internal/api-client";
import type { AdminAiModelsResponse } from "@feature/agents-shared";

export function createAdminAiClient(core: ApiCore) {
  return {
    listModels: () => core.request<AdminAiModelsResponse>(`/api/admin/ai/models`),
    setModelEnabled: (id: string, enabled: boolean) =>
      core.request<void>(`/api/admin/ai/models/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      }),
    setModelDailyCap: (id: string, dailyTokenCap: number | null) =>
      core.request<void>(`/api/admin/ai/models/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ dailyTokenCap }),
      }),
    setProviderKey: (slug: string, apiKey: string) =>
      core.request<void>(`/api/admin/ai/providers/${encodeURIComponent(slug)}/key`, {
        method: "PUT",
        body: JSON.stringify({ apiKey }),
      }),
    clearProviderKey: (slug: string) =>
      core.request<void>(`/api/admin/ai/providers/${encodeURIComponent(slug)}/key`, {
        method: "DELETE",
      }),
  };
}

export function useAdminAiApi() {
  const core = useApiCore();
  return useMemo(() => createAdminAiClient(core), [core]);
}
