// Typed HTTP client for the platform backend, grouped by resource namespace.
import type {
  AdminUserRow,
  AuditEventRow,
  CurrentUser,
  JobSummary,
  UserRole,
  UserStatus,
  UserSummary,
} from "@internal/shared-types";

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

export interface ApiCore {
  request<T>(path: string, init?: RequestInit): Promise<T>;
  requestAllowing401<T>(path: string): Promise<T | null>;
}

export function createApiCore(options: ApiClientOptions = {}): ApiCore {
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

  return { request, requestAllowing401 };
}

export function createApiClient(options: ApiClientOptions = {}) {
  const baseUrl = options.baseUrl ?? "";
  const { request, requestAllowing401 } = createApiCore(options);

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

    users: {
      search: (query: string, limit = 20) => {
        const qs = new URLSearchParams();
        if (query) qs.set("query", query);
        qs.set("limit", String(limit));
        return request<ListResponse<UserSummary>>(`/api/users?${qs.toString()}`);
      },
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
