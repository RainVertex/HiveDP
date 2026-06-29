// Single project view: list/kanban tasks, sharing, edit, and task creation.
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { PageLayout } from "@internal/shared-ui";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "@internal/i18n";
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
  useCurrentProjectsUser,
  useBuckets,
  type Task,
  type Bucket,
} from "./api";
import { KanbanBoard } from "./KanbanBoard";
import { UserAutocomplete } from "./components/UserAutocomplete";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { CodingRunPanel } from "./components/CodingRunPanel";

type View = "list" | "kanban";
type SortColumn = "dueDate" | "endDate";

export function ProjectDetailPage() {
  const { t } = useTranslation("projects");
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { project, refetch: refetchProject } = useProject(id);
  const { tasks, loading, error, refetch } = useTasks(id);
  const { me } = useCurrentProjectsUser();
  const { update: updateProject, loading: savingProject } = useUpdateProject(id);
  const { remove: deleteProject, loading: deletingProject } = useDeleteProject();
  const [searchParams, setSearchParams] = useSearchParams();
  const assignedToMe = searchParams.get("assigned") === "me";
  const favoritesOnly = searchParams.get("favorites") === "1";
  const sortParam = searchParams.get("sort");
  const [sortColumnRaw, sortDirRaw] = sortParam?.split(".") ?? [];
  const sortColumn: SortColumn | null =
    sortColumnRaw === "dueDate" || sortColumnRaw === "endDate" ? sortColumnRaw : null;
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

  function setSort(column: SortColumn | null, dir: "asc" | "desc") {
    const next = new URLSearchParams(searchParams);
    if (column) next.set("sort", `${column}.${dir}`);
    else next.delete("sort");
    setSearchParams(next, { replace: true });
  }
  const [showEdit, setShowEdit] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editArchived, setEditArchived] = useState(false);

  function toggleSort(column: SortColumn) {
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
      list = list.filter((t) => t.isFavorite);
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
  const [newTaskBucketId, setNewTaskBucketId] = useState<string>("");
  const [showShares, setShowShares] = useState(false);
  const [showCoding, setShowCoding] = useState(false);
  const [shareUsername, setShareUsername] = useState("");
  const [sharePermission, setSharePermission] = useState(2);
  const {
    shares,
    loading: sharesLoading,
    error: sharesError,
    refetch: refetchShares,
  } = useProjectShares(id);
  const { add: addShare, loading: addingShare, error: addError } = useAddProjectShare(id);
  const { remove: removeShare } = useRemoveProjectShare(id);
  const { update: updateShare } = useUpdateProjectShare(id);

  async function handleCreateTask(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim()) return;
    try {
      await create({
        title: newTitle.trim(),
        bucketId: newTaskBucketId || undefined,
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
    setEditArchived(project?.isArchived ?? false);
    setShowEdit(true);
  }

  async function handleSaveProject(e: React.FormEvent) {
    e.preventDefault();
    if (!editTitle.trim()) return;
    try {
      await updateProject({
        title: editTitle.trim(),
        description: editDescription.trim() || null,
        isArchived: editArchived,
      });
      setShowEdit(false);
      refetchProject();
    } catch {
      // ignore
    }
  }

  async function handleDeleteProject() {
    if (!confirm(t("confirm.deleteProject", { title: project?.title }))) return;
    try {
      await deleteProject(id);
      navigate("/projects");
    } catch {
      // ignore
    }
  }

  const isOwner = !!project?.owner?.id && project.owner.id === me?.id;
  const canEdit = !project || isOwner || (project.maxPermission ?? 0) >= 2;
  const isAdmin = !project || isOwner || (project.maxPermission ?? 0) >= 3;

  return (
    <PageLayout
      title={project?.title ?? t("page.projectFallbackTitle")}
      description={project?.description || undefined}
      actions={
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-app-border">
            <button
              type="button"
              onClick={() => setView("list")}
              className={`px-3 py-1.5 text-sm ${view === "list" ? "bg-app-primary text-app-primary-foreground" : "text-app-text hover:bg-app-surface-hover"} rounded-l-md`}
            >
              {t("view.list")}
            </button>
            <button
              type="button"
              onClick={() => setView("kanban")}
              className={`px-3 py-1.5 text-sm ${view === "kanban" ? "bg-app-primary text-app-primary-foreground" : "text-app-text hover:bg-app-surface-hover"} rounded-r-md`}
            >
              {t("view.kanban")}
            </button>
          </div>
          {isAdmin && (
            <button
              type="button"
              onClick={openEdit}
              className="rounded-md border border-app-border bg-app-surface px-3 py-1.5 text-sm text-app-text hover:bg-app-surface-hover"
            >
              {t("actions.edit")}
            </button>
          )}
          {isAdmin && (
            <button
              type="button"
              onClick={() => setShowShares((v) => !v)}
              className="rounded-md border border-app-border bg-app-surface px-3 py-1.5 text-sm text-app-text hover:bg-app-surface-hover"
            >
              {t("actions.share")}
            </button>
          )}
          {canEdit && (
            <button
              type="button"
              onClick={() => setShowCoding((v) => !v)}
              className="rounded-md border border-app-border bg-app-surface px-3 py-1.5 text-sm text-app-text hover:bg-app-surface-hover"
            >
              {t("coding.action")}
            </button>
          )}
          {canEdit && (
            <button
              type="button"
              onClick={() => setShowNewTask(true)}
              className="rounded-md bg-app-primary px-3 py-1.5 text-sm font-medium text-app-primary-foreground hover:opacity-90"
            >
              {t("actions.newTask")}
            </button>
          )}
          {isAdmin && (
            <button
              type="button"
              onClick={() => void handleDeleteProject()}
              disabled={deletingProject}
              className="rounded-md border border-app-danger px-3 py-1.5 text-sm text-app-danger hover:bg-app-danger/10 disabled:opacity-60"
            >
              {deletingProject ? t("actions.deleting") : t("actions.delete")}
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
          <h3 className="text-sm font-semibold text-app-text">{t("form.shareHeading")}</h3>
          {project?.isAutoProvisioned ? (
            <p className="mt-1 text-xs text-app-text-muted">{t("share.syncedNote")}</p>
          ) : (
            <p className="mt-1 text-xs text-app-text-muted">{t("share.manualNote")}</p>
          )}

          {(addError || sharesError) && (
            <div className="mt-3 rounded-md border border-app-danger bg-app-surface px-3 py-2 text-xs text-app-danger">
              {addError ?? sharesError}
            </div>
          )}

          <form onSubmit={handleAddShare} className="mt-3 flex items-center gap-2">
            <UserAutocomplete
              value={shareUsername}
              onChange={setShareUsername}
              placeholder={t("form.usernamePlaceholder")}
            />
            <select
              value={sharePermission}
              onChange={(e) => setSharePermission(Number(e.target.value))}
              disabled={project?.isAutoProvisioned}
              className="rounded-md border border-app-border bg-app-surface px-2 py-1.5 text-sm text-app-text disabled:opacity-60"
            >
              <option value={0}>{t("permissions.read")}</option>
              <option value={1}>{t("permissions.triage")}</option>
              <option value={2}>{t("permissions.write")}</option>
              <option value={3}>{t("permissions.maintain")}</option>
              <option value={4}>{t("permissions.admin")}</option>
            </select>
            <button
              type="submit"
              disabled={addingShare || !shareUsername.trim() || project?.isAutoProvisioned}
              className="rounded-md bg-app-primary px-3 py-1.5 text-sm font-medium text-app-primary-foreground hover:opacity-90 disabled:opacity-60"
            >
              {addingShare ? t("actions.adding") : t("actions.add")}
            </button>
          </form>

          <div className="mt-4">
            <h4 className="text-xs font-semibold text-app-text-muted">
              {t("form.sharedWithHeading")}
            </h4>
            {sharesLoading ? (
              <p className="mt-2 text-xs text-app-text-muted">{t("loading.generic")}</p>
            ) : shares.length === 0 ? (
              <p className="mt-2 text-xs text-app-text-muted">{t("share.notSharedYet")}</p>
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
                        disabled={project?.isAutoProvisioned}
                        className="rounded-md border border-app-border bg-app-surface px-2 py-1 text-xs text-app-text disabled:opacity-60"
                        aria-label={t("permissions.permissionAriaLabel", { username: s.username })}
                      >
                        <option value={0}>{t("permissions.read")}</option>
                        <option value={1}>{t("permissions.triage")}</option>
                        <option value={2}>{t("permissions.write")}</option>
                        <option value={3}>{t("permissions.maintain")}</option>
                        <option value={4}>{t("permissions.admin")}</option>
                      </select>
                      {!project?.isAutoProvisioned && (
                        <button
                          type="button"
                          onClick={() => void handleRemoveShare(s.username)}
                          className="text-xs text-app-danger hover:underline"
                        >
                          {t("actions.remove")}
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {showCoding && canEdit && <CodingRunPanel projectId={id} />}

      {showNewTask && (
        <form onSubmit={handleCreateTask} className="mb-4 flex items-center gap-2">
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder={t("form.taskTitlePlaceholder")}
            autoFocus
            className="flex-1 rounded-md border border-app-border bg-app-surface px-3 py-1.5 text-sm text-app-text placeholder:text-app-text-muted focus:outline-none focus:ring-2 focus:ring-app-primary"
          />
          {buckets.length > 0 && (
            <select
              value={newTaskBucketId}
              onChange={(e) => setNewTaskBucketId(e.target.value)}
              className="rounded-md border border-app-border bg-app-surface px-2 py-1.5 text-sm text-app-text"
            >
              <option value="">{t("form.defaultColumn")}</option>
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
            className="rounded-md bg-app-primary px-3 py-1.5 text-sm font-medium text-app-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {creating ? t("actions.creating") : t("actions.create")}
          </button>
          <button
            type="button"
            onClick={() => setShowNewTask(false)}
            className="rounded-md border border-app-border px-3 py-1.5 text-sm text-app-text hover:bg-app-surface-hover"
          >
            {t("actions.cancel")}
          </button>
        </form>
      )}

      {showEdit && (
        <form
          onSubmit={handleSaveProject}
          className="mb-4 rounded-lg border border-app-border bg-app-surface p-4 space-y-3"
        >
          <h3 className="text-sm font-semibold text-app-text">{t("form.editProjectHeading")}</h3>
          <div>
            <label className="block text-xs font-medium text-app-text-muted">
              {t("form.titleLabel")}
            </label>
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
            <label className="block text-xs font-medium text-app-text-muted">
              {t("form.descriptionEditLabel")}
            </label>
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
            {t("form.archivedLabel")}
          </label>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={savingProject || !editTitle.trim()}
              className="rounded-md bg-app-primary px-3 py-1.5 text-sm font-medium text-app-primary-foreground hover:opacity-90 disabled:opacity-60"
            >
              {savingProject ? t("actions.saving") : t("actions.save")}
            </button>
            <button
              type="button"
              onClick={() => setShowEdit(false)}
              className="rounded-md border border-app-border bg-app-surface px-3 py-1.5 text-sm text-app-text hover:bg-app-surface-hover"
            >
              {t("actions.cancel")}
            </button>
          </div>
        </form>
      )}

      {!canEdit && (
        <div className="mb-4 rounded-md border border-app-border bg-app-surface px-3 py-2 text-sm text-app-text-muted">
          {t("info.readOnlyProject")}
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
          {t("filter.assignedToMe")}
        </label>
        <label className="inline-flex items-center gap-2 text-xs text-app-text-muted">
          <input
            type="checkbox"
            checked={favoritesOnly}
            onChange={(e) => setFavoritesOnly(e.target.checked)}
            className="rounded"
          />
          {t("filter.favoritesOnly")}
        </label>
        {(assignedToMe || favoritesOnly || sortColumn) && (
          <span className="text-xs text-app-text-muted">
            {t("info.showingCount", { visible: visibleTasks.length, total: tasks.length })}
          </span>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-app-text-muted">{t("loading.generic")}</p>
      ) : view === "kanban" ? (
        <ErrorBoundary fallbackTitle={t("view.kanban")}>
          <KanbanBoard projectId={id} tasks={visibleTasks} onUpdate={refetch} canEdit={canEdit} />
        </ErrorBoundary>
      ) : (
        <TaskListView
          tasks={visibleTasks}
          buckets={buckets}
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
  buckets,
  sortColumn,
  sortDir,
  onSort,
}: {
  tasks: Task[];
  buckets: Bucket[];
  sortColumn: SortColumn | null;
  sortDir: "asc" | "desc";
  onSort: (column: SortColumn) => void;
}) {
  const { t } = useTranslation("projects");

  if (tasks.length === 0) {
    return <p className="text-sm text-app-text-muted">{t("empty.noTasks")}</p>;
  }

  function sortIndicator(column: SortColumn) {
    if (sortColumn !== column) return "↕";
    return sortDir === "asc" ? "↑" : "↓";
  }

  const sortedBuckets = [...buckets].sort((a, b) => a.position - b.position);
  const fallbackBucketId = sortedBuckets[0]?.id ?? null;
  const bucketTitleById = new Map(buckets.map((b) => [b.id, b.title]));
  function columnLabel(task: Task): string | null {
    const bid = task.bucketId ?? fallbackBucketId;
    return (bid && bucketTitleById.get(bid)) || null;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-app-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-app-border bg-app-surface text-left text-xs text-app-text-muted">
            <th className="px-4 py-2 font-medium">{t("fields.title")}</th>
            <th className="px-4 py-2 font-medium">{t("fields.status")}</th>
            <th className="px-4 py-2 font-medium">{t("fields.stage")}</th>
            <th className="px-4 py-2 font-medium">{t("fields.priority")}</th>
            <th className="px-4 py-2 font-medium">{t("fields.assignee")}</th>
            <th className="px-4 py-2 font-medium">
              <button
                type="button"
                onClick={() => onSort("dueDate")}
                className="flex items-center gap-1 hover:text-app-text"
              >
                {t("fields.dueDate")}{" "}
                <span className="text-[10px]">{sortIndicator("dueDate")}</span>
              </button>
            </th>
            <th className="px-4 py-2 font-medium">
              <button
                type="button"
                onClick={() => onSort("endDate")}
                className="flex items-center gap-1 hover:text-app-text"
              >
                {t("fields.endDate")}{" "}
                <span className="text-[10px]">{sortIndicator("endDate")}</span>
              </button>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-app-border">
          {tasks.map((task) => (
            <tr key={task.id} className="bg-app-surface hover:bg-app-surface-hover">
              <td className="px-4 py-2">
                <Link to={`/tasks/${task.id}`} className="text-app-primary hover:underline">
                  {task.title}
                </Link>
              </td>
              <td className="px-4 py-2">
                <span
                  className={`inline-block rounded-full px-2 py-0.5 text-xs ${task.done ? "bg-green-900/40 text-green-400" : "bg-gray-700/40 text-gray-300"}`}
                >
                  {task.done ? t("status.done") : t("status.open")}
                </span>
              </td>
              <td className="px-4 py-2">
                {columnLabel(task) ? (
                  <span className="inline-block rounded-full border border-app-border px-2 py-0.5 text-xs text-app-text-muted">
                    {columnLabel(task)}
                  </span>
                ) : (
                  <span className="text-app-text-muted">-</span>
                )}
              </td>
              <td className="px-4 py-2">
                <PriorityBadge priority={task.priority} />
              </td>
              <td className="px-4 py-2 text-app-text-muted">
                {task.assignees?.map((a) => a.name || a.username).join(", ") || "-"}
              </td>
              <td className="px-4 py-2 text-app-text-muted">
                {task.dueDate ? new Date(task.dueDate).toLocaleDateString() : "-"}
              </td>
              <td className="px-4 py-2 text-app-text-muted">
                {task.endDate ? new Date(task.endDate).toLocaleDateString() : "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const PRIORITY_COLORS: Record<number, string> = {
  0: "bg-gray-600",
  1: "bg-blue-600",
  2: "bg-yellow-600",
  3: "bg-orange-600",
  4: "bg-red-600",
};

function PriorityBadge({ priority }: { priority: number }) {
  const { t } = useTranslation("projects");
  const priorityKeys: Record<number, string> = {
    0: "priority.none",
    1: "priority.low",
    2: "priority.medium",
    3: "priority.high",
    4: "priority.urgent",
  };
  const key = priorityKeys[priority] ?? "priority.none";
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs text-white ${PRIORITY_COLORS[priority] ?? "bg-gray-600"}`}
    >
      {t(key)}
    </span>
  );
}
