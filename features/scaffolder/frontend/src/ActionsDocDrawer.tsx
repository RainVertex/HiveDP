import { useEffect, useMemo, useState } from "react";
import { useApi } from "@internal/api-client/react";
import { useTranslation } from "@internal/i18n";
import type { ScaffolderActionDoc } from "@internal/shared-types";

interface FieldRow {
  name: string;
  type: string;
  required: boolean;
  defaultValue: string | null;
  description: string | null;
}

function typeLabel(prop: Record<string, unknown>): string {
  if (Array.isArray(prop.enum)) return prop.enum.map((v) => JSON.stringify(v)).join(" | ");
  if (typeof prop.type === "string") return prop.type;
  if (Array.isArray(prop.type)) return prop.type.join(" | ");
  return "any";
}

function fieldsOf(schema: Record<string, unknown>): FieldRow[] {
  const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
  return Object.entries(properties).map(([name, prop]) => ({
    name,
    type: typeLabel(prop),
    required: required.has(name),
    defaultValue: prop.default === undefined ? null : JSON.stringify(prop.default),
    description: typeof prop.description === "string" ? prop.description : null,
  }));
}

export function ActionsDocDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const api = useApi();
  const { t } = useTranslation("scaffolder");
  const [actions, setActions] = useState<ScaffolderActionDoc[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open || actions !== null) return;
    api.scaffolder
      .listActions()
      .then((res) => setActions(res.items))
      .catch((err) => setError(err instanceof Error ? err.message : t("errors.loadActions")));
  }, [api, open, actions, t]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const filtered = useMemo(() => {
    if (!actions) return [];
    const needle = query.trim().toLowerCase();
    if (!needle) return actions;
    return actions.filter(
      (action) =>
        action.id.toLowerCase().includes(needle) ||
        action.description.toLowerCase().includes(needle),
    );
  }, [actions, query]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label={t("actionsDoc.close")}
        onClick={onClose}
        className="absolute inset-0 bg-black/30"
      />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-xl flex-col border-l border-app-border bg-app-bg shadow-xl">
        <div className="border-b border-app-border p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-app-text">{t("actionsDoc.title")}</h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-app-border px-2 py-1 text-xs text-app-text-muted hover:bg-app-surface-hover"
            >
              {t("actionsDoc.close")}
            </button>
          </div>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("actionsDoc.searchPlaceholder")}
            autoFocus
            className="w-full rounded-md border border-app-border bg-app-surface px-3 py-2 text-sm text-app-text focus:border-app-primary focus:outline-none"
          />
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!error && actions === null && (
            <p className="text-sm text-app-text-muted">{t("loading.generic")}</p>
          )}
          {actions !== null && filtered.length === 0 && (
            <p className="text-sm text-app-text-muted">{t("actionsDoc.noMatches")}</p>
          )}

          {filtered.map((action) => {
            const fields = fieldsOf(action.inputJsonSchema);
            return (
              <section
                key={action.id}
                className="rounded-md border border-app-border bg-app-surface p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-mono text-sm font-semibold text-app-text">{action.id}</h3>
                  {action.irreversible && (
                    <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] text-rose-700">
                      {t("plan.irreversibleWarning")}
                    </span>
                  )}
                  {action.capabilities.map((capability) => (
                    <span
                      key={capability}
                      className="rounded bg-app-surface-hover px-1.5 py-0.5 text-[10px] text-app-text-muted"
                    >
                      {capability}
                    </span>
                  ))}
                </div>
                <p className="mt-1 text-xs text-app-text-muted">{action.description}</p>

                {fields.length === 0 ? (
                  <p className="mt-2 text-xs text-app-text-muted">{t("actionsDoc.noInputs")}</p>
                ) : (
                  <table className="mt-2 w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-app-border text-app-text-muted">
                        <th className="py-1 pr-3 font-medium">{t("actionsDoc.fieldName")}</th>
                        <th className="py-1 pr-3 font-medium">{t("actionsDoc.fieldType")}</th>
                        <th className="py-1 pr-3 font-medium">{t("actionsDoc.fieldDefault")}</th>
                        <th className="py-1 font-medium">{t("actionsDoc.fieldDescription")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fields.map((field) => (
                        <tr key={field.name} className="border-b border-app-border/50 align-top">
                          <td className="py-1 pr-3 font-mono text-app-text">
                            {field.name}
                            {field.required && <span className="text-rose-600"> *</span>}
                          </td>
                          <td className="py-1 pr-3 font-mono text-app-text-muted">{field.type}</td>
                          <td className="py-1 pr-3 font-mono text-app-text-muted">
                            {field.defaultValue ?? ""}
                          </td>
                          <td className="py-1 text-app-text-muted">{field.description ?? ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-app-text-muted hover:text-app-text">
                    {t("actionsDoc.rawSchema")}
                  </summary>
                  <pre className="mt-2 overflow-x-auto rounded bg-app-surface-hover p-2 text-[10px] leading-4">
                    {JSON.stringify(action.inputJsonSchema, null, 2)}
                  </pre>
                </details>
              </section>
            );
          })}
        </div>
      </aside>
    </div>
  );
}
