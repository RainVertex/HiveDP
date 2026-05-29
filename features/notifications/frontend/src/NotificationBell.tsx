import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useApi } from "@internal/api-client/react";
import type { NotificationDto } from "@internal/shared-types";

const POLL_INTERVAL_MS = 30_000;

function notificationHref(n: NotificationDto): string | null {
  const p = n.payload as Record<string, unknown>;
  // Both request kinds resolve into the unified Requests section now:
  //   *.submitted → /approvals/team (the approver inbox)
  //   everything else → /requests/team (the requester's status)
  // The legacy /teams/maintainer-{requests,approvals} URLs still resolve via
  // the redirect routes, so older notification rows keep working.
  if (n.kind === "team.request.submitted" || n.kind === "team.maintainer_request.submitted") {
    return "/approvals/team";
  }
  if (n.kind.startsWith("team.request.") || n.kind.startsWith("team.maintainer_request.")) {
    return "/requests/team";
  }
  if (typeof p.teamSlug === "string") return `/teams/${p.teamSlug}`;
  if (n.kind.startsWith("vikunja.")) {
    return typeof p.taskId === "string" ? `/vikunja/tasks/${p.taskId}` : "/vikunja";
  }
  return null;
}

function notificationSummary(n: NotificationDto): string {
  switch (n.kind) {
    case "team.request.submitted": {
      const name = (n.payload as Record<string, unknown>).requestedByDisplayName;
      return typeof name === "string"
        ? `${name} requested a new team.`
        : "New team request awaiting review.";
    }
    case "team.request.approved":
      return "Your team request was approved.";
    case "team.request.rejected": {
      const reason = (n.payload as Record<string, unknown>).reason;
      return `Your team request was rejected${typeof reason === "string" ? `: ${reason}` : ""}.`;
    }
    case "team.request.changes_proposed":
      return "An admin proposed changes to your team request.";
    case "team.request.counter_proposed": {
      const name = (n.payload as Record<string, unknown>).requestedByDisplayName;
      return typeof name === "string"
        ? `${name} counter-proposed changes.`
        : "Requester counter-proposed changes.";
    }
    case "team.request.auto_cancelled":
      return "Team request auto-cancelled after 3 negotiation rounds.";
    case "team.request.expired":
      return "Your team request expired.";
    case "team.maintainer_request.submitted": {
      const name = (n.payload as Record<string, unknown>).requestedByDisplayName;
      const teamName = (n.payload as Record<string, unknown>).teamName;
      return typeof name === "string" && typeof teamName === "string"
        ? `${name} requested to become a maintainer of ${teamName}.`
        : "New maintainer request awaiting review.";
    }
    case "team.maintainer_request.approved":
      return "Your maintainer request was approved.";
    case "team.maintainer_request.rejected": {
      const reason = (n.payload as Record<string, unknown>).reason;
      return `Your maintainer request was rejected${typeof reason === "string" ? `: ${reason}` : ""}.`;
    }
    case "team.member.added":
      return "You were added to a team.";
    case "team.member.removed":
      return "You were removed from a team.";
    case "vikunja.task.assigned": {
      const p = n.payload as Record<string, unknown>;
      const title = typeof p.taskTitle === "string" ? p.taskTitle : "a task";
      return `Assigned to: ${title}`;
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

export function NotificationBell() {
  const api = useApi();
  const [unread, setUnread] = useState<number>(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationDto[] | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const refreshCount = useCallback(async () => {
    try {
      const res = await api.notifications.unreadCount();
      setUnread(res.count);
    } catch {
      // network blip — leave previous count
    }
  }, [api]);

  useEffect(() => {
    void refreshCount();
    const t = setInterval(refreshCount, POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [refreshCount]);

  // Click-outside to close.
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  async function handleOpen() {
    setOpen((prev) => !prev);
    if (!open) {
      try {
        const res = await api.notifications.list({ limit: 20 });
        setItems(res.items);
      } catch {
        setItems([]);
      }
    }
  }

  async function markAllRead() {
    try {
      await api.notifications.markAllRead();
      setUnread(0);
      setItems(
        (prev) =>
          prev?.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })) ?? null,
      );
    } catch {
      // ignore
    }
  }

  async function handleNotificationClick(n: NotificationDto) {
    setOpen(false);
    if (n.readAt) return;
    // Optimistic update so the badge drops immediately on click.
    const nowIso = new Date().toISOString();
    setItems(
      (prev) => prev?.map((it) => (it.id === n.id ? { ...it, readAt: nowIso } : it)) ?? null,
    );
    setUnread((prev) => Math.max(0, prev - 1));
    try {
      await api.notifications.markRead(n.id);
    } catch {
      // Revert and resync if the server rejected our optimistic update.
      void refreshCount();
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => void handleOpen()}
        aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ""}`}
        className="relative rounded-full border border-app-border bg-app-surface px-3 py-1 text-sm text-app-text hover:bg-app-surface-hover"
      >
        Inbox
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 rounded-full bg-app-primary px-1.5 py-0.5 text-[10px] font-medium leading-none text-app-primary-on">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 rounded-lg border border-app-border bg-app-surface shadow-lg">
          <div className="flex items-center justify-between border-b border-app-border px-3 py-2 text-xs">
            <span className="font-semibold text-app-text">Notifications</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void markAllRead()}
                className="text-app-text-muted hover:text-app-text"
              >
                Mark all read
              </button>
              <Link to="/notifications" className="text-app-primary">
                View all
              </Link>
            </div>
          </div>
          {items === null && <div className="px-3 py-4 text-xs text-app-text-muted">Loading…</div>}
          {items && items.length === 0 && (
            <div className="px-3 py-4 text-xs text-app-text-muted">You're all caught up.</div>
          )}
          {items && items.length > 0 && (
            <ul className="max-h-80 overflow-y-auto">
              {items.map((n) => {
                const href = notificationHref(n);
                const isUnread = !n.readAt;
                const content = (
                  <div className="flex items-start gap-2 px-3 py-2">
                    <span
                      aria-hidden="true"
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                        isUnread ? "bg-app-primary" : "bg-transparent"
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <div
                        className={`text-xs ${
                          isUnread ? "font-medium text-app-text" : "text-app-text-muted"
                        }`}
                      >
                        {notificationSummary(n)}
                        {isUnread && <span className="sr-only"> (unread)</span>}
                      </div>
                      <div className="text-[10px] text-app-text-muted">
                        {new Date(n.createdAt).toLocaleString()}
                      </div>
                    </div>
                  </div>
                );
                return (
                  <li
                    key={n.id}
                    className={`border-t border-app-border first:border-t-0 ${
                      isUnread ? "bg-app-primary-soft" : ""
                    }`}
                  >
                    {href ? (
                      <Link
                        to={href}
                        onClick={() => void handleNotificationClick(n)}
                        className="block hover:bg-app-surface-hover"
                      >
                        {content}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleNotificationClick(n)}
                        className="block w-full text-left hover:bg-app-surface-hover"
                      >
                        {content}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
