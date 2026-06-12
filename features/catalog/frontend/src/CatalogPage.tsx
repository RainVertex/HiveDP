import { useCallback, useEffect, useState } from "react";
import { PageLayout } from "@internal/shared-ui";
import { useApi } from "@internal/api-client/react";
import { useTranslation } from "@internal/i18n";
import { CatalogTable } from "./catalog-table/CatalogTable";
import { Toolbar } from "./catalog-table/Toolbar";
import type { CatalogRow } from "./catalog-table/columns";
import { useCatalogView } from "./catalog-table/useCatalogView";
import { RegisterEntityDialog } from "./RegisterEntityDialog";

export function CatalogPage() {
  const api = useApi();
  const view = useCatalogView();
  const { t } = useTranslation("catalog");
  const [rows, setRows] = useState<CatalogRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filteredCount, setFilteredCount] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);

  const load = useCallback(() => {
    let cancelled = false;
    api.catalog
      .list()
      .then((res) => {
        if (cancelled) return;
        setRows(res.items);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : t("page.errorLoad"));
      });
    return () => {
      cancelled = true;
    };
  }, [api, t]);

  useEffect(() => load(), [load]);

  return (
    <PageLayout
      title={t("page.title")}
      description={t("page.description")}
      actions={
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          className="rounded-md bg-app-primary px-3 py-1.5 text-sm font-medium text-app-primary-on hover:opacity-90"
        >
          {t("page.registerButton")}
        </button>
      }
    >
      {error && (
        <div className="mb-4 rounded-md border border-app-danger bg-app-surface px-3 py-2 text-sm text-app-danger">
          {error}
        </div>
      )}

      {rows === null ? (
        <p className="text-sm text-app-text-muted">{t("page.loading")}</p>
      ) : (
        <>
          <Toolbar view={view} total={rows.length} filtered={filteredCount} />
          {rows.length === 0 ? (
            <p className="text-sm text-app-text-muted">{t("page.emptyEntities")}</p>
          ) : (
            <CatalogTable data={rows} view={view} onFilteredCountChange={setFilteredCount} />
          )}
          {rows.length > 0 && filteredCount === 0 && (
            <p className="mt-3 text-sm text-app-text-muted">
              {t("page.noMatch")}{" "}
              <button
                type="button"
                onClick={view.reset}
                className="text-app-primary-on hover:underline"
              >
                {t("page.resetFilters")}
              </button>
            </p>
          )}
        </>
      )}

      <RegisterEntityDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreated={load}
      />
    </PageLayout>
  );
}
