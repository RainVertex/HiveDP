import { useEffect, useState } from "react";
import { PageLayout } from "@internal/shared-ui";
import { useApi } from "@internal/api-client/react";
import type { ScaffolderBinding } from "@internal/shared-types";
import { TemplateDriftBadge } from "./TemplateDriftBadge";

export function BindingsPage() {
  const api = useApi();
  const [items, setItems] = useState<ScaffolderBinding[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.scaffolder
      .listBindings()
      .then((res) => setItems(res.items))
      .catch((err) => setError(err.message ?? "Failed to load bindings"));
  }, [api]);

  return (
    <PageLayout
      title="Scaffolder bindings"
      description="Generated artifacts and the templates that produced them."
    >
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!error && items === null && <p className="text-sm text-app-text-muted">Loading…</p>}
      {items && items.length === 0 && (
        <p className="text-sm text-app-text-muted">No bindings yet.</p>
      )}
      {items && items.length > 0 && (
        <ul className="divide-y divide-app-border rounded-md border border-app-border bg-app-surface">
          {items.map((b) => (
            <li key={b.id} className="px-3 py-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex items-center gap-2 flex-wrap">
                  <div>
                    <div className="font-mono text-app-text">{b.targetRef}</div>
                    <div className="text-xs text-app-text-muted">
                      {b.templateId} · v{b.templateVersion} · {b.targetKind} · target={b.target}
                    </div>
                  </div>
                  <TemplateDriftBadge bindingId={b.id} />
                </div>
                <div className="text-right text-xs text-app-text-muted">
                  <div>{new Date(b.appliedAt).toLocaleString()}</div>
                  {b.prUrl && (
                    <a
                      href={b.prUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-app-primary hover:underline"
                    >
                      PR
                    </a>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </PageLayout>
  );
}
