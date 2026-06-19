// Header notification bell: polls unread count and renders a dropdown inbox.
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useNotificationsApi } from "./client";
import { useTranslation } from "@internal/i18n";
import type { NotificationDto } from "@feature/notifications-shared";
import type { TFunction } from "i18next";

const POLL_INTERVAL_MS = 30_000;

function notificationHref(n: NotificationDto): string | null {
  const p = n.payload as Record<string, unknown>;
  if (typeof p.teamSlug === "string") return `/teams/${p.teamSlug}`;
  if (n.kind.startsWith("projects.")) {
    return typeof p.taskId === "string" ? `/tasks/${p.taskId}` : "/projects";
  }
  return null;
}

function notificationSummary(n: NotificationDto, t: TFunction): string {
  switch (n.kind) {
    case "team.member.added":
      return t("bellSummary.memberAdded");
    case "team.member.removed":
      return t("bellSummary.memberRemoved");
    case "projects.task.assigned": {
      const p = n.payload as Record<string, unknown>;
      const title = typeof p.taskTitle === "string" ? p.taskTitle : t("fallback.aTask");
      return t("bellSummary.taskAssigned", { title });
    }
    case "projects.task.commentAdded": {
      const p = n.payload as Record<string, unknown>;
      const title = typeof p.taskTitle === "string" ? p.taskTitle : t("fallback.aTask");
      const author = typeof p.authorName === "string" ? p.authorName : t("fallback.someone");
      return t("bellSummary.taskCommented", { author, title });
    }
    default:
      return n.kind;
  }
}

function BellIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

export function NotificationBell() {
  const api = useNotificationsApi();
  const { t } = useTranslation("notifications");
  const [unread, setUnread] = useState<number>(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationDto[] | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const refreshCount = useCallback(async () => {
    try {
      const res = await api.unreadCount();
      setUnread(res.count);
    } catch {
      // network blip, leave previous count
    }
  }, [api]);

  useEffect(() => {
    void refreshCount();
    const timer = setInterval(refreshCount, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [refreshCount]);

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
        const res = await api.list({ limit: 20 });
        setItems(res.items);
      } catch {
        setItems([]);
      }
    }
  }

  async function markAllRead() {
    try {
      await api.markAllRead();
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
      await api.markRead(n.id);
    } catch {
      // Revert and resync if the server rejected our optimistic update.
      void refreshCount();
    }
  }

  const ariaLabel =
    unread > 0 ? t("bell.ariaLabelWithCount", { count: unread }) : t("bell.ariaLabel");

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => void handleOpen()}
        aria-label={ariaLabel}
        aria-haspopup="true"
        aria-expanded={open}
        className={`relative inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-app-focus-ring ${
          open
            ? "border-app-border-strong bg-app-surface-hover text-app-text"
            : "border-app-border bg-app-surface text-app-text-muted hover:bg-app-surface-hover hover:text-app-text"
        }`}
      >
        <BellIcon className="h-4 w-4" />
        <span className="hidden sm:inline">{t("bell.buttonLabel")}</span>
        {unread > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-app-primary px-1 text-[10px] font-semibold leading-none text-app-primary-foreground ring-2 ring-app-surface">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-app-lg border border-app-border bg-app-surface shadow-app-lg">
          <div className="flex items-center justify-between gap-2 border-b border-app-border bg-app-bg-sunken px-3 py-2.5">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-app-text">{t("bell.heading")}</span>
              {unread > 0 && (
                <span className="rounded-full bg-app-primary-soft px-1.5 py-0.5 text-[10px] font-semibold leading-none text-app-primary-soft-foreground">
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 text-xs">
              <button
                type="button"
                onClick={() => void markAllRead()}
                disabled={unread === 0}
                className="font-medium text-app-text-muted transition-colors hover:text-app-text disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t("bell.markAllRead")}
              </button>
              <Link
                to="/notifications"
                onClick={() => setOpen(false)}
                className="font-medium text-app-primary transition-colors hover:text-app-primary-hover"
              >
                {t("bell.viewAll")}
              </Link>
            </div>
          </div>
          {items === null && (
            <div className="px-3 py-8 text-center text-xs text-app-text-muted">
              {t("bell.loading")}
            </div>
          )}
          {items && items.length === 0 && (
            <div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
              <BellIcon className="h-6 w-6 text-app-text-subtle" />
              <span className="text-xs text-app-text-muted">{t("bell.empty")}</span>
            </div>
          )}
          {items && items.length > 0 && (
            <ul className="max-h-80 divide-y divide-app-border overflow-y-auto">
              {items.map((n) => {
                const href = notificationHref(n);
                const isUnread = !n.readAt;
                const content = (
                  <div className="flex items-start gap-2.5 px-3 py-2.5">
                    <span
                      aria-hidden="true"
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                        isUnread ? "bg-app-primary" : "bg-transparent"
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <div
                        className={`text-[13px] leading-snug ${
                          isUnread ? "font-medium text-app-text" : "text-app-text-muted"
                        }`}
                      >
                        {notificationSummary(n, t)}
                        {isUnread && <span className="sr-only"> {t("bell.unreadSrOnly")}</span>}
                      </div>
                      <div className="mt-0.5 text-[11px] text-app-text-subtle">
                        {new Date(n.createdAt).toLocaleString()}
                      </div>
                    </div>
                  </div>
                );
                return (
                  <li key={n.id} className={isUnread ? "bg-app-primary-soft" : ""}>
                    {href ? (
                      <Link
                        to={href}
                        onClick={() => void handleNotificationClick(n)}
                        className="block transition-colors hover:bg-app-surface-hover"
                      >
                        {content}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleNotificationClick(n)}
                        className="block w-full text-left transition-colors hover:bg-app-surface-hover"
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
