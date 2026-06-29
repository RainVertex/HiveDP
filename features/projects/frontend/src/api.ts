import { useCallback, useEffect, useState } from "react";
import type { UserSummaryDto } from "@internal/shared-types";
import type {
  ProjectDto,
  BucketDto,
  LabelDto,
  TaskDto,
  TaskCommentDto,
  ProjectShareDto,
} from "@feature/projects-shared";

interface FetchState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

function useFetch<T>(url: string | null) {
  const [state, setState] = useState<FetchState<T>>({ data: null, loading: !!url, error: null });
  const [tick, setTick] = useState(0);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => {
        if (!cancelled) setState({ data: d as T, loading: false, error: null });
      })
      .catch((e) => {
        if (!cancelled) setState({ data: null, loading: false, error: (e as Error).message });
      });
    return () => {
      cancelled = true;
    };
  }, [url, tick]);

  return { ...state, refetch };
}

// Re-exported under the names this feature's components already use, sourced from the shared contract
// so the frontend types cannot drift from the backend DTOs.
export type UserSummary = UserSummaryDto;
export type Project = ProjectDto;
export type Bucket = BucketDto;
export type Task = TaskDto;
export type TaskComment = TaskCommentDto;
export type ProjectShareUser = ProjectShareDto;

export interface TaskFilters {
  done?: boolean;
  priority?: number;
}

export interface CurrentProjectsUser {
  id: string;
  username: string;
  name: string;
}

export function useProjects() {
  const { data, loading, error, refetch } = useFetch<Project[]>("/api/projects/projects");
  return { projects: data ?? [], loading, error, refetch };
}

export function useCurrentProjectsUser() {
  const { data, loading, error } = useFetch<CurrentProjectsUser>("/api/projects/me");
  return { me: data, loading, error };
}

export function useProject(projectId: string | undefined) {
  const url = projectId ? `/api/projects/projects/${projectId}` : null;
  const { data, loading, error, refetch } = useFetch<Project>(url);
  return { project: data, loading, error, refetch };
}

export function useTasks(projectId: string | undefined, filters?: TaskFilters) {
  const qs = filters
    ? "?" +
      new URLSearchParams(
        Object.entries(filters)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, String(v)]),
      ).toString()
    : "";
  const url = projectId ? `/api/projects/projects/${projectId}/tasks${qs}` : null;
  const { data, loading, error, refetch } = useFetch<Task[]>(url);
  return { tasks: data ?? [], loading, error, refetch };
}

export function useTask(taskId: string | undefined) {
  const url = taskId ? `/api/projects/tasks/${taskId}` : null;
  const { data, loading, error, refetch } = useFetch<Task>(url);
  return { task: data, loading, error, refetch };
}

export function useBuckets(projectId: string | undefined) {
  const url = projectId ? `/api/projects/projects/${projectId}/buckets` : null;
  const { data, loading, error, refetch } = useFetch<Bucket[]>(url);
  return { buckets: data ?? [], loading, error, refetch };
}

export function useCreateBucket(projectId: string) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useCallback(
    async (title: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/projects/projects/${projectId}/buckets`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as Bucket;
      } catch (e) {
        setError((e as Error).message);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [projectId],
  );

  return { create, loading, error };
}

export function useUpdateBucket() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = useCallback(async (bucketId: string, body: { title?: string }) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/buckets/${bucketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as Bucket;
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  return { update, loading, error };
}

export function useDeleteBucket() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = useCallback(async (bucketId: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/buckets/${bucketId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  return { remove, loading, error };
}

export function useLabels(projectId: string | undefined) {
  const url = projectId ? `/api/projects/labels?projectId=${encodeURIComponent(projectId)}` : null;
  const { data, loading, error, refetch } = useFetch<LabelDto[]>(url);
  return { labels: data ?? [], loading, error, refetch };
}

export function useCreateLabel() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useCallback(
    async (input: { projectId: string; title: string; hexColor?: string }) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/projects/labels", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as LabelDto;
      } catch (e) {
        setError((e as Error).message);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return { create, loading, error };
}

export function useTaskAssignees(taskId: string) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = useCallback(
    async (username: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/projects/tasks/${taskId}/assignees`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        return (await res.json()) as UserSummary;
      } catch (e) {
        setError((e as Error).message);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [taskId],
  );

  const remove = useCallback(
    async (userId: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/projects/tasks/${taskId}/assignees/${userId}`, {
          method: "DELETE",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (e) {
        setError((e as Error).message);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [taskId],
  );

  return { add, remove, loading, error };
}

export function useTaskLabels(taskId: string) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = useCallback(
    async (labelId: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/projects/tasks/${taskId}/labels`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ labelId }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (e) {
        setError((e as Error).message);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [taskId],
  );

  const remove = useCallback(
    async (labelId: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/projects/tasks/${taskId}/labels/${labelId}`, {
          method: "DELETE",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (e) {
        setError((e as Error).message);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [taskId],
  );

  return { add, remove, loading, error };
}

export function useProjectShares(projectId: string | undefined) {
  const url = projectId ? `/api/projects/projects/${projectId}/shares` : null;
  const { data, loading, error, refetch } = useFetch<ProjectShareUser[]>(url);
  return { shares: data ?? [], loading, error, refetch };
}

export function useAddProjectShare(projectId: string) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = useCallback(
    async (input: { username: string; right?: number }) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/projects/projects/${projectId}/shares`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        return (await res.json()) as ProjectShareUser;
      } catch (e) {
        setError((e as Error).message);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [projectId],
  );

  return { add, loading, error };
}

export function useUpdateProjectShare(projectId: string) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = useCallback(
    async (username: string, right: number) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/projects/projects/${projectId}/shares/${encodeURIComponent(username)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ right }),
          },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as ProjectShareUser;
      } catch (e) {
        setError((e as Error).message);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [projectId],
  );

  return { update, loading, error };
}

export function useRemoveProjectShare(projectId: string) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = useCallback(
    async (username: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/projects/projects/${projectId}/shares/${encodeURIComponent(username)}`,
          { method: "DELETE" },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (e) {
        setError((e as Error).message);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [projectId],
  );

  return { remove, loading, error };
}

export function useUpdateProject(projectId: string) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = useCallback(
    async (body: {
      title?: string;
      description?: string | null;
      isArchived?: boolean;
      hexColor?: string | null;
    }) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/projects/projects/${projectId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as Project;
      } catch (e) {
        setError((e as Error).message);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [projectId],
  );

  return { update, loading, error };
}

export function useDeleteProject() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = useCallback(async (projectId: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/projects/${projectId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  return { remove, loading, error };
}

export function useCreateProject() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useCallback(async (body: { title: string; description?: string }) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/projects/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as Project;
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg);
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  return { create, loading, error };
}

export function useCreateTask(projectId: string) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useCallback(
    async (body: {
      title: string;
      description?: string;
      priority?: number;
      dueDate?: string;
      bucketId?: string;
    }) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/projects/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, projectId }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as Task;
      } catch (e) {
        const msg = (e as Error).message;
        setError(msg);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [projectId],
  );

  return { create, loading, error };
}

export function useUpdateTask() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = useCallback(async (taskId: string, body: Partial<Task>) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as Task;
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg);
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  return { update, loading, error };
}

export function useDeleteTask() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = useCallback(async (taskId: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/tasks/${taskId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg);
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  return { remove, loading, error };
}

export interface CodingAgentOption {
  id: string;
  name: string;
}

// Coding agents (runtime="code") assignable from the standalone run panel. Sourced from the agents
// list endpoint, filtered to the coding runtime.
export function useCodingAgents() {
  const { data, loading, error } =
    useFetch<Array<{ id: string; name: string; runtime?: string }>>("/api/agents");
  const agents: CodingAgentOption[] = (data ?? [])
    .filter((a) => a.runtime === "code")
    .map((a) => ({ id: a.id, name: a.name }));
  return { agents, loading, error };
}

export function useCodingRun(projectId: string) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (input: { agentId: string; instruction: string; branch?: string }) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/projects/projects/${projectId}/coding-runs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        return (await res.json()) as { status: string };
      } catch (e) {
        setError((e as Error).message);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [projectId],
  );

  return { run, loading, error };
}

export function useCreateComment(taskId: string | undefined) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useCallback(
    async (body: string) => {
      if (!taskId) return;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/projects/tasks/${taskId}/comments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as TaskComment;
      } catch (e) {
        const msg = (e as Error).message;
        setError(msg);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [taskId],
  );

  return { create, loading, error };
}
