import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PageLayout, ConfirmDialog } from "@internal/shared-ui";
import { useApi } from "@internal/api-client/react";
import type { Agent, AgentRun } from "@internal/shared-types";

type AgentDetail = Agent & {
  llmModel?: { slug: string; displayName: string; provider: { slug: string; displayName: string } };
  runs?: AgentRun[];
};

interface TestResult {
  status: "succeeded" | "failed";
  finalText: string | null;
  tokensInput: number;
  tokensOutput: number;
  costUsd: number | null;
  error: string | null;
}

export function AgentDetailPage() {
  const api = useApi();
  const navigate = useNavigate();
  const { id = "" } = useParams<{ id: string }>();
  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const load = useCallback(() => {
    api.agents
      .get(id)
      .then((a) => setAgent(a as AgentDetail))
      .catch((err) => setError(err.message ?? "Failed to load agent"));
  }, [api, id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onDelete() {
    setDeleting(true);
    try {
      await api.agents.delete(id);
      navigate("/agents");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  async function runTest() {
    if (!prompt.trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.agents.test(id, prompt.trim());
      setTestResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Test failed");
    } finally {
      setTesting(false);
    }
  }

  if (error && !agent) {
    return (
      <PageLayout title="Agent">
        <p className="text-sm text-app-danger">{error}</p>
      </PageLayout>
    );
  }
  if (!agent) {
    return (
      <PageLayout title="Agent">
        <p className="text-sm text-app-text-muted">Loading…</p>
      </PageLayout>
    );
  }

  const toolIds = Array.isArray(agent.toolIds) ? agent.toolIds : [];

  return (
    <PageLayout
      title={agent.name}
      description={agent.description ?? undefined}
      actions={
        <div className="flex items-center gap-2">
          <Link
            to={`/agents/${agent.id}/edit`}
            className="rounded-md border border-app-border bg-app-surface px-3 py-1.5 text-sm text-app-text hover:bg-app-surface-hover"
          >
            Edit
          </Link>
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="rounded-md border border-app-danger px-3 py-1.5 text-sm text-app-danger hover:bg-app-danger/10"
          >
            Delete
          </button>
        </div>
      }
    >
      {error && <p className="mb-4 text-sm text-app-danger">{error}</p>}

      <section className="mb-6 grid gap-3 rounded-lg border border-app-border bg-app-surface p-4 text-sm sm:grid-cols-2">
        <Field label="Kind" value={agent.kind} />
        <Field label="Status" value={agent.status} />
        <Field
          label="Model"
          value={
            agent.llmModel
              ? `${agent.llmModel.displayName} (${agent.llmModel.provider.displayName})`
              : agent.modelId
          }
        />
        <Field label="Approval mode" value={agent.approvalMode} />
        <Field label="Max tool calls" value={String(agent.maxToolCalls)} />
        <Field
          label="Token budget"
          value={agent.tokenBudget != null ? String(agent.tokenBudget) : "—"}
        />
      </section>

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold text-app-text">Tools</h2>
        {toolIds.length === 0 ? (
          <p className="text-sm text-app-text-muted">No tools.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {toolIds.map((t) => (
              <span
                key={t}
                className="rounded-full border border-app-border bg-app-surface px-2 py-0.5 font-mono text-xs text-app-text-muted"
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold text-app-text">System prompt</h2>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-app-border bg-app-bg-sunken p-3 text-xs text-app-text">
          {agent.instructions}
        </pre>
      </section>

      <section className="mb-6 rounded-lg border border-app-border bg-app-surface p-4">
        <h2 className="mb-2 text-sm font-semibold text-app-text">Try it out</h2>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          placeholder="Prompt to test this agent…"
          className="w-full resize-y rounded-md border border-app-border bg-app-bg-sunken px-2 py-1.5 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-app-primary"
        />
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            disabled={testing || !prompt.trim()}
            onClick={() => void runTest()}
            className="rounded-md bg-app-primary px-3 py-1.5 text-sm font-medium text-app-primary-on hover:opacity-90 disabled:opacity-50"
          >
            {testing ? "Running…" : "Run test"}
          </button>
        </div>
        {testResult && (
          <div className="mt-3 rounded-md border border-app-border bg-app-bg-sunken p-3 text-sm">
            <div className="mb-1 text-xs text-app-text-muted">
              {testResult.status} · in {testResult.tokensInput} / out {testResult.tokensOutput}{" "}
              tokens
              {testResult.costUsd != null ? ` · $${testResult.costUsd.toFixed(4)}` : ""}
            </div>
            {testResult.error ? (
              <p className="text-app-danger">{testResult.error}</p>
            ) : (
              <p className="whitespace-pre-wrap text-app-text">
                {testResult.finalText ?? "(no text)"}
              </p>
            )}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-app-text">Recent runs</h2>
        {!agent.runs || agent.runs.length === 0 ? (
          <p className="text-sm text-app-text-muted">No runs yet.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-app-text-muted">
                <th className="py-1">Started</th>
                <th className="py-1">Status</th>
                <th className="py-1">Tokens</th>
                <th className="py-1">Cost</th>
              </tr>
            </thead>
            <tbody>
              {agent.runs.map((r) => (
                <tr key={r.id} className="border-t border-app-border">
                  <td className="py-1.5 text-app-text-muted">
                    {new Date(r.startedAt).toLocaleString()}
                  </td>
                  <td className="py-1.5 text-app-text">{r.status}</td>
                  <td className="py-1.5 text-app-text-muted">
                    {(r.tokensInput ?? 0) + (r.tokensOutput ?? 0)}
                  </td>
                  <td className="py-1.5 text-app-text-muted">
                    {r.costUsd != null ? `$${Number(r.costUsd).toFixed(4)}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete agent"
        message={`Delete "${agent.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        busy={deleting}
        onConfirm={() => void onDelete()}
        onClose={() => setConfirmDelete(false)}
      />
    </PageLayout>
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
