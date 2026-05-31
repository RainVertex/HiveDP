import { useEffect, useRef, useState } from "react";

interface PlatformUser {
  id: string;
  username: string;
  name: string;
  kind?: "human" | "agent";
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  onSelect?: (user: PlatformUser) => void;
  className?: string;
}

export function UserAutocomplete({ value, onChange, placeholder, onSelect, className }: Props) {
  const [suggestions, setSuggestions] = useState<PlatformUser[]>([]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = value.trim();
    if (q.length < 1) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      fetch(`/api/projects/users/search?q=${encodeURIComponent(q)}`)
        .then((r) => (r.ok ? r.json() : []))
        .then((d: PlatformUser[]) => {
          if (!cancelled) {
            setSuggestions(d ?? []);
            setOpen(true);
          }
        })
        .catch(() => {});
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [value]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function handlePick(u: PlatformUser) {
    onChange(u.username);
    if (onSelect) onSelect(u);
    setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative flex-1">
      <input
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        placeholder={placeholder}
        className={
          className ??
          "w-full rounded-md border border-app-border bg-app-surface px-3 py-1.5 text-sm text-app-text placeholder:text-app-text-muted"
        }
      />
      {open && suggestions.length > 0 && (
        <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-48 overflow-y-auto rounded-md border border-app-border bg-app-surface shadow-lg">
          {suggestions.map((u) => (
            <li key={u.id}>
              <button
                type="button"
                onClick={() => handlePick(u)}
                className="block w-full px-3 py-1.5 text-left text-sm text-app-text hover:bg-app-surface-hover"
              >
                {u.kind === "agent" ? (
                  <>
                    <span className="font-medium">{u.name}</span>
                    <span className="ml-2 rounded bg-app-surface-hover px-1 text-[10px] uppercase tracking-wide text-app-text-muted">
                      agent
                    </span>
                  </>
                ) : (
                  <>
                    <span className="font-medium">{u.username}</span>
                    {u.name && u.name !== u.username && (
                      <span className="ml-2 text-xs text-app-text-muted">{u.name}</span>
                    )}
                  </>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
