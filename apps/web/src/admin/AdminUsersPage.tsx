import { useCallback, useEffect, useState } from "react";
import { PageLayout } from "@internal/shared-ui";
import { useApi } from "@internal/api-client/react";
import type { AdminUserRow, UserRole, UserStatus } from "@internal/shared-types";
import { useCurrentUser } from "../auth";
import { ProfileAvatar } from "../profile";

export function AdminUsersPage() {
  const client = useApi();
  const me = useCurrentUser();
  const [rows, setRows] = useState<AdminUserRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await client.adminUsers.list();
      setRows(res.items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users");
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  async function patch(id: string, patch: { role?: UserRole; status?: UserStatus }) {
    setSavingId(id);
    try {
      const updated = await client.adminUsers.update(id, patch);
      setRows((prev) => prev?.map((r) => (r.id === id ? updated : r)) ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setSavingId(null);
    }
  }

  async function remove(u: AdminUserRow) {
    if (
      !window.confirm(
        `Delete ${u.displayName} (@${u.githubLogin}) permanently? This cannot be undone.`,
      )
    ) {
      return;
    }
    setSavingId(u.id);
    try {
      await client.adminUsers.delete(u.id);
      setRows((prev) => prev?.filter((r) => r.id !== u.id) ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setSavingId(null);
    }
  }

  if (me.role !== "admin") {
    return (
      <PageLayout title="Users" description="Admin only.">
        <div className="text-sm text-app-text-muted">
          You need the <strong>admin</strong> role to view this page.
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout title="Users" description="Manage who can access the platform.">
      {error && (
        <div className="mb-4 rounded-md border border-app-danger bg-app-surface px-3 py-2 text-sm text-app-danger">
          {error}
        </div>
      )}

      {!rows ? (
        <div className="text-sm text-app-text-muted">Loading…</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-app-border bg-app-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-app-border">
              <tr className="text-left text-xs uppercase tracking-wide text-app-text-muted">
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">GitHub</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Last login</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id} className="border-t border-app-border">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <ProfileAvatar name={u.displayName} avatarUrl={u.avatarUrl} size="sm" />
                      <div className="min-w-0">
                        <div className="truncate text-app-text">{u.displayName}</div>
                        <div className="truncate text-xs text-app-text-muted">{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-app-text-muted">@{u.githubLogin}</td>
                  <td className="px-4 py-3">
                    <select
                      value={u.role}
                      disabled={savingId === u.id}
                      onChange={(e) => void patch(u.id, { role: e.target.value as UserRole })}
                      className="rounded-md border border-app-border bg-app-surface px-2 py-1 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-app-primary"
                    >
                      <option value="admin">admin</option>
                      <option value="member">member</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        u.status === "active"
                          ? "bg-app-success/10 text-app-success"
                          : "bg-app-danger/10 text-app-danger"
                      }`}
                    >
                      {u.status === "active" ? "Active" : "Disabled"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-app-text-muted">
                    {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        disabled={savingId === u.id || u.id === me.id}
                        title={
                          u.id === me.id
                            ? "You can't change your own status"
                            : u.status === "active"
                              ? "Disable this account"
                              : "Re-enable this account"
                        }
                        onClick={() =>
                          void patch(u.id, {
                            status: u.status === "active" ? "disabled" : "active",
                          })
                        }
                        className="rounded-md border border-app-border bg-app-surface px-2.5 py-1 text-xs text-app-text transition-colors hover:bg-app-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {u.status === "active" ? "Disable" : "Enable"}
                      </button>
                      <button
                        type="button"
                        disabled={savingId === u.id || u.id === me.id}
                        title={
                          u.id === me.id ? "You can't delete your own account" : "Delete this user"
                        }
                        onClick={() => void remove(u)}
                        className="rounded-md border border-app-danger/40 bg-app-surface px-2.5 py-1 text-xs text-app-danger transition-colors hover:bg-app-danger hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageLayout>
  );
}
