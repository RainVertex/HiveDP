import { useEffect, useMemo, useState } from "react";
import { ApiError } from "@internal/api-client";
import { useApi } from "@internal/api-client/react";
import type {
  GithubInstallationSummary,
  TeamPolicyViolation,
  UserSummary,
} from "@internal/shared-types";
import { UserPicker } from "./UserPicker";

// Shared "Request a team" form body, used by both the dialog and the full page.
export interface RequestTeamFormProps {
  // createdTeamSlug is almost always null since requests need approval first.
  onSubmitted: (createdTeamSlug: string | null) => void;
  onCancel?: () => void;
  variant?: "dialog" | "page";
}

interface SubmitError {
  message: string;
  policyViolation: TeamPolicyViolation | null;
}

export function RequestTeamForm({
  onSubmitted,
  onCancel,
  variant = "dialog",
}: RequestTeamFormProps) {
  const api = useApi();
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [mirrorToGithub, setMirrorToGithub] = useState(false);
  const [installations, setInstallations] = useState<GithubInstallationSummary[]>([]);
  const [installationsLoaded, setInstallationsLoaded] = useState(false);
  const [githubIntegrationId, setGithubIntegrationId] = useState("");
  const [pickedMaintainers, setPickedMaintainers] = useState<UserSummary[]>([]);
  const [pickedMembers, setPickedMembers] = useState<UserSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SubmitError | null>(null);

  useEffect(() => {
    setInstallationsLoaded(false);
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

  async function handleSubmit() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.teamRequests.submit({
        slug,
        name,
        description: description || undefined,
        mirrorToGithub,
        githubIntegrationId: mirrorToGithub ? githubIntegrationId : undefined,
        proposedMaintainerUserIds: pickedMaintainers.map((u) => u.id),
        proposedMemberUserIds: pickedMembers.map((u) => u.id),
      });
      onSubmitted(res.createdTeamSlug ?? null);
    } catch (err) {
      setError(toSubmitError(err));
    } finally {
      setBusy(false);
    }
  }

  // A user appears once across both lists; picking in one moves them out of the other.
  const excludeIds = useMemo(
    () => [...pickedMaintainers.map((u) => u.id), ...pickedMembers.map((u) => u.id)],
    [pickedMaintainers, pickedMembers],
  );
  function addMaintainer(u: UserSummary) {
    setPickedMaintainers((prev) => (prev.some((p) => p.id === u.id) ? prev : [...prev, u]));
    setPickedMembers((prev) => prev.filter((p) => p.id !== u.id));
  }
  function addMember(u: UserSummary) {
    setPickedMembers((prev) => (prev.some((p) => p.id === u.id) ? prev : [...prev, u]));
    setPickedMaintainers((prev) => prev.filter((p) => p.id !== u.id));
  }
  function removeMaintainer(id: string) {
    setPickedMaintainers((prev) => prev.filter((u) => u.id !== id));
  }
  function removeMember(id: string) {
    setPickedMembers((prev) => prev.filter((u) => u.id !== id));
  }

  const inputClass =
    "mt-1 w-full rounded-md border border-app-border bg-app-surface px-2 py-1 text-app-text";

  return (
    <div className={variant === "page" ? "max-w-xl space-y-4 text-sm" : "space-y-3 text-sm"}>
      <label className="block">
        <span className="text-xs text-app-text-muted">Team name</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My new team"
          disabled={busy}
          className={inputClass}
        />
        {nameError && <p className="mt-1 text-xs text-app-danger">{nameError}</p>}
      </label>

      <label className="block">
        <span className="text-xs text-app-text-muted">Slug</span>
        <input
          type="text"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="data-platform-team"
          disabled={busy}
          className={inputClass}
        />
        {slugError && <p className="mt-1 text-xs text-app-danger">{slugError}</p>}
      </label>

      <label className="block">
        <span className="text-xs text-app-text-muted">Description (optional)</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={busy}
          rows={3}
          className={inputClass}
        />
      </label>

      <section className="space-y-2">
        <div>
          <div className="text-xs text-app-text-muted">Maintainers (optional)</div>
          {pickedMaintainers.length > 0 && (
            <ul className="mt-1 flex flex-wrap gap-1">
              {pickedMaintainers.map((u) => (
                <UserChip
                  key={u.id}
                  user={u}
                  disabled={busy}
                  onRemove={() => removeMaintainer(u.id)}
                />
              ))}
            </ul>
          )}
          <div className="mt-1">
            <UserPicker
              excludeIds={excludeIds}
              onSelect={addMaintainer}
              placeholder="Add a maintainer…"
              disabled={busy}
            />
          </div>
        </div>

        <div>
          <div className="text-xs text-app-text-muted">Members (optional)</div>
          {pickedMembers.length > 0 && (
            <ul className="mt-1 flex flex-wrap gap-1">
              {pickedMembers.map((u) => (
                <UserChip key={u.id} user={u} disabled={busy} onRemove={() => removeMember(u.id)} />
              ))}
            </ul>
          )}
          <div className="mt-1">
            <UserPicker
              excludeIds={excludeIds}
              onSelect={addMember}
              placeholder="Add a member…"
              disabled={busy}
            />
          </div>
        </div>

        <p className="text-xs text-app-text-muted">
          If you don&apos;t choose any members or maintainer, only you will be added as the
          maintainer.
        </p>
      </section>

      <label className="flex items-center gap-2">
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
            className={inputClass}
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
              No active GitHub integrations connected. Ask an admin to install the GitHub App first.
            </p>
          )}
          {(pickedMaintainers.length > 0 || pickedMembers.length > 0) && (
            <p className="mt-1 text-xs text-app-text-muted">
              Picked users will also be added to the GitHub team. Anyone GitHub can&apos;t add (e.g.
              not in the org and not invitable) will be skipped — the rest will go through.
            </p>
          )}
        </label>
      )}

      {generalError && <div className="text-xs text-app-danger">{generalError}</div>}

      <div className="flex justify-end gap-2 pt-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-md px-3 py-1 text-app-text-muted hover:bg-app-surface-hover"
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={!canSubmit}
          className="rounded-md bg-app-primary px-3 py-1 text-app-primary-on disabled:opacity-50"
        >
          {busy ? "Submitting…" : "Submit"}
        </button>
      </div>
    </div>
  );
}

function toSubmitError(err: unknown): SubmitError {
  if (err instanceof ApiError) {
    return {
      message: err.message,
      policyViolation: readPolicyViolationFromApiError(err),
    };
  }
  return {
    message: err instanceof Error ? err.message : "Submission failed",
    policyViolation: null,
  };
}

interface UserChipProps {
  user: UserSummary;
  onRemove: () => void;
  disabled?: boolean;
}

function UserChip({ user, onRemove, disabled }: UserChipProps) {
  return (
    <li className="inline-flex items-center gap-1 rounded-full border border-app-border bg-app-surface px-2 py-0.5 text-xs text-app-text">
      <span>{user.displayName}</span>
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        aria-label={`Remove ${user.displayName}`}
        className="text-app-text-muted hover:text-app-danger disabled:opacity-50"
      >
        ×
      </button>
    </li>
  );
}

function readPolicyViolationFromApiError(err: ApiError): TeamPolicyViolation | null {
  // api-client surfaces only `error`, so match the validator's slug message shape.
  if (err.status === 422 && /slug must/i.test(err.message)) {
    return { policyKind: "name_pattern", field: "slug", message: err.message };
  }
  return null;
}
