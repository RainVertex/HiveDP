// Admin editor for per-entity observability config (PromQL / LogQL / dashboard / trace-id).

import { useEffect, useMemo, useState } from "react";
import { PageLayout } from "@internal/shared-ui";
import { useTranslation, Trans } from "@internal/i18n";
import type {
  CatalogEntityWithOwners,
  EntityObservabilityConfigDto,
  Integration,
} from "@internal/shared-types";
import { useApi } from "@internal/api-client/react";

interface RowDraft {
  integrationId: string;
  upQuery: string;
  latencyQuery: string;
  errorQuery: string;
  logsSelector: string;
  dashboardUid: string;
  traceIdRegex: string;
  status: "clean" | "dirty" | "saving" | "saved" | "error";
  error?: string;
}

function defaultRow(integrationId: string): RowDraft {
  return {
    integrationId,
    upQuery: "",
    latencyQuery: "",
    errorQuery: "",
    logsSelector: "",
    dashboardUid: "",
    traceIdRegex: "",
    status: "clean",
  };
}

function rowFromDto(dto: EntityObservabilityConfigDto): RowDraft {
  return {
    integrationId: dto.integrationId,
    upQuery: dto.upQuery ?? "",
    latencyQuery: dto.latencyQuery ?? "",
    errorQuery: dto.errorQuery ?? "",
    logsSelector: dto.logsSelector ?? "",
    dashboardUid: dto.dashboardUid ?? "",
    traceIdRegex: dto.traceIdRegex ?? "",
    status: "clean",
  };
}

function placeholders(entityName: string) {
  return {
    upQuery: `min(up{service="${entityName}"})`,
    latencyQuery: `histogram_quantile(0.95, sum by (le) (rate(http_server_duration_milliseconds_bucket{service="${entityName}"}[5m])))`,
    errorQuery: `sum(rate(http_server_request_count_total{service="${entityName}",http_status_code=~"5.."}[5m])) / sum(rate(http_server_request_count_total{service="${entityName}"}[5m]))`,
    logsSelector: `{service="${entityName}"}`,
  };
}

export function ObservabilityConfigPage() {
  const api = useApi();
  const { t } = useTranslation("observability");
  const [entities, setEntities] = useState<CatalogEntityWithOwners[]>([]);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [rows, setRows] = useState<Record<string, RowDraft>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const grafanaIntegrations = useMemo(
    () => integrations.filter((i) => i.kind === "grafana" && i.enabled),
    [integrations],
  );

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.catalog.list(), api.integrations.list()])
      .then(async ([entitiesRes, integrationsRes]) => {
        if (cancelled) return;
        const accessibleItems = entitiesRes.items.filter((i) => i.accessible);
        const grafana = integrationsRes.items.filter((i) => i.kind === "grafana" && i.enabled);
        const defaultIntegrationId = grafana[0]?.id ?? "";

        const initial: Record<string, RowDraft> = {};
        const configs = await Promise.all(
          accessibleItems.map((e) => api.observability.getEntityConfig(e.id).catch(() => null)),
        );
        if (cancelled) return;
        for (const [idx, entity] of accessibleItems.entries()) {
          const cfg = configs[idx];
          initial[entity.id] = cfg ? rowFromDto(cfg) : defaultRow(defaultIntegrationId);
        }

        setEntities(accessibleItems);
        setIntegrations(integrationsRes.items);
        setRows(initial);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : t("errors.failedLoad"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, t]);

  function updateRow(entityId: string, patch: Partial<RowDraft>) {
    setRows((prev) => ({
      ...prev,
      [entityId]: { ...prev[entityId], ...patch, status: "dirty" },
    }));
  }

  async function save(entityId: string) {
    const row = rows[entityId];
    if (!row || !row.integrationId) {
      updateRow(entityId, { status: "error", error: t("errors.pickIntegration") });
      return;
    }
    setRows((prev) => ({ ...prev, [entityId]: { ...prev[entityId], status: "saving" } }));
    try {
      const dto = await api.observability.putEntityConfig(entityId, {
        integrationId: row.integrationId,
        upQuery: row.upQuery || null,
        latencyQuery: row.latencyQuery || null,
        errorQuery: row.errorQuery || null,
        logsSelector: row.logsSelector || null,
        dashboardUid: row.dashboardUid || null,
        traceIdRegex: row.traceIdRegex || null,
      });
      setRows((prev) => ({ ...prev, [entityId]: { ...rowFromDto(dto), status: "saved" } }));
    } catch (err) {
      setRows((prev) => ({
        ...prev,
        [entityId]: {
          ...prev[entityId],
          status: "error",
          error: err instanceof Error ? err.message : t("errors.saveFailed"),
        },
      }));
    }
  }

  return (
    <PageLayout title={t("page.configTitle")} description={t("page.configDescription")}>
      {error && <p className="text-sm text-app-danger">{error}</p>}
      {loading && <p className="text-sm text-app-text-muted">{t("errors.loading")}</p>}
      {!loading && grafanaIntegrations.length === 0 && (
        <p className="text-sm text-app-text-muted">
          <Trans
            ns="observability"
            i18nKey="empty.noGrafanaIntegration"
            components={{
              link: (
                <a href="/integrations" className="underline-offset-2 hover:underline">
                  {t("empty.noGrafanaIntegrationLinkText")}
                </a>
              ),
            }}
          />
        </p>
      )}
      {!loading && entities.length > 0 && grafanaIntegrations.length > 0 && (
        <div className="space-y-3">
          {entities.map((entity) => {
            const row = rows[entity.id];
            if (!row) return null;
            const ph = placeholders(entity.name);
            return (
              <details key={entity.id} className="rounded border border-app-border bg-app-surface">
                <summary className="flex cursor-pointer items-center justify-between px-3 py-2 text-sm">
                  <span className="text-app-text">
                    {entity.name}
                    <span className="ml-2 text-xs text-app-text-muted">{entity.kind}</span>
                  </span>
                  <StatusBadge row={row} t={t} />
                </summary>
                <div className="space-y-2 border-t border-app-border p-3">
                  <SelectField
                    label={t("fields.grafanaIntegration")}
                    value={row.integrationId}
                    onChange={(v) => updateRow(entity.id, { integrationId: v })}
                    options={grafanaIntegrations.map((i) => ({ value: i.id, label: i.name }))}
                  />
                  <Field
                    label={t("fields.upQuery")}
                    value={row.upQuery}
                    onChange={(v) => updateRow(entity.id, { upQuery: v })}
                    placeholder={ph.upQuery}
                  />
                  <Field
                    label={t("fields.latencyQuery")}
                    value={row.latencyQuery}
                    onChange={(v) => updateRow(entity.id, { latencyQuery: v })}
                    placeholder={ph.latencyQuery}
                  />
                  <Field
                    label={t("fields.errorQuery")}
                    value={row.errorQuery}
                    onChange={(v) => updateRow(entity.id, { errorQuery: v })}
                    placeholder={ph.errorQuery}
                  />
                  <Field
                    label={t("fields.logsSelector")}
                    value={row.logsSelector}
                    onChange={(v) => updateRow(entity.id, { logsSelector: v })}
                    placeholder={ph.logsSelector}
                  />
                  <Field
                    label={t("fields.dashboardUidField")}
                    value={row.dashboardUid}
                    onChange={(v) => updateRow(entity.id, { dashboardUid: v })}
                    placeholder={t("fields.dashboardUidPlaceholder")}
                  />
                  <Field
                    label={t("fields.traceIdRegex")}
                    value={row.traceIdRegex}
                    onChange={(v) => updateRow(entity.id, { traceIdRegex: v })}
                    placeholder={t("fields.traceIdRegexPlaceholder")}
                  />
                  {row.error && <p className="text-xs text-app-danger">{row.error}</p>}
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => save(entity.id)}
                      disabled={row.status === "saving" || row.status === "clean"}
                      className="rounded bg-app-primary px-3 py-1.5 text-sm font-medium text-app-primary-on disabled:opacity-50"
                    >
                      {row.status === "saving" ? t("actions.saving") : t("actions.save")}
                    </button>
                  </div>
                </div>
              </details>
            );
          })}
        </div>
      )}
    </PageLayout>
  );
}

function StatusBadge({ row, t }: { row: RowDraft; t: (key: string) => string }) {
  if (row.status === "clean") return null;
  if (row.status === "saved")
    return <span className="text-xs text-app-success">{t("status.saved")}</span>;
  if (row.status === "error")
    return <span className="text-xs text-app-danger">{t("status.error")}</span>;
  if (row.status === "saving")
    return <span className="text-xs text-app-text-muted">{t("status.saving")}</span>;
  return <span className="text-xs text-app-warning">{t("status.unsaved")}</span>;
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block text-xs">
      <span className="text-app-text-muted">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 block w-full rounded border border-app-border bg-app-bg px-2 py-1.5 font-mono text-xs text-app-text"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="block text-xs">
      <span className="text-app-text-muted">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 block w-full rounded border border-app-border bg-app-bg px-2 py-1.5 text-sm text-app-text"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
