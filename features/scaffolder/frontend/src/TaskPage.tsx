// Scaffolder task detail page: loads persisted state then live-streams step and log events.
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { PageLayout } from "@internal/shared-ui";
import { useApi } from "@internal/api-client/react";
import type { ScaffolderTask, ScaffolderTaskStatus } from "@internal/shared-types";

type StepEvent =
  | { kind: "task.started"; taskId: string }
  | { kind: "step.started"; taskId: string; stepId: string; action: string }
  | {
      kind: "step.finished";
      taskId: string;
      stepId: string;
      status: "succeeded" | "failed" | "cancelled";
      output?: unknown;
      error?: string;
    }
  | {
      kind: "log";
      taskId: string;
      stepId?: string;
      level: "info" | "warn" | "error";
      body: string;
    }
  | {
      kind: "task.finished";
      taskId: string;
      status: ScaffolderTaskStatus;
      output?: unknown;
      error?: string;
    };

interface StepView {
  stepId: string;
  action: string;
  status: "pending" | "running" | "succeeded" | "failed" | "cancelled";
}

interface LogView {
  stepId: string | null;
  level: "info" | "warn" | "error";
  body: string;
}

export function TaskPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const api = useApi();
  const [task, setTask] = useState<ScaffolderTask | null>(null);
  const [steps, setSteps] = useState<StepView[]>([]);
  const [logs, setLogs] = useState<LogView[]>([]);
  const [terminalStatus, setTerminalStatus] = useState<ScaffolderTaskStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!taskId) return;
    api.scaffolder
      .getTask(taskId)
      .then((t) => {
        setTask(t);
        setSteps(
          (t.steps ?? []).map((s) => ({
            stepId: s.stepId,
            action: s.action,
            status: s.status as StepView["status"],
          })),
        );
        // Logs come back newest-first, reverse for display.
        setLogs(
          [...(t.logs ?? [])].reverse().map((l) => ({
            stepId: l.stepId,
            level: l.level,
            body: l.body,
          })),
        );
        if (t.finishedAt) setTerminalStatus(t.status);
      })
      .catch((err) => setError(err.message ?? "Failed to load task"));
  }, [api, taskId]);

  // Live stream only opens while the task is still running, skipped once finished.
  useEffect(() => {
    if (!taskId || terminalStatus) return;
    if (task && task.finishedAt) return;
    const url = api.scaffolder.taskEventsUrl(taskId);
    const source = new EventSource(url, { withCredentials: true });
    source.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data) as StepEvent;
        applyEvent(event);
      } catch {
        // malformed event, ignore
      }
    };
    source.onerror = () => {
      source.close();
    };
    return () => source.close();

    function applyEvent(event: StepEvent) {
      if (event.kind === "step.started") {
        setSteps((prev) =>
          upsertStep(prev, { stepId: event.stepId, action: event.action, status: "running" }),
        );
      } else if (event.kind === "step.finished") {
        setSteps((prev) =>
          prev.map((s) => (s.stepId === event.stepId ? { ...s, status: event.status } : s)),
        );
      } else if (event.kind === "log") {
        setLogs((prev) => [
          ...prev,
          { stepId: event.stepId ?? null, level: event.level, body: event.body },
        ]);
      } else if (event.kind === "task.finished") {
        setTerminalStatus(event.status);
        if (event.error) setError(event.error);
      }
    }
  }, [api, taskId, terminalStatus, task]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs.length]);

  if (error && !task)
    return (
      <PageLayout title="Task">
        <p className="text-sm text-red-600">{error}</p>
      </PageLayout>
    );

  return (
    <PageLayout
      title={task ? `Task ${task.id.slice(0, 8)}…` : "Task"}
      description={
        terminalStatus
          ? `Final status: ${terminalStatus}`
          : task?.status
            ? `Running… (${task.status})`
            : "Connecting…"
      }
    >
      {error && terminalStatus && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]">
        <ol className="space-y-1">
          {steps.map((s) => (
            <li key={s.stepId} className="flex items-center gap-2 text-xs">
              <StatusDot status={s.status} />
              <span className="font-mono text-app-text">{s.action}</span>
              <span className="text-app-text-muted">· {s.stepId}</span>
            </li>
          ))}
          {steps.length === 0 && <li className="text-xs text-app-text-muted">No steps.</li>}
        </ol>

        <div className="rounded-md border border-app-border bg-app-surface-hover p-3">
          <div className="max-h-[60vh] overflow-y-auto font-mono text-[11px] leading-tight">
            {logs.map((l, i) => (
              <div key={i} className={logColor(l.level)}>
                {l.stepId && <span className="text-app-text-muted">[{l.stepId}] </span>}
                {l.body}
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        </div>
      </div>
    </PageLayout>
  );
}

function upsertStep(prev: StepView[], next: StepView): StepView[] {
  const idx = prev.findIndex((s) => s.stepId === next.stepId);
  if (idx === -1) return [...prev, next];
  const copy = [...prev];
  copy[idx] = next;
  return copy;
}

function StatusDot({ status }: { status: StepView["status"] }) {
  const color =
    status === "succeeded"
      ? "bg-emerald-500"
      : status === "running"
        ? "bg-sky-500 animate-pulse"
        : status === "failed"
          ? "bg-rose-500"
          : status === "cancelled"
            ? "bg-amber-500"
            : "bg-app-border";
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}

function logColor(level: LogView["level"]): string {
  return level === "error"
    ? "text-rose-700"
    : level === "warn"
      ? "text-amber-700"
      : "text-app-text";
}
