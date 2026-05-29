import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { PageLayout } from "@internal/shared-ui";
import { useProjects, useCreateProject } from "./api";

const POLL_INTERVAL_MS = 30_000;

export function VikunjaProjectsPage() {
  const { projects, loading, error, refetch } = useProjects();
  const { create: createProject, loading: creating, error: createError } = useCreateProject();
  const [initializing, setInitializing] = useState(true);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [showNewProject, setShowNewProject] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const initRan = useRef(false);
  const inFlight = useRef(false);

  const runSync = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetch("/api/vikunja/sync", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        setSyncError(`Sync failed: ${body.error ?? res.statusText}`);
        return;
      }
      setSyncError(null);
      refetch();
    } catch (err) {
      setSyncError(`Sync error: ${err instanceof Error ? err.message : "unknown"}`);
    } finally {
      inFlight.current = false;
    }
  }, [refetch]);

  useEffect(() => {
    if (initRan.current) return;
    initRan.current = true;
    void (async () => {
      try {
        const initRes = await fetch("/api/vikunja/init", {
          method: "POST",
          credentials: "include",
        });
        if (!initRes.ok) {
          const body = await initRes.json().catch(() => ({ error: initRes.statusText }));
          setSyncError(`Vikunja init failed: ${body.error ?? initRes.statusText}`);
          return;
        }
        await runSync();
      } finally {
        setInitializing(false);
      }
    })();
  }, [runSync]);

  useEffect(() => {
    if (initializing) return;
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void runSync();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [initializing, runSync]);

  useEffect(() => {
    if (initializing) return;
    function onFocus() {
      void runSync();
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [initializing, runSync]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim()) return;
    try {
      await createProject({
        title: newTitle.trim(),
        description: newDescription.trim() || undefined,
      });
      setNewTitle("");
      setNewDescription("");
      setShowNewProject(false);
      refetch();
    } catch {
      // error rendered from createError
    }
  }

  function handleCancel() {
    setShowNewProject(false);
    setNewTitle("");
    setNewDescription("");
  }

  return (
    <PageLayout
      title="Projects"
      description="Vikunja project boards."
      actions={
        <button
          type="button"
          onClick={() => setShowNewProject(true)}
          disabled={initializing || showNewProject}
          className="rounded-md border border-app-border bg-app-primary px-3 py-1.5 text-sm text-app-primary-on hover:opacity-90 disabled:opacity-50"
        >
          + New Project
        </button>
      }
    >
      {showNewProject && (
        <form
          onSubmit={handleCreate}
          className="mb-4 rounded-lg border border-app-border bg-app-surface p-4"
        >
          {createError && (
            <div className="mb-3 rounded-md border border-app-danger bg-app-surface px-3 py-2 text-sm text-app-danger">
              {createError}
            </div>
          )}
          <label className="block text-xs font-medium text-app-text-muted">Title</label>
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            autoFocus
            required
            maxLength={200}
            placeholder="My new project"
            className="mt-1 w-full rounded-md border border-app-border bg-app-surface px-3 py-2 text-sm text-app-text"
          />
          <label className="mt-3 block text-xs font-medium text-app-text-muted">
            Description (optional)
          </label>
          <textarea
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            rows={2}
            maxLength={10000}
            placeholder="What is this project about?"
            className="mt-1 w-full rounded-md border border-app-border bg-app-surface px-3 py-2 text-sm text-app-text"
          />
          <div className="mt-3 flex items-center gap-2">
            <button
              type="submit"
              disabled={creating || !newTitle.trim()}
              className="rounded-md border border-app-border bg-app-primary px-3 py-1.5 text-sm text-app-primary-on hover:opacity-90 disabled:opacity-50"
            >
              {creating ? "Creating..." : "Create"}
            </button>
            <button
              type="button"
              onClick={handleCancel}
              disabled={creating}
              className="rounded-md border border-app-border bg-app-surface px-3 py-1.5 text-sm text-app-text hover:bg-app-surface-hover"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {syncError && (
        <div className="mb-4 rounded-md border border-app-danger bg-app-surface px-3 py-2 text-sm text-app-danger">
          {syncError}
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-md border border-app-danger bg-app-surface px-3 py-2 text-sm text-app-danger">
          {error}
        </div>
      )}

      {loading || initializing ? (
        <p className="text-sm text-app-text-muted">
          {initializing ? "Setting up your project workspace..." : "Loading..."}
        </p>
      ) : projects.length === 0 ? (
        <p className="text-sm text-app-text-muted">
          No projects yet. Click "+ New Project" to create one.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <Link
              key={p.id}
              to={`/vikunja/projects/${p.id}`}
              className="rounded-lg border border-app-border bg-app-surface p-4 hover:bg-app-surface-hover transition-colors"
            >
              <h3 className="text-sm font-medium text-app-text">{p.title}</h3>
              {p.description && (
                <p className="mt-1 text-xs text-app-text-muted line-clamp-2">{p.description}</p>
              )}
              <div className="mt-3 text-[11px] text-app-text-muted">
                {p.task_count !== undefined ? `${p.task_count} tasks` : ""}
              </div>
            </Link>
          ))}
        </div>
      )}
    </PageLayout>
  );
}
