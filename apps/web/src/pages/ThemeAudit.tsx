import { useEffect, useState, type ReactNode } from "react";
import { PageLayout } from "@internal/shared-ui";
import { ThemeSwitcher, useTheme } from "../theme";

const SURFACE_VARS = [
  "--c-bg",
  "--c-bg-sunken",
  "--c-surface",
  "--c-surface-hover",
  "--c-overlay",
  "--c-border",
  "--c-border-strong",
  "--c-primary",
  "--c-primary-soft",
  "--c-accent",
  "--c-success",
  "--c-success-soft",
  "--c-warning",
  "--c-warning-soft",
  "--c-danger",
  "--c-danger-soft",
] as const;

type CssVar = (typeof SURFACE_VARS)[number];

function useResolvedVars(): Record<CssVar, string> {
  const { theme } = useTheme();
  const [values, setValues] = useState<Record<CssVar, string>>(
    () => Object.fromEntries(SURFACE_VARS.map((k) => [k, ""])) as Record<CssVar, string>,
  );

  useEffect(() => {
    const cs = getComputedStyle(document.documentElement);
    const next = Object.fromEntries(
      SURFACE_VARS.map((k) => [k, cs.getPropertyValue(k).trim()]),
    ) as Record<CssVar, string>;
    setValues(next);
  }, [theme]);

  return values;
}

export function ThemeAuditPage() {
  const { theme } = useTheme();
  const vars = useResolvedVars();

  return (
    <PageLayout
      title="Theme audit"
      description={`Active theme: ${theme}. Use the switcher below to flip themes and inspect each token in context.`}
    >
      <div className="mb-8">
        <ThemeSwitcher variant="grid" />
      </div>

      <div className="flex flex-col gap-8">
        <Section
          title="Surfaces"
          tokens={[
            "bg-app-bg",
            "bg-app-bg-sunken",
            "bg-app-surface",
            "bg-app-surface-hover",
            "bg-app-overlay",
          ]}
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <SurfaceTile label="bg" varName="--c-bg" value={vars["--c-bg"]} />
            <SurfaceTile label="bg-sunken" varName="--c-bg-sunken" value={vars["--c-bg-sunken"]} />
            <SurfaceTile label="surface" varName="--c-surface" value={vars["--c-surface"]} />
            <SurfaceTile
              label="surface-hover"
              varName="--c-surface-hover"
              value={vars["--c-surface-hover"]}
            />
            <SurfaceTile label="overlay" varName="--c-overlay" value={vars["--c-overlay"]} />
          </div>
        </Section>

        <Section
          title="Text tiers"
          tokens={["text-app-text", "text-app-text-muted", "text-app-text-subtle"]}
        >
          <div className="rounded-app-md border border-app-border bg-app-surface p-5">
            <p className="text-base text-app-text">
              <span className="font-mono text-xs text-app-text-subtle">text-app-text · </span>
              The quick brown fox jumps over the lazy dog. Body copy at default size.
            </p>
            <p className="mt-2 text-sm text-app-text">
              Same token, smaller size — for compact rows and dense tables.
            </p>
            <p className="mt-4 text-base text-app-text-muted">
              <span className="font-mono text-xs text-app-text-subtle">text-app-text-muted · </span>
              Secondary copy: descriptions, hints, supporting metadata.
            </p>
            <p className="mt-2 text-sm text-app-text-muted">Smaller variant of muted text.</p>
            <p className="mt-4 text-base text-app-text-subtle">
              <span className="font-mono text-xs text-app-text-subtle">
                text-app-text-subtle ·{" "}
              </span>
              Tertiary copy: placeholders, timestamps, disabled labels.
            </p>
            <p className="mt-2 text-sm text-app-text-subtle">12:34 · 2 hours ago · v1.0.4</p>
          </div>
        </Section>

        <Section title="Borders" tokens={["border-app-border", "border-app-border-strong"]}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-app-md border border-app-border bg-app-surface p-4">
              <div className="font-mono text-xs text-app-text-subtle">border-app-border</div>
              <div className="mt-2 text-sm text-app-text">Default divider weight.</div>
              <hr className="my-3 border-app-border" />
              <div className="text-sm text-app-text-muted">Below the rule.</div>
            </div>
            <div className="rounded-app-md border-2 border-app-border-strong bg-app-surface p-4">
              <div className="font-mono text-xs text-app-text-subtle">border-app-border-strong</div>
              <div className="mt-2 text-sm text-app-text">Emphasized outline / focus border.</div>
              <hr className="my-3 border-app-border-strong" />
              <div className="text-sm text-app-text-muted">Below the strong rule.</div>
            </div>
          </div>
        </Section>

        <Section
          title="Buttons"
          tokens={[
            "bg-app-primary text-app-primary-foreground",
            "bg-app-primary-soft text-app-primary-soft-foreground",
            "border border-app-border bg-app-surface text-app-text",
            "bg-app-danger text-app-danger-foreground",
          ]}
        >
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className="rounded-app-md bg-app-primary px-4 py-2 text-sm font-medium text-app-primary-foreground transition-all duration-150 hover:-translate-y-0.5 hover:bg-app-primary-hover hover:shadow-app-md"
            >
              Primary action
            </button>
            <button
              type="button"
              className="rounded-app-md bg-app-primary-soft px-4 py-2 text-sm font-medium text-app-primary-soft-foreground transition-all duration-150 hover:-translate-y-0.5 hover:shadow-app-md hover:ring-2 hover:ring-inset hover:ring-app-primary"
            >
              Primary soft
            </button>
            <button
              type="button"
              className="rounded-app-md border border-app-border bg-app-surface px-4 py-2 text-sm text-app-text transition-all duration-150 hover:-translate-y-0.5 hover:bg-app-surface-hover hover:shadow-app-md"
            >
              Secondary
            </button>
            <button
              type="button"
              className="rounded-app-md bg-app-danger px-4 py-2 text-sm font-medium text-app-danger-foreground transition-all duration-150 hover:-translate-y-0.5 hover:opacity-90 hover:shadow-app-md"
            >
              Delete
            </button>
          </div>
        </Section>

        <Section
          title="Status banners"
          tokens={[
            "bg-app-success-soft text-app-success-foreground border-app-success",
            "bg-app-warning-soft text-app-warning-foreground border-app-warning",
            "bg-app-danger-soft text-app-danger-foreground border-app-danger",
          ]}
        >
          <div className="flex flex-col gap-3">
            <Banner kind="success" message="Build succeeded — deployment is live." />
            <Banner kind="warning" message="Token expires in 3 days. Rotate soon." />
            <Banner kind="danger" message="Migration failed. See logs for details." />
          </div>
        </Section>

        <Section
          title="Inputs (uses bg-sunken)"
          tokens={[
            "bg-app-bg-sunken",
            "border-app-border",
            "focus:ring-app-focus-ring",
            "placeholder:text-app-text-subtle",
          ]}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-app-text-muted">Text input</span>
              <input
                type="text"
                placeholder="Type here…"
                className="rounded-app-md border border-app-border bg-app-bg-sunken px-3 py-2 text-sm text-app-text placeholder:text-app-text-subtle focus:border-app-primary focus:outline-none focus:ring-2 focus:ring-app-focus-ring"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-app-text-muted">Select</span>
              <select className="rounded-app-md border border-app-border bg-app-bg-sunken px-3 py-2 text-sm text-app-text focus:border-app-primary focus:outline-none focus:ring-2 focus:ring-app-focus-ring">
                <option>Option one</option>
                <option>Option two</option>
                <option>Option three</option>
              </select>
            </label>
            <label className="sm:col-span-2 flex flex-col gap-1.5">
              <span className="text-xs font-medium text-app-text-muted">Textarea</span>
              <textarea
                rows={3}
                placeholder="Multi-line input…"
                className="rounded-app-md border border-app-border bg-app-bg-sunken px-3 py-2 text-sm text-app-text placeholder:text-app-text-subtle focus:border-app-primary focus:outline-none focus:ring-2 focus:ring-app-focus-ring"
              />
            </label>
          </div>
        </Section>

        <Section
          title="Focus ring"
          tokens={["focus-visible:ring-app-focus-ring", "--c-focus-ring"]}
        >
          <div className="rounded-app-md border border-app-border bg-app-surface p-5">
            <p className="mb-3 text-sm text-app-text-muted">
              Tab into the button below to see the theme-tuned focus ring.
            </p>
            <button
              type="button"
              className="rounded-app-md bg-app-primary px-4 py-2 text-sm font-medium text-app-primary-foreground focus:outline-none focus-visible:ring-4 focus-visible:ring-app-focus-ring"
            >
              Focus me
            </button>
          </div>
        </Section>

        <Section title="Shadows" tokens={["shadow-app-sm", "shadow-app-md", "shadow-app-lg"]}>
          <div className="grid gap-4 sm:grid-cols-3">
            <ShadowCard size="sm" />
            <ShadowCard size="md" />
            <ShadowCard size="lg" />
          </div>
        </Section>
      </div>
    </PageLayout>
  );
}

function Section({
  title,
  tokens,
  children,
}: {
  title: string;
  tokens: string[];
  children: ReactNode;
}) {
  return (
    <section>
      <header className="mb-3">
        <h2 className="text-lg font-semibold text-app-text">{title}</h2>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs text-app-text-subtle">
          {tokens.map((t) => (
            <span key={t}>{t}</span>
          ))}
        </div>
      </header>
      {children}
    </section>
  );
}

function SurfaceTile({ label, varName, value }: { label: string; varName: string; value: string }) {
  return (
    <div className="rounded-app-md border border-app-border bg-app-surface p-2">
      <div
        className="h-16 w-full rounded-app-sm border border-app-border"
        style={{ backgroundColor: `var(${varName})` }}
        aria-hidden
      />
      <div className="mt-2 text-xs font-medium text-app-text">{label}</div>
      <div className="font-mono text-[10px] text-app-text-subtle">{varName}</div>
      <div className="font-mono text-[10px] text-app-text-muted">{value || "—"}</div>
    </div>
  );
}

function Banner({ kind, message }: { kind: "success" | "warning" | "danger"; message: string }) {
  const classes: Record<typeof kind, string> = {
    success: "border-app-success bg-app-success-soft text-app-success-foreground",
    warning: "border-app-warning bg-app-warning-soft text-app-warning-foreground",
    danger: "border-app-danger bg-app-danger-soft text-app-danger-foreground",
  };
  return (
    <div className={`rounded-app-md border px-4 py-3 text-sm ${classes[kind]}`}>
      <div className="font-mono text-xs opacity-70">{kind}</div>
      <div className="mt-0.5 font-medium">{message}</div>
    </div>
  );
}

function ShadowCard({ size }: { size: "sm" | "md" | "lg" }) {
  return (
    <div
      className="rounded-app-lg border border-app-border bg-app-surface p-5"
      style={{ boxShadow: `var(--shadow-app-${size})` }}
    >
      <div className="font-mono text-xs text-app-text-subtle">shadow-app-{size}</div>
      <div className="mt-2 text-sm text-app-text">
        Card with the {size} elevation token. Shadow color is theme-tinted via{" "}
        <code className="font-mono text-xs">--c-shadow-color</code>.
      </div>
    </div>
  );
}
