import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PageLayout } from "@internal/shared-ui";
import { useApi } from "@internal/api-client/react";
import type { ScaffolderTemplateSummary } from "@internal/shared-types";

const TAG_FILTERS = ["recommended", "feature", "monorepo", "service", "widget"] as const;

export function ScaffolderPage() {
  const api = useApi();
  const [items, setItems] = useState<ScaffolderTemplateSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>("recommended");

  useEffect(() => {
    api.scaffolder
      .listTemplates()
      .then((res) => setItems(res.items))
      .catch((err) => setError(err.message ?? "Failed to load templates"));
  }, [api]);

  const filtered = items && activeTag ? items.filter((t) => t.tags.includes(activeTag)) : items;

  return (
    <PageLayout
      title="Create"
      description="Scaffold features, services, and widgets from versioned templates."
    >
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!error && items === null && <p className="text-sm text-app-text-muted">Loading…</p>}

      {items !== null && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTag(null)}
            className={chipClass(activeTag === null)}
          >
            All
          </button>
          {TAG_FILTERS.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => setActiveTag(activeTag === tag ? null : tag)}
              className={chipClass(activeTag === tag)}
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      {filtered && filtered.length === 0 && (
        <p className="text-sm text-app-text-muted">No templates match this filter.</p>
      )}

      {filtered && filtered.length > 0 && (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((t) => (
            <li key={t.id}>
              <Link
                to={`/scaffolder/${t.id}`}
                className="block rounded-md border border-app-border bg-app-surface p-4 hover:border-app-primary"
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-sm font-semibold text-app-text">{t.name}</h2>
                  <span className="rounded-full bg-app-surface-hover px-2 py-0.5 text-[10px] text-app-text-muted">
                    v{t.version}
                  </span>
                </div>
                <p className="mt-1 text-xs text-app-text-muted">{t.description}</p>
                {t.tags.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1">
                    {t.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded bg-app-surface-hover px-1.5 py-0.5 text-[10px] text-app-text-muted"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
                <div className="mt-3 flex items-center gap-2 text-[10px] text-app-text-muted">
                  <span>{t.audience.join(" + ")}</span>
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
