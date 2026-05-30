import { useTheme } from "./ThemeContext";
import type { ThemeId } from "./themes";

interface ThemeSwitcherProps {
  variant?: "select" | "grid";
}

export function ThemeSwitcher({ variant = "select" }: ThemeSwitcherProps) {
  const { theme, setTheme, themes } = useTheme();

  if (variant === "select") {
    const active = themes.find((t) => t.id === theme);
    return (
      <label className="flex items-center gap-2 text-xs text-app-text-muted">
        <span className="hidden sm:inline">Theme</span>
        <span className="relative inline-flex items-center">
          {active && (
            <span
              aria-hidden
              className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border border-app-border"
              style={{ backgroundColor: active.swatch.primary }}
            />
          )}
          <select
            aria-label="Theme"
            value={theme}
            onChange={(e) => setTheme(e.target.value as ThemeId)}
            className="appearance-none bg-none rounded-md border border-app-border bg-app-surface py-1.5 pl-8 pr-8 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-app-primary"
          >
            {themes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          <svg
            aria-hidden
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-app-text-muted"
          >
            <path d="M6 8l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </label>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {themes.map((option) => {
        const active = option.id === theme;
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => setTheme(option.id)}
            aria-pressed={active}
            className={`text-left rounded-lg border p-3 transition-colors ${
              active
                ? "border-app-primary bg-app-primary-soft"
                : "border-app-border bg-app-surface hover:bg-app-surface-hover"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span
                className={`text-sm font-medium ${
                  active ? "text-app-primary-soft-foreground" : "text-app-text"
                }`}
              >
                {option.label}
              </span>
              {active && <span className="text-xs font-semibold text-app-primary">Active</span>}
            </div>
            <div className="mt-1 text-xs text-app-text-muted">{option.description}</div>
            <div className="mt-3 flex gap-1.5" aria-hidden>
              <Swatch color={option.swatch.bg} />
              <Swatch color={option.swatch.surface} />
              <Swatch color={option.swatch.primary} />
              <Swatch color={option.swatch.accent} />
              <Swatch color={option.swatch.success} />
              <Swatch color={option.swatch.danger} />
            </div>
          </button>
        );
      })}
    </div>
  );
}

function Swatch({ color }: { color: string }) {
  return (
    <span
      className="h-5 w-5 rounded-md border border-app-border"
      style={{ backgroundColor: color }}
    />
  );
}
