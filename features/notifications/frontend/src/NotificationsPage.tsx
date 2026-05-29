import { useCallback, useEffect, useState } from "react";
import { PageLayout } from "@internal/shared-ui";
import { useApi } from "@internal/api-client/react";
import type { NotificationDto } from "@internal/shared-types";

function summary(n: NotificationDto): string {
  switch (n.kind) {
    case "team.request.submitted": {
      const name = (n.payload as Record<string, unknown>).requestedByDisplayName;
      return typeof name === "string"
        ? `New team request from ${name}`
        : "New team request awaiting review";
    }
    case "team.request.approved":
      return "Team request approved";
    case "team.request.rejected":
      return "Team request rejected";
    case "team.request.changes_proposed": {
      const name = (n.payload as Record<string, unknown>).proposedByDisplayName;
      return typeof name === "string"
        ? `Admin (${name}) proposed changes to your team request`
        : "Admin proposed changes to your team request";
    }
    case "team.request.counter_proposed": {
      const name = (n.payload as Record<string, unknown>).requestedByDisplayName;
      return typeof name === "string"
        ? `${name} counter-proposed changes`
        : "Requester counter-proposed changes";
    }
    case "team.request.auto_cancelled":
      return "Team request auto-cancelled (3-round limit)";
    case "team.request.expired":
      return "Team request expired";
    case "team.maintainer_request.submitted": {
      const name = (n.payload as Record<string, unknown>).requestedByDisplayName;
      const teamName = (n.payload as Record<string, unknown>).teamName;
      return typeof name === "string" && typeof teamName === "string"
        ? `${name} requested to become a maintainer of ${teamName}`
        : "New maintainer request awaiting review";
    }
    case "team.maintainer_request.approved":
      return "Maintainer request approved";
    case "team.maintainer_request.rejected":
      return "Maintainer request rejected";
    case "team.member.added":
      return "Added to team";
    case "team.member.removed":
      return "Removed from team";
    case "vikunja.task.assigned": {
      const p = n.payload as Record<string, unknown>;
      const title = typeof p.taskTitle === "string" ? p.taskTitle : "a task";
      const project = typeof p.projectTitle === "string" ? ` in ${p.projectTitle}` : "";
      return `Assigned to: ${title}${project}`;
    }
    case "vikunja.comment.posted": {
      const p = n.payload as Record<string, unknown>;
      const title = typeof p.taskTitle === "string" ? p.taskTitle : "a task";
      const author = typeof p.authorName === "string" ? p.authorName : "Someone";
      return `${author} commented on: ${title}`;
    }
    default:
      return n.kind;
  }
}

export function NotificationsPage() {
  const api = useApi();
  const [items, setItems] = useState<NotificationDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.notifications.list({ unread: unreadOnly, limit: 200 });
      setItems(res.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    }
  }, [api, unreadOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  async function markRead(id: string) {
    await api.notifications.markRead(id);
    await load();
  }

  async function markAll() {
    await api.notifications.markAllRead();
    await load();
  }

  return (
    <PageLayout
      title="Notifications"
      description="In-app inbox."
      actions={
        <button
          type="button"
          onClick={() => void markAll()}
          className="rounded-md border border-app-border px-3 py-1 text-sm text-app-text hover:bg-app-surface-hover"
        >
          Mark all read
        </button>
      }
    >
      {error && <p className="mb-3 text-sm text-app-danger">{error}</p>}
      <label className="mb-3 inline-flex items-center gap-2 text-xs text-app-text-muted">
        <input
          type="checkbox"
          checked={unreadOnly}
          onChange={(e) => setUnreadOnly(e.target.checked)}
        />
        Unread only
      </label>
      {!items && <p className="text-sm text-app-text-muted">Loading…</p>}
      {items && items.length === 0 && (
        <p className="text-sm text-app-text-muted">No notifications.</p>
      )}
      {items && items.length > 0 && (
        <ul className="divide-y divide-app-border rounded-lg border border-app-border bg-app-surface">
          {items.map((n) => {
            const isUnread = !n.readAt;
            return (
              <li
                key={n.id}
                className={`flex items-start justify-between gap-3 px-4 py-3 text-sm ${
                  isUnread ? "bg-app-primary-soft" : ""
                }`}
              >
                <div className="flex min-w-0 items-start gap-2">
                  <span
                    aria-hidden="true"
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                      isUnread ? "bg-app-primary" : "bg-transparent"
                    }`}
                  />
                  <div className="min-w-0">
                    <div className={isUnread ? "font-medium text-app-text" : "text-app-text-muted"}>
                      {summary(n)}
                      {isUnread && <span className="sr-only"> (unread)</span>}
                    </div>
                    <div className="text-xs text-app-text-muted">
                      {new Date(n.createdAt).toLocaleString()}
                    </div>
                    <pre className="mt-1 max-h-32 overflow-auto rounded bg-app-surface-hover p-2 text-[10px] text-app-text-muted">
                      {JSON.stringify(n.payload, null, 2)}
                    </pre>
                  </div>
                </div>
                {isUnread && (
                  <button
                    type="button"
                    onClick={() => void markRead(n.id)}
                    className="shrink-0 text-xs text-app-primary"
                  >
                    Mark read
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </PageLayout>
  );
}
