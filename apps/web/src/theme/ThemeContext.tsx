// Theme context: reads/persists the active theme and applies it to <html>.
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import {
  DEFAULT_THEME,
  THEMES,
  THEME_STORAGE_KEY,
  VALID_THEME_IDS,
  type ThemeId,
  type ThemeOption,
} from "./themes";

function readStoredTheme(): ThemeId {
  if (typeof window === "undefined") return DEFAULT_THEME;
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored && VALID_THEME_IDS.has(stored as ThemeId)) return stored as ThemeId;
  } catch {
    // localStorage blocked, fall through
  }
  if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) return "dark";
  return DEFAULT_THEME;
}

interface ThemeContextValue {
  theme: ThemeId;
  setTheme: (id: ThemeId) => void;
  themes: ThemeOption[];
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: PropsWithChildren) {
  const [theme, setThemeState] = useState<ThemeId>(() => readStoredTheme());

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // ignore persistence failure
    }
  }, [theme]);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, setTheme: setThemeState, themes: THEMES }),
    [theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}
