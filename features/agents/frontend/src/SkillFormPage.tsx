// Admin form to create or edit a skill: a named bundle of registry tools plus optional model guidance.
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { PageLayout } from "@internal/shared-ui";
import { useTranslation } from "@internal/i18n";
import type { AgentToolGroup } from "@feature/agents-shared";
import { useAgentsApi } from "./client";

export function SkillFormPage() {
  const api = useAgentsApi();
  const navigate = useNavigate();
  const { t } = useTranslation("agents");
  const { id } = useParams<{ id?: string }>();
  const isEdit = Boolean(id);

  const [toolGroups, setToolGroups] = useState<AgentToolGroup[]>([]);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [guidance, setGuidance] = useState("");
  const [toolIds, setToolIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEdit);

  useEffect(() => {
    api.agents
      .listTools()
      .then((res) => setToolGroups(res.groups))
      .catch(() => {});
  }, [api]);

  useEffect(() => {
    if (!isEdit || !id) return;
    api.skills
      .get(id)
      .then((s) => {
        setLabel(s.label);
        setDescription(s.description ?? "");
        setGuidance(s.guidance ?? "");
        setToolIds(s.toolIds);
      })
      .catch((err) => setError(err.message ?? t("errors.failedToLoadSkills")))
      .finally(() => setLoading(false));
  }, [api, id, isEdit, t]);

  function toggleTool(tid: string) {
    setToolIds((prev) => (prev.includes(tid) ? prev.filter((x) => x !== tid) : [...prev, tid]));
  }

  function toggleGroup(group: AgentToolGroup) {
    const ids = group.tools.map((tool) => tool.id);
    const allSelected = ids.every((gid) => toolIds.includes(gid));
    setToolIds((prev) => {
      if (allSelected) return prev.filter((gid) => !ids.includes(gid));
      const next = new Set(prev);
      ids.forEach((gid) => next.add(gid));
      return [...next];
    });
  }

  function toggleGroupOpen(groupId: string) {
    setOpenGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
  }

  async function save() {
    setError(null);
    if (!label.trim()) return setError(t("errors.skillNameRequired"));
    const body = {
      label: label.trim(),
      description: description.trim() || null,
      guidance: guidance.trim() || null,
      toolIds,
    };
    setSaving(true);
    try {
      if (isEdit && id) {
        await api.skills.update(id, body);
      } else {
        await api.skills.create(body);
      }
      navigate("/skills");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.saveSkillFailed"));
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <PageLayout title={isEdit ? t("skills.editTitle") : t("skills.newTitle")}>
        <p className="text-sm text-app-text-muted">{t("loading.agent")}</p>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title={isEdit ? t("skills.editTitle") : t("skills.newTitle")}
      description={t("skills.formDescription")}
    >
      {error && (
        <div className="mb-4 rounded-md border border-app-danger bg-app-surface px-3 py-2 text-sm text-app-danger">
          {error}
        </div>
      )}

      <div className="grid max-w-2xl gap-4">
        <Labeled label={t("skills.fields.label")} required>
          <input value={label} onChange={(e) => setLabel(e.target.value)} className={inputCls} />
        </Labeled>

        <Labeled label={t("skills.fields.description")}>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={inputCls}
          />
        </Labeled>

        <Labeled label={t("skills.fields.guidance")}>
          <textarea
            value={guidance}
            onChange={(e) => setGuidance(e.target.value)}
            rows={3}
            className={`${inputCls} resize-y`}
          />
          <p className="mt-1 text-xs text-app-text-muted">{t("skills.guidanceHint")}</p>
        </Labeled>

        <Labeled label={t("skills.fields.tools")}>
          {toolGroups.length === 0 ? (
            <p className="text-xs text-app-text-muted">{t("empty.noSkillsRegistered")}</p>
          ) : (
            <div className="grid gap-2">
              {toolGroups.map((group) => {
                const ids = group.tools.map((tool) => tool.id);
                const selectedCount = ids.filter((gid) => toolIds.includes(gid)).length;
                const allSelected = ids.length > 0 && selectedCount === ids.length;
                const someSelected = selectedCount > 0 && !allSelected;
                const open = Boolean(openGroups[group.id]);
                return (
                  <div
                    key={group.id}
                    className="overflow-hidden rounded-md border border-app-border"
                  >
                    <div className="flex items-start gap-2 bg-app-surface px-2 py-1.5">
                      <TristateCheckbox
                        checked={allSelected}
                        indeterminate={someSelected}
                        onChange={() => toggleGroup(group)}
                      />
                      <button
                        type="button"
                        onClick={() => toggleGroupOpen(group.id)}
                        aria-expanded={open}
                        className="flex flex-1 items-start gap-2 text-left text-sm font-medium text-app-text"
                      >
                        <span className="mt-0.5 w-3 shrink-0 text-xs text-app-text-muted">
                          {open ? "▾" : "▸"}
                        </span>
                        <span>
                          {t(`toolGroups.${group.id}.label`)}
                          <span className="ml-1 text-xs font-normal text-app-text-muted">
                            ({selectedCount}/{ids.length})
                          </span>
                        </span>
                      </button>
                    </div>
                    {open && (
                      <div className="grid gap-1.5 border-t border-app-border px-2 py-2">
                        {group.tools.map((tool) => (
                          <label
                            key={tool.id}
                            className="flex items-start gap-2 text-sm text-app-text"
                          >
                            <input
                              type="checkbox"
                              checked={toolIds.includes(tool.id)}
                              onChange={() => toggleTool(tool.id)}
                              className="mt-0.5 text-app-primary focus:ring-app-primary"
                            />
                            <span>
                              <span className="font-mono text-xs">{tool.id}</span>
                              {tool.description && (
                                <span className="block text-xs text-app-text-muted">
                                  {tool.description}
                                </span>
                              )}
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Labeled>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => navigate("/skills")}
            className="rounded-md border border-app-border bg-app-surface px-3 py-1.5 text-sm text-app-text hover:bg-app-surface-hover"
          >
            {t("actions.cancel")}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void save()}
            className="rounded-md bg-app-primary px-3 py-1.5 text-sm font-medium text-app-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {saving ? t("actions.saving") : isEdit ? t("actions.saveChanges") : t("skills.create")}
          </button>
        </div>
      </div>
    </PageLayout>
  );
}

const inputCls =
  "w-full rounded-md border border-app-border bg-app-surface px-2 py-1.5 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-app-primary";

// Native checkboxes can't show the indeterminate state via props, so set it on the DOM node.
function TristateCheckbox({
  checked,
  indeterminate,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      className="mt-0.5 text-app-primary focus:ring-app-primary"
    />
  );
}

function Labeled({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-app-text-muted">
        {label}
        {required && <span className="text-app-danger"> *</span>}
      </span>
      {children}
    </label>
  );
}
