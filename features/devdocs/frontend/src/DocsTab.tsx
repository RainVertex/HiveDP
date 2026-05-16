import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useApi } from "@internal/api-client/react";
import type { CurrentUser, DocResolvedSource } from "@internal/shared-types";
import { useDocPage, useDocsList, useDocsSearch } from "./useDevDocs";
import { DocsSidebar } from "./DocsSidebar";
import { DocPageView } from "./DocPageView";
import { EmptyState } from "./EmptyState";
import { ExternalDocsCard } from "./ExternalDocsCard";
import { DocsSearchBox } from "./DocsSearchBox";

export function DocsTab() {
  const api = useApi();
  const { id: entityId = "" } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const docs = useDocsList(entityId);
  const search = useDocsSearch(entityId);

  const slugParam = searchParams.get("p");
  const pageSummaries = useMemo(() => docs.data?.pages ?? [], [docs.data?.pages]);
  const activeSlug = useMemo(() => {
    if (slugParam && pageSummaries.some((p) => p.slug === slugParam)) return slugParam;
    const index = pageSummaries.find((p) => p.slug === "index");
    if (index) return index.slug;
    return pageSummaries[0]?.slug ?? null;
  }, [slugParam, pageSummaries]);

  const pageDetail = useDocPage(entityId, activeSlug);

  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  useEffect(() => {
    let cancelled = false;
    api.auth
      .me()
      .then((me) => {
        if (!cancelled) setCurrentUser(me);
      })
      .catch(() => {
        // 401 means we're not signed in; the page guard will redirect, but
        // failing silently here keeps the docs view from crashing.
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  async function runSync() {
    setSyncing(true);
    setSyncError(null);
    try {
      await api.devdocs.sync(entityId);
      docs.reload();
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  function selectSlug(slug: string) {
    const next = new URLSearchParams(searchParams);
    next.set("p", slug);
    setSearchParams(next, { replace: true });
    search.clear();
  }

  if (docs.error) {
    return (
      <div className="rounded-md border border-app-danger bg-app-surface px-3 py-2 text-sm text-app-danger">
        {docs.error}
      </div>
    );
  }
  if (!docs.data) {
    return <p className="text-sm text-app-text-muted">Loading DevDocs…</p>;
  }

  const { syncState, pages } = docs.data;
  const resolved: DocResolvedSource | null = syncState.resolvedSource;

  if (resolved && resolved.kind === "external" && resolved.url) {
    return <ExternalDocsCard url={resolved.url} />;
  }
  if (resolved && resolved.kind === "spec-url" && resolved.url) {
    return <ExternalDocsCard url={resolved.url} />;
  }

  if (pages.length === 0) {
    return (
      <div className="space-y-3">
        {syncError && (
          <div className="rounded-md border border-app-danger bg-app-surface px-3 py-2 text-sm text-app-danger">
            {syncError}
          </div>
        )}
        <EmptyState syncState={syncState} onRunSync={runSync} syncing={syncing} />
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="space-y-3 lg:sticky lg:top-4 lg:self-start">
        <DocsSearchBox
          hits={search.hits}
          loading={search.loading}
          error={search.error}
          onSearch={search.search}
          onClear={search.clear}
          onSelect={selectSlug}
        />
        <DocsSidebar
          entityId={entityId}
          pages={pages}
          activeSlug={activeSlug}
          onSelect={selectSlug}
        />
        <button
          type="button"
          onClick={runSync}
          disabled={syncing}
          className="w-full rounded border border-app-border px-2 py-1 text-[11px] text-app-text-muted hover:bg-app-surface-hover disabled:opacity-50"
        >
          {syncing ? "Syncing…" : "Resync from repo"}
        </button>
        {syncError && <p className="text-[11px] text-app-danger">{syncError}</p>}
      </aside>
      <main className="min-w-0">
        {pageDetail.error && (
          <div className="rounded-md border border-app-danger bg-app-surface px-3 py-2 text-sm text-app-danger">
            {pageDetail.error}
          </div>
        )}
        {pageDetail.loading && !pageDetail.page && (
          <p className="text-sm text-app-text-muted">Loading page…</p>
        )}
        {pageDetail.page && (
          <DocPageView
            page={pageDetail.page}
            currentUser={currentUser}
            onChanged={() => {
              pageDetail.reload();
              docs.reload();
            }}
          />
        )}
      </main>
    </div>
  );
}
