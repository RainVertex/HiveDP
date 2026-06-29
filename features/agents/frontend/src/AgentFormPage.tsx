// Admin form to create or edit an agent (model, prompt, tools, approval mode, limits).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { PageLayout, AgentAvatar } from "@internal/shared-ui";
import { useTranslation } from "@internal/i18n";
import {
  isCodingCapableProviderKind,
  type Agent,
  type ApprovalMode,
  type LlmModelSummary,
  type SkillSummary,
} from "@feature/agents-shared";
import { useAgentsApi } from "./client";
import { fileToAvatarDataUrl } from "./avatarImage";
import { AvatarPickerDialog } from "./AvatarPickerDialog";
import type { AvatarPreset } from "./avatarPresets";

const KIND_OPTIONS: {
  value: string;
  labelKey: "custom" | "catalogEnrichment" | "platformAssistant";
}[] = [
  { value: "custom", labelKey: "custom" },
  { value: "catalog-enrichment", labelKey: "catalogEnrichment" },
  { value: "platform-assistant", labelKey: "platformAssistant" },
];

export function AgentFormPage({ avatarPresets = [] }: { avatarPresets?: AvatarPreset[] }) {
  const api = useAgentsApi();
  const navigate = useNavigate();
  const { t } = useTranslation("agents");
  const { id } = useParams<{ id?: string }>();
  const isEdit = Boolean(id);

  const [models, setModels] = useState<LlmModelSummary[]>([]);
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [recommendedIds, setRecommendedIds] = useState<string[]>([]);
  const [requiresTools, setRequiresTools] = useState(false);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [category, setCategory] = useState("");
  const [kind, setKind] = useState("custom");
  const [runtime, setRuntime] = useState<"chat" | "code">("chat");
  const [instructions, setInstructions] = useState("");
  const [modelId, setModelId] = useState("");
  const [skillIds, setSkillIds] = useState<string[]>([]);
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>("ask");
  const [maxToolCalls, setMaxToolCalls] = useState(10);
  const [tokenBudget, setTokenBudget] = useState<string>("");
  const [temperature, setTemperature] = useState<string>("");
  const [assignableToTasks, setAssignableToTasks] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEdit);

  useEffect(() => {
    api.llm
      .listModels()
      .then((res) => setModels(res.items))
      .catch((err) => setError(err.message ?? t("errors.failedToLoadModels")));
    api.skills
      .list()
      .then((res) => setSkills(res.items))
      .catch(() => {});
    api.agents
      .list()
      .then((res) => {
        const distinct = [
          ...new Set(
            res.items.map((a) => a.category?.trim()).filter((c): c is string => Boolean(c)),
          ),
        ].sort((a, b) => a.localeCompare(b));
        setCategories(distinct);
      })
      .catch(() => {});
  }, [api, t]);

  useEffect(() => {
    if (!isEdit || !id) return;
    api.agents
      .get(id)
      .then((a: Agent) => {
        setName(a.name);
        setDescription(a.description ?? "");
        setAvatarUrl(a.avatarUrl ?? "");
        setCategory(a.category ?? "");
        setKind(a.kind);
        setRuntime(a.runtime === "code" ? "code" : "chat");
        setInstructions(a.instructions);
        setModelId(a.modelId);
        setSkillIds(Array.isArray(a.skillIds) ? a.skillIds : []);
        setApprovalMode(a.approvalMode);
        setMaxToolCalls(a.maxToolCalls);
        setTokenBudget(a.tokenBudget != null ? String(a.tokenBudget) : "");
        setTemperature(a.temperature != null ? String(a.temperature) : "");
        setAssignableToTasks(a.assignableToTasks ?? false);
      })
      .catch((err) => setError(err.message ?? t("errors.failedToLoadAgent")))
      .finally(() => setLoading(false));
  }, [api, id, isEdit, t]);

  const loadRecommendations = useCallback(
    (k: string, rt: "chat" | "code") => {
      api.llm
        .recommendations(k, rt === "code" ? "code" : undefined)
        .then((r) => {
          setRecommendedIds(r.recommendedModelIds);
          setRequiresTools(r.requiresTools);
        })
        .catch(() => {
          setRecommendedIds([]);
          setRequiresTools(false);
        });
    },
    [api],
  );

  useEffect(() => {
    loadRecommendations(kind, runtime);
  }, [kind, runtime, loadRecommendations]);

  // For a fresh coding agent, default the model to the top coding recommendation (GPT-5.5). Only when
  // nothing is chosen yet, so it never overrides an explicit pick or the model loaded when editing.
  useEffect(() => {
    if (runtime === "code" && !modelId && recommendedIds.length > 0) {
      setModelId(recommendedIds[0]);
    }
  }, [runtime, modelId, recommendedIds]);

  const skillsSelected = skillIds.length > 0;

  const sortedModels = useMemo(() => {
    const rank = (m: LlmModelSummary) => (recommendedIds.includes(m.id) ? 0 : 1);
    return [...models].sort((a, b) => rank(a) - rank(b));
  }, [models, recommendedIds]);

  const recommendedNames = useMemo(
    () =>
      recommendedIds
        .map((rid) => models.find((m) => m.id === rid)?.displayName)
        .filter((n): n is string => Boolean(n)),
    [recommendedIds, models],
  );

  const selectedModel = useMemo(
    () => models.find((m) => m.id === modelId) ?? null,
    [models, modelId],
  );

  function toggleSkill(skillId: string) {
    setSkillIds((prev) =>
      prev.includes(skillId) ? prev.filter((s) => s !== skillId) : [...prev, skillId],
    );
  }

  async function onPickAvatar(file: File | undefined) {
    if (!file) return;
    setAvatarError(null);
    try {
      setAvatarUrl(await fileToAvatarDataUrl(file));
    } catch {
      setAvatarError(t("errors.avatarReadError"));
    }
  }

  async function save() {
    setError(null);
    if (!name.trim()) return setError(t("errors.nameRequired"));
    if (!instructions.trim()) return setError(t("errors.systemPromptRequired"));
    if (!modelId) return setError(t("errors.pickModel"));
    const selected = models.find((m) => m.id === modelId);
    if (skillsSelected && selected && !selected.supportsTools) {
      return setError(t("errors.modelNoTools"));
    }
    if (selected && !selected.providerReady) {
      return setError(t("errors.modelProviderNotReady"));
    }
    if (runtime === "code" && selected && !isCodingCapableProviderKind(selected.provider.kind)) {
      return setError(t("errors.codingUnsupportedProvider"));
    }
    const body = {
      name: name.trim(),
      description: description.trim() || undefined,
      avatarUrl: avatarUrl.trim() || null,
      category: category.trim() || null,
      kind,
      runtime,
      modelId,
      instructions: instructions.trim(),
      skillIds,
      approvalMode,
      maxToolCalls,
      tokenBudget: tokenBudget.trim() ? Number(tokenBudget) : null,
      temperature: temperature.trim() ? Number(temperature) : null,
      assignableToTasks,
    };
    setSaving(true);
    try {
      if (isEdit && id) {
        await api.agents.update(id, body);
        navigate(`/agents/${id}`);
      } else {
        const created = await api.agents.create(body);
        navigate(`/agents/${created.id}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.saveFailed"));
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <PageLayout title={isEdit ? t("page.editAgent") : t("page.newAgent")}>
        <p className="text-sm text-app-text-muted">{t("loading.agent")}</p>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title={isEdit ? t("page.editAgent") : t("page.newAgent")}
      description={t("page.formDescription")}
    >
      {error && (
        <div className="mb-4 rounded-md border border-app-danger bg-app-surface px-3 py-2 text-sm text-app-danger">
          {error}
        </div>
      )}

      <div className="grid max-w-2xl gap-4">
        <Labeled label={t("fields.name")} required>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
        </Labeled>

        <Labeled label={t("fields.description")}>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={inputCls}
          />
        </Labeled>

        <Labeled label={t("fields.category")}>
          <CategoryCombobox
            value={category}
            onChange={setCategory}
            options={categories}
            placeholder={t("form.categoryPlaceholder")}
            toggleLabel={t("actions.toggleCategoryList")}
          />
          {categories.length > 0 && (
            <p className="mt-1 text-xs text-app-text-muted">{t("form.categoryHint")}</p>
          )}
        </Labeled>

        <Labeled label={t("fields.avatar")}>
          <div className="flex items-center gap-3">
            <AgentAvatar name={name || "?"} avatarUrl={avatarUrl || null} size={56} />
            <div className="flex flex-col gap-1.5">
              <div className="flex gap-2">
                <label className="cursor-pointer rounded-md border border-app-border bg-app-surface px-3 py-1.5 text-sm text-app-text hover:bg-app-surface-hover">
                  {avatarUrl ? t("actions.changeImage") : t("actions.uploadImage")}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      void onPickAvatar(file);
                    }}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  className="rounded-md border border-app-border bg-app-surface px-3 py-1.5 text-sm text-app-text hover:bg-app-surface-hover"
                >
                  {t("actions.choosePreset")}
                </button>
                {avatarUrl && (
                  <button
                    type="button"
                    onClick={() => setAvatarUrl("")}
                    className="rounded-md border border-app-border bg-app-surface px-3 py-1.5 text-sm text-app-text hover:bg-app-surface-hover"
                  >
                    {t("actions.remove")}
                  </button>
                )}
              </div>
              <p className="text-xs text-app-text-muted">{t("form.avatarHint")}</p>
              {avatarError && <p className="text-xs text-app-danger">{avatarError}</p>}
            </div>
          </div>
          <AvatarPickerDialog
            open={pickerOpen}
            value={avatarUrl}
            presets={avatarPresets}
            onSelect={(src) => {
              setAvatarUrl(src);
              setAvatarError(null);
              setPickerOpen(false);
            }}
            onClose={() => setPickerOpen(false)}
          />
        </Labeled>

        <Labeled label={t("fields.kind")}>
          <select value={kind} onChange={(e) => setKind(e.target.value)} className={inputCls}>
            {KIND_OPTIONS.map((k) => (
              <option key={k.value} value={k.value}>
                {t(`kind.${k.labelKey}`)}
              </option>
            ))}
          </select>
        </Labeled>

        <Labeled label={t("fields.runtime")}>
          <select
            value={runtime}
            onChange={(e) => {
              const next = e.target.value as "chat" | "code";
              setRuntime(next);
              // Skills are a chat-loop concept; a coding agent uses Aider's own tools, so drop them.
              if (next === "code") setSkillIds([]);
            }}
            className={inputCls}
          >
            <option value="chat">{t("runtime.chat")}</option>
            <option value="code">{t("runtime.code")}</option>
          </select>
          <p className="mt-1 text-xs text-app-text-muted">
            {runtime === "code" ? t("runtime.codeHint") : t("runtime.chatHint")}
          </p>
        </Labeled>

        <Labeled label={t("fields.systemPrompt")} required>
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={6}
            className={`${inputCls} resize-y`}
          />
        </Labeled>

        {runtime !== "code" && (
          <Labeled label={t("fields.skills")}>
            {skills.length === 0 ? (
              <p className="text-xs text-app-text-muted">{t("empty.noSkillsRegistered")}</p>
            ) : (
              <div className="grid gap-2">
                {skills.map((skill) => {
                  const selected = skillIds.includes(skill.id);
                  return (
                    <label
                      key={skill.id}
                      className="flex cursor-pointer items-start gap-2 rounded-md border border-app-border bg-app-surface px-2 py-1.5"
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleSkill(skill.id)}
                        className="mt-0.5 text-app-primary focus:ring-app-primary"
                      />
                      <span className="min-w-0">
                        <span className="text-sm font-medium text-app-text">{skill.label}</span>
                        <span className="ml-1 text-xs font-normal text-app-text-muted">
                          ({t("skills.toolCount", { count: skill.tools.length })})
                        </span>
                        {skill.description && (
                          <span className="block text-xs font-normal text-app-text-muted">
                            {skill.description}
                          </span>
                        )}
                        {skill.guidance && (
                          <span className="block text-xs font-normal text-app-text-muted">
                            <span className="font-medium text-app-text">
                              {t("skills.whenToUse")}{" "}
                            </span>
                            {skill.guidance}
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </Labeled>
        )}
        {runtime === "code" && (
          <Labeled label={t("fields.skills")}>
            <p className="text-xs text-app-text-muted">{t("form.codeSkillsNote")}</p>
          </Labeled>
        )}

        <Labeled label={t("fields.model")} required>
          <select value={modelId} onChange={(e) => setModelId(e.target.value)} className={inputCls}>
            <option value="">{t("form.selectModel")}</option>
            {sortedModels.map((m) => {
              const recommended = recommendedIds.includes(m.id);
              const incompatible = skillsSelected && !m.supportsTools;
              const providerNotReady = !m.providerReady;
              const inPerM = formatPer1M(m.costPer1kIn);
              const outPerM = formatPer1M(m.costPer1kOut);
              return (
                <option key={m.id} value={m.id} disabled={incompatible || providerNotReady}>
                  {m.displayName} ({m.provider.displayName})
                  {inPerM && outPerM
                    ? t("form.costSuffix", { in: inPerM, out: outPerM })
                    : t("form.costFreeSuffix")}
                  {recommended ? t("form.recommendedSuffix") : ""}
                  {incompatible ? t("form.noToolSupportSuffix") : ""}
                  {providerNotReady ? t("form.noProviderKeySuffix") : ""}
                </option>
              );
            })}
          </select>
          {selectedModel &&
            (() => {
              const inPerM = formatPer1M(selectedModel.costPer1kIn);
              const outPerM = formatPer1M(selectedModel.costPer1kOut);
              return (
                <p className="mt-1 text-xs text-app-text-muted">
                  {inPerM && outPerM
                    ? t("form.costLine", { in: inPerM, out: outPerM })
                    : t("form.costLineFree")}
                </p>
              );
            })()}
          {recommendedNames.length > 0 && (
            <p className="mt-1 text-xs text-app-text-muted">
              {t("form.recommendedFor", {
                kind: t(`kind.${KIND_OPTIONS.find((k) => k.value === kind)?.labelKey ?? "custom"}`),
                names: recommendedNames.join(", "),
              })}
              {requiresTools ? t("form.requiresTools") : ""}
            </p>
          )}
          {models.length === 0 && (
            <p className="mt-1 text-xs text-app-text-muted">{t("form.noModels")}</p>
          )}
        </Labeled>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Labeled label={t("fields.approvalMode")}>
            <select
              value={approvalMode}
              onChange={(e) => setApprovalMode(e.target.value as ApprovalMode)}
              className={inputCls}
            >
              <option value="ask">{t("form.approvalAsk")}</option>
              <option value="auto">{t("form.approvalAuto")}</option>
            </select>
          </Labeled>
          <Labeled label={t("fields.maxToolCalls")}>
            <input
              type="number"
              min={1}
              max={50}
              value={maxToolCalls}
              onChange={(e) => setMaxToolCalls(Number(e.target.value))}
              className={inputCls}
            />
          </Labeled>
          <Labeled label={t("fields.tokenBudget")}>
            <input
              type="number"
              min={1}
              value={tokenBudget}
              onChange={(e) => setTokenBudget(e.target.value)}
              className={inputCls}
            />
          </Labeled>
          <Labeled label={t("fields.temperature")}>
            <input
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={temperature}
              placeholder={t("form.temperaturePlaceholder")}
              onChange={(e) => setTemperature(e.target.value)}
              className={inputCls}
            />
            <p className="mt-1 text-xs text-app-text-muted">{t("form.temperatureHint")}</p>
          </Labeled>
        </div>

        <Labeled label={t("fields.assignableToTasks")}>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={assignableToTasks}
              onChange={(e) => setAssignableToTasks(e.target.checked)}
              className="h-4 w-4 accent-app-primary"
            />
            <span className="text-sm text-app-text-muted">{t("form.assignableToTasksHint")}</span>
          </label>
        </Labeled>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => navigate(isEdit && id ? `/agents/${id}` : "/agents")}
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
            {saving
              ? t("actions.saving")
              : isEdit
                ? t("actions.saveChanges")
                : t("actions.createAgent")}
          </button>
        </div>
      </div>
    </PageLayout>
  );
}

const inputCls =
  "w-full rounded-md border border-app-border bg-app-surface px-2 py-1.5 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-app-primary";

// Rates are stored per 1K tokens, but the industry convention is to quote per 1M, which also gives
// cleaner whole numbers. Null means a self-hosted model with no per-token cost.
function formatPer1M(costPer1k: number | null): string | null {
  if (costPer1k == null) return null;
  return `$${(costPer1k * 1000).toFixed(2)}`;
}

// Free-text input plus a theme-styled dropdown of existing values (native datalist cannot be themed).
function CategoryCombobox({
  value,
  onChange,
  options,
  placeholder,
  toggleLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder: string;
  toggleLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  const q = value.trim().toLowerCase();
  const filtered = q ? options.filter((o) => o.toLowerCase().includes(q)) : options;

  return (
    <div ref={rootRef} className="relative">
      <input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        placeholder={placeholder}
        className={`${inputCls} ${options.length > 0 ? "pr-8" : ""}`}
      />
      {options.length > 0 && (
        <button
          type="button"
          tabIndex={-1}
          aria-label={toggleLabel}
          onClick={() => setOpen((v) => !v)}
          className="absolute inset-y-0 right-0 flex items-center px-2 text-xs text-app-text-muted"
        >
          ▾
        </button>
      )}
      {open && filtered.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-md border border-app-border bg-app-surface py-1 shadow-lg">
          {filtered.map((o) => (
            <li key={o}>
              <button
                type="button"
                onClick={() => {
                  onChange(o);
                  setOpen(false);
                }}
                className="block w-full px-2 py-1.5 text-left text-sm text-app-text hover:bg-app-surface-hover"
              >
                {o}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
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
