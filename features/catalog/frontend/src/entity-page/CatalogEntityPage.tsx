import { NavLink, Outlet, useParams } from "react-router-dom";
import { PageLayout } from "@internal/shared-ui";
import { KindBadge, LifecycleBadge, OwnerCell } from "../catalog-table/cells";
import { StarCell } from "../catalog-table/StarCell";
import { EntityOverviewProvider } from "./EntityOverviewContext";
import { useEntityOverview } from "./useEntityOverview";
import { EntityDriftBadge } from "./EntityDriftBadge";

const TABS: Array<{ to: string; label: string; end?: boolean }> = [
  { to: "", label: "Overview", end: true },
  { to: "related", label: "Related Entities" },
  { to: "scorecards", label: "Scorecards" },
  { to: "docs", label: "Docs" },
  { to: "apis", label: "APIs" },
  { to: "runs", label: "CI/CD" },
  { to: "audit", label: "Audit Log" },
];

export function CatalogEntityPage() {
  const { id = "" } = useParams<{ id: string }>();
  const { data, error, loading, reload } = useEntityOverview(id);

  if (loading && !data) {
    return (
      <PageLayout title="Loading…">
        <p className="text-sm text-app-text-muted">Loading entity…</p>
      </PageLayout>
    );
  }
  if (error || !data) {
    return (
      <PageLayout title="Catalog entity">
        <div className="rounded-md border border-app-danger bg-app-surface px-3 py-2 text-sm text-app-danger">
          {error ?? "Entity not found"}
        </div>
      </PageLayout>
    );
  }

  const { entity } = data;
  const description = entity.description ?? "—";

  return (
    <main className="p-6">
      <header className="mb-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[11px] font-medium uppercase tracking-wide text-app-text-muted">
              Component — {entity.kind}
            </div>
            <div className="flex items-center gap-3 mt-1">
              <h1 className="text-2xl font-semibold text-app-text truncate">{entity.name}</h1>
              <StarCell entityId={entity.id} entityName={entity.name} />
              <KindBadge value={entity.kind} />
              <LifecycleBadge value={entity.lifecycle} />
              <EntityDriftBadge data={data} reload={reload} />
            </div>
            {entity.description && (
              <p className="mt-1 text-sm text-app-text-muted truncate" title={description}>
                {entity.description}
              </p>
            )}
          </div>
          <div className="text-right text-xs text-app-text-muted">
            <div className="uppercase tracking-wide">
              {entity.ownerTeams.length > 1 ? "Owners" : "Owner"}
            </div>
            <div className="mt-1 flex justify-end">
              <OwnerCell teams={entity.ownerTeams} />
            </div>
          </div>
        </div>

        <nav className="mt-4 flex gap-1 border-b border-app-border" aria-label="Entity tabs">
          {TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                `px-3 py-2 text-sm border-b-2 -mb-px transition-colors ${
                  isActive
                    ? "border-app-primary text-app-text"
                    : "border-transparent text-app-text-muted hover:text-app-text"
                }`
              }
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <EntityOverviewProvider value={{ data, reload }}>
        <Outlet context={{ data, reload }} />
      </EntityOverviewProvider>
    </main>
  );
}
