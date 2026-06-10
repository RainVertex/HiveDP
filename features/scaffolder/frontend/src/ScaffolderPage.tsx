import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PageLayout } from "@internal/shared-ui";
import { useApi } from "@internal/api-client/react";
import { useTranslation } from "@internal/i18n";
import type { ScaffolderTemplateSummary } from "@internal/shared-types";

const TAG_FILTERS = ["recommended", "service", "github"] as const;

export function ScaffolderPage() {
  const api = useApi();
  const { t } = useTranslation("scaffolder");
  const [items, setItems] = useState<ScaffolderTemplateSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>("recommended");

  useEffect(() => {
    api.scaffolder
      .listTemplates()
      .then((res) => setItems(res.items))
      .catch((err) => setError(err.message ?? t("errors.loadTemplates")));
  }, [api, t]);

  const filtered =
    items && activeTag ? items.filter((item) => item.tags.includes(activeTag)) : items;

  return (
    <PageLayout title={t("page.createTitle")} description={t("page.createDescription")}>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!error && items === null && (
        <p className="text-sm text-app-text-muted">{t("loading.generic")}</p>
      )}

      {items !== null && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTag(null)}
            className={chipClass(activeTag === null)}
          >
            {t("filter.all")}
          </button>
          {TAG_FILTERS.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => setActiveTag(activeTag === tag ? null : tag)}
              className={chipClass(activeTag === tag)}
            >
              {t(`tags.${tag}`)}
            </button>
          ))}
        </div>
      )}

      {filtered && filtered.length === 0 && (
        <p className="text-sm text-app-text-muted">{t("empty.noTemplates")}</p>
      )}

      {filtered && filtered.length > 0 && (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((item) => (
            <li key={item.id}>
              <Link
                to={`/scaffolder/${item.id}`}
                className="block rounded-md border border-app-border bg-app-surface p-4 hover:border-app-primary"
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-sm font-semibold text-app-text">{item.name}</h2>
                  <span className="rounded-full bg-app-surface-hover px-2 py-0.5 text-[10px] text-app-text-muted">
                    v{item.version}
                  </span>
                </div>
                <p className="mt-1 text-xs text-app-text-muted">{item.description}</p>
                {item.tags.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1">
                    {item.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded bg-app-surface-hover px-1.5 py-0.5 text-[10px] text-app-text-muted"
                      >
                        {t(`tags.${tag}`, { defaultValue: tag })}
                      </span>
                    ))}
                  </div>
                )}
                <div className="mt-3 flex items-center gap-2 text-[10px] text-app-text-muted">
                  <span>
                    {item.audience.map((a) => t(`audience.${a}`, { defaultValue: a })).join(" + ")}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PageLayout>
  );
}

function chipClass(active: boolean): string {
  return `rounded-full border px-3 py-1 text-xs transition-colors ${
    active
      ? "border-app-primary bg-app-primary-soft text-app-primary-on"
      : "border-app-border text-app-text-muted hover:bg-app-surface-hover"
  }`;
}
