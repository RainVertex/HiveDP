import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { VikunjaTask } from "./api";

const PRIORITY_COLORS: Record<number, string> = {
  0: "bg-gray-600",
  1: "bg-blue-600",
  2: "bg-yellow-600",
  3: "bg-orange-600",
  4: "bg-red-600",
};

const PRIORITY_LABELS: Record<number, string> = {
  0: "None",
  1: "Low",
  2: "Med",
  3: "High",
  4: "Urg",
};

interface Props {
  userId: string;
}

export function MyTasksPanel({ userId }: Props) {
  const [tasks, setTasks] = useState<VikunjaTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/vikunja/users/${userId}/tasks?limit=10`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => {
        if (!cancelled) setTasks(d as VikunjaTask[]);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (loading) return <p className="text-xs text-app-text-muted">Loading tasks...</p>;
  if (error) return <p className="text-xs text-app-danger">{error}</p>;
  if (tasks.length === 0)
    return <p className="text-xs text-app-text-muted">No tasks assigned to you.</p>;

  return (
    <div className="space-y-1">
      {tasks.map((t) => (
        <Link
          key={t.id}
          to={`/vikunja/tasks/${t.id}`}
          className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-app-surface-hover transition-colors"
        >
          <span
            className={`inline-block h-2 w-2 shrink-0 rounded-full ${PRIORITY_COLORS[t.priority] ?? "bg-gray-600"}`}
            title={PRIORITY_LABELS[t.priority]}
          />
          <span className="flex-1 truncate text-sm text-app-text">{t.title}</span>
          {t.project_title && (
            <span className="shrink-0 text-[11px] text-app-text-muted">{t.project_title}</span>
          )}
          {t.due_date && (
            <span className="shrink-0 text-[11px] text-app-text-muted">
              {new Date(t.due_date).toLocaleDateString()}
            </span>
          )}
        </Link>
      ))}
      {tasks.length >= 10 && (
        <Link to="/vikunja" className="block px-2 py-1 text-xs text-app-primary-on hover:underline">
          View all
        </Link>
      )}
    </div>
  );
}
