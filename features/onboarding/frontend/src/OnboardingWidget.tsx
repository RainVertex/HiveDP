// Onboarding checklist widget: lists tasks with complete/dismiss actions.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useApi } from "@internal/api-client/react";
import type { UserTaskDto } from "@internal/shared-types";

interface TaskPresenter {
  title: string;
  description: string;
  ctaHref: string;
  ctaLabel: string;
  autoCompletes: boolean;
}

const PRESENTERS: Record<string, TaskPresenter> = {
  "request-tool-access": {
    title: "Request access to your tools",
    description:
      "Get the credentials you need for GitHub, observability, and the rest of your toolchain.",
    ctaHref: "/integrations",
    ctaLabel: "Browse integrations",
    autoCompletes: false,
  },
  "team-join": {
    title: "Join or create a team",
    description: "Find your team or request a new one if it doesn't exist yet.",
    ctaHref: "/teams",
    ctaLabel: "Find a team",
    autoCompletes: true,
  },
};

function presenterFor(kind: string): TaskPresenter {
  return (
    PRESENTERS[kind] ?? {
      title: kind,
      description: "",
      ctaHref: "/",
      ctaLabel: "Open",
      autoCompletes: false,
    }
  );
}

export function OnboardingWidget() {
  const api = useApi();
  const [tasks, setTasks] = useState<UserTaskDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.onboarding
      .listTasks()
      .then((res) => {
        if (!cancelled) setTasks(res.items);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message ?? "Failed to load onboarding.");
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  const markComplete = async (id: string) => {
    const previous = tasks;
    setTasks((prev) =>
      prev
        ? prev.map((t) =>
            t.id === id ? { ...t, status: "completed", completedAt: new Date().toISOString() } : t,
          )
        : prev,
    );
    try {
      await api.onboarding.completeTask(id);
    } catch (err) {
      console.error("Failed to complete task", err);
      if (previous) setTasks(previous);
    }
  };

  const dismiss = async (id: string) => {
    const previous = tasks;
    setTasks((prev) =>
      prev ? prev.map((t) => (t.id === id ? { ...t, status: "dismissed" } : t)) : prev,
    );
    try {
      await api.onboarding.dismissTask(id);
    } catch (err) {
      console.error("Failed to dismiss task", err);
      if (previous) setTasks(previous);
    }
  };

  if (error) return <Empty message={error} />;
  if (tasks === null) return <Loading />;

  const visible = tasks.filter((t) => t.status !== "dismissed");
  if (visible.length === 0) {
    return <Empty message="You're all caught up." />;
  }
  const remaining = visible.filter((t) => t.status === "pending").length;

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 text-xs text-app-text-muted">
        {remaining} of {visible.length} remaining
      </div>
      <ul className="flex flex-col divide-y divide-app-border">
        {visible.map((task) => {
          const p = presenterFor(task.kind);
          const done = task.status === "completed";
          return (
            <li key={task.id} className="flex items-start gap-3 py-3">
              <span
                aria-hidden
                className={`mt-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                  done
                    ? "border-emerald-500 bg-emerald-500 text-white"
                    : "border-app-border bg-app-surface"
                }`}
              >
                {done && <Check />}
              </span>
              <div className="min-w-0 flex-1">
                <div
                  className={`text-sm font-medium ${
                    done ? "text-app-text-muted line-through" : "text-app-text"
                  }`}
                >
                  {p.title}
                </div>
                {p.description && (
                  <div className="mt-0.5 text-xs text-app-text-muted">{p.description}</div>
                )}
                {!done && (
                  <div className="mt-2 flex items-center gap-3">
                    <Link
                      to={p.ctaHref}
                      className="text-sm font-medium text-app-primary hover:text-app-primary-hover"
                    >
                      {p.ctaLabel} →
                    </Link>
                    {!p.autoCompletes && (
                      <button
                        type="button"
                        onClick={() => markComplete(task.id)}
                        className="text-xs text-app-text-muted hover:text-app-text"
                      >
                        Mark done
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => dismiss(task.id)}
                      className="text-xs text-app-text-muted hover:text-app-text"
                    >
                      Dismiss
                    </button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Loading() {
  return (
    <div className="flex flex-col gap-2">
      <div className="h-4 rounded bg-app-surface-hover animate-pulse" />
      <div className="h-4 w-3/4 rounded bg-app-surface-hover animate-pulse" />
      <div className="h-4 w-1/2 rounded bg-app-surface-hover animate-pulse" />
    </div>
  );
}

function Empty({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center py-6 text-center text-sm text-app-text-muted">
      {message}
    </div>
  );
}

function Check() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
      <path
        d="M2 5l2 2 4-4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
