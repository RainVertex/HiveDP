// Cell renderers for the catalog table (badges, owner/tags/repo/date/name cells).
import { Link } from "react-router-dom";
import { useTranslation } from "@internal/i18n";
import type { CatalogEntityKind, Lifecycle } from "@feature/catalog-shared";
import type { Team } from "@feature/teams-shared";

export function KindBadge({ value }: { value: CatalogEntityKind }) {
  const { t } = useTranslation("catalog");
  return (
    <span className="inline-flex items-center rounded bg-app-surface-hover px-1.5 py-0.5 font-mono text-[11px] text-app-text-muted">
      {t(`kind.${value}`)}
    </span>
  );
}

export function LifecycleBadge({ value }: { value: Lifecycle }) {
  const { t } = useTranslation("catalog");
  const cls = lifecycleStyle(value);
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}
    >
      {t(`lifecycle.${value}`)}
    </span>
  );
}

function lifecycleStyle(value: Lifecycle): string {
  switch (value) {
    case "production":
      return "bg-app-success-soft text-app-success-foreground";
    case "experimental":
      return "bg-app-warning-soft text-app-warning-foreground";
    case "deprecated":
      return "bg-app-surface-hover text-app-text-muted line-through";
    case "development":
      return "bg-app-primary-soft text-app-primary-soft-foreground";
  }
}

export function OwnerCell({ teams }: { teams: Team[] }) {
  if (!teams || teams.length === 0) return <span className="text-app-text-muted">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {teams.map((team) => (
        <a
          key={team.id}
          href={`/teams/${team.slug}`}
          className="inline-block whitespace-nowrap rounded-full bg-app-primary-soft px-2 py-0.5 text-[11px] font-medium leading-4 text-app-primary-soft-foreground hover:underline"
          title={team.description ?? team.name}
        >
          {team.name}
        </a>
      ))}
    </div>
  );
}

export function TagsCell({ tags }: { tags: string[] }) {
  if (!tags || tags.length === 0) return <span className="text-app-text-muted">—</span>;
  // En fazla 2 satir, fazlasi sutun olarak yana buyur, tasan kisim tablonun yatay kaydirmasinda gorunur.
  return (
    <div className="grid w-max grid-flow-col grid-rows-2 items-center justify-items-start gap-1">
      {tags.map((t) => (
        <span
          key={t}
          className="whitespace-nowrap rounded bg-app-surface-hover px-1.5 py-0.5 font-mono text-[10px] text-app-text-muted"
        >
          {t}
        </span>
      ))}
    </div>
  );
}

export function RepoCell({ url }: { url: string | null | undefined }) {
  if (!url) return <span className="text-app-text-muted">—</span>;
  const label = url.replace(/^https?:\/\/(www\.)?github\.com\//, "").replace(/\.git$/, "");
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      className="text-app-primary hover:underline"
    >
      {label} ↗
    </a>
  );
}

export function DateCell({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-app-text-muted">—</span>;
  return <span className="text-app-text-muted">{new Date(value).toLocaleDateString()}</span>;
}

export function NameCell({
  id,
  name,
  description,
  staleSince,
  locked,
}: {
  id?: string;
  name: string;
  description: string | null | undefined;
  staleSince?: string | null;
  locked?: boolean;
}) {
  const { t } = useTranslation("catalog");
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        {id ? (
          <Link
            to={`/catalog/${id}`}
            className="truncate font-medium text-app-text hover:text-app-primary hover:underline"
          >
            {name}
          </Link>
        ) : (
          <div className="truncate font-medium text-app-text">{name}</div>
        )}
        {locked && (
          <span className="text-app-text-muted" title={t("cell.lockedTitle")}>
            🔒
          </span>
        )}
        {staleSince && (
          <span
            className="inline-flex items-center rounded-full bg-app-warning-soft px-1.5 py-0.5 text-[10px] font-medium text-app-warning-foreground"
            title={t("cell.staleTitle", { date: new Date(staleSince).toLocaleString() })}
          >
            {t("cell.staleLabel")}
          </span>
        )}
      </div>
      {description && (
        <div className="max-w-[12rem] truncate text-xs text-app-text-muted" title={description}>
          {description}
        </div>
      )}
    </div>
  );
}
