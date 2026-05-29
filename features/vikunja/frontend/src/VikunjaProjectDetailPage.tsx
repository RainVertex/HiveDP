import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { PageLayout } from "@internal/shared-ui";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  useTasks,
  useCreateTask,
  useProject,
  useUpdateProject,
  useDeleteProject,
  useProjectShares,
  useAddProjectShare,
  useRemoveProjectShare,
  useUpdateProjectShare,
  useCurrentVikunjaUser,
  useBuckets,
  type VikunjaTask,
} from "./api";
import { VikunjaKanbanBoard } from "./VikunjaKanbanBoard";
import { UserAutocomplete } from "./components/UserAutocomplete";
import { ErrorBoundary } from "./components/ErrorBoundary";

const POLL_INTERVAL_MS = 30_000;

type View = "list" | "kanban";

const PRIORITY_LABELS: Record<number, string> = {
  0: "None",
  1: "Low",
  2: "Medium",
  3: "High",
  4: "Urgent",
};

const PRIORITY_COLORS: Record<number, string> = {
  0: "bg-gray-600",
  1: "bg-blue-600",
  2: "bg-yellow-600",
  3: "bg-orange-600",
  4: "bg-red-600",
};

export function VikunjaProjectDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { project, refetch: refetchProject } = useProject(id);
  const { tasks, loading, error, refetch } = useTasks(id);
  const { me } = useCurrentVikunjaUser();
  const { update: updateProject, loading: savingProject } = useUpdateProject(id);
  const { remove: deleteProject, loading: deletingProject } = useDeleteProject();
  const [searchParams, setSearchParams] = useSearchParams();
  const assignedToMe = searchParams.get("assigned") === "me";
  const favoritesOnly = searchParams.get("favorites") === "1";
  const sortParam = searchParams.get("sort");
  const [sortColumnRaw, sortDirRaw] = sortParam?.split(".") ?? [];
  const sortColumn =
    sortColumnRaw === "due_date" || sortColumnRaw === "end_date" ? sortColumnRaw : null;
  const sortDir: "asc" | "desc" = sortDirRaw === "desc" ? "desc" : "asc";

  function setAssignedToMe(value: boolean) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set("assigned", "me");
    else next.delete("assigned");
    setSearchParams(next, { replace: true });
  }

  function setFavoritesOnly(value: boolean) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set("favorites", "1");
    else next.delete("favorites");
    setSearchParams(next, { replace: true });
  }

  function setSort(column: "due_date" | "end_date" | null, dir: "asc" | "desc") {
    const next = new URLSearchParams(searchParams);
    if (column) next.set("sort", `${column}.${dir}`);
    else next.delete("sort");
    setSearchParams(next, { replace: true });
  }
  const [showEdit, setShowEdit] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editArchived, setEditArchived] = useState(false);

  function toggleSort(column: "due_date" | "end_date") {
    if (sortColumn !== column) {
      setSort(column, "asc");
    } else if (sortDir === "asc") {
      setSort(column, "desc");
    } else {
      setSort(null, "asc");
    }
  }

  const visibleTasks = (() => {
    let list = tasks;
    if (assignedToMe && me) {
      list = list.filter((t) => t.assignees?.some((a) => a.id === me.id));
    }
    if (favoritesOnly) {
      list = list.filter((t) => t.is_favorite);
    }
    if (sortColumn) {
      const col = sortColumn;
      const dir = sortDir;
      list = [...list].sort((a, b) => {
        const av = a[col];
        const bv = b[col];
        const at = av ? new Date(av).getTime() : Number.POSITIVE_INFINITY;
        const bt = bv ? new Date(bv).getTime() : Number.POSITIVE_INFINITY;
        return dir === "asc" ? at - bt : bt - at;
      });
    }
    return list;
  })();
  const { create, loading: creating } = useCreateTask(id);
  const { buckets } = useBuckets(id);
  const [view, setView] = useState<View>("list");
  const [showNewTask, setShowNewTask] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newTaskBucketId, setNewTaskBucketId] = useState<number | "">("");
  const [showShares, setShowShares] = useState(false);
  const [shareUsername, setShareUsername] = useState("");
  const [sharePermission, setSharePermission] = useState(1);
  const {
    shares,
    loading: sharesLoading,
    error: sharesError,
    refetch: refetchShares,
  } = useProjectShares(id);
  const { add: addShare, loading: addingShare, error: addError } = useAddProjectShare(id);
  const { remove: removeShare } = useRemoveProjectShare(id);
  const { update: updateShare } = useUpdateProjectShare(id);
  const inFlight = useRef(false);

  const runSync = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetch("/api/vikunja/sync", {
        method: "POST",
        credentials: "include",
      });
      if (res.ok) refetch();
    } finally {
      inFlight.current = false;
    }
  }, [refetch]);

  useEffect(() => {
    void runSync();
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void runSync();
    }, POLL_INTERVAL_MS);
    function onFocus() {
      void runSync();
    }
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [runSync]);

  async function handleCreateTask(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim()) return;
    try {
      await create({
        title: newTitle.trim(),
        bucket_id: typeof newTaskBucketId === "number" ? newTaskBucketId : undefined,
      });
      setNewTitle("");
      setNewTaskBucketId("");
      setShowNewTask(false);
      refetch();
    } catch {
      // error shown via hook
    }
  }

  async function handleAddShare(e: React.FormEvent) {
    e.preventDefault();
    if (!shareUsername.trim()) return;
    try {
      await addShare({ username: shareUsername.trim(), right: sharePermission });
      setShareUsername("");
      refetchShares();
    } catch {
      // error shown via hook
    }
  }

  async function handleRemoveShare(username: string) {
    try {
      await removeShare(username);
      refetchShares();
    } catch {
      // ignore
    }
  }

  async function handleChangeSharePermission(username: string, right: number) {
    try {
      await updateShare(username, right);
      refetchShares();
    } catch {
      // ignore
    }
  }

  function openEdit() {
    setEditTitle(project?.title ?? "");
    setEditDescription(project?.description ?? "");
    setEditArchived(project?.is_archived ?? false);
    setShowEdit(true);
  }

  async function handleSaveProject(e: React.FormEvent) {
    e.preventDefault();
    if (!editTitle.trim()) return;
    try {
      await updateProject({
        title: editTitle.trim(),
        description: editDescription.trim(),
        is_archived: editArchived,
      });
      setShowEdit(false);
      refetchProject();
    } catch {
      // ignore
    }
  }

  async function handleDeleteProject() {
    if (!confirm(`Delete "${project?.title}"? This cannot be undone.`)) return;
    try {
      await deleteProject(id);
      navigate("/vikunja");
    } catch {
      // ignore
    }
  }

  const isOwner = !!project?.owner?.id && project.owner.id === me?.id;
  const canEdit = !project || isOwner || (project.max_permission ?? 0) >= 1;
  const isAdmin = !project || isOwner || (project.max_permission ?? 0) >= 2;

  return (
    <PageLayout
      title={project?.title ?? "Project"}
      description={project?.description || undefined}
      actions={
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-app-border">
            <button
              type="button"
              onClick={() => setView("list")}
              className={`px-3 py-1.5 text-sm ${view === "list" ? "bg-app-primary text-app-primary-on" : "text-app-text hover:bg-app-surface-hover"} rounded-l-md`}
            >
              List
            </button>
            <button
              type="button"
              onClick={() => setView("kanban")}
              className={`px-3 py-1.5 text-sm ${view === "kanban" ? "bg-app-primary text-app-primary-on" : "text-app-text hover:bg-app-surface-hover"} rounded-r-md`}
            >
              Kanban
            </button>
          </div>
          {isAdmin && (
            <button
              type="button"
              onClick={openEdit}
              className="rounded-md border border-app-border bg-app-surface px-3 py-1.5 text-sm text-app-text hover:bg-app-surface-hover"
            >
              Edit
            </button>
          )}
          {isAdmin && (
            <button
              type="button"
              onClick={() => setShowShares((v) => !v)}
              className="rounded-md border border-app-border bg-app-surface px-3 py-1.5 text-sm text-app-text hover:bg-app-surface-hover"
            >
              Share
            </button>
          )}
          {canEdit && (
            <button
              type="button"
              onClick={() => setShowNewTask(true)}
              className="rounded-md bg-app-primary px-3 py-1.5 text-sm font-medium text-app-primary-on hover:opacity-90"
            >
              New Task
            </button>
          )}
          {isAdmin && (
            <button
              type="button"
              onClick={() => void handleDeleteProject()}
              disabled={deletingProject}
              className="rounded-md border border-app-danger px-3 py-1.5 text-sm text-app-danger hover:bg-app-danger/10 disabled:opacity-60"
            >
              {deletingProject ? "Deleting..." : "Delete"}
            </button>
          )}
        </div>
      }
    >
      {error && (
        <div className="mb-4 rounded-md border border-app-danger bg-app-surface px-3 py-2 text-sm text-app-danger">
          {error}
        </div>
      )}

      {showShares && (
        <div className="mb-4 rounded-lg border border-app-border bg-app-surface p-4">
          <h3 className="text-sm font-semibold text-app-text">Share Project</h3>
          <p className="mt-1 text-xs text-app-text-muted">
            Add Vikunja users by username. They'll see this project in their workspace after their
            next sync.
          </p>

          {(addError || sharesError) && (
            <div className="mt-3 rounded-md border border-app-danger bg-app-surface px-3 py-2 text-xs text-app-danger">
              {addError ?? sharesError}
            </div>
          )}

          <form onSubmit={handleAddShare} className="mt-3 flex items-center gap-2">
            <UserAutocomplete
              value={shareUsername}
              onChange={setShareUsername}
              placeholder="Type a username..."
            />
            <select
              value={sharePermission}
              onChange={(e) => setSharePermission(Number(e.target.value))}
              className="rounded-md border border-app-border bg-app-surface px-2 py-1.5 text-sm text-app-text"
            >
              <option value={0}>Read</option>
              <option value={1}>Read & Write</option>
              <option value={2}>Admin</option>
            </select>
            <button
              type="submit"
              disabled={addingShare || !shareUsername.trim()}
              className="rounded-md bg-app-primary px-3 py-1.5 text-sm font-medium text-app-primary-on hover:opacity-90 disabled:opacity-60"
            >
              {addingShare ? "Adding..." : "Add"}
            </button>
          </form>

          <div className="mt-4">
            <h4 className="text-xs font-semibold text-app-text-muted">Shared with</h4>
            {sharesLoading ? (
              <p className="mt-2 text-xs text-app-text-muted">Loading...</p>
            ) : shares.length === 0 ? (
              <p className="mt-2 text-xs text-app-text-muted">Not shared with anyone yet.</p>
            ) : (
              <ul className="mt-2 divide-y divide-app-border rounded-md border border-app-border">
                {shares.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center justify-between bg-app-surface px-3 py-2 text-sm"
                  >
                    <span className="font-medium text-app-text">{s.username}</span>
                    <div className="flex items-center gap-3">
                      <select
                        value={s.permission}
                        onChange={(e) =>
                          void handleChangeSharePermission(s.username, Number(e.target.value))
                        }
                        className="rounded-md border border-app-border bg-app-surface px-2 py-1 text-xs text-app-text"
                        aria-label={`Permission for ${s.username}`}
                      >
                        <option value={0}>Read</option>
                        <option value={1}>Read & Write</option>
                        <option value={2}>Admin</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => void handleRemoveShare(s.username)}
                        className="text-xs text-app-danger hover:underline"
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {showNewTask && (
        <form onSubmit={handleCreateTask} className="mb-4 flex items-center gap-2">
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Task title"
            autoFocus
            className="flex-1 rounded-md border border-app-border bg-app-surface px-3 py-1.5 text-sm text-app-text placeholder:text-app-text-muted focus:outline-none focus:ring-2 focus:ring-app-primary"
          />
          {buckets.length > 0 && (
            <select
              value={newTaskBucketId}
              onChange={(e) => setNewTaskBucketId(e.target.value ? Number(e.target.value) : "")}
              className="rounded-md border border-app-border bg-app-surface px-2 py-1.5 text-sm text-app-text"
            >
              <option value="">Default column</option>
              {buckets.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title}
                </option>
              ))}
            </select>
          )}
          <button
            type="submit"
            disabled={creating}
            className="rounded-md bg-app-primary px-3 py-1.5 text-sm font-medium text-app-primary-on hover:opacity-90 disabled:opacity-60"
          >
            {creating ? "Creating..." : "Create"}
          </button>
          <button
            type="button"
            onClick={() => setShowNewTask(false)}
            className="rounded-md border border-app-border px-3 py-1.5 text-sm text-app-text hover:bg-app-surface-hover"
          >
            Cancel
          </button>
        </form>
      )}

      {showEdit && (
        <form
          onSubmit={handleSaveProject}
          className="mb-4 rounded-lg border border-app-border bg-app-surface p-4 space-y-3"
        >
          <h3 className="text-sm font-semibold text-app-text">Edit Project</h3>
          <div>
            <label className="block text-xs font-medium text-app-text-muted">Title</label>
            <input
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              required
              maxLength={200}
              className="mt-1 w-full rounded-md border border-app-border bg-app-surface px-3 py-2 text-sm text-app-text"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-app-text-muted">Description</label>
            <textarea
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              rows={3}
              maxLength={10000}
              className="mt-1 w-full rounded-md border border-app-border bg-app-surface px-3 py-2 text-sm text-app-text"
            />
          </div>
          <label className="inline-flex items-center gap-2 text-xs text-app-text-muted">
            <input
              type="checkbox"
              checked={editArchived}
              onChange={(e) => setEditArchived(e.target.checked)}
            />
            Archived
          </label>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={savingProject || !editTitle.trim()}
              className="rounded-md bg-app-primary px-3 py-1.5 text-sm font-medium text-app-primary-on hover:opacity-90 disabled:opacity-60"
            >
              {savingProject ? "Saving..." : "Save"}
            </button>
            <button
              type="button"
              onClick={() => setShowEdit(false)}
              className="rounded-md border border-app-border bg-app-surface px-3 py-1.5 text-sm text-app-text hover:bg-app-surface-hover"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {!canEdit && (
        <div className="mb-4 rounded-md border border-app-border bg-app-surface px-3 py-2 text-sm text-app-text-muted">
          You have read-only access to this project. Editing and adding tasks is disabled.
        </div>
      )}

      <div className="mb-3 flex items-center gap-3">
        <label className="inline-flex items-center gap-2 text-xs text-app-text-muted">
          <input
            type="checkbox"
            checked={assignedToMe}
            onChange={(e) => setAssignedToMe(e.target.checked)}
            className="rounded"
          />
          Assigned to me
        </label>
        <label className="inline-flex items-center gap-2 text-xs text-app-text-muted">
          <input
            type="checkbox"
            checked={favoritesOnly}
            onChange={(e) => setFavoritesOnly(e.target.checked)}
            className="rounded"
          />
          ★ Favorites only
        </label>
        {(assignedToMe || favoritesOnly || sortColumn) && (
          <span className="text-xs text-app-text-muted">
            Showing {visibleTasks.length} of {tasks.length}
          </span>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-app-text-muted">Loading...</p>
      ) : view === "kanban" ? (
        <ErrorBoundary fallbackTitle="Kanban board failed to render">
          <VikunjaKanbanBoard
            projectId={id}
            tasks={visibleTasks}
            onUpdate={refetch}
            canEdit={canEdit}
          />
        </ErrorBoundary>
      ) : (
        <TaskListView
          tasks={visibleTasks}
          sortColumn={sortColumn}
          sortDir={sortDir}
          onSort={toggleSort}
        />
      )}
    </PageLayout>
  );
}

function TaskListView({
  tasks,
  sortColumn,
  sortDir,
  onSort,
}: {
  tasks: VikunjaTask[];
  sortColumn: "due_date" | "end_date" | null;
  sortDir: "asc" | "desc";
  onSort: (column: "due_date" | "end_date") => void;
}) {
  if (tasks.length === 0) {
    return <p className="text-sm text-app-text-muted">No tasks match.</p>;
  }

  function sortIndicator(column: "due_date" | "end_date") {
    if (sortColumn !== column) return "↕";
    return sortDir === "asc" ? "↑" : "↓";
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-app-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-app-border bg-app-surface text-left text-xs text-app-text-muted">
            <th className="px-4 py-2 font-medium">Title</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 font-medium">Priority</th>
            <th className="px-4 py-2 font-medium">Assignee</th>
            <th className="px-4 py-2 font-medium">
              <button
                type="button"
                onClick={() => onSort("due_date")}
                className="flex items-center gap-1 hover:text-app-text"
              >
                Due Date <span className="text-[10px]">{sortIndicator("due_date")}</span>
              </button>
            </th>
            <th className="px-4 py-2 font-medium">
              <button
                type="button"
                onClick={() => onSort("end_date")}
                className="flex items-center gap-1 hover:text-app-text"
              >
                End Date <span className="text-[10px]">{sortIndicator("end_date")}</span>
              </button>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-app-border">
          {tasks.map((t) => (
            <tr key={t.id} className="bg-app-surface hover:bg-app-surface-hover">
              <td className="px-4 py-2">
                <Link to={`/vikunja/tasks/${t.id}`} className="text-app-primary-on hover:underline">
                  {t.title}
                </Link>
              </td>
              <td className="px-4 py-2">
                <span
                  className={`inline-block rounded-full px-2 py-0.5 text-xs ${t.done ? "bg-green-900/40 text-green-400" : "bg-gray-700/40 text-gray-300"}`}
                >
                  {t.done ? "Done" : "Open"}
                </span>
              </td>
              <td className="px-4 py-2">
                <span
                  className={`inline-block rounded-full px-2 py-0.5 text-xs text-white ${PRIORITY_COLORS[t.priority] ?? "bg-gray-600"}`}
                >
                  {PRIORITY_LABELS[t.priority] ?? "None"}
                </span>
              </td>
              <td className="px-4 py-2 text-app-text-muted">
                {t.assignees?.map((a) => a.name || a.username).join(", ") || "-"}
              </td>
              <td className="px-4 py-2 text-app-text-muted">
                {t.due_date ? new Date(t.due_date).toLocaleDateString() : "-"}
              </td>
              <td className="px-4 py-2 text-app-text-muted">
                {t.end_date ? new Date(t.end_date).toLocaleDateString() : "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
