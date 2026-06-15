import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PageLayout, ConfirmDialog, AgentAvatar } from "@internal/shared-ui";
import { useApi } from "@internal/api-client/react";
import { useTranslation } from "@internal/i18n";
import type {
  Agent,
  AgentRun,
  AgentToolDescriptor,
  AgentToolGroup,
  CurrentUser,
} from "@internal/shared-types";
import { McpServersEditor } from "./McpServersEditor";

const KIND_LABEL_KEY: Record<string, "custom" | "catalogEnrichment" | "platformAssistant"> = {
  custom: "custom",
  "catalog-enrichment": "catalogEnrichment",
  "platform-assistant": "platformAssistant",
};

type AgentDetail = Agent & {
  llmModel?: { slug: string; displayName: string; provider: { slug: string; displayName: string } };
  runs?: AgentRun[];
};

interface TestResult {
  status: "succeeded" | "failed";
  finalText: string | null;
  tokensInput: number;
  tokensOutput: number;
  costUsd: number | null;
  error: string | null;
}

export function AgentDetailPage() {
  const api = useApi();
  const navigate = useNavigate();
  const { t } = useTranslation("agents");
  const { id = "" } = useParams<{ id: string }>();
  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [toolGroups, setToolGroups] = useState<AgentToolGroup[]>([]);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const load = useCallback(() => {
    api.agents
      .get(id)
      .then((a) => setAgent(a as AgentDetail))
      .catch((err) => setError(err.message ?? t("errors.failedToLoadAgent")));
  }, [api, id, t]);

  useEffect(() => {
    void load();
    api.auth
      .me()
      .then(setMe)
      .catch(() => setMe(null));
    api.agents
      .listTools()
      .then((res) => setToolGroups(res.groups))
      .catch(() => {});
  }, [api, load]);

  function toggleGroupOpen(groupId: string) {
    setOpenGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
  }

  async function onDelete() {
    setDeleting(true);
    try {
      await api.agents.delete(id);
      navigate("/agents");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.deleteFailed"));
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  async function runTest() {
    if (!prompt.trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.agents.test(id, prompt.trim());
      setTestResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.testFailed"));
    } finally {
      setTesting(false);
    }
  }

  if (error && !agent) {
    return (
      <PageLayout title={t("page.agentTitle")}>
        <p className="text-sm text-app-danger">{error}</p>
      </PageLayout>
    );
  }
  if (!agent) {
    return (
      <PageLayout title={t("page.agentTitle")}>
        <p className="text-sm text-app-text-muted">{t("loading.agent")}</p>
      </PageLayout>
    );
  }

  const toolIds = Array.isArray(agent.toolIds) ? agent.toolIds : [];
  const isAdmin = me?.role === "admin";
  const toolGroupSections = groupSelectedTools(toolIds, toolGroups, t("detail.otherTools"));

  return (
    <PageLayout
      title={agent.name}
      description={agent.description ?? undefined}
      actions={
        isAdmin ? (
          <div className="flex items-center gap-2">
            <Link
              to={`/agents/${agent.id}/edit`}
              className="rounded-md border border-app-border bg-app-surface px-3 py-1.5 text-sm text-app-text hover:bg-app-surface-hover"
            >
              {t("actions.edit")}
            </Link>
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="rounded-md border border-app-danger px-3 py-1.5 text-sm text-app-danger hover:bg-app-danger/10"
            >
              {t("actions.delete")}
            </button>
          </div>
        ) : undefined
      }
    >
      {error && <p className="mb-4 text-sm text-app-danger">{error}</p>}

      <div className="mb-4 flex items-center gap-3">
        <AgentAvatar name={agent.name} avatarUrl={agent.avatarUrl} size={56} />
        <div className="text-sm text-app-text-muted">
          {agent.category ?? t("category.uncategorized")}
        </div>
      </div>

      <section className="mb-6 grid gap-3 rounded-lg border border-app-border bg-app-surface p-4 text-sm sm:grid-cols-2">
        <Field
          label={t("fields.kind_field")}
          value={t(`kind.${KIND_LABEL_KEY[agent.kind] ?? "custom"}`)}
        />
        <Field label={t("fields.status")} value={t(`status.${agent.status}`)} />
        <Field
          label={t("fields.model")}
          value={
            agent.llmModel
              ? `${agent.llmModel.displayName} (${agent.llmModel.provider.displayName})`
              : agent.modelId
          }
        />
        <Field label={t("fields.approvalMode")} value={t(`approvalMode.${agent.approvalMode}`)} />
        <Field label={t("fields.maxToolCalls")} value={String(agent.maxToolCalls)} />
        <Field
          label={t("fields.tokenBudget")}
          value={agent.tokenBudget != null ? String(agent.tokenBudget) : "—"}
        />
      </section>

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold text-app-text">{t("detail.tools")}</h2>
        {toolIds.length === 0 ? (
          <p className="text-sm text-app-text-muted">{t("empty.noTools")}</p>
        ) : (
          <div>
            <div className="flex flex-wrap gap-1.5">
              {toolGroupSections.map((group) => {
                const open = Boolean(openGroups[group.id]);
                return (
                  <button
                    key={group.id}
                    type="button"
                    onClick={() => toggleGroupOpen(group.id)}
                    aria-expanded={open}
                    title={group.description || undefined}
                    className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm ${
                      open
                        ? "border-app-primary bg-app-primary/10 text-app-text"
                        : "border-app-border bg-app-surface text-app-text hover:bg-app-surface-hover"
                    }`}
                  >
                    <span>{group.label}</span>
                    <span className="rounded-full bg-app-bg-sunken px-1.5 text-xs text-app-text-muted">
                      {group.tools.length}
                    </span>
                  </button>
                );
              })}
            </div>
            {toolGroupSections.some((group) => openGroups[group.id]) && (
              <div className="mt-2 grid gap-2">
                {toolGroupSections
                  .filter((group) => openGroups[group.id])
                  .map((group) => (
                    <div
                      key={group.id}
                      className="rounded-md border border-app-border bg-app-surface px-3 py-2"
                    >
                      <div className="mb-1 text-xs font-semibold text-app-text">
                        {group.label}
                        {group.description && (
                          <span className="ml-1 font-normal text-app-text-muted">
                            {group.description}
                          </span>
                        )}
                      </div>
                      <div className="grid gap-1.5">
                        {group.tools.map((tool) => (
                          <div key={tool.id} className="text-sm text-app-text">
                            <span className="font-mono text-xs">{tool.id}</span>
                            {tool.description && (
                              <span className="block text-xs text-app-text-muted">
                                {tool.description}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}
      </section>

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold text-app-text">{t("detail.systemPrompt")}</h2>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-app-border bg-app-bg-sunken p-3 text-xs text-app-text">
          {agent.instructions}
        </pre>
      </section>

      {isAdmin && <McpServersEditor agentId={agent.id} />}

      {isAdmin && (
        <section className="mb-6 rounded-lg border border-app-border bg-app-surface p-4">
          <h2 className="mb-2 text-sm font-semibold text-app-text">{t("detail.tryItOut")}</h2>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            placeholder={t("detail.testPlaceholder")}
            className="w-full resize-y rounded-md border border-app-border bg-app-bg-sunken px-2 py-1.5 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-app-primary"
          />
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              disabled={testing || !prompt.trim()}
              onClick={() => void runTest()}
              className="rounded-md bg-app-primary px-3 py-1.5 text-sm font-medium text-app-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {testing ? t("actions.running") : t("actions.runTest")}
            </button>
          </div>
          {testResult && (
            <div className="mt-3 rounded-md border border-app-border bg-app-bg-sunken p-3 text-sm">
              <div className="mb-1 text-xs text-app-text-muted">
                {t("status." + testResult.status)} ·{" "}
                {t("detail.tokenSummary", {
                  input: testResult.tokensInput,
                  output: testResult.tokensOutput,
                })}
                {testResult.costUsd != null ? ` · $${testResult.costUsd.toFixed(4)}` : ""}
              </div>
              {testResult.error ? (
                <p className="text-app-danger">{testResult.error}</p>
              ) : (
                <p className="whitespace-pre-wrap text-app-text">
                  {testResult.finalText ?? t("empty.noText")}
                </p>
              )}
            </div>
          )}
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold text-app-text">{t("detail.recentRuns")}</h2>
        {!agent.runs || agent.runs.length === 0 ? (
          <p className="text-sm text-app-text-muted">{t("empty.noRuns")}</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-app-text-muted">
                <th className="py-1">{t("table.started")}</th>
                <th className="py-1">{t("table.trigger")}</th>
                <th className="py-1">{t("table.context")}</th>
                <th className="py-1">{t("table.status")}</th>
                <th className="py-1">{t("table.tokens")}</th>
                <th className="py-1">{t("table.cost")}</th>
              </tr>
            </thead>
            <tbody>
              {agent.runs.map((r) => (
                <tr key={r.id} className="border-t border-app-border">
                  <td className="py-1.5">
                    <Link
                      to={`/agents/${agent.id}/runs/${r.id}`}
                      className="text-app-primary hover:underline"
                    >
                      {new Date(r.startedAt).toLocaleString()}
                    </Link>
                  </td>
                  <td className="py-1.5 text-app-text-muted">
                    {r.trigger ? (
                      <span className="rounded-full border border-app-border bg-app-surface px-2 py-0.5">
                        {r.trigger}
                      </span>
                    ) : (
                      <span className="text-app-text-muted">-</span>
                    )}
                  </td>
                  <td className="py-1.5">
                    <RunContext run={r} />
                  </td>
                  <td className="py-1.5 text-app-text">{t("status." + r.status)}</td>
                  <td className="py-1.5 text-app-text-muted">
                    {(r.tokensInput ?? 0) + (r.tokensOutput ?? 0)}
                  </td>
                  <td className="py-1.5 text-app-text-muted">
                    {r.costUsd != null ? `$${Number(r.costUsd).toFixed(4)}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <ConfirmDialog
        open={confirmDelete}
        title={t("confirm.deleteTitle")}
        message={t("confirm.deleteMessage", { name: agent.name })}
        confirmLabel={t("confirm.deleteLabel")}
        destructive
        busy={deleting}
        onConfirm={() => void onDelete()}
        onClose={() => setConfirmDelete(false)}
      />
    </PageLayout>
  );
}

interface ToolGroupSection {
  id: string;
  label: string;
  description: string;
  tools: AgentToolDescriptor[];
}

// Buckets the agent's selected tool ids into their registered groups, keeping group order.
// Tool ids that match no known group fall into a trailing "other" section so nothing is hidden.
function groupSelectedTools(
  toolIds: string[],
  toolGroups: AgentToolGroup[],
  otherLabel: string,
): ToolGroupSection[] {
  const selected = new Set(toolIds);
  const claimed = new Set<string>();
  const sections: ToolGroupSection[] = [];

  for (const group of toolGroups) {
    const tools = group.tools.filter((tool) => selected.has(tool.id));
    tools.forEach((tool) => claimed.add(tool.id));
    if (tools.length > 0) {
      sections.push({
        id: group.id,
        label: group.label,
        description: group.description,
        tools,
      });
    }
  }

  const orphans = toolIds.filter((tid) => !claimed.has(tid));
  if (orphans.length > 0) {
    sections.push({
      id: "__other__",
      label: otherLabel,
      description: "",
      tools: orphans.map((tid) => ({ id: tid, name: tid, description: "" })),
    });
  }

  return sections;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-app-text-muted">{label}</div>
      <div className="text-app-text">{value}</div>
    </div>
  );
}

// Links a run back to what it acted on: the task it worked, the conversation it answered, or nothing for test/manual/cron runs.
function RunContext({ run }: { run: AgentRun }) {
  if (run.task) {
    return (
      <Link to={`/tasks/${run.task.id}`} className="text-app-primary hover:underline">
        {run.task.title}
      </Link>
    );
  }
  if (run.conversation) {
    return (
      <Link to={`/chat/${run.conversation.id}`} className="text-app-primary hover:underline">
        {run.conversation.title}
      </Link>
    );
  }
  return <span className="text-app-text-muted">-</span>;
}
