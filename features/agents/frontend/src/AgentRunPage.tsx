// Detail view for a single agent run: the step-by-step trace, reasoning, final response, and run metadata.
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { PageLayout } from "@internal/shared-ui";
import { useApi } from "@internal/api-client/react";
import type { AgentRun } from "@internal/shared-types";

interface RunToolCall {
  name: string;
  input: unknown;
  output: unknown;
  durationMs: number;
  isError: boolean;
}

interface RunStep {
  index: number;
  text: string | null;
  reasoning: string | null;
  toolCalls: RunToolCall[];
  tokensInput: number;
  tokensOutput: number;
}

interface RunOutput {
  steps?: RunStep[];
  toolCalls?: RunToolCall[];
  finalText?: string | null;
}

function readOutput(output: unknown): RunOutput {
  if (output && typeof output === "object" && !Array.isArray(output)) {
    const o = output as Record<string, unknown>;
    const steps = Array.isArray(o.steps) ? (o.steps as RunStep[]) : undefined;
    const toolCalls = Array.isArray(o.toolCalls) ? (o.toolCalls as RunToolCall[]) : undefined;
    const finalText = typeof o.finalText === "string" ? o.finalText : null;
    return { steps, toolCalls, finalText };
  }
  return {};
}

// The entity a catalog run acted on, taken from the first tool call that carries an entityId.
function entityIdFromCalls(calls: RunToolCall[]): string | null {
  for (const c of calls) {
    if (c.input && typeof c.input === "object") {
      const id = (c.input as Record<string, unknown>).entityId;
      if (typeof id === "string" && id) return id;
    }
  }
  return null;
}

// The PR the run opened, taken from any tool call output that carries a prUrl.
function prUrlFromCalls(calls: RunToolCall[]): string | null {
  for (const c of calls) {
    if (c.output && typeof c.output === "object") {
      const url = (c.output as Record<string, unknown>).prUrl;
      if (typeof url === "string" && url) return url;
    }
  }
  return null;
}

function formatInput(input: unknown): string {
  if (typeof input === "string") return input;
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

export function AgentRunPage() {
  const api = useApi();
  const { id = "", runId = "" } = useParams<{ id: string; runId: string }>();
  const [run, setRun] = useState<AgentRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);

  const load = useCallback(() => {
    return api.agents
      .getRun(id, runId)
      .then((r) => setRun(r))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load run"));
  }, [api, id, runId]);

  useEffect(() => {
    void load();
  }, [load]);

  // While the run is in flight, poll so tool calls and steps appear without a manual refresh.
  useEffect(() => {
    if (run?.status !== "running") return;
    const timer = setInterval(() => void load(), 2000);
    return () => clearInterval(timer);
  }, [run?.status, load]);

  const stop = useCallback(() => {
    setStopping(true);
    void api.agents
      .cancelRun(id, runId)
      .then(() => load())
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to cancel run"))
      .finally(() => setStopping(false));
  }, [api, id, runId, load]);

  if (error && !run) {
    return (
      <PageLayout title="Run">
        <p className="text-sm text-app-danger">{error}</p>
        <Link to={`/agents/${id}`} className="text-sm text-app-primary hover:underline">
          Back to agent
        </Link>
      </PageLayout>
    );
  }
  if (!run) {
    return (
      <PageLayout title="Run">
        <p className="text-sm text-app-text-muted">Loading…</p>
      </PageLayout>
    );
  }

  const { steps, toolCalls, finalText } = readOutput(run.output);
  const calls = toolCalls ?? [];
  const entityId = entityIdFromCalls(calls);
  const prUrl = prUrlFromCalls(calls);
  const total = (run.tokensInput ?? 0) + (run.tokensOutput ?? 0);
  const durationMs = run.finishedAt
    ? new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()
    : null;
  const isRunning = run.status === "running";

  return (
    <PageLayout
      title={`${run.agent?.name ?? "Agent"} run`}
      description={`${run.trigger ?? "run"} · ${run.status}`}
      actions={
        <div className="flex items-center gap-2">
          {isRunning && (
            <button
              type="button"
              onClick={stop}
              disabled={stopping}
              className="rounded-md border border-app-danger px-3 py-1.5 text-sm text-app-danger hover:bg-app-surface-hover disabled:opacity-50"
            >
              {stopping ? "Stopping…" : "Stop"}
            </button>
          )}
          <Link
            to={`/agents/${id}`}
            className="rounded-md border border-app-border bg-app-surface px-3 py-1.5 text-sm text-app-text hover:bg-app-surface-hover"
          >
            Back to agent
          </Link>
        </div>
      }
    >
      <section className="mb-6 grid gap-3 rounded-lg border border-app-border bg-app-surface p-4 text-sm sm:grid-cols-3">
        <Field label="Status" value={run.status} />
        <Field label="Trigger" value={run.trigger ?? "-"} />
        <Field label="Writes" value={run.containsWrites ? "Modified data" : "Read-only"} />
        <Field label="Started" value={new Date(run.startedAt).toLocaleString()} />
        <Field
          label="Finished"
          value={run.finishedAt ? new Date(run.finishedAt).toLocaleString() : "-"}
        />
        <Field
          label="Duration"
          value={durationMs != null ? `${(durationMs / 1000).toFixed(1)}s` : "running…"}
        />
        <Field
          label="Tokens"
          value={`${total} (in ${run.tokensInput ?? 0} / out ${run.tokensOutput ?? 0})`}
        />
        <Field
          label="Cost"
          value={run.costUsd != null ? `$${Number(run.costUsd).toFixed(4)}` : "-"}
        />
        <CopyableField label="Run ID" value={run.id} />
      </section>

      {(run.task || run.conversation || entityId || prUrl) && (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-semibold text-app-text">Context</h2>
          <div className="flex flex-wrap gap-3 text-sm">
            {run.task && (
              <Link to={`/tasks/${run.task.id}`} className="text-app-primary hover:underline">
                Task: {run.task.title}
              </Link>
            )}
            {run.conversation && (
              <Link
                to={`/chat/${run.conversation.id}`}
                className="text-app-primary hover:underline"
              >
                Conversation: {run.conversation.title}
              </Link>
            )}
            {entityId && (
              <Link to={`/catalog/${entityId}`} className="text-app-primary hover:underline">
                Catalog entity
              </Link>
            )}
            {prUrl && (
              <a
                href={prUrl}
                target="_blank"
                rel="noreferrer"
                className="text-app-primary hover:underline"
              >
                Pull request ↗
              </a>
            )}
          </div>
        </section>
      )}

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold text-app-text">Input</h2>
        <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded-md border border-app-border bg-app-bg-sunken p-3 text-xs text-app-text">
          {formatInput(run.input)}
        </pre>
      </section>

      {run.error && (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-semibold text-app-text">Error</h2>
          <pre className="overflow-auto whitespace-pre-wrap rounded-md border border-app-danger bg-app-bg-sunken p-3 text-xs text-app-danger">
            {run.error}
          </pre>
        </section>
      )}

      {steps && steps.length > 0 ? (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-semibold text-app-text">
            Timeline
            <span className="ml-1 text-xs font-normal text-app-text-muted">
              {steps.length} step{steps.length === 1 ? "" : "s"}
            </span>
          </h2>
          <div className="grid gap-3">
            {steps.map((s) => (
              <StepCard key={s.index} step={s} />
            ))}
          </div>
        </section>
      ) : (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-semibold text-app-text">
            Tool calls
            <span className="ml-1 text-xs font-normal text-app-text-muted">{calls.length}</span>
          </h2>
          {calls.length === 0 ? (
            <p className="text-sm text-app-text-muted">No tool calls.</p>
          ) : (
            <div className="grid gap-1">
              {calls.map((c, i) => (
                <ToolCallRow key={i} call={c} />
              ))}
            </div>
          )}
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold text-app-text">Final response</h2>
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-app-border bg-app-bg-sunken p-3 text-xs text-app-text">
          {finalText ?? "(no text)"}
        </pre>
      </section>
    </PageLayout>
  );
}

function StepCard({ step }: { step: RunStep }) {
  const stepTokens = step.tokensInput + step.tokensOutput;
  return (
    <div className="rounded-lg border border-app-border bg-app-surface p-3">
      <div className="mb-2 flex items-center justify-between text-xs text-app-text-muted">
        <span className="font-semibold text-app-text">Step {step.index + 1}</span>
        <span>
          {stepTokens} tokens (in {step.tokensInput} / out {step.tokensOutput})
        </span>
      </div>
      {step.reasoning && <Reasoning text={step.reasoning} />}
      {step.text && (
        <pre className="mb-2 max-h-60 overflow-auto whitespace-pre-wrap rounded-md border border-app-border bg-app-bg-sunken p-2 text-xs text-app-text">
          {step.text}
        </pre>
      )}
      {step.toolCalls.length > 0 && (
        <div className="grid gap-1">
          {step.toolCalls.map((c, i) => (
            <ToolCallRow key={i} call={c} />
          ))}
        </div>
      )}
    </div>
  );
}

function Reasoning({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-xs text-app-text-muted hover:underline"
      >
        {open ? "▾" : "▸"} Reasoning
      </button>
      {open && (
        <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap rounded-md border border-dashed border-app-border bg-app-bg-sunken p-2 text-[11px] italic text-app-text-muted">
          {text}
        </pre>
      )}
    </div>
  );
}

function ToolCallRow({ call }: { call: RunToolCall }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border border-app-border bg-app-surface">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs"
      >
        <span aria-hidden>{call.isError ? "❌" : "🔧"}</span>
        <span className="font-mono text-app-text">{call.name}</span>
        <span className="ml-auto text-app-text-muted">{call.durationMs}ms</span>
      </button>
      {open && (
        <div className="border-t border-app-border px-2 py-2 text-[11px]">
          <div className="font-mono text-app-text-muted">input:</div>
          <pre className="mb-2 overflow-x-auto whitespace-pre-wrap break-all text-app-text">
            {JSON.stringify(call.input, null, 2)}
          </pre>
          <div className="font-mono text-app-text-muted">{call.isError ? "error:" : "output:"}</div>
          <pre className="overflow-x-auto whitespace-pre-wrap break-all text-app-text">
            {JSON.stringify(call.output, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-app-text-muted">{label}</div>
      <div className="text-app-text">{value}</div>
    </div>
  );
}

function CopyableField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-app-text-muted">{label}</div>
      <button
        type="button"
        onClick={copy}
        className="font-mono text-xs text-app-text hover:underline"
        title="Copy"
      >
        {copied ? "Copied" : value}
      </button>
    </div>
  );
}
