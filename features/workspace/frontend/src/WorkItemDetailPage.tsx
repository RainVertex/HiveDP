import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { PageLayout } from "@internal/shared-ui";
import { useApi } from "@internal/api-client/react";
import type {
  PlaneCommentDto,
  PlaneStateDto,
  PlaneWorkItemDetailDto,
} from "@internal/shared-types";

export function WorkItemDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const api = useApi();
  const [item, setItem] = useState<PlaneWorkItemDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [states, setStates] = useState<PlaneStateDto[]>([]);

  useEffect(() => {
    api.workspace
      .getWorkItem(id)
      .then((loaded) => {
        setItem(loaded);
        if (loaded.projectId) {
          api.workspace
            .getProject(loaded.projectId)
            .then((p) => setStates(p.states ?? []))
            .catch(() => {});
        }
      })
      .catch((err) => setError(err.message ?? "Failed to load work item"));
  }, [api, id]);

  const handleCommentAdded = useCallback((c: PlaneCommentDto) => {
    setItem((prev) => (prev ? { ...prev, comments: [...prev.comments, c] } : prev));
  }, []);

  const handleStateChanged = useCallback(
    (stateId: string) => {
      const next = states.find((s) => s.id === stateId);
      if (!next) return;
      setItem((prev) => (prev ? { ...prev, state: next } : prev));
      api.workspace.updateWorkItem(id, { stateId }).catch(() => {
        setItem((prev) => (prev ? { ...prev, state: item?.state ?? null } : prev));
      });
    },
    [api, id, item?.state, states],
  );

  return (
    <PageLayout
      title={
        item ? `${item.project?.identifier ?? ""}-${item.sequenceId} · ${item.name}` : "Work item"
      }
      actions={
        item ? (
          <div className="flex items-center gap-2">
            {item.planeUrl && (
              <Link
                to={`/workspace/plane?url=${encodeURIComponent(item.planeUrl)}`}
                className="rounded-md bg-app-primary px-3 py-1 text-sm font-medium text-app-primary-on"
              >
                Open in Plane
              </Link>
            )}
            {item.project && (
              <Link
                to={`/workspace/projects/${item.projectId}`}
                className="rounded-md border border-app-border px-3 py-1 text-sm text-app-text hover:bg-app-surface-hover"
              >
                Back to {item.project.name}
              </Link>
            )}
          </div>
        ) : null
      }
    >
      {error && <p className="mb-3 text-sm text-app-danger">{error}</p>}
      {!error && !item && <p className="text-sm text-app-text-muted">Loading...</p>}
      {item && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_240px]">
          <div className="space-y-4">
            <section>
              <h3 className="mb-1 text-xs uppercase tracking-wide text-app-text-muted">
                Description
              </h3>
              {item.description ? (
                <pre className="whitespace-pre-wrap rounded-md border border-app-border bg-app-surface p-3 text-sm text-app-text">
                  {item.description}
                </pre>
              ) : (
                <p className="text-sm text-app-text-muted">No description.</p>
              )}
            </section>

            {item.subItems.length > 0 && (
              <section>
                <h3 className="mb-2 text-xs uppercase tracking-wide text-app-text-muted">
                  Sub-issues ({item.subItems.length})
                </h3>
                <ul className="divide-y divide-app-border rounded-md border border-app-border">
                  {item.subItems.map((s) => (
                    <li key={s.id} className="p-2 text-sm">
                      <Link to={`/workspace/work-items/${s.id}`} className="hover:text-app-primary">
                        {s.name}
                      </Link>
                      <span className="ml-2 text-xs text-app-text-muted">
                        {s.state?.name ?? "—"}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section>
              <h3 className="mb-2 text-xs uppercase tracking-wide text-app-text-muted">
                Comments ({item.comments.length})
              </h3>
              {item.comments.length > 0 && (
                <ul className="space-y-2">
                  {item.comments.map((c) => (
                    <li
                      key={c.id}
                      className="rounded-md border border-app-border bg-app-surface p-3 text-sm"
                    >
                      <div className="flex items-baseline gap-2 text-xs text-app-text-muted">
                        {c.author ? (
                          <span className="font-medium text-app-text" title={c.author.email}>
                            {c.author.displayName}
                          </span>
                        ) : (
                          <span className="italic">Unknown author</span>
                        )}
                        <span>{new Date(c.externalCreatedAt).toLocaleString()}</span>
                      </div>
                      <pre className="mt-1 whitespace-pre-wrap text-app-text">{c.body}</pre>
                    </li>
                  ))}
                </ul>
              )}
              <CommentForm workItemId={id} onAdded={handleCommentAdded} />
            </section>
          </div>

          <aside className="space-y-3 text-sm">
            {states.length > 0 ? (
              <div>
                <div className="text-xs uppercase tracking-wide text-app-text-muted">State</div>
                <select
                  value={item.state?.id ?? ""}
                  onChange={(e) => handleStateChanged(e.target.value)}
                  className="mt-1 w-full rounded-md border border-app-border bg-app-surface px-2 py-1 text-sm text-app-text"
                >
                  {!item.state && <option value="">—</option>}
                  {states.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <Detail label="State" value={item.state?.name ?? "—"} />
            )}
            <Detail label="Priority" value={item.priority} />
            <Detail
              label="Start"
              value={item.startDate ? new Date(item.startDate).toLocaleDateString() : "—"}
            />
            <Detail
              label="Due"
              value={item.targetDate ? new Date(item.targetDate).toLocaleDateString() : "—"}
            />
            <Detail
              label="Completed"
              value={item.completedAt ? new Date(item.completedAt).toLocaleDateString() : "—"}
            />
            <Detail label="Assignees" value={`${item.assigneeIds.length} mapped`} />
          </aside>
        </div>
      )}
    </PageLayout>
  );
}

function CommentForm({
  workItemId,
  onAdded,
}: {
  workItemId: string;
  onAdded: (c: PlaneCommentDto) => void;
}) {
  const api = useApi();
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setErr(null);
    api.workspace
      .postComment(workItemId, { comment: trimmed })
      .then((c) => {
        setText("");
        onAdded(c);
      })
      .catch((e) => setErr(e.message ?? "Failed to post comment"))
      .finally(() => setSubmitting(false));
  };

  return (
    <div className="mt-3 space-y-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Write a comment..."
        rows={3}
        className="w-full rounded-md border border-app-border bg-app-surface p-2 text-sm text-app-text placeholder:text-app-text-muted"
      />
      {err && <p className="text-xs text-app-danger">{err}</p>}
      <button
        onClick={submit}
        disabled={!text.trim() || submitting}
        className="rounded-md bg-app-primary px-3 py-1 text-sm font-medium text-app-primary-on disabled:opacity-50"
      >
        {submitting ? "Posting..." : "Post comment"}
      </button>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-app-text-muted">{label}</div>
      <div className="text-app-text">{value}</div>
    </div>
  );
}
