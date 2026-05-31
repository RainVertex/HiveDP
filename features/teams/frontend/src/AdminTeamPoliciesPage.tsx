// Admin page to toggle and configure the hard team-request policies.
import { useCallback, useEffect, useState } from "react";
import { PageLayout } from "@internal/shared-ui";
import { useApi } from "@internal/api-client/react";
import type { TeamPolicyDto, TeamPolicyKind } from "@internal/shared-types";

export function AdminTeamPoliciesPage() {
  const api = useApi();
  const [items, setItems] = useState<TeamPolicyDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyKind, setBusyKind] = useState<TeamPolicyKind | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api.teamPolicies.list();
      setItems(res.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  async function update(
    kind: TeamPolicyKind,
    body: { enabled?: boolean; config?: Record<string, unknown> },
  ) {
    setBusyKind(kind);
    setError(null);
    try {
      const next = await api.teamPolicies.update(kind, body);
      setItems((prev) => (prev ? prev.map((p) => (p.kind === kind ? next : p)) : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusyKind(null);
    }
  }

  return (
    <PageLayout
      title="Team policies"
      description="Hard rules enforced on every team request at submission. Adding a new policy requires a code change; this page toggles and configures the existing ones."
    >
      {error && <p className="mb-3 text-sm text-app-danger">{error}</p>}
      {!items && !error && <p className="text-sm text-app-text-muted">Loading…</p>}
      {items && items.length > 0 && (
        <ul className="space-y-3">
          {items.map((p) => (
            <li
              key={p.kind}
              className="rounded-lg border border-app-border bg-app-surface p-4 text-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-app-text">
                    <span className="font-medium">{p.label}</span>{" "}
                    <span className="text-xs text-app-text-muted">({p.kind})</span>
                  </div>
                  {p.description && (
                    <p className="mt-1 text-xs text-app-text-muted">{p.description}</p>
                  )}
                </div>
                <label className="flex shrink-0 items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={p.enabled}
                    disabled={busyKind === p.kind}
                    onChange={(e) => void update(p.kind, { enabled: e.target.checked })}
                  />
                  <span className="text-app-text-muted">Enabled</span>
                </label>
              </div>
              <PolicyConfigEditor policy={p} busy={busyKind === p.kind} onSave={update} />
            </li>
          ))}
        </ul>
      )}
    </PageLayout>
  );
}

interface PolicyConfigEditorProps {
  policy: TeamPolicyDto;
  busy: boolean;
  onSave: (kind: TeamPolicyKind, body: { config: Record<string, unknown> }) => Promise<void>;
}

function PolicyConfigEditor({ policy, busy, onSave }: PolicyConfigEditorProps) {
  if (policy.kind === "name_pattern") {
    return <NamePatternEditor policy={policy} busy={busy} onSave={onSave} />;
  }
  return null;
}

function NamePatternEditor({ policy, busy, onSave }: PolicyConfigEditorProps) {
  const initialSuffix = String(policy.config.requireSuffix ?? "");
  const initialHyphen = Boolean(policy.config.requireHyphenSeparation);
  const [requireSuffix, setRequireSuffix] = useState(initialSuffix);
  const [requireHyphenSeparation, setRequireHyphenSeparation] = useState(initialHyphen);

  const dirty = requireSuffix !== initialSuffix || requireHyphenSeparation !== initialHyphen;

  return (
    <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
      <label className="flex flex-col">
        <span className="text-app-text-muted">Required suffix</span>
        <input
          type="text"
          value={requireSuffix}
          onChange={(e) => setRequireSuffix(e.target.value)}
          disabled={busy}
          className="mt-1 rounded-md border border-app-border bg-app-surface px-2 py-1 text-app-text"
        />
      </label>
      <label className="flex items-end gap-2">
        <input
          type="checkbox"
          checked={requireHyphenSeparation}
          disabled={busy}
          onChange={(e) => setRequireHyphenSeparation(e.target.checked)}
        />
        <span className="text-app-text-muted">Require hyphen between words</span>
      </label>
      <div className="col-span-2 flex justify-end">
        <button
          type="button"
          disabled={busy || !dirty}
          onClick={() =>
            void onSave(policy.kind, {
              config: { requireSuffix, requireHyphenSeparation },
            })
          }
          className="rounded-md bg-app-primary px-3 py-1 text-app-primary-on disabled:opacity-50"
        >
          Save config
        </button>
      </div>
    </div>
  );
}
