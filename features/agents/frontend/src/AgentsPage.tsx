import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageLayout, AgentAvatar } from "@internal/shared-ui";
import { useApi } from "@internal/api-client/react";
import type { Agent } from "@internal/shared-types";

const UNCATEGORIZED = "Uncategorized";
const CATEGORY_ORDER = [
  "Plan & Coordinate",
  "Catalog & Quality",
  "Ship & Operate",
  "Knowledge & Docs",
  "Access & Governance",
];

function handleOf(name: string): string {
  return (
    "@" +
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
  );
}

function orderCategories(cats: string[]): string[] {
  return [...cats].sort((a, b) => {
    const ra = a === UNCATEGORIZED ? Infinity : CATEGORY_ORDER.indexOf(a);
    const rb = b === UNCATEGORIZED ? Infinity : CATEGORY_ORDER.indexOf(b);
    const sa = ra === -1 ? CATEGORY_ORDER.length : ra;
    const sb = rb === -1 ? CATEGORY_ORDER.length : rb;
    return sa - sb || a.localeCompare(b);
  });
}

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

  const groups = useMemo(() => {
    if (!items) return [];
    const byCategory = new Map<string, Agent[]>();
    for (const agent of items) {
      const key = agent.category ?? UNCATEGORIZED;
      const list = byCategory.get(key) ?? [];
      list.push(agent);
      byCategory.set(key, list);
    }
    return orderCategories([...byCategory.keys()]).map((category) => ({
      category,
      agents: byCategory.get(category)!,
    }));
  }, [items]);

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

      {groups.map(({ category, agents }) => (
        <section key={category} className="mb-8">
          <h2 className="mb-3 flex items-baseline gap-2 text-sm font-semibold text-app-text">
            {category}
            <span className="text-xs font-normal text-app-text-muted">{agents.length}</span>
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {agents.map((agent) => (
              <AgentCard key={agent.id} agent={agent} />
            ))}
          </div>
        </section>
      ))}
    </PageLayout>
  );
}

function AgentCard({ agent }: { agent: Agent }) {
  return (
    <div className="relative rounded-lg border border-app-border bg-app-surface p-4 transition-colors hover:bg-app-surface-hover">
      <Link to={`/agents/${agent.id}`} className="block">
        <div className="flex items-start gap-3">
          <AgentAvatar name={agent.name} avatarUrl={agent.avatarUrl} size={48} />
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium text-app-text">{agent.name}</div>
            <div className="truncate font-mono text-xs text-app-text-muted">
              {handleOf(agent.name)}
            </div>
          </div>
        </div>
        {agent.description && (
          <p className="mt-2 line-clamp-2 text-xs text-app-text-muted">{agent.description}</p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
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
      </Link>
    </div>
  );
}
