// Compact per-field diff between a team request's original submission and its current values.
import type { TeamRequestDto } from "@internal/shared-types";

interface RequestDiffProps {
  request: TeamRequestDto;
}

export function RequestDiff({ request }: RequestDiffProps) {
  const rows = buildRows(request);
  if (rows.length === 0) return null;
  return (
    <div className="mt-2 rounded-md border border-app-border bg-app-bg/40 px-3 py-2 text-xs">
      <div className="mb-1 text-app-text-muted">Changes from original</div>
      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={r.label} className="flex flex-wrap gap-x-2">
            <span className="text-app-text-muted">{r.label}:</span>
            <span className="text-app-text-muted line-through">{r.before}</span>
            <span className="text-app-text">→ {r.after}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function buildRows(r: TeamRequestDto): { label: string; before: string; after: string }[] {
  const rows: { label: string; before: string; after: string }[] = [];
  if (r.slug !== r.original.slug) {
    rows.push({ label: "slug", before: r.original.slug, after: r.slug });
  }
  if (r.name !== r.original.name) {
    rows.push({ label: "name", before: r.original.name, after: r.name });
  }
  const beforeDesc = r.original.description ?? "(none)";
  const afterDesc = r.description ?? "(none)";
  if (beforeDesc !== afterDesc) {
    rows.push({ label: "description", before: beforeDesc, after: afterDesc });
  }
  if (r.mirrorToGithub !== r.original.mirrorToGithub) {
    rows.push({
      label: "mirror to GitHub",
      before: r.original.mirrorToGithub ? "yes" : "no",
      after: r.mirrorToGithub ? "yes" : "no",
    });
  }
  if ((r.githubIntegrationId ?? null) !== (r.original.githubIntegrationId ?? null)) {
    rows.push({
      label: "GitHub integration",
      before: r.original.githubIntegrationId ?? "(none)",
      after: r.githubIntegrationId ?? "(none)",
    });
  }
  return rows;
}
