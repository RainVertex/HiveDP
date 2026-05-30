import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PageLayout } from "@internal/shared-ui";
import { useApi } from "@internal/api-client/react";
import type { Agent } from "@internal/shared-types";

export function AgentsPage() {
  const api = useApi();
  const [items, setItems] = useState<Agent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.agents
      .list()
      .then((res) => setItems(res.items))
      .catch((err) => setError(err.message ?? "Failed to load agents"));
  }, [api]);

  return (
    <PageLayout
      title="Agents"
      description="Task-specific AI agents. Each agent has its own model, tools, and approval mode."
    >
      <div className="mb-4 flex items-center justify-end gap-2">
        <Link
          to="/agents/new"
          className="rounded-md bg-app-primary px-3 py-1.5 text-sm font-medium text-app-primary-on hover:opacity-90"
        >
          + New agent
        </Link>
      </div>

      {error && <p className="text-sm text-app-danger">{error}</p>}
      {!error && items === null && <p className="text-sm text-app-text-muted">Loading…</p>}
      {items && items.length === 0 && (
        <div className="rounded-md border border-app-border bg-app-surface p-6 text-center">
          <p className="mb-3 text-sm text-app-text-muted">No agents yet.</p>
          <Link
            to="/agents/new"
            className="inline-block rounded-md bg-app-primary px-3 py-1.5 text-sm font-medium text-app-primary-on hover:opacity-90"
          >
            Create your first agent
          </Link>
        </div>
      )}
      {items && items.length > 0 && (
        <ul className="divide-y divide-app-border rounded-lg border border-app-border bg-app-surface">
          {items.map((agent) => (
            <li key={agent.id} className="p-4">
              <Link
                to={`/agents/${agent.id}`}
                className="block hover:bg-app-surface-hover rounded -m-1 p-1"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-app-text">{agent.name}</div>
                    {agent.description && (
                      <div className="mt-0.5 truncate text-xs text-app-text-muted">
                        {agent.description}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-1.5 text-xs">
                    <span className="rounded-full border border-app-border bg-app-surface px-2 py-0.5 text-app-text-muted">
                      {agent.kind}
                    </span>
                    {agent.llmModel && (
                      <span className="rounded-full border border-app-border bg-app-surface px-2 py-0.5 text-app-text-muted">
                        {agent.llmModel.displayName}
                      </span>
                    )}
                    <span
                      className={`rounded-full px-2 py-0.5 ${
                        agent.status === "running"
                          ? "bg-app-warning/10 text-app-warning"
                          : agent.status === "failed"
                            ? "bg-app-danger/10 text-app-danger"
                            : "bg-app-surface text-app-text-muted"
                      }`}
                    >
                      {agent.status}
                    </span>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PageLayout>
  );
}
