// Thin typed REST wrapper for Plane (https://developers.plane.so). One
// client instance corresponds to one Integration row (so it carries one
// baseUrl + token). Stateless beyond that — safe to instantiate per-request.
//
// Auth: Plane accepts `X-API-Key: plane_api_<token>` for personal API keys
// and `Authorization: Bearer <oauth>` for OAuth. We support API key only for
// now (OAuth is deferred per the workspace plan).
//
// Pagination: Plane endpoints either return an array directly or wrap the
// array in `{ count, next, previous, results }`. The collect helper handles
// both, paginates by following `next` until exhaustion, and flattens to a
// single array. Don't use it for endpoints that can grow unbounded — sync
// engine bounds calls per project anyway.

import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  PlaneApiComment,
  PlaneApiCycle,
  PlaneApiLabel,
  PlaneApiMember,
  PlaneApiModule,
  PlaneApiProject,
  PlaneApiState,
  PlaneApiWorkItem,
  PlaneApiWorkspace,
  PlaneClientConfig,
  PlanePage,
} from "./types";

export * from "./types";

export class PlaneApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body: string,
  ) {
    super(message);
    this.name = "PlaneApiError";
  }
}

export interface PlaneClient {
  getWorkspace(slug: string): Promise<PlaneApiWorkspace>;
  listProjects(slug: string): Promise<PlaneApiProject[]>;
  listStates(slug: string, projectId: string): Promise<PlaneApiState[]>;
  listLabels(slug: string, projectId: string): Promise<PlaneApiLabel[]>;
  listCycles(slug: string, projectId: string): Promise<PlaneApiCycle[]>;
  listModules(slug: string, projectId: string): Promise<PlaneApiModule[]>;
  listWorkItems(
    slug: string,
    projectId: string,
    opts?: { updatedAfter?: Date },
  ): Promise<PlaneApiWorkItem[]>;
  getWorkItem(slug: string, projectId: string, workItemId: string): Promise<PlaneApiWorkItem>;
  createWorkItem(
    slug: string,
    projectId: string,
    body: { name: string; description_html?: string; priority?: string },
  ): Promise<PlaneApiWorkItem>;
  listComments(slug: string, projectId: string, workItemId: string): Promise<PlaneApiComment[]>;
  listWorkspaceMembers(slug: string): Promise<PlaneApiMember[]>;
}

export function createPlaneClient(config: PlaneClientConfig): PlaneClient {
  const fetchImpl = config.fetch ?? fetch;
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  const pageSize = config.pageSize ?? 100;

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${baseUrl}${path}`;
    const res = await fetchImpl(url, {
      ...init,
      headers: {
        "X-API-Key": config.apiToken,
        accept: "application/json",
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new PlaneApiError(
        res.status,
        `Plane API ${init?.method ?? "GET"} ${path} -> ${res.status}`,
        body,
      );
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  // Plane returns either an array (some endpoints) or { results, next, ... }.
  // Always normalize to an array. Follows `next` until null.
  async function collect<T>(path: string, params?: Record<string, string>): Promise<T[]> {
    const qs = new URLSearchParams(params);
    qs.set("per_page", String(pageSize));
    let next: string | null = `${path}${qs.toString() ? `?${qs.toString()}` : ""}`;
    const out: T[] = [];
    while (next) {
      const page: PlanePage<T> | T[] = await request<PlanePage<T> | T[]>(next);
      if (Array.isArray(page)) {
        out.push(...page);
        next = null;
      } else {
        if (page.results) out.push(...page.results);
        // `next` from Plane may be an absolute URL — strip baseUrl when present.
        const nextLink: string | null | undefined = page.next;
        if (nextLink) {
          next = nextLink.startsWith(baseUrl) ? nextLink.slice(baseUrl.length) : nextLink;
        } else {
          next = null;
        }
      }
    }
    return out;
  }

  return {
    getWorkspace: (slug) => request<PlaneApiWorkspace>(`/api/v1/workspaces/${slug}/`),
    listProjects: (slug) => collect<PlaneApiProject>(`/api/v1/workspaces/${slug}/projects/`),
    listStates: (slug, projectId) =>
      collect<PlaneApiState>(`/api/v1/workspaces/${slug}/projects/${projectId}/states/`),
    listLabels: (slug, projectId) =>
      collect<PlaneApiLabel>(`/api/v1/workspaces/${slug}/projects/${projectId}/labels/`),
    listCycles: (slug, projectId) =>
      collect<PlaneApiCycle>(`/api/v1/workspaces/${slug}/projects/${projectId}/cycles/`),
    listModules: (slug, projectId) =>
      collect<PlaneApiModule>(`/api/v1/workspaces/${slug}/projects/${projectId}/modules/`),
    listWorkItems: (slug, projectId, opts) => {
      // Plane renamed the endpoint from `issues` to `work-items` in newer
      // releases. We try `work-items` first, fall through to `issues` on 404
      // so the integration works against both. Cache the resolved path on the
      // closure so subsequent calls skip the probe.
      const params: Record<string, string> = {};
      if (opts?.updatedAfter) params["updated_at__gte"] = opts.updatedAfter.toISOString();
      return collectWithFallback<PlaneApiWorkItem>(slug, projectId, "work-items", "issues", params);
    },
    getWorkItem: async (slug, projectId, workItemId) => {
      try {
        return await request<PlaneApiWorkItem>(
          `/api/v1/workspaces/${slug}/projects/${projectId}/work-items/${workItemId}/`,
        );
      } catch (err) {
        if (err instanceof PlaneApiError && err.status === 404) {
          return await request<PlaneApiWorkItem>(
            `/api/v1/workspaces/${slug}/projects/${projectId}/issues/${workItemId}/`,
          );
        }
        throw err;
      }
    },
    listComments: (slug, projectId, workItemId) =>
      collectWithFallback<PlaneApiComment>(
        slug,
        projectId,
        `work-items/${workItemId}/comments`,
        `issues/${workItemId}/comments`,
        {},
      ),
    createWorkItem: async (slug, projectId, body) => {
      try {
        return await request<PlaneApiWorkItem>(
          `/api/v1/workspaces/${slug}/projects/${projectId}/work-items/`,
          { method: "POST", body: JSON.stringify(body) },
        );
      } catch (err) {
        if (err instanceof PlaneApiError && err.status === 404) {
          return await request<PlaneApiWorkItem>(
            `/api/v1/workspaces/${slug}/projects/${projectId}/issues/`,
            { method: "POST", body: JSON.stringify(body) },
          );
        }
        throw err;
      }
    },
    listWorkspaceMembers: (slug) => collect<PlaneApiMember>(`/api/v1/workspaces/${slug}/members/`),
  };

  async function collectWithFallback<T>(
    slug: string,
    projectId: string,
    primary: string,
    fallback: string,
    params: Record<string, string>,
  ): Promise<T[]> {
    try {
      return await collect<T>(
        `/api/v1/workspaces/${slug}/projects/${projectId}/${primary}/`,
        params,
      );
    } catch (err) {
      if (err instanceof PlaneApiError && err.status === 404) {
        return await collect<T>(
          `/api/v1/workspaces/${slug}/projects/${projectId}/${fallback}/`,
          params,
        );
      }
      throw err;
    }
  }
}

// -----------------------------------------------------------------------------
// Webhook signature verification
// -----------------------------------------------------------------------------
// Plane signs every webhook delivery with HMAC-SHA256(secret, raw body). The
// signature lands in the `X-Plane-Signature` header. We compute and compare
// in constant time to avoid leaking length info via timing.

export interface PlaneWebhookHeaders {
  signature: string | null;
  delivery: string | null;
  event: string | null;
}

export function readPlaneWebhookHeaders(headers: {
  get: (name: string) => string | null;
}): PlaneWebhookHeaders {
  return {
    signature: headers.get("x-plane-signature"),
    delivery: headers.get("x-plane-delivery"),
    event: headers.get("x-plane-event"),
  };
}

/** Returns true when `signature` matches HMAC-SHA256(secret, rawBody). */
export function verifyPlaneSignature(
  rawBody: Buffer | string,
  signature: string | null,
  secret: string,
): boolean {
  if (!signature) return false;
  const computed = createHmac("sha256", secret)
    .update(typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody)
    .digest("hex");
  // Plane historically prefixed `sha256=` on some events. Strip if present.
  const provided = signature.startsWith("sha256=") ? signature.slice(7) : signature;
  if (provided.length !== computed.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided, "hex"), Buffer.from(computed, "hex"));
  } catch {
    return false;
  }
}
