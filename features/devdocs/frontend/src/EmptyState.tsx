// Placeholder shown when an entity has no DevDocs, explaining how to add them and offering a resync.
import type { DocSyncStateRow } from "@internal/shared-types";

export interface EmptyStateProps {
  syncState: DocSyncStateRow | null;
  onRunSync: () => void;
  syncing: boolean;
}

export function EmptyState({ syncState, onRunSync, syncing }: EmptyStateProps) {
  const lastErr = syncState?.lastError;
  return (
    <div className="rounded-lg border border-app-border bg-app-surface p-6">
      <h2 className="text-sm font-semibold text-app-text mb-2">No DevDocs yet</h2>
      <p className="text-sm text-app-text-muted mb-3">
        DevDocs auto-discovers Markdown from this entity&rsquo;s repo. To make docs appear here, do{" "}
        <strong>one</strong> of:
      </p>
      <ol className="list-decimal list-inside text-sm text-app-text-muted space-y-2 mb-4">
        <li>
          Add a <code>docs/</code> folder at the repo root containing one or more <code>.md</code>{" "}
          or <code>.mdx</code> files. Subfolders are walked recursively and become nested pages (up
          to 200 files total). The landing page is <code>docs/index.md</code> if it exists,
          otherwise <code>docs/README.md</code>, otherwise the first page found. Each page&rsquo;s
          title is taken from a <code>title:</code> YAML frontmatter field, then the first{" "}
          <code># heading</code> in the file, then the filename.
        </li>
        <li>
          Add a <code>README.md</code> at the repo root. It is rendered as a single
          &ldquo;Overview&rdquo; page.
        </li>
        <li>
          Set <code>spec.docs</code> in <code>catalog-info.yaml</code> to point at a different
          folder in this repo, or at an external docs site:
        </li>
      </ol>
      <pre className="rounded bg-app-surface-hover p-3 text-xs overflow-x-auto mb-3">
        {`# Option A: explicit folder inside this repo
#   (same conventions as the docs/ folder above)
spec:
  docs:
    path: ./docs

# Option B: external docs site (rendered as a link card,
#   no Markdown is fetched)
spec:
  docs:
    url: https://docs.example.com/your-service`}
      </pre>
      <p className="text-xs text-app-text-muted mb-4">
        A sync runs automatically when this entity is registered or updated, and every two hours on
        a schedule.
      </p>
      {lastErr && (
        <div className="mb-3 rounded-md border border-app-danger bg-app-surface px-3 py-2 text-xs text-app-danger">
          Last sync error: {lastErr}
        </div>
      )}
      <button
        type="button"
        onClick={onRunSync}
        disabled={syncing}
        className="rounded-md bg-app-primary px-3 py-1.5 text-sm font-medium text-app-primary-on hover:opacity-90 disabled:opacity-50"
      >
        {syncing ? "Syncing…" : "Run sync now"}
      </button>
    </div>
  );
}
