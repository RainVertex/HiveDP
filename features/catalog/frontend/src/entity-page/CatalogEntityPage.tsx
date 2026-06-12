import { NavLink, Outlet, useParams } from "react-router-dom";
import { PageLayout } from "@internal/shared-ui";
import { useTranslation } from "@internal/i18n";
import { KindBadge, LifecycleBadge, OwnerCell } from "../catalog-table/cells";
import { StarCell } from "../catalog-table/StarCell";
import { EntityOverviewProvider } from "./EntityOverviewContext";
import { LockedEntityView } from "./LockedEntityView";
import { useEntityOverview } from "./useEntityOverview";

export function CatalogEntityPage() {
  const { id = "" } = useParams<{ id: string }>();
  const { data, error, loading, reload } = useEntityOverview(id);
  const { t } = useTranslation("catalog");

  const TABS = [
    { to: "", label: t("tabs.overview"), end: true },
    { to: "related", label: t("tabs.related") },
    { to: "scorecards", label: t("tabs.scorecards") },
    { to: "docs", label: t("tabs.docs") },
    { to: "apis", label: t("tabs.apis") },
    { to: "runs", label: t("tabs.runs") },
    { to: "audit", label: t("tabs.audit") },
  ];

  if (loading && !data) {
    return (
      <PageLayout title={t("entity.loading")}>
        <p className="text-sm text-app-text-muted">{t("entity.loadingBody")}</p>
      </PageLayout>
    );
  }
  if (error || !data) {
    return (
      <PageLayout title={t("entity.errorTitle")}>
        <div className="rounded-md border border-app-danger bg-app-surface px-3 py-2 text-sm text-app-danger">
          {error ?? t("entity.notFound")}
        </div>
      </PageLayout>
    );
  }

  if (data.accessible === false) {
    return <LockedEntityView entity={data.entity} />;
  }

  const { entity } = data;
  const description = entity.description ?? "—";

  return (
    <main className="p-6">
      <header className="mb-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[11px] font-medium uppercase tracking-wide text-app-text-muted">
              {t("entity.componentLabel")} — {t(`kind.${entity.kind}`)}
            </div>
            <div className="flex items-center gap-3 mt-1">
              <h1 className="text-2xl font-semibold text-app-text truncate">{entity.name}</h1>
              <StarCell entityId={entity.id} entityName={entity.name} />
              <KindBadge value={entity.kind} />
              <LifecycleBadge value={entity.lifecycle} />
            </div>
            {entity.description && (
              <p className="mt-1 text-sm text-app-text-muted truncate" title={description}>
                {entity.description}
              </p>
            )}
          </div>
          <div className="text-right text-xs text-app-text-muted">
            <div className="uppercase tracking-wide">
              {entity.ownerTeams.length > 1 ? t("entity.owners") : t("entity.owner")}
            </div>
            <div className="mt-1 flex justify-end">
              <OwnerCell teams={entity.ownerTeams} />
            </div>
          </div>
        </div>

        <nav className="mt-4 flex gap-1 border-b border-app-border" aria-label={t("tabs.overview")}>
          {TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                `px-3 py-2 text-sm border-b-2 -mb-px transition-colors ${
                  isActive
                    ? "border-app-primary text-app-text"
                    : "border-transparent text-app-text-muted hover:text-app-text"
                }`
              }
            >
              {tab.label}
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
