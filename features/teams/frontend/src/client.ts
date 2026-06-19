import { useMemo } from "react";
import { useApiCore } from "@internal/api-client/react";
import type { ApiCore, ListResponse } from "@internal/api-client";
import type { TeamDetail, TeamMemberRole, TeamSummary } from "@feature/teams-shared";

export function createTeamsClient(core: ApiCore) {
  return {
    teams: {
      list: (opts: { includeDeleted?: boolean; allOrgs?: boolean } = {}) => {
        const params = new URLSearchParams();
        if (opts.includeDeleted) params.set("includeDeleted", "true");
        if (opts.allOrgs) params.set("allOrgs", "1");
        const qs = params.toString();
        return core.request<ListResponse<TeamSummary>>(`/api/teams${qs ? `?${qs}` : ""}`);
      },
      get: (slug: string) => core.request<TeamDetail>(`/api/teams/${encodeURIComponent(slug)}`),
      create: (body: {
        slug: string;
        name: string;
        description?: string;
        leadUserId?: string;
        accountLogin: string;
      }) => core.request<TeamDetail>(`/api/teams`, { method: "POST", body: JSON.stringify(body) }),
      update: (slug: string, body: { slug?: string; name?: string; description?: string | null }) =>
        core.request<TeamDetail>(`/api/teams/${encodeURIComponent(slug)}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        }),
      delete: (slug: string) =>
        core.request<void>(`/api/teams/${encodeURIComponent(slug)}`, { method: "DELETE" }),
      restore: (slug: string) =>
        core.request<TeamDetail>(`/api/teams/${encodeURIComponent(slug)}/restore`, {
          method: "POST",
        }),
      transferOwnership: (slug: string, targetTeamSlug: string) =>
        core.request<{
          from: { teamId: string; slug: string };
          to: { teamId: string; slug: string };
          entityCount: number;
        }>(`/api/teams/${encodeURIComponent(slug)}/transfer-ownership`, {
          method: "POST",
          body: JSON.stringify({ targetTeamSlug }),
        }),
      addMember: (slug: string, body: { userId: string; role?: TeamMemberRole }) =>
        core.request<TeamDetail>(`/api/teams/${encodeURIComponent(slug)}/members`, {
          method: "POST",
          body: JSON.stringify(body),
        }),
      setMemberRole: (slug: string, userId: string, role: TeamMemberRole) =>
        core.request<TeamDetail>(
          `/api/teams/${encodeURIComponent(slug)}/members/${encodeURIComponent(userId)}`,
          { method: "PATCH", body: JSON.stringify({ role }) },
        ),
      removeMember: (slug: string, userId: string) =>
        core.request<void>(
          `/api/teams/${encodeURIComponent(slug)}/members/${encodeURIComponent(userId)}`,
          { method: "DELETE" },
        ),
    },
  };
}

export function useTeamsApi() {
  const core = useApiCore();
  return useMemo(() => createTeamsClient(core), [core]);
}
