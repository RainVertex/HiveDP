// Datasource picker for the Grafana connect/configure flows (Prometheus required, Loki/Tempo optional).

export interface DatasourceCandidate {
  uid: string;
  name: string;
  isDefault: boolean;
}

export function pickDefaultUid(candidates: DatasourceCandidate[]): string {
  if (candidates.length === 0) return "";
  const flagged = candidates.find((c) => c.isDefault);
  return (flagged ?? candidates[0]).uid;
}

export function DatasourceSelect({
  label,
  value,
  onChange,
  candidates,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  candidates: DatasourceCandidate[];
  required?: boolean;
}) {
  if (candidates.length === 0) {
    return (
      <div className="text-xs">
        <span className="text-app-text-muted">{label}</span>
        <p className="mt-1 rounded border border-dashed border-app-border px-2 py-1.5 text-app-text-muted">
          No datasource of this type configured in Grafana
          {required ? " — cannot continue without one" : " — leaving this feature disabled"}.
        </p>
      </div>
    );
  }
  return (
    <label className="block text-xs">
      <span className="text-app-text-muted">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 block w-full rounded border border-app-border bg-app-bg px-2 py-1.5 text-sm text-app-text"
      >
        {!required && <option value="">(none)</option>}
        {candidates.map((c) => (
          <option key={c.uid} value={c.uid}>
            {c.name}
            {c.isDefault ? " (default)" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
