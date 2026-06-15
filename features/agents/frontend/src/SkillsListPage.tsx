import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PageLayout, ConfirmDialog } from "@internal/shared-ui";
import { useApi } from "@internal/api-client/react";
import { useTranslation } from "@internal/i18n";
import type { CurrentUser, SkillSummary } from "@internal/shared-types";

export function SkillsListPage() {
  const api = useApi();
  const { t } = useTranslation("agents");
  const [items, setItems] = useState<SkillSummary[] | null>(null);
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<SkillSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

  const isAdmin = me?.role === "admin";

  const load = useCallback(() => {
    api.skills
      .list()
      .then((res) => setItems(res.items))
      .catch((err) => setError(err.message ?? t("errors.failedToLoadSkills")));
  }, [api, t]);

  useEffect(() => {
    load();
    api.auth
      .me()
      .then(setMe)
      .catch(() => setMe(null));
  }, [api, load]);

  async function onDelete() {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      await api.skills.delete(confirmDelete.id);
      setConfirmDelete(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.deleteSkillFailed"));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <PageLayout
      title={t("skills.title")}
      description={t("skills.description")}
      actions={
        isAdmin ? (
          <Link
            to="/skills/new"
            className="rounded-md bg-app-primary px-3 py-1.5 text-sm font-medium text-app-primary-foreground hover:opacity-90"
          >
            + {t("skills.new")}
          </Link>
        ) : undefined
      }
    >
      {error && <p className="mb-4 text-sm text-app-danger">{error}</p>}
      {!error && items === null && (
        <p className="text-sm text-app-text-muted">{t("loading.agents")}</p>
      )}
      {items && items.length === 0 && (
        <p className="text-sm text-app-text-muted">{t("skills.empty")}</p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items?.map((skill) => (
          <div
            key={skill.id}
            className="relative rounded-lg border border-app-border bg-app-surface p-4"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-medium text-app-text">{skill.label}</div>
                <div className="text-xs text-app-text-muted">
                  {t("skills.toolCount", { count: skill.tools.length })}
                </div>
              </div>
              {skill.builtin && (
                <span className="shrink-0 rounded-full border border-app-border px-2 py-0.5 text-[10px] uppercase tracking-wide text-app-text-muted">
                  {t("skills.builtin")}
                </span>
              )}
            </div>
            {skill.description && (
              <p className="mt-2 line-clamp-2 text-xs text-app-text-muted">{skill.description}</p>
            )}
            {isAdmin && (
              <div className="mt-3 flex gap-2">
                <Link
                  to={`/skills/${skill.id}/edit`}
                  className="rounded-md border border-app-border bg-app-surface px-2.5 py-1 text-xs text-app-text hover:bg-app-surface-hover"
                >
                  {t("actions.edit")}
                </Link>
                {!skill.builtin && (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(skill)}
                    className="rounded-md border border-app-danger px-2.5 py-1 text-xs text-app-danger hover:bg-app-danger/10"
                  >
                    {t("actions.delete")}
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <ConfirmDialog
        open={confirmDelete !== null}
        title={t("skills.deleteTitle")}
        message={t("skills.deleteMessage", { name: confirmDelete?.label ?? "" })}
        confirmLabel={t("confirm.deleteLabel")}
        destructive
        busy={deleting}
        onConfirm={() => void onDelete()}
        onClose={() => setConfirmDelete(null)}
      />
    </PageLayout>
  );
}
