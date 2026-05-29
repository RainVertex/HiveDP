import { useCallback, useEffect, useState } from "react";

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

export interface VikunjaProject {
  id: number;
  title: string;
  description: string;
  is_archived: boolean;
  background_information: string;
  created: string;
  updated: string;
  task_count?: number;
  max_permission?: number;
  owner?: { id: number; username: string; name: string };
}

export interface VikunjaTask {
  id: number;
  title: string;
  description: string;
  done: boolean;
  priority: number;
  project_id: number;
  platform_project_id?: string;
  bucket_id: number;
  due_date: string | null;
  start_date: string | null;
  end_date: string | null;
  percent_done: number;
  is_favorite: boolean;
  labels: { id: number; title: string; hex_color: string }[];
  assignees: { id: number; username: string; name: string }[];
  created: string;
  updated: string;
  project_title?: string;
}

export interface VikunjaBucket {
  id: number;
  title: string;
  position: number;
  tasks: VikunjaTask[];
}

export interface VikunjaComment {
  id: number;
  comment: string;
  author: { id: number; username: string; name: string };
  created: string;
}

export interface TaskFilters {
  done?: boolean;
  priority?: number;
}

export function useProjects() {
  const { data, loading, error, refetch } = useFetch<VikunjaProject[]>("/api/vikunja/projects");
  return { projects: data ?? [], loading, error, refetch };
}

export interface CurrentVikunjaUser {
  id: number;
  username: string;
  name: string;
}

export function useCurrentVikunjaUser() {
  const { data, loading, error } = useFetch<CurrentVikunjaUser>("/api/vikunja/me");
  return { me: data, loading, error };
}

export function useProject(projectId: string | undefined) {
  const url = projectId ? `/api/vikunja/projects/${projectId}` : null;
  const { data, loading, error, refetch } = useFetch<VikunjaProject>(url);
  return { project: data, loading, error, refetch };
}

export function useTasks(projectId: string | number | undefined, filters?: TaskFilters) {
  const qs = filters
    ? "?" +
      new URLSearchParams(
        Object.entries(filters)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, String(v)]),
      ).toString()
    : "";
  const url = projectId ? `/api/vikunja/projects/${projectId}/tasks${qs}` : null;
  const { data, loading, error, refetch } = useFetch<VikunjaTask[]>(url);
  return { tasks: data ?? [], loading, error, refetch };
}

export function useTask(taskId: string | number | undefined) {
  const url = taskId ? `/api/vikunja/tasks/${taskId}` : null;
  const { data, loading, error, refetch } = useFetch<VikunjaTask>(url);
  return { task: data, loading, error, refetch };
}

export function useBuckets(projectId: string | number | undefined) {
  const url = projectId ? `/api/vikunja/projects/${projectId}/buckets` : null;
  const { data, loading, error, refetch } = useFetch<VikunjaBucket[]>(url);
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
        const res = await fetch(`/api/vikunja/projects/${projectId}/buckets`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
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
      const res = await fetch(`/api/vikunja/buckets/${bucketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
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
      const res = await fetch(`/api/vikunja/buckets/${bucketId}`, { method: "DELETE" });
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

export interface VikunjaLabelDto {
  id: number;
  title: string;
  hex_color: string;
}

export function useLabels() {
  const { data, loading, error, refetch } = useFetch<VikunjaLabelDto[]>("/api/vikunja/labels");
  return { labels: data ?? [], loading, error, refetch };
}

export function useCreateLabel() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useCallback(async (input: { title: string; hex_color?: string }) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/vikunja/labels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as VikunjaLabelDto;
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

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
        const res = await fetch(`/api/vikunja/tasks/${taskId}/assignees`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        return await res.json();
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
    async (userId: number) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/vikunja/tasks/${taskId}/assignees/${userId}`, {
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
    async (labelId: number) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/vikunja/tasks/${taskId}/labels`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label_id: labelId }),
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
    async (labelId: number) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/vikunja/tasks/${taskId}/labels/${labelId}`, {
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

export interface VikunjaShareUser {
  id: number;
  username: string;
  permission: number;
}

export function useProjectShares(projectId: string | undefined) {
  const url = projectId ? `/api/vikunja/projects/${projectId}/shares` : null;
  const { data, loading, error, refetch } = useFetch<VikunjaShareUser[]>(url);
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
        const res = await fetch(`/api/vikunja/projects/${projectId}/shares`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        return (await res.json()) as VikunjaShareUser;
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
          `/api/vikunja/projects/${projectId}/shares/${encodeURIComponent(username)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ right }),
          },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
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
          `/api/vikunja/projects/${projectId}/shares/${encodeURIComponent(username)}`,
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
    async (body: { title?: string; description?: string; is_archived?: boolean }) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/vikunja/projects/${projectId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as VikunjaProject;
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
      const res = await fetch(`/api/vikunja/projects/${projectId}`, { method: "DELETE" });
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
      const res = await fetch("/api/vikunja/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as VikunjaProject;
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
      due_date?: string;
      bucket_id?: number;
    }) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/vikunja/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, project_id: projectId }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as VikunjaTask;
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

  const update = useCallback(async (taskId: string | number, body: Partial<VikunjaTask>) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/vikunja/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as VikunjaTask;
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

  const remove = useCallback(async (taskId: string | number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/vikunja/tasks/${taskId}`, { method: "DELETE" });
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

export function useCreateComment(taskId: string | number | undefined) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useCallback(
    async (comment: string) => {
      if (!taskId) return;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/vikunja/tasks/${taskId}/comments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ comment }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as VikunjaComment;
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
