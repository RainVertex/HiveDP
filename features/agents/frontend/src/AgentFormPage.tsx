import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { PageLayout } from "@internal/shared-ui";
import { useApi } from "@internal/api-client/react";
import type {
  Agent,
  AgentToolDescriptor,
  ApprovalMode,
  LlmModelSummary,
} from "@internal/shared-types";

const KIND_OPTIONS = ["custom", "catalog-enrichment", "platform-assistant"];

export function AgentFormPage() {
  const api = useApi();
  const navigate = useNavigate();
  const { id } = useParams<{ id?: string }>();
  const isEdit = Boolean(id);

  const [models, setModels] = useState<LlmModelSummary[]>([]);
  const [tools, setTools] = useState<AgentToolDescriptor[]>([]);
  const [recommendedIds, setRecommendedIds] = useState<string[]>([]);
  const [requiresTools, setRequiresTools] = useState(false);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState("custom");
  const [instructions, setInstructions] = useState("");
  const [modelId, setModelId] = useState("");
  const [toolIds, setToolIds] = useState<string[]>([]);
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>("ask");
  const [maxToolCalls, setMaxToolCalls] = useState(10);
  const [tokenBudget, setTokenBudget] = useState<string>("");

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEdit);

  // Load model registry + tool registry once.
  useEffect(() => {
    api.llm
      .listModels()
      .then((res) => setModels(res.items))
      .catch((err) => setError(err.message ?? "Failed to load models"));
    api.agents
      .listTools()
      .then((res) => setTools(res.items))
      .catch(() => {});
  }, [api]);

  // Load the existing agent when editing.
  useEffect(() => {
    if (!isEdit || !id) return;
    api.agents
      .get(id)
      .then((a: Agent) => {
        setName(a.name);
        setDescription(a.description ?? "");
        setKind(a.kind);
        setInstructions(a.instructions);
        setModelId(a.modelId);
        setToolIds(Array.isArray(a.toolIds) ? a.toolIds : []);
        setApprovalMode(a.approvalMode);
        setMaxToolCalls(a.maxToolCalls);
        setTokenBudget(a.tokenBudget != null ? String(a.tokenBudget) : "");
      })
      .catch((err) => setError(err.message ?? "Failed to load agent"))
      .finally(() => setLoading(false));
  }, [api, id, isEdit]);

  // Refresh recommendations whenever the kind changes.
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

  // Recommended models first, then the rest. Models that cannot support the
  // selected tools are disabled in the picker.
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
      kind,
      modelId,
      instructions: instructions.trim(),
      toolIds,
      approvalMode,
      maxToolCalls,
      tokenBudget: tokenBudget.trim() ? Number(tokenBudget) : null,
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
