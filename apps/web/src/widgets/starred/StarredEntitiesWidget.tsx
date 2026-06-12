import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { CatalogListItem } from "@internal/shared-types";
import { useApi, useStarred } from "@internal/api-client/react";
import { StarIcon } from "./StarIcon";

export function StarredEntitiesWidget() {
  const api = useApi();
  const { starredIds, toggle } = useStarred();
  const [entities, setEntities] = useState<CatalogListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.catalog
      .list()
      .then((res) => {
        if (!cancelled) setEntities(res.items);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message ?? "Failed to load catalog.");
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  if (error) return <EmptyState message={error} />;
  if (entities === null) return <LoadingState />;

  const starred = entities.filter((e) => starredIds.includes(e.id));

  if (starred.length === 0) {
    return (
      <EmptyState
        message="No starred entities yet."
        action={
          <Link
            to="/catalog"
            className="text-sm font-medium text-app-primary hover:text-app-primary-hover"
          >
            Browse the catalog →
          </Link>
        }
      />
    );
  }

  return (
    <ul className="flex flex-col divide-y divide-app-border">
      {starred.map((entity) => (
        <li key={entity.id} className="py-2 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-medium text-app-text truncate">{entity.name}</div>
            <div className="text-xs text-app-text-muted truncate">
              {entity.kind} · {entity.lifecycle}
            </div>
          </div>
          <button
            type="button"
            onClick={() => toggle(entity.id)}
            aria-label={`Unstar ${entity.name}`}
            className="text-yellow-500 hover:text-yellow-600 transition-colors"
          >
            <StarIcon filled />
          </button>
        </li>
      ))}
    </ul>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-col gap-2">
      <div className="h-4 rounded bg-app-surface-hover animate-pulse" />
      <div className="h-4 rounded bg-app-surface-hover animate-pulse w-3/4" />
      <div className="h-4 rounded bg-app-surface-hover animate-pulse w-1/2" />
    </div>
  );
}

function EmptyState({ message, action }: { message: string; action?: React.ReactNode }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center gap-2 py-6">
      <StarIcon />
      <div className="text-sm text-app-text-muted">{message}</div>
      {action}
    </div>
  );
}
