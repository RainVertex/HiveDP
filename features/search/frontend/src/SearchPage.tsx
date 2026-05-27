import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PageLayout } from "@internal/shared-ui";
import { useApi } from "@internal/api-client/react";
import type { SearchHit, SearchResults } from "@internal/shared-types";

function kindLabel(kind: SearchHit["kind"]): string {
  switch (kind) {
    case "catalog":
      return "catalog entity";
    case "devdoc":
      return "devdoc";
    default:
      return kind;
  }
}

function hrefFor(hit: SearchHit): string | null {
  if (hit.href) return hit.href;
  switch (hit.kind) {
    case "catalog":
      return `/catalog/${hit.id}`;
    case "team":
      return `/teams`;
    case "agent":
      return `/agents`;
    case "devdoc":
      return `/devdocs`;
    default:
      return null;
  }
}

export function SearchPage() {
  const api = useApi();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQuery = searchParams.get("q") ?? "";
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SearchResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function execute(q: string) {
    if (!q) return;
    setLoading(true);
    setError(null);
    try {
      setResults(await api.search.query(q));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (initialQuery) execute(initialQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run(e: FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setSearchParams({ q });
    await execute(q);
  }

  return (
    <PageLayout
      title="Search"
      description="Find catalog entities, projects, teams, agents, and DevDocs pages."
    >
      <form onSubmit={run} className="flex gap-2 mb-4">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search…"
          className="flex-1 border border-gray-300 rounded-md px-3 py-1.5 text-sm"
        />
        <button
          type="submit"
          className="px-3 py-1.5 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          disabled={loading}
        >
          {loading ? "Searching…" : "Search"}
        </button>
      </form>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {results && results.hits.length === 0 && (
        <p className="text-sm text-gray-600">No results for &ldquo;{results.query}&rdquo;.</p>
      )}
      {results && results.hits.length > 0 && (
        <ul className="divide-y divide-gray-200">
          {results.hits.map((hit) => {
            const href = hrefFor(hit);
            const titleNode = href ? (
              <Link to={href} className="font-medium text-gray-900 hover:underline">
                {hit.title}
              </Link>
            ) : (
              <span className="font-medium text-gray-900">{hit.title}</span>
            );
            return (
              <li key={`${hit.kind}:${hit.id}`} className="py-3">
                <div>{titleNode}</div>
                <div className="text-xs text-gray-500">{kindLabel(hit.kind)}</div>
                {hit.snippet && <p className="mt-1 text-sm text-gray-700">{hit.snippet}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </PageLayout>
  );
}
