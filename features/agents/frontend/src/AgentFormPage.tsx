// Admin form to create or edit an agent (model, prompt, tools, approval mode, limits).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { PageLayout, AgentAvatar } from "@internal/shared-ui";
import { useApi } from "@internal/api-client/react";
import type {
  Agent,
  AgentToolDescriptor,
  ApprovalMode,
  LlmModelSummary,
} from "@internal/shared-types";
import { fileToAvatarDataUrl } from "./avatarImage";

const KIND_OPTIONS = ["custom", "catalog-enrichment", "platform-assistant"];

export function AgentFormPage() {
  const api = useApi();
  const navigate = useNavigate();
  const { id } = useParams<{ id?: string }>();
  const isEdit = Boolean(id);

  const [models, setModels] = useState<LlmModelSummary[]>([]);
  const [tools, setTools] = useState<AgentToolDescriptor[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [recommendedIds, setRecommendedIds] = useState<string[]>([]);
  const [requiresTools, setRequiresTools] = useState(false);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [category, setCategory] = useState("");
  const [kind, setKind] = useState("custom");
  const [instructions, setInstructions] = useState("");
  const [modelId, setModelId] = useState("");
  const [toolIds, setToolIds] = useState<string[]>([]);
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>("ask");
  const [maxToolCalls, setMaxToolCalls] = useState(10);
  const [tokenBudget, setTokenBudget] = useState<string>("");
  const [temperature, setTemperature] = useState<string>("");

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEdit);

  useEffect(() => {
    api.llm
      .listModels()
      .then((res) => setModels(res.items))
      .catch((err) => setError(err.message ?? "Failed to load models"));
    api.agents
      .listTools()
      .then((res) => setTools(res.items))
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
  }, [api]);

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
        setInstructions(a.instructions);
        setModelId(a.modelId);
        setToolIds(Array.isArray(a.toolIds) ? a.toolIds : []);
        setApprovalMode(a.approvalMode);
        setMaxToolCalls(a.maxToolCalls);
        setTokenBudget(a.tokenBudget != null ? String(a.tokenBudget) : "");
        setTemperature(a.temperature != null ? String(a.temperature) : "");
      })
      .catch((err) => setError(err.message ?? "Failed to load agent"))
      .finally(() => setLoading(false));
  }, [api, id, isEdit]);

  const loadRecommendations = useCallback(
    (k: string) => {
      api.llm
        .recommendations(k)
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
    loadRecommendations(kind);
  }, [kind, loadRecommendations]);

  const toolsSelected = toolIds.length > 0;

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

  function toggleTool(tid: string) {
    setToolIds((prev) => (prev.includes(tid) ? prev.filter((t) => t !== tid) : [...prev, tid]));
  }

  async function onPickAvatar(file: File | undefined) {
    if (!file) return;
    setAvatarError(null);
    try {
      setAvatarUrl(await fileToAvatarDataUrl(file));
    } catch {
      setAvatarError("Could not read that image. Try a different file.");
    }
  }

  async function save() {
    setError(null);
    if (!name.trim()) return setError("Name is required.");
    if (!instructions.trim()) return setError("System prompt is required.");
    if (!modelId) return setError("Pick a model.");
    const selected = models.find((m) => m.id === modelId);
    if (toolsSelected && selected && !selected.supportsTools) {
      return setError("The selected model does not support tools. Pick a tool-capable model.");
    }
    const body = {
      name: name.trim(),
      description: description.trim() || undefined,
      avatarUrl: avatarUrl.trim() || null,
      category: category.trim() || null,
      kind,
      modelId,
      instructions: instructions.trim(),
      toolIds,
      approvalMode,
      maxToolCalls,
      tokenBudget: tokenBudget.trim() ? Number(tokenBudget) : null,
      temperature: temperature.trim() ? Number(temperature) : null,
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
      setError(err instanceof Error ? err.message : "Save failed");
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <PageLayout title={isEdit ? "Edit agent" : "New agent"}>
        <p className="text-sm text-app-text-muted">Loading…</p>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title={isEdit ? "Edit agent" : "New agent"}
      description="Configure the agent's model, prompt, tools, and approval mode."
    >
      {error && (
        <div className="mb-4 rounded-md border border-app-danger bg-app-surface px-3 py-2 text-sm text-app-danger">
          {error}
        </div>
      )}

      <div className="grid max-w-2xl gap-4">
        <Labeled label="Name" required>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
        </Labeled>

        <Labeled label="Description">
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={inputCls}
          />
        </Labeled>

        <Labeled label="Category">
          <CategoryCombobox value={category} onChange={setCategory} options={categories} />
          {categories.length > 0 && (
            <p className="mt-1 text-xs text-app-text-muted">
              Pick an existing category or type a new one.
            </p>
          )}
        </Labeled>

        <Labeled label="Avatar">
          <div className="flex items-center gap-3">
            <AgentAvatar name={name || "?"} avatarUrl={avatarUrl || null} size={56} />
            <div className="flex flex-col gap-1.5">
              <div className="flex gap-2">
                <label className="cursor-pointer rounded-md border border-app-border bg-app-surface px-3 py-1.5 text-sm text-app-text hover:bg-app-surface-hover">
                  {avatarUrl ? "Change image" : "Upload image"}
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
                {avatarUrl && (
                  <button
                    type="button"
                    onClick={() => setAvatarUrl("")}
                    className="rounded-md border border-app-border bg-app-surface px-3 py-1.5 text-sm text-app-text hover:bg-app-surface-hover"
                  >
                    Remove
                  </button>
                )}
              </div>
              <p className="text-xs text-app-text-muted">
                PNG, JPG, WebP, or SVG. Square images look best, large ones are scaled down. Leave
                blank to show initials.
              </p>
              {avatarError && <p className="text-xs text-app-danger">{avatarError}</p>}
            </div>
          </div>
        </Labeled>

        <Labeled label="Kind">
          <select value={kind} onChange={(e) => setKind(e.target.value)} className={inputCls}>
            {KIND_OPTIONS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </Labeled>

        <Labeled label="System prompt" required>
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={6}
            className={`${inputCls} resize-y`}
          />
        </Labeled>

        <Labeled label="Tools">
          {tools.length === 0 ? (
            <p className="text-xs text-app-text-muted">No tools registered.</p>
          ) : (
            <div className="grid gap-1.5">
              {tools.map((t) => (
                <label key={t.id} className="flex items-start gap-2 text-sm text-app-text">
                  <input
                    type="checkbox"
                    checked={toolIds.includes(t.id)}
                    onChange={() => toggleTool(t.id)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-mono text-xs">{t.id}</span>
                    {t.description && (
                      <span className="block text-xs text-app-text-muted">{t.description}</span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          )}
        </Labeled>

        <Labeled label="Model" required>
          <select value={modelId} onChange={(e) => setModelId(e.target.value)} className={inputCls}>
            <option value="">Select a model…</option>
            {sortedModels.map((m) => {
              const recommended = recommendedIds.includes(m.id);
              const incompatible = toolsSelected && !m.supportsTools;
              return (
                <option key={m.id} value={m.id} disabled={incompatible}>
                  {m.displayName} ({m.provider.displayName}){recommended ? " · Recommended" : ""}
                  {incompatible ? " · no tool support" : ""}
                </option>
              );
            })}
          </select>
          {recommendedNames.length > 0 && (
            <p className="mt-1 text-xs text-app-text-muted">
              Recommended for {kind}: {recommendedNames.join(", ")}
              {requiresTools ? " (this kind needs a tool-capable model)" : ""}
            </p>
          )}
          {models.length === 0 && (
            <p className="mt-1 text-xs text-app-text-muted">
              No models available. An admin must enable a model with a ready provider in Admin -&gt;
              AI / Models.
            </p>
          )}
        </Labeled>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Labeled label="Approval mode">
            <select
              value={approvalMode}
              onChange={(e) => setApprovalMode(e.target.value as ApprovalMode)}
              className={inputCls}
            >
              <option value="ask">ask (confirm writes)</option>
              <option value="auto">auto (run writes)</option>
            </select>
          </Labeled>
          <Labeled label="Max tool calls">
            <input
              type="number"
              min={1}
              max={50}
              value={maxToolCalls}
              onChange={(e) => setMaxToolCalls(Number(e.target.value))}
              className={inputCls}
            />
          </Labeled>
          <Labeled label="Token budget (optional)">
            <input
              type="number"
              min={1}
              value={tokenBudget}
              onChange={(e) => setTokenBudget(e.target.value)}
              className={inputCls}
            />
          </Labeled>
          <Labeled label="Temperature (optional)">
            <input
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={temperature}
              placeholder="Recommended"
              onChange={(e) => setTemperature(e.target.value)}
              className={inputCls}
            />
            <p className="mt-1 text-xs text-app-text-muted">
              Higher is more creative, lower is more deterministic. Leave blank to use the
              recommended default for the model.
            </p>
          </Labeled>
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => navigate(isEdit && id ? `/agents/${id}` : "/agents")}
            className="rounded-md border border-app-border bg-app-surface px-3 py-1.5 text-sm text-app-text hover:bg-app-surface-hover"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void save()}
            className="rounded-md bg-app-primary px-3 py-1.5 text-sm font-medium text-app-primary-on hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving…" : isEdit ? "Save changes" : "Create agent"}
          </button>
        </div>
      </div>
    </PageLayout>
  );
}

const inputCls =
  "w-full rounded-md border border-app-border bg-app-surface px-2 py-1.5 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-app-primary";

// Free-text input plus a theme-styled dropdown of existing values (native datalist cannot be themed).
function CategoryCombobox({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
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
        placeholder="e.g. Plan & Coordinate"
        className={`${inputCls} ${options.length > 0 ? "pr-8" : ""}`}
      />
      {options.length > 0 && (
        <button
          type="button"
          tabIndex={-1}
          aria-label="Toggle category list"
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
