import { useState } from "react";
import { useTranslation } from "@internal/i18n";
import { useCodingAgents, useCodingRun } from "../api";

// Standalone coding run: pick a coding agent and give it a free-text instruction. It clones the
// project's connected repo, makes the change in a sandbox, opens a draft PR, and notifies the caller.
export function CodingRunPanel({ projectId }: { projectId: string }) {
  const { t } = useTranslation("projects");
  const { agents, loading: agentsLoading } = useCodingAgents();
  const { run, loading, error } = useCodingRun(projectId);
  const [agentId, setAgentId] = useState("");
  const [instruction, setInstruction] = useState("");
  const [branch, setBranch] = useState("");
  const [queued, setQueued] = useState(false);

  const effectiveAgentId = agentId || agents[0]?.id || "";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!effectiveAgentId || !instruction.trim()) return;
    setQueued(false);
    try {
      await run({
        agentId: effectiveAgentId,
        instruction: instruction.trim(),
        branch: branch.trim() || undefined,
      });
      setInstruction("");
      setBranch("");
      setQueued(true);
    } catch {
      // error shown via hook
    }
  }

  if (!agentsLoading && agents.length === 0) {
    return (
      <div className="mb-4 rounded-lg border border-app-border bg-app-surface p-4">
        <h3 className="text-sm font-semibold text-app-text">{t("coding.heading")}</h3>
        <p className="mt-1 text-xs text-app-text-muted">{t("coding.noAgents")}</p>
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-lg border border-app-border bg-app-surface p-4">
      <h3 className="text-sm font-semibold text-app-text">{t("coding.heading")}</h3>
      <p className="mt-1 text-xs text-app-text-muted">{t("coding.hint")}</p>

      {error && (
        <div className="mt-3 rounded-md border border-app-danger bg-app-surface px-3 py-2 text-xs text-app-danger">
          {error}
        </div>
      )}
      {queued && (
        <div className="mt-3 rounded-md border border-app-border bg-app-surface px-3 py-2 text-xs text-app-text-muted">
          {t("coding.queued")}
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-3 space-y-3">
        <div>
          <label className="block text-xs font-medium text-app-text-muted">
            {t("coding.agentLabel")}
          </label>
          <select
            value={effectiveAgentId}
            onChange={(e) => setAgentId(e.target.value)}
            className="mt-1 w-full rounded-md border border-app-border bg-app-surface px-2 py-1.5 text-sm text-app-text"
          >
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-app-text-muted">
            {t("coding.instructionLabel")}
          </label>
          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            rows={3}
            maxLength={20000}
            placeholder={t("coding.instructionPlaceholder")}
            className="mt-1 w-full rounded-md border border-app-border bg-app-surface px-3 py-2 text-sm text-app-text placeholder:text-app-text-muted"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-app-text-muted">
            {t("coding.branchLabel")}
          </label>
          <input
            type="text"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            maxLength={200}
            placeholder={t("coding.branchPlaceholder")}
            className="mt-1 w-full rounded-md border border-app-border bg-app-surface px-3 py-2 text-sm text-app-text placeholder:text-app-text-muted"
          />
        </div>
        <button
          type="submit"
          disabled={loading || !effectiveAgentId || !instruction.trim()}
          className="rounded-md bg-app-primary px-3 py-1.5 text-sm font-medium text-app-primary-foreground hover:opacity-90 disabled:opacity-60"
        >
          {loading ? t("coding.starting") : t("coding.run")}
        </button>
      </form>
    </div>
  );
}
