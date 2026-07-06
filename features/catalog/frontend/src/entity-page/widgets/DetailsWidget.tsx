// Overview details panel: renders entity metadata, links, health, and DORA tier from the yamlSpec.
import { Link } from "react-router-dom";
import { useTranslation } from "@internal/i18n";
import type { DoraMetricsSnapshot, ServiceHealthSample } from "@feature/observability-shared";
import { DateCell, KindBadge, LifecycleBadge, TagsCell } from "../../catalog-table/cells";
import { TierPill } from "../TierPill";
import { useEntityOverviewContext } from "../EntityOverviewContext";

function readAnnotation(yamlSpec: unknown, key: string): string | null {
  const yaml = yamlSpec as Record<string, unknown> | null | undefined;
  const meta = yaml?.metadata as Record<string, unknown> | undefined;
  const ann = meta?.annotations as Record<string, unknown> | undefined;
  const v = ann?.[key];
  return typeof v === "string" ? v : null;
}

function readSpecField(yamlSpec: unknown, key: string): string | null {
  const yaml = yamlSpec as Record<string, unknown> | null | undefined;
  const spec = yaml?.spec as Record<string, unknown> | undefined;
  const v = spec?.[key];
  return typeof v === "string" ? v : null;
}

function readMetadataLinks(
  yamlSpec: unknown,
): Array<{ url: string; title: string; type?: string; icon?: string }> {
  const yaml = yamlSpec as Record<string, unknown> | null | undefined;
  const meta = yaml?.metadata as Record<string, unknown> | undefined;
  const links = meta?.links;
  if (!Array.isArray(links)) return [];
  const out: Array<{ url: string; title: string; type?: string; icon?: string }> = [];
  for (const l of links) {
    if (!l || typeof l !== "object") continue;
    const r = l as Record<string, unknown>;
    if (typeof r.url === "string" && typeof r.title === "string") {
      out.push({
        url: r.url,
        title: r.title,
        type: typeof r.type === "string" ? r.type : undefined,
        icon: typeof r.icon === "string" ? r.icon : undefined,
      });
    }
  }
  return out;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-app-text-muted text-xs uppercase tracking-wide">{label}</dt>
      <dd className="text-app-text">{children}</dd>
    </>
  );
}

interface IconDef {
  svg: React.ReactNode;
  label: string;
  tint: string;
}

const GH_PATH =
  "M8 .2A8 8 0 0 0 5.5 15.8c.4.1.6-.2.6-.4v-1.5c-2.2.5-2.7-1.1-2.7-1.1-.4-.9-.9-1.2-.9-1.2-.7-.5.1-.5.1-.5.8.1 1.2.8 1.2.8.7 1.2 1.9.9 2.4.7.1-.5.3-.9.5-1.1-1.8-.2-3.6-.9-3.6-3.9 0-.9.3-1.6.8-2.1-.1-.2-.4-1 .1-2.1 0 0 .7-.2 2.2.8a7.5 7.5 0 0 1 4 0c1.5-1 2.2-.8 2.2-.8.5 1.1.2 1.9.1 2.1.5.5.8 1.2.8 2.1 0 3-1.8 3.7-3.6 3.9.3.2.5.7.5 1.5v2.2c0 .2.2.5.6.4A8 8 0 0 0 8 .2Z";
const SLACK_PATH =
  "M3.5 10.5a1.5 1.5 0 1 1 0-3h1.5v3H3.5Zm2.25 0v-3h3v3h-3ZM5.5 6a1.5 1.5 0 1 1 3 0v1.5h-3V6Zm0 4.5h3V12a1.5 1.5 0 1 1-3 0v-1.5Zm4.5-1.5a1.5 1.5 0 1 1 3 0H12V9h-2Zm-2.25 0V6h3v3h-3Zm4.5 1.5h-3v-1.5h3V12a1.5 1.5 0 1 1-3 0v-1.5h1.5V9h1.5v1.5Z";
const GRAFANA_PATH =
  "M8 1.5 1.5 5v3l1 .5v.5a4 4 0 1 0 4-4h-.7L4 3.5l4-1.5 4 1.5-1.8.5h-.7a5 5 0 1 1-5 5v-.5l-1-.5V5L8 1.5Z";
const PROM_PATH =
  "M8 .8c1.6 1.7 1.5 3.4.4 4.5-.7.7-1.6 1.2-2.4 2-1 1.1-1.6 2.7-.6 4.4l.7-.4c-.7-1.1-.4-2.1.3-2.9.7-.7 1.7-1.2 2.5-2 1.4-1.3 1.6-3.6-.9-5.6Zm-5 9.4v3.5h10v-3.5h-10Zm1.2 1h7.6v1.5H4.2v-1.5Z";
const PD_PATH =
  "M3 1.5h6.5c2.8 0 4 1.7 4 3.8s-1.2 3.7-4 3.7H6V14H3V1.5Zm3 5h3c1 0 1.5-.5 1.5-1.2 0-.7-.5-1.3-1.5-1.3H6v2.5Z";
const RUNBOOK_PATH =
  "M3 2h7.5c1.4 0 2.5 1.1 2.5 2.5V13a1 1 0 0 1-1.4.9L8 12.5l-3.6 1.4A1 1 0 0 1 3 13V2Zm1.5 1.5v8l3-1.2 3.5 1.4V4.5c0-.6-.5-1-1-1H4.5Z";
const DOCS_PATH = "M3.5 1.5h7l3 3V14H3.5V1.5Zm6 0v3h3M5 5h4M5 7h6M5 9h6M5 11h4";
const DD_PATH =
  "M2 8c0-3.3 2.7-6 6-6s6 2.7 6 6h-2a4 4 0 0 0-8 0H2Zm6-1a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm4 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm-7 4 2 3 2-3h-1V8H7v3H5Z";
const SENTRY_PATH =
  "M8 1 14 13H10.4a2 2 0 0 0-3.6-1.6L5 13H2L8 1Zm0 3.5L4.7 11h.5a3 3 0 0 1 5.6 0h.5L8 4.5Z";
const LINK_PATH =
  "M5 7a3 3 0 0 1 3-3h2v1.5H8a1.5 1.5 0 1 0 0 3h2V10H8a3 3 0 0 1-3-3Zm6 0h-2V5.5h2a3 3 0 0 1 0 6H9V10h2a1.5 1.5 0 0 0 0-3Zm-4 0h4v1.5H7V7Z";

const ICONS: Record<string, IconDef> = {
  github: {
    svg: <path d={GH_PATH} />,
    label: "GitHub",
    tint: "bg-app-surface-hover hover:bg-app-primary-soft",
  },
  slack: {
    svg: <path d={SLACK_PATH} fill="currentColor" />,
    label: "Slack",
    tint: "bg-purple-100 hover:bg-purple-200 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  },
  grafana: {
    svg: <path d={GRAFANA_PATH} fill="currentColor" />,
    label: "Grafana",
    tint: "bg-orange-100 hover:bg-orange-200 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
  },
  prometheus: {
    svg: <path d={PROM_PATH} fill="currentColor" />,
    label: "Prometheus",
    tint: "bg-red-100 hover:bg-red-200 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  },
  datadog: {
    svg: <path d={DD_PATH} fill="currentColor" />,
    label: "Datadog",
    tint: "bg-violet-100 hover:bg-violet-200 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
  },
  sentry: {
    svg: <path d={SENTRY_PATH} fill="currentColor" />,
    label: "Sentry",
    tint: "bg-app-surface-hover hover:bg-app-primary-soft",
  },
  pagerduty: {
    svg: <path d={PD_PATH} fill="currentColor" />,
    label: "Pagerduty",
    tint: "bg-emerald-100 hover:bg-emerald-200 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  },
  runbook: {
    svg: <path d={RUNBOOK_PATH} fill="currentColor" />,
    label: "Runbook",
    tint: "bg-amber-100 hover:bg-amber-200 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  },
  docs: {
    svg: <path d={DOCS_PATH} fill="none" stroke="currentColor" strokeWidth="1.2" />,
    label: "Docs",
    tint: "bg-app-surface-hover hover:bg-app-primary-soft",
  },
  link: {
    svg: <path d={LINK_PATH} fill="currentColor" />,
    label: "Link",
    tint: "bg-app-surface-hover hover:bg-app-primary-soft",
  },
};

function IconLinkChip({ href, icon, label }: { href: string; icon: string; label?: string }) {
  const def = ICONS[icon] ?? ICONS.link!;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      title={label ?? def.label}
      aria-label={label ?? def.label}
      className={`inline-flex h-6 w-6 items-center justify-center rounded ${def.tint} transition-colors`}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
        {def.svg}
      </svg>
    </a>
  );
}

function IconChipRow({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-1.5">{children}</div>;
}

function HealthPill({ status }: { status: ServiceHealthSample["status"] | "unknown" }) {
  const { t } = useTranslation("catalog");
  const cls =
    status === "healthy"
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
      : status === "degraded"
        ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
        : status === "down"
          ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
          : "bg-app-surface-hover text-app-text-muted";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}
    >
      {t(`healthStatus.${status}`)}
    </span>
  );
}

function LanguageChip({ value }: { value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded bg-app-surface-hover px-1.5 py-0.5 text-[11px] text-app-text">
      <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
      {value}
    </span>
  );
}

// DORA tier rollup using Google's published thresholds.
function computeDoraTier(
  snapshot: DoraMetricsSnapshot | null,
): "red" | "orange" | "yellow" | "green" | "none" {
  if (!snapshot) return "none";
  const checks = [
    snapshot.deployFrequencyPerDay >= 1
      ? "elite"
      : snapshot.deployFrequencyPerDay >= 1 / 7
        ? "high"
        : snapshot.deployFrequencyPerDay >= 1 / 30
          ? "medium"
          : "low",
    snapshot.leadTimeHours <= 24
      ? "elite"
      : snapshot.leadTimeHours <= 24 * 7
        ? "high"
        : snapshot.leadTimeHours <= 24 * 30
          ? "medium"
          : "low",
    snapshot.changeFailureRate <= 0.15
      ? "elite"
      : snapshot.changeFailureRate <= 0.3
        ? "high"
        : snapshot.changeFailureRate <= 0.45
          ? "medium"
          : "low",
    snapshot.mttrHours <= 1
      ? "elite"
      : snapshot.mttrHours <= 24
        ? "high"
        : snapshot.mttrHours <= 24 * 7
          ? "medium"
          : "low",
  ] as const;
  const order = ["low", "medium", "high", "elite"] as const;
  const worstIdx = checks.reduce((acc, t) => Math.min(acc, order.indexOf(t)), order.length - 1);
  return (["red", "orange", "yellow", "green"] as const)[worstIdx]!;
}

export function DetailsWidget() {
  const { data } = useEntityOverviewContext();
  const { t } = useTranslation("catalog");
  const { entity, health, scorecards, dora } = data;
  const language = readAnnotation(entity.yamlSpec, "github.com/language");
  const onCall = readAnnotation(entity.yamlSpec, "on-call");
  const specType = readSpecField(entity.yamlSpec, "type");
  const lastCommitter = readAnnotation(entity.yamlSpec, "github.com/last-committer");
  const slackChannel = readAnnotation(entity.yamlSpec, "slack.com/channel");
  const slackUrl =
    readAnnotation(entity.yamlSpec, "slack.com/url") ??
    (slackChannel?.startsWith("#")
      ? `https://slack.com/app_redirect?channel=${slackChannel.slice(1)}`
      : null);
  const pagerdutyServiceId = readAnnotation(entity.yamlSpec, "pagerduty.com/service-id");
  const pagerdutyUrl = pagerdutyServiceId
    ? `https://pagerduty.com/service-directory/${pagerdutyServiceId}`
    : null;

  const allLinks = readMetadataLinks(entity.yamlSpec);
  const runbookLinks = allLinks.filter(
    (l) => l.type === "runbook" || l.icon === "runbook" || /runbook/i.test(l.title),
  );
  const runbookAnnotation = readAnnotation(entity.yamlSpec, "runbook");
  if (runbookAnnotation && !runbookLinks.some((l) => l.url === runbookAnnotation)) {
    runbookLinks.push({
      url: runbookAnnotation,
      title: t("details.runbookLabel"),
      type: "runbook",
    });
  }

  const dashboards: Array<{ url: string; icon: string; label: string }> = [];
  const grafana = readAnnotation(entity.yamlSpec, "grafana.com/dashboard-url");
  const prom = readAnnotation(entity.yamlSpec, "prometheus.io/url");
  const dd = readAnnotation(entity.yamlSpec, "datadoghq.com/dashboard-url");
  const sentrySlug = readAnnotation(entity.yamlSpec, "sentry.io/project-slug");
  if (grafana) dashboards.push({ url: grafana, icon: "grafana", label: "Grafana" });
  if (prom) dashboards.push({ url: prom, icon: "prometheus", label: "Prometheus" });
  if (dd) dashboards.push({ url: dd, icon: "datadog", label: "Datadog" });
  if (sentrySlug)
    dashboards.push({
      url: `https://sentry.io/organizations/${sentrySlug}/`,
      icon: "sentry",
      label: "Sentry",
    });

  const docsLinks = allLinks.filter(
    (l) => l.type === "docs" || l.icon === "docs" || /docs?/i.test(l.title),
  );

  const latestHealth = health && health.length > 0 ? health[0]!.status : "unknown";
  const productionReadiness = scorecards?.find((s) => s.scorecard.slug === "production-readiness");
  const latestDora = dora && dora.length > 0 ? dora[0]! : null;
  const doraTier = computeDoraTier(latestDora);

  return (
    <>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
        <Field label={t("details.fieldTitle")}>{entity.name}</Field>

        {language && (
          <Field label={t("details.fieldLanguage")}>
            <LanguageChip value={language} />
          </Field>
        )}

        <Field label={t("details.fieldType")}>
          <div className="flex items-center gap-2">
            <KindBadge value={entity.kind} />
            {specType && specType !== entity.kind && (
              <span className="text-xs text-app-text-muted">({specType})</span>
            )}
          </div>
        </Field>

        <Field label={t("details.fieldLifecycle")}>
          <LifecycleBadge value={entity.lifecycle} />
        </Field>

        {runbookLinks.length > 0 && (
          <Field label={t("details.fieldRunbooks")}>
            <IconChipRow>
              {runbookLinks.map((l) => (
                <IconLinkChip key={l.url} href={l.url} icon="runbook" label={l.title} />
              ))}
            </IconChipRow>
          </Field>
        )}

        {dashboards.length > 0 && (
          <Field label={t("details.fieldMonitorDashboards")}>
            <IconChipRow>
              {dashboards.map((d) => (
                <IconLinkChip key={d.url} href={d.url} icon={d.icon} label={d.label} />
              ))}
            </IconChipRow>
          </Field>
        )}

        {onCall && <Field label={t("details.fieldOnCall")}>{onCall}</Field>}

        {(entity.repoUrl || docsLinks.length > 0) && (
          <Field label={t("details.fieldUrl")}>
            <IconChipRow>
              {entity.repoUrl && (
                <IconLinkChip
                  href={entity.repoUrl}
                  icon="github"
                  label={t("details.repositoryLink")}
                />
              )}
              {docsLinks.map((l) => (
                <IconLinkChip key={l.url} href={l.url} icon="docs" label={l.title} />
              ))}
            </IconChipRow>
          </Field>
        )}

        {health !== undefined && (
          <Field label={t("details.fieldHealth")}>
            <HealthPill status={latestHealth} />
          </Field>
        )}

        {lastCommitter && <Field label={t("details.fieldLastCommitter")}>{lastCommitter}</Field>}

        <Field
          label={
            entity.ownerTeams.length > 1
              ? t("details.fieldOwningTeams")
              : t("details.fieldOwningTeam")
          }
        >
          {entity.ownerTeams.length === 0 ? (
            <span className="text-app-text-muted">—</span>
          ) : (
            <div className="flex flex-wrap gap-1">
              {entity.ownerTeams.map((team) => (
                <Link
                  key={team.id}
                  to={`/teams/${team.slug}`}
                  className="inline-block max-w-full truncate rounded-full bg-app-primary-soft px-2 py-0.5 text-[11px] font-medium leading-4 text-app-primary-soft-foreground hover:underline"
                  title={team.description ?? team.name}
                >
                  {team.name}
                </Link>
              ))}
            </div>
          )}
        </Field>

        {(slackUrl || slackChannel) && (
          <Field label={t("details.fieldSlack")}>
            {slackUrl ? (
              <IconChipRow>
                <IconLinkChip
                  href={slackUrl}
                  icon="slack"
                  label={slackChannel ?? t("details.slackLabel")}
                />
                {slackChannel && (
                  <span className="text-xs text-app-text-muted">{slackChannel}</span>
                )}
              </IconChipRow>
            ) : (
              <span className="text-app-text">{slackChannel}</span>
            )}
          </Field>
        )}

        {pagerdutyUrl && (
          <Field label={t("details.fieldPagerduty")}>
            <IconLinkChip
              href={pagerdutyUrl}
              icon="pagerduty"
              label={t("details.pagerdutyService")}
            />
          </Field>
        )}

        {productionReadiness && (
          <Field label={t("details.fieldProductionReadiness")}>
            <TierPill
              tier={productionReadiness.tier}
              tierStyle={productionReadiness.scorecard.tierStyle}
            />
          </Field>
        )}

        {dora !== undefined && (
          <Field label={t("details.fieldDoraMetrics")}>
            <TierPill tier={doraTier} tierStyle="threshold" />
          </Field>
        )}

        <Field label={t("details.fieldTags")}>
          <TagsCell tags={entity.tags} />
        </Field>

        <Field label={t("details.fieldLastSeen")}>
          <DateCell value={entity.lastSeenAt} />
        </Field>

        {entity.staleSince && (
          <Field label={t("details.fieldStaleSince")}>
            <DateCell value={entity.staleSince} />
          </Field>
        )}

        <Field label={t("details.fieldSource")}>
          <div>
            <span>{t(`entitySource.${entity.source}`)}</span>
            {entity.sourceRef && (
              <div className="text-xs text-app-text-muted truncate">{entity.sourceRef}</div>
            )}
          </div>
        </Field>
      </dl>
      {entity.description && (
        <div className="mt-3 border-t border-app-border pt-3 text-sm text-app-text">
          {entity.description}
        </div>
      )}
    </>
  );
}
