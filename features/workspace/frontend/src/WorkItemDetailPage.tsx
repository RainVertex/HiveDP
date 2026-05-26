import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { PageLayout } from "@internal/shared-ui";
import { useApi } from "@internal/api-client/react";
import type { PlaneWorkItemDetailDto } from "@internal/shared-types";

export function WorkItemDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const api = useApi();
  const [item, setItem] = useState<PlaneWorkItemDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.workspace
      .getWorkItem(id)
      .then(setItem)
      .catch((err) => setError(err.message ?? "Failed to load work item"));
  }, [api, id]);

  return (
    <PageLayout
      title={
        item ? `${item.project?.identifier ?? ""}-${item.sequenceId} · ${item.name}` : "Work item"
      }
      actions={
        item?.project ? (
          <Link
            to={`/workspace/projects/${item.projectId}`}
            className="rounded-md border border-app-border px-3 py-1 text-sm text-app-text hover:bg-app-surface-hover"
          >
            Back to {item.project.name}
          </Link>
        ) : null
      }
    >
      {error && <p className="mb-3 text-sm text-app-danger">{error}</p>}
      {!error && !item && <p className="text-sm text-app-text-muted">Loading…</p>}
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
              {item.comments.length === 0 ? (
                <p className="text-sm text-app-text-muted">No comments.</p>
              ) : (
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
            </section>
          </div>

          <aside className="space-y-3 text-sm">
            <Detail label="State" value={item.state?.name ?? "—"} />
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

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-app-text-muted">{label}</div>
      <div className="text-app-text">{value}</div>
    </div>
  );
}
