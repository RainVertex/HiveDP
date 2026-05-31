// Shared edit form body for team-request proposals plus its API error mapper.
import { useEffect, useMemo, useState } from "react";
import { ApiError } from "@internal/api-client";
import { useApi } from "@internal/api-client/react";
import type {
  GithubInstallationSummary,
  TeamPolicyViolation,
  TeamRequestDto,
} from "@internal/shared-types";

export type RequestEdit = {
  slug?: string;
  name?: string;
  description?: string | null;
  mirrorToGithub?: boolean;
  githubIntegrationId?: string | null;
};

interface RequestEditFormProps {
  request: TeamRequestDto;
  busy: boolean;
  // Round this submission lands on; >3 means the next edit auto-cancels.
  nextRound: number;
  onSubmit: (edit: RequestEdit) => Promise<void>;
  onCancel: () => void;
  submitLabel: string;
  error: { message: string; policyViolation: TeamPolicyViolation | null } | null;
}

export function RequestEditForm(props: RequestEditFormProps) {
  const { request, busy, nextRound, onSubmit, onCancel, submitLabel, error } = props;
  const api = useApi();

  const [slug, setSlug] = useState(request.slug);
  const [name, setName] = useState(request.name);
  const [description, setDescription] = useState(request.description ?? "");
  const [mirrorToGithub, setMirrorToGithub] = useState(request.mirrorToGithub);
  const [githubIntegrationId, setGithubIntegrationId] = useState(request.githubIntegrationId ?? "");

  const [installations, setInstallations] = useState<GithubInstallationSummary[]>([]);
  const [installationsLoaded, setInstallationsLoaded] = useState(false);

  useEffect(() => {
    api.integrations
      .githubInstallations()
      .then((res) => setInstallations(res.items))
      .catch(() => setInstallations([]))
      .finally(() => setInstallationsLoaded(true));
  }, [api]);

  const slugError = error?.policyViolation?.field === "slug" ? error.policyViolation.message : null;
  const nameError = error?.policyViolation?.field === "name" ? error.policyViolation.message : null;
  const generalError = error && !error.policyViolation ? error.message : null;

  const canSubmit = useMemo(() => {
    if (!slug || !name) return false;
    if (mirrorToGithub && !githubIntegrationId) return false;
    return !busy;
  }, [busy, mirrorToGithub, githubIntegrationId, slug, name]);

  const aboutToAutoCancel = nextRound > 3;

  async function handleSubmit() {
    const edit: RequestEdit = {};
    if (slug !== request.slug) edit.slug = slug;
    if (name !== request.name) edit.name = name;
    if ((description || null) !== (request.description ?? null)) {
      edit.description = description || null;
    }
    if (mirrorToGithub !== request.mirrorToGithub) edit.mirrorToGithub = mirrorToGithub;
    const nextIntegration = mirrorToGithub ? githubIntegrationId : null;
    if ((nextIntegration || null) !== (request.githubIntegrationId ?? null)) {
      edit.githubIntegrationId = nextIntegration;
    }
    await onSubmit(edit);
  }

  return (
    <div className="mt-4 space-y-3 text-sm">
      {aboutToAutoCancel && (
        <div className="rounded-md border border-app-danger/40 bg-app-danger/10 px-3 py-2 text-xs text-app-danger">
          This will be the {nextRound}th edit and exceeds the 3-round negotiation cap. Submitting
          will auto-cancel the request and notify both parties.
        </div>
      )}

      <label className="block">
        <span className="text-xs text-app-text-muted">Team name</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
          className="mt-1 w-full rounded-md border border-app-border bg-app-surface px-2 py-1 text-app-text"
        />
        {nameError && <p className="mt-1 text-xs text-app-danger">{nameError}</p>}
      </label>

      <label className="block">
        <span className="text-xs text-app-text-muted">Slug</span>
        <input
          type="text"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          disabled={busy}
          className="mt-1 w-full rounded-md border border-app-border bg-app-surface px-2 py-1 text-app-text"
        />
        {slugError && <p className="mt-1 text-xs text-app-danger">{slugError}</p>}
      </label>

      <label className="block">
        <span className="text-xs text-app-text-muted">Description</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={busy}
          rows={3}
          className="mt-1 w-full rounded-md border border-app-border bg-app-surface px-2 py-1 text-app-text"
        />
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={mirrorToGithub}
          onChange={(e) => setMirrorToGithub(e.target.checked)}
          disabled={busy}
        />
        <span className="text-app-text">Mirror to GitHub?</span>
      </label>

      {mirrorToGithub && (
        <label className="block">
          <span className="text-xs text-app-text-muted">Which GitHub org?</span>
          <select
            value={githubIntegrationId}
            onChange={(e) => setGithubIntegrationId(e.target.value)}
            disabled={busy || !installationsLoaded || installations.length === 0}
            className="mt-1 w-full rounded-md border border-app-border bg-app-surface px-2 py-1 text-app-text"
          >
            <option value="">— Select an org —</option>
            {installations.map((i) => (
              <option key={i.integrationId} value={i.integrationId}>
                {i.accountLogin} ({i.name})
              </option>
            ))}
          </select>
          {installationsLoaded && installations.length === 0 && (
            <p className="mt-1 text-xs text-app-text-muted">
              No active GitHub integrations connected.
            </p>
          )}
        </label>
      )}

      {generalError && <div className="text-xs text-app-danger">{generalError}</div>}

      <div className="mt-5 flex justify-end gap-2 text-sm">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-md px-3 py-1 text-app-text-muted hover:bg-app-surface-hover"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="rounded-md bg-app-primary px-3 py-1 text-app-primary-on disabled:opacity-50"
        >
          {busy ? "Submitting…" : submitLabel}
        </button>
      </div>
    </div>
  );
}

export function toEditError(err: unknown): {
  message: string;
  policyViolation: TeamPolicyViolation | null;
} {
  if (err instanceof ApiError) {
    if (err.status === 422 && /slug must/i.test(err.message)) {
      return {
        message: err.message,
        policyViolation: { policyKind: "name_pattern", field: "slug", message: err.message },
      };
    }
    return { message: err.message, policyViolation: null };
  }
  return {
    message: err instanceof Error ? err.message : "Submission failed",
    policyViolation: null,
  };
}
