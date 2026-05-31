// Debounced user search picker backed by GET /api/users?query=.
import { useEffect, useRef, useState } from "react";
import { useApi } from "@internal/api-client/react";
import type { UserSummary } from "@internal/shared-types";

interface UserPickerProps {
  excludeIds?: string[];
  onSelect: (user: UserSummary) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function UserPicker({
  excludeIds = [],
  onSelect,
  placeholder = "Search by name or email…",
  disabled,
}: UserPickerProps) {
  const api = useApi();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults(null);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await api.users.search(query.trim());
        setResults(res.items);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Search failed");
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [api, query]);

  const excluded = new Set(excludeIds);

  return (
    <div className="space-y-2">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full rounded-md border border-app-border bg-app-surface px-3 py-2 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-app-primary"
      />
      {error && <div className="text-xs text-app-danger">{error}</div>}
      {loading && <div className="text-xs text-app-text-muted">Searching…</div>}
      {results && results.length > 0 && (
        <ul className="max-h-60 overflow-y-auto rounded-md border border-app-border">
          {results.map((u) => {
            const isExcluded = excluded.has(u.id);
            return (
              <li key={u.id}>
                <button
                  type="button"
                  disabled={isExcluded || disabled}
                  onClick={() => onSelect(u)}
                  className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm ${
                    isExcluded
                      ? "cursor-not-allowed text-app-text-muted"
                      : "hover:bg-app-surface-hover text-app-text"
                  }`}
                >
                  <span>
                    <span className="font-medium">{u.displayName}</span>
                    <span className="ml-2 text-xs text-app-text-muted">{u.email}</span>
                  </span>
                  {isExcluded && <span className="text-xs">already added</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {results && results.length === 0 && !loading && (
        <div className="text-xs text-app-text-muted">No matches</div>
      )}
    </div>
  );
}
