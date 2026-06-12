// Read-only header shown when the viewer is not a member of the entity's GitHub org.
import { useTranslation } from "@internal/i18n";
import type { CatalogEntityLocked } from "@internal/shared-types";
import { KindBadge, LifecycleBadge } from "../catalog-table/cells";

export function LockedEntityView({ entity }: { entity: CatalogEntityLocked }) {
  const { t } = useTranslation("catalog");
  return (
    <main className="p-6">
      <header className="mb-4">
        <div className="text-[11px] font-medium uppercase tracking-wide text-app-text-muted">
          {t("entity.componentLabel")} — {t(`kind.${entity.kind}`)}
        </div>
        <div className="flex items-center gap-3 mt-1">
          <h1 className="text-2xl font-semibold text-app-text truncate">{entity.name}</h1>
          <KindBadge value={entity.kind} />
          <LifecycleBadge value={entity.lifecycle} />
          <span className="text-app-text-muted">{entity.accountLogin}</span>
        </div>
        {entity.description && (
          <p className="mt-1 text-sm text-app-text-muted truncate" title={entity.description}>
            {entity.description}
          </p>
        )}
      </header>
      <div className="rounded-md border border-app-border bg-app-surface px-4 py-6 text-center">
        <div className="text-2xl" aria-hidden>
          🔒
        </div>
        <h2 className="mt-2 text-sm font-medium text-app-text">{t("entity.lockedTitle")}</h2>
        <p className="mt-1 text-sm text-app-text-muted">
          {t("entity.lockedMessage", { org: entity.accountLogin })}
        </p>
      </div>
    </main>
  );
}
