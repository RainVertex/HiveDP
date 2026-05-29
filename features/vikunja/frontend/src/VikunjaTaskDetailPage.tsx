import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PageLayout } from "@internal/shared-ui";
import {
  useTask,
  useUpdateTask,
  useDeleteTask,
  useCreateComment,
  useLabels,
  useCreateLabel,
  useTaskAssignees,
  useTaskLabels,
  useProject,
  useCurrentVikunjaUser,
  type VikunjaComment,
} from "./api";
import { UserAutocomplete } from "./components/UserAutocomplete";

const PRIORITIES = [
  { value: 0, label: "None" },
  { value: 1, label: "Low" },
  { value: 2, label: "Medium" },
  { value: 3, label: "High" },
  { value: 4, label: "Urgent" },
];

function toInputDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function fromInputDate(value: string): string | null {
  if (!value) return null;
  return new Date(value + "T00:00:00Z").toISOString();
}

export function VikunjaTaskDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { task, loading, error, refetch } = useTask(id);
  const { project } = useProject(task?.platform_project_id);
  const { update, loading: saving } = useUpdateTask();
  const { remove: removeTask, loading: deleting } = useDeleteTask();
  const { create: postComment, loading: commenting } = useCreateComment(id);
  const { labels: allLabels, refetch: refetchLabels } = useLabels();
  const { create: createNewLabel } = useCreateLabel();
  const { add: addAssignee, remove: removeAssignee } = useTaskAssignees(id);
  const { add: addLabel, remove: removeLabel } = useTaskLabels(id);
  const { me } = useCurrentVikunjaUser();
  const isOwner = !!project?.owner?.id && project.owner.id === me?.id;
  const canEdit = !project || isOwner || (project.max_permission ?? 0) >= 1;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [done, setDone] = useState(false);
  const [priority, setPriority] = useState(0);
  const [dueDate, setDueDate] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [percentDone, setPercentDone] = useState(0);
  const [isFavorite, setIsFavorite] = useState(false);
  const [comments, setComments] = useState<VikunjaComment[]>([]);
  const [newComment, setNewComment] = useState("");
  const [dirty, setDirty] = useState(false);
  const [newAssignee, setNewAssignee] = useState("");
  const [newLabelTitle, setNewLabelTitle] = useState("");
  const [assigneeError, setAssigneeError] = useState<string | null>(null);

  useEffect(() => {
    if (!task) return;
    setTitle(task.title);
    setDescription(task.description ?? "");
    setDone(task.done);
    setPriority(task.priority);
    setDueDate(toInputDate(task.due_date));
    setStartDate(toInputDate(task.start_date));
    setEndDate(toInputDate(task.end_date));
    setPercentDone(Math.round((task.percent_done ?? 0) * 100));
    setIsFavorite(task.is_favorite ?? false);
    setDirty(false);
  }, [task]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    fetch(`/api/vikunja/tasks/${id}/comments`)
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => {
        if (!cancelled) setComments(d as VikunjaComment[]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function handleSave() {
    try {
      await update(id, {
        title,
        description,
        done,
        priority,
        due_date: fromInputDate(dueDate),
        start_date: fromInputDate(startDate),
        end_date: fromInputDate(endDate),
        percent_done: percentDone / 100,
        is_favorite: isFavorite,
      });
      refetch();
      setDirty(false);
    } catch {
      // error from hook
    }
  }

  async function handleToggleFavorite() {
    const next = !isFavorite;
    setIsFavorite(next);
    try {
      await update(id, { is_favorite: next });
      refetch();
    } catch {
      setIsFavorite(!next);
    }
  }

  async function handleQuickDone() {
    const next = !done;
    setDone(next);
    try {
      await update(id, { done: next });
      refetch();
    } catch {
      setDone(!next);
    }
  }

  async function handleDelete() {
    if (!confirm("Delete this task? This cannot be undone.")) return;
    try {
      await removeTask(id);
      navigate(
        task?.platform_project_id ? `/vikunja/projects/${task.platform_project_id}` : "/vikunja",
      );
    } catch {
      // error from hook
    }
  }

  async function handleAddComment(e: React.FormEvent) {
    e.preventDefault();
    if (!newComment.trim()) return;
    try {
      const created = await postComment(newComment.trim());
      if (created) setComments((prev) => [...prev, created]);
      setNewComment("");
    } catch {
      // error from hook
    }
  }

  async function handleAddAssignee(e: React.FormEvent) {
    e.preventDefault();
    if (!newAssignee.trim()) return;
    setAssigneeError(null);
    try {
      await addAssignee(newAssignee.trim());
      setNewAssignee("");
      refetch();
    } catch (err) {
      setAssigneeError(err instanceof Error ? err.message : "Failed");
    }
  }

  async function handleRemoveAssignee(userId: number) {
    try {
      await removeAssignee(userId);
      refetch();
    } catch {
      // ignore
    }
  }

  async function handleAttachLabel(labelId: number) {
    try {
      await addLabel(labelId);
      refetch();
    } catch {
      // ignore
    }
  }

  async function handleDetachLabel(labelId: number) {
    try {
      await removeLabel(labelId);
      refetch();
    } catch {
      // ignore
    }
  }

  async function handleCreateAndAttachLabel(e: React.FormEvent) {
    e.preventDefault();
    if (!newLabelTitle.trim()) return;
    try {
      const created = await createNewLabel({ title: newLabelTitle.trim() });
      await addLabel(created.id);
      setNewLabelTitle("");
      refetchLabels();
      refetch();
    } catch {
      // ignore
    }
  }

  function markDirty() {
    setDirty(true);
  }

  if (loading)
    return (
      <PageLayout title="Task">
        <p className="text-sm text-app-text-muted">Loading...</p>
      </PageLayout>
    );
  if (error) {
    return (
      <PageLayout title="Task">
        <div className="rounded-md border border-app-danger bg-app-surface px-3 py-2 text-sm text-app-danger">
          {error}
        </div>
      </PageLayout>
    );
  }

  const taskLabelIds = new Set(task?.labels?.map((l) => l.id) ?? []);
  const availableLabels = allLabels.filter((l) => !taskLabelIds.has(l.id));

  const backHref = task?.platform_project_id
    ? `/vikunja/projects/${task.platform_project_id}`
    : "/vikunja";

  return (
    <PageLayout
      title={task?.title ?? "Task"}
      actions={
        canEdit ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleToggleFavorite()}
              className={`rounded-md border border-app-border px-3 py-1.5 text-sm ${isFavorite ? "bg-yellow-500/20 text-yellow-400" : "bg-app-surface text-app-text hover:bg-app-surface-hover"}`}
              title={isFavorite ? "Remove from favorites" : "Add to favorites"}
            >
              {isFavorite ? "★ Favorited" : "☆ Favorite"}
            </button>
            <button
              type="button"
              onClick={() => void handleQuickDone()}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${done ? "bg-green-900/40 text-green-400" : "bg-app-primary text-app-primary-on hover:opacity-90"}`}
            >
              {done ? "✓ Done" : "Mark Done"}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !dirty}
              className="rounded-md bg-app-primary px-3 py-1.5 text-sm font-medium text-app-primary-on hover:opacity-90 disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save"}
            </button>
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={deleting}
              className="rounded-md border border-app-danger px-3 py-1.5 text-sm text-app-danger hover:bg-app-danger/10 disabled:opacity-60"
            >
              {deleting ? "Deleting..." : "Delete"}
            </button>
          </div>
        ) : (
          <span className="rounded-md border border-app-border bg-app-surface px-3 py-1.5 text-xs text-app-text-muted">
            Read-only
          </span>
        )
      }
    >
      <Link
        to={backHref}
        className="mb-4 inline-flex items-center gap-1 text-xs text-app-text-muted hover:text-app-text"
      >
        ← Back to project
      </Link>
      {!canEdit && (
        <div className="mb-4 rounded-md border border-app-border bg-app-surface px-3 py-2 text-sm text-app-text-muted">
          You have read-only access to this task. Editing is disabled.
        </div>
      )}
      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="flex-1 space-y-4">
          <input
            type="text"
            value={title}
            disabled={!canEdit}
            onChange={(e) => {
              setTitle(e.target.value);
              markDirty();
            }}
            className="w-full rounded-md border border-app-border bg-app-surface px-3 py-2 text-lg font-medium text-app-text focus:outline-none focus:ring-2 focus:ring-app-primary disabled:opacity-70"
          />

          <textarea
            value={description}
            disabled={!canEdit}
            onChange={(e) => {
              setDescription(e.target.value);
              markDirty();
            }}
            placeholder="Add a description..."
            rows={8}
            className="w-full rounded-md border border-app-border bg-app-surface px-3 py-2 text-sm text-app-text placeholder:text-app-text-muted focus:outline-none focus:ring-2 focus:ring-app-primary disabled:opacity-70"
          />

          <div className="space-y-3">
            <h3 className="text-sm font-medium text-app-text">Comments</h3>
            {comments.length === 0 && (
              <p className="text-xs text-app-text-muted">No comments yet.</p>
            )}
            <div className="space-y-2">
              {comments.map((c) => (
                <div
                  key={c.id}
                  className="rounded-md border border-app-border bg-app-surface px-3 py-2"
                >
                  <div className="flex items-center gap-2 text-xs text-app-text-muted">
                    <span className="font-medium text-app-text">
                      {c.author?.name || c.author?.username || "Unknown"}
                    </span>
                    <span>{new Date(c.created).toLocaleString()}</span>
                  </div>
                  <p className="mt-1 text-sm text-app-text">{c.comment}</p>
                </div>
              ))}
            </div>
            <form onSubmit={handleAddComment} className="flex gap-2">
              <input
                type="text"
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Add a comment..."
                className="flex-1 rounded-md border border-app-border bg-app-surface px-3 py-1.5 text-sm text-app-text placeholder:text-app-text-muted focus:outline-none focus:ring-2 focus:ring-app-primary"
              />
              <button
                type="submit"
                disabled={commenting || !newComment.trim()}
                className="rounded-md bg-app-primary px-3 py-1.5 text-sm font-medium text-app-primary-on hover:opacity-90 disabled:opacity-60"
              >
                {commenting ? "Posting..." : "Comment"}
              </button>
            </form>
          </div>
        </div>

        <div className="w-full shrink-0 space-y-4 lg:w-80">
          <div className="space-y-4 rounded-lg border border-app-border bg-app-surface p-4">
            <div>
              <label className="text-xs font-medium text-app-text-muted">Priority</label>
              <select
                value={priority}
                onChange={(e) => {
                  setPriority(Number(e.target.value));
                  markDirty();
                }}
                className="mt-1 w-full rounded-md border border-app-border bg-app-surface px-3 py-1.5 text-sm text-app-text"
              >
                {PRIORITIES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-medium text-app-text-muted">
                Progress ({percentDone}%)
              </label>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={percentDone}
                onChange={(e) => {
                  setPercentDone(Number(e.target.value));
                  markDirty();
                }}
                className="mt-1 w-full"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-app-text-muted">Due Date</label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => {
                  setDueDate(e.target.value);
                  markDirty();
                }}
                className="mt-1 w-full rounded-md border border-app-border bg-app-surface px-3 py-1.5 text-sm text-app-text"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-app-text-muted">Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  markDirty();
                }}
                className="mt-1 w-full rounded-md border border-app-border bg-app-surface px-3 py-1.5 text-sm text-app-text"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-app-text-muted">End Date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  markDirty();
                }}
                className="mt-1 w-full rounded-md border border-app-border bg-app-surface px-3 py-1.5 text-sm text-app-text"
              />
            </div>
          </div>

          <div className="space-y-2 rounded-lg border border-app-border bg-app-surface p-4">
            <label className="text-xs font-medium text-app-text-muted">Assignees</label>
            <div className="flex flex-wrap gap-1">
              {(task?.assignees ?? []).map((a) => (
                <span
                  key={a.id}
                  className="inline-flex items-center gap-1 rounded-full bg-app-primary/20 px-2 py-0.5 text-xs text-app-text"
                >
                  {a.name || a.username}
                  <button
                    type="button"
                    onClick={() => void handleRemoveAssignee(a.id)}
                    className="text-app-danger hover:opacity-80"
                  >
                    ×
                  </button>
                </span>
              ))}
              {(task?.assignees ?? []).length === 0 && (
                <span className="text-xs text-app-text-muted">No assignees yet.</span>
              )}
            </div>
            <form onSubmit={handleAddAssignee} className="flex gap-2">
              <UserAutocomplete
                value={newAssignee}
                onChange={setNewAssignee}
                placeholder="Type a username..."
                className="w-full rounded-md border border-app-border bg-app-surface px-2 py-1 text-xs text-app-text placeholder:text-app-text-muted"
              />
              <button
                type="submit"
                disabled={!newAssignee.trim()}
                className="rounded-md bg-app-primary px-2 py-1 text-xs text-app-primary-on hover:opacity-90 disabled:opacity-60"
              >
                Add
              </button>
            </form>
            {assigneeError && <p className="text-xs text-app-danger">{assigneeError}</p>}
          </div>

          <div className="space-y-2 rounded-lg border border-app-border bg-app-surface p-4">
            <label className="text-xs font-medium text-app-text-muted">Labels</label>
            <div className="flex flex-wrap gap-1">
              {(task?.labels ?? []).map((l) => (
                <span
                  key={l.id}
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs text-white"
                  style={{ backgroundColor: l.hex_color || "#6b7280" }}
                >
                  {l.title}
                  <button
                    type="button"
                    onClick={() => void handleDetachLabel(l.id)}
                    className="hover:opacity-80"
                  >
                    ×
                  </button>
                </span>
              ))}
              {(task?.labels ?? []).length === 0 && (
                <span className="text-xs text-app-text-muted">No labels.</span>
              )}
            </div>
            {availableLabels.length > 0 && (
              <select
                onChange={(e) => {
                  const lid = Number(e.target.value);
                  if (lid) void handleAttachLabel(lid);
                  e.target.value = "";
                }}
                defaultValue=""
                className="w-full rounded-md border border-app-border bg-app-surface px-2 py-1 text-xs text-app-text"
              >
                <option value="">Attach existing label...</option>
                {availableLabels.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.title}
                  </option>
                ))}
              </select>
            )}
            <form onSubmit={handleCreateAndAttachLabel} className="flex gap-2">
              <input
                type="text"
                value={newLabelTitle}
                onChange={(e) => setNewLabelTitle(e.target.value)}
                placeholder="New label name"
                className="flex-1 rounded-md border border-app-border bg-app-surface px-2 py-1 text-xs text-app-text"
              />
              <button
                type="submit"
                disabled={!newLabelTitle.trim()}
                className="rounded-md bg-app-primary px-2 py-1 text-xs text-app-primary-on hover:opacity-90 disabled:opacity-60"
              >
                Create
              </button>
            </form>
          </div>
        </div>
      </div>
    </PageLayout>
  );
}
