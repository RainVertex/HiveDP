import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useApi } from "@internal/api-client/react";
import type { DeploymentRow, WorkflowRunRow } from "@internal/shared-types";
import { useEntityOverviewContext } from "../EntityOverviewContext";

// Compact Overview CI/CD widget: recent workflow runs plus latest deploy per environment.

const CONCLUSION_COLOR: Record<string, string> = {
  success: "text-app-success",
  failure: "text-app-danger",
  cancelled: "text-app-text-muted",
  skipped: "text-app-text-muted",
  timed_out: "text-app-danger",
  action_required: "text-app-warning",
  neutral: "text-app-text-muted",
};

const DEPLOY_STATE_COLOR: Record<string, string> = {
  success: "text-app-success",
  failure: "text-app-danger",
  error: "text-app-danger",
  pending: "text-app-text-muted",
  queued: "text-app-text-muted",
  in_progress: "text-app-warning",
  inactive: "text-app-text-muted",
};

function fmtAge(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`;
  return `${Math.floor(ms / 86_400_000)}d`;
}

function latestPerEnvironment(deploys: DeploymentRow[]): DeploymentRow[] {
  // Backend returns newest-first, so first occurrence per env name is the latest.
  const seen = new Set<string>();
  const out: DeploymentRow[] = [];
  for (const d of deploys) {
    if (seen.has(d.environment)) continue;
    seen.add(d.environment);
    out.push(d);
  }
  return out;
}

export function PipelinesWidget() {
  const { data } = useEntityOverviewContext();
  const api = useApi();
  const entityId = data.entity.id;
  const hasInstallation = data.entity.installationId != null;

  const [runs, setRuns] = useState<WorkflowRunRow[] | null>(null);
  const [deploys, setDeploys] = useState<DeploymentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hasInstallation) {
      setRuns([]);
      setDeploys([]);
      return;
    }
    let cancelled = false;
    Promise.all([
      api.catalog.pipelineRuns(entityId, { limit: 5 }),
      api.catalog.deployments(entityId, { limit: 20 }),
    ])
      .then(([r, d]) => {
        if (cancelled) return;
        setRuns(r.items);
        setDeploys(d.items);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed");
      });
    return () => {
      cancelled = true;
    };
  }, [api, entityId, hasInstallation]);

  if (!hasInstallation) {
    return (
      <p className="text-sm text-app-text-muted">
        Connect the GitHub App to see CI runs and deployments here.
      </p>
    );
  }
  if (error) return <p className="text-sm text-app-danger">{error}</p>;
  if (runs === null || deploys === null) {
    return <p className="text-sm text-app-text-muted">Loading…</p>;
  }
  if (runs.length === 0 && deploys.length === 0) {
    return (
      <p className="text-sm text-app-text-muted">No workflow runs or deployments synced yet.</p>
    );
  }

  const envs = latestPerEnvironment(deploys);

  return (
    <div className="space-y-3 text-sm">
      {envs.length > 0 && (
        <section>
          <div className="text-xs uppercase tracking-wide text-app-text-muted mb-1">
            Environments
          </div>
          <ul className="space-y-1">
            {envs.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2">
                <span className="rounded-full bg-app-surface-hover px-2 py-0.5 text-xs text-app-text">
                  {d.environment}
                </span>
                <span
                  className={`text-xs uppercase tracking-wide ${
                    DEPLOY_STATE_COLOR[d.state] ?? "text-app-text-muted"
                  }`}
                >
                  {d.state}
                </span>
                <span className="flex-1 truncate text-right font-mono text-xs text-app-text-muted">
                  {d.sha.slice(0, 7)}
                </span>
                <span className="text-xs text-app-text-muted whitespace-nowrap">
                  {fmtAge(d.deployedAt)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {runs.length > 0 && (
        <section>
          <div className="text-xs uppercase tracking-wide text-app-text-muted mb-1">
            Recent runs
          </div>
          <ul className="space-y-1">
            {runs.map((r) => (
              <li key={r.id} className="flex items-center gap-2">
                <RunBadge status={r.status} conclusion={r.conclusion} />
                <a
                  href={r.htmlUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex-1 truncate text-app-text hover:underline"
                  title={`${r.workflowName} #${r.runNumber}`}
                >
                  {r.workflowName}
                </a>
                <span className="text-xs text-app-text-muted truncate max-w-[6rem]">
                  {r.headBranch ?? "—"}
                </span>
                <span className="text-xs text-app-text-muted whitespace-nowrap">
                  {fmtAge(r.runUpdatedAt)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="pt-1">
        <Link
          to={`/catalog/${entityId}/runs`}
          className="text-xs text-app-primary-on hover:underline"
        >
          View all CI/CD activity →
        </Link>
      </div>
    </div>
  );
}

function RunBadge({
  status,
  conclusion,
}: {
  status: WorkflowRunRow["status"];
  conclusion: WorkflowRunRow["conclusion"];
}) {
  if (status !== "completed") {
    return (
      <span
        className="inline-block w-2 h-2 rounded-full bg-app-warning shrink-0"
        aria-label={status}
      />
    );
  }
  const color = conclusion
    ? (CONCLUSION_COLOR[conclusion] ?? "text-app-text-muted")
    : "text-app-text-muted";
  const dot =
    conclusion === "success"
      ? "bg-app-success"
      : conclusion === "failure" || conclusion === "timed_out"
        ? "bg-app-danger"
        : "bg-app-text-muted";
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${dot} shrink-0`}
      aria-label={conclusion ?? "completed"}
      title={`${color}`}
    />
  );
}
