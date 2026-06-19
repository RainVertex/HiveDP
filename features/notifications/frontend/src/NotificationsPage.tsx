import { useCallback, useEffect, useState } from "react";
import { PageLayout } from "@internal/shared-ui";
import { useNotificationsApi } from "./client";
import { useTranslation } from "@internal/i18n";
import type { NotificationDto } from "@feature/notifications-shared";
import type { TFunction } from "i18next";

function summary(n: NotificationDto, t: TFunction): string {
  switch (n.kind) {
    case "team.member.added":
      return t("summary.memberAdded");
    case "team.member.removed":
      return t("summary.memberRemoved");
    case "projects.task.assigned": {
      const p = n.payload as Record<string, unknown>;
      const title = typeof p.taskTitle === "string" ? p.taskTitle : t("fallback.aTask");
      const project = typeof p.projectTitle === "string" ? p.projectTitle : null;
      return project
        ? t("summary.taskAssignedInProject", { title, project })
        : t("summary.taskAssigned", { title });
    }
    case "projects.task.commentAdded": {
      const p = n.payload as Record<string, unknown>;
      const title = typeof p.taskTitle === "string" ? p.taskTitle : t("fallback.aTask");
      const author = typeof p.authorName === "string" ? p.authorName : t("fallback.someone");
      return t("summary.taskCommented", { author, title });
    }
    default:
      return n.kind;
  }
}

export function NotificationsPage() {
  const api = useNotificationsApi();
  const { t } = useTranslation("notifications");
  const [items, setItems] = useState<NotificationDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.list({ unread: unreadOnly, limit: 200 });
      setItems(res.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("page.errorLoad"));
    }
  }, [api, unreadOnly, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function markRead(id: string) {
    await api.markRead(id);
    await load();
  }

  async function markAll() {
    await api.markAllRead();
    await load();
  }

  return (
    <PageLayout
      title={t("page.title")}
      description={t("page.description")}
      actions={
        <button
          type="button"
          onClick={() => void markAll()}
          className="rounded-md border border-app-border px-3 py-1 text-sm text-app-text hover:bg-app-surface-hover"
        >
          {t("page.markAllRead")}
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
        {t("page.unreadOnly")}
      </label>
      {!items && <p className="text-sm text-app-text-muted">{t("page.loading")}</p>}
      {items && items.length === 0 && (
        <p className="text-sm text-app-text-muted">{t("page.empty")}</p>
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
                      {summary(n, t)}
                      {isUnread && <span className="sr-only"> {t("page.unreadSrOnly")}</span>}
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
                    {t("page.markRead")}
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
