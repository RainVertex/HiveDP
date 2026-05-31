// Team detail page: member management, role changes, ownership transfer, and maintainer requests.
import { useCallback, useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { PageLayout } from "@internal/shared-ui";
import { useApi } from "@internal/api-client/react";
import type {
  CurrentUser,
  MaintainerRequestDto,
  TeamDetail,
  TeamMemberRole,
  TeamSummary,
  UserSummary,
} from "@internal/shared-types";
import { UserPicker } from "./UserPicker";
import { RequestMaintainerDialog } from "./RequestMaintainerDialog";

export function TeamDetailPage() {
  const { slug = "" } = useParams<{ slug: string }>();
  const api = useApi();
  const navigate = useNavigate();
  const [team, setTeam] = useState<TeamDetail | null>(null);
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [transferTarget, setTransferTarget] = useState<string>("");
  const [allTeams, setAllTeams] = useState<TeamSummary[]>([]);
  const [pendingMaintainerRequest, setPendingMaintainerRequest] =
    useState<MaintainerRequestDto | null>(null);
  const [maintainerDialogOpen, setMaintainerDialogOpen] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api.teams.get(slug);
      setTeam(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    }
  }, [api, slug]);

  const loadMyMaintainerRequest = useCallback(
    async (currentSlug: string) => {
      try {
        const r = await api.maintainerRequests.list();
        const open =
          r.items.find((m) => m.teamSlug === currentSlug && m.status === "pending") ?? null;
        setPendingMaintainerRequest(open);
      } catch {
        setPendingMaintainerRequest(null);
      }
    },
    [api],
  );

  useEffect(() => {
    void load();
    void loadMyMaintainerRequest(slug);
    api.auth
      .me()
      .then(setMe)
      .catch(() => setMe(null));
    api.teams
      .list()
      .then((r) => setAllTeams(r.items))
      .catch(() => setAllTeams([]));
  }, [api, load, loadMyMaintainerRequest, slug]);

  if (error) {
    return (
      <PageLayout title="Team">
        <p className="text-sm text-app-danger">{error}</p>
      </PageLayout>
    );
  }
  if (!team || !me) {
    return (
      <PageLayout title="Team">
        <p className="text-sm text-app-text-muted">Loading…</p>
      </PageLayout>
    );
  }

  const isAdmin = me.role === "admin";
  const myMembership = team.members.find((m) => m.userId === me.id) ?? null;
  const isLead = myMembership?.role === "lead";
  const canManage = isAdmin || isLead;
  // Admins promote via the role-picker, leads are already maintainers, non-members cannot request.
  const canRequestMaintainer = !!myMembership && !isLead && !isAdmin;

  async function addMember(user: UserSummary) {
    setBusy(true);
    try {
      const updated = await api.teams.addMember(team!.slug, { userId: user.id });
      setTeam(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Add failed");
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(userId: string, role: TeamMemberRole) {
    setBusy(true);
    try {
      const updated = await api.teams.setMemberRole(team!.slug, userId, role);
      setTeam(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(userId: string) {
    setBusy(true);
    try {
      await api.teams.removeMember(team!.slug, userId);
      if (userId === me!.id) {
        navigate("/teams");
        return;
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Remove failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleTransfer() {
    if (!transferTarget || transferTarget === team!.slug) return;
    setBusy(true);
    try {
      const result = await api.teams.transferOwnership(team!.slug, transferTarget);
      alert(`Transferred ${result.entityCount} entities to ${result.to.slug}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transfer failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Soft-delete "${team!.name}"? It can be restored within 30 days.`)) return;
    setBusy(true);
    try {
      await api.teams.delete(team!.slug);
      navigate("/teams");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageLayout
      title={team.name}
      description={team.description ?? team.slug}
      actions={
        <>
          {canRequestMaintainer && !pendingMaintainerRequest && (
            <button
              type="button"
              onClick={() => setMaintainerDialogOpen(true)}
              disabled={busy}
              className="rounded-md border border-app-border px-3 py-1 text-sm text-app-text hover:bg-app-surface-hover"
            >
              Request to become maintainer
            </button>
          )}
          {canRequestMaintainer && pendingMaintainerRequest && (
            <span className="rounded-md border border-app-border px-3 py-1 text-sm text-app-text-muted">
              Maintainer request pending
            </span>
          )}
          {canManage && isAdmin && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={busy}
              className="rounded-md border border-app-danger px-3 py-1 text-sm text-app-danger hover:bg-app-surface-hover"
            >
              Delete
            </button>
          )}
        </>
      }
    >
      {error && <p className="mb-3 text-sm text-app-danger">{error}</p>}

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold text-app-text">
          Members ({team.members.length})
        </h2>
        <ul className="divide-y divide-app-border rounded-lg border border-app-border bg-app-surface">
          {team.members.map((m) => {
            const isSelf = m.userId === me.id;
            return (
              <li key={m.userId} className="flex items-center justify-between px-4 py-2 text-sm">
                <div className="min-w-0">
                  <div className="text-app-text">{m.displayName}</div>
                  <div className="text-xs text-app-text-muted">{m.email}</div>
                </div>
                <div className="flex items-center gap-2">
                  {canManage && !isSelf ? (
                    <select
                      value={m.role}
                      disabled={busy}
                      onChange={(e) => void changeRole(m.userId, e.target.value as TeamMemberRole)}
                      className="rounded-md border border-app-border bg-app-surface px-2 py-1 text-xs"
                    >
                      <option value="lead">lead</option>
                      <option value="member">member</option>
                    </select>
                  ) : (
                    <span className="rounded bg-app-surface-hover px-2 py-0.5 text-xs">
                      {m.role}
                    </span>
                  )}
                  {(canManage || isSelf) && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void removeMember(m.userId)}
                      className="text-xs text-app-text-muted hover:text-app-danger"
                    >
                      {isSelf ? "Leave" : "Remove"}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {canManage && (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-semibold text-app-text">Add a member</h2>
          <UserPicker
            excludeIds={team.members.map((m) => m.userId)}
            onSelect={addMember}
            disabled={busy}
          />
        </section>
      )}

      <RequestMaintainerDialog
        open={maintainerDialogOpen}
        teamSlug={team.slug}
        teamName={team.name}
        onClose={() => setMaintainerDialogOpen(false)}
        onSubmitted={(req) => {
          setPendingMaintainerRequest(req);
        }}
      />

      {canManage && (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-semibold text-app-text">Transfer ownership</h2>
          <p className="mb-2 text-xs text-app-text-muted">
            Move all catalog entities and projects owned by this team to another team. Required
            before deletion if this team owns resources.
          </p>
          <div className="flex gap-2 text-sm">
            <select
              value={transferTarget}
              onChange={(e) => setTransferTarget(e.target.value)}
              disabled={busy}
              className="rounded-md border border-app-border bg-app-surface px-2 py-1"
            >
              <option value="">— Select target team —</option>
              {allTeams
                .filter((t) => t.slug !== team.slug)
                .map((t) => (
                  <option key={t.id} value={t.slug}>
                    {t.name}
                  </option>
                ))}
            </select>
            <button
              type="button"
              onClick={handleTransfer}
              disabled={busy || !transferTarget}
              className="rounded-md bg-app-primary px-3 py-1 text-app-primary-on disabled:opacity-50"
            >
              Transfer
            </button>
          </div>
        </section>
      )}
    </PageLayout>
  );
}
