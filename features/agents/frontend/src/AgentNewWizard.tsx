import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PageLayout } from "@internal/shared-ui";
import { useApi } from "@internal/api-client/react";
import type {
  AgentToolDescriptor,
  ProviderKind,
  ToolApprovalPolicy,
  TeamSummary,
} from "@internal/shared-types";
import { ProviderPicker, type ProviderPickerValue } from "./components/ProviderPicker";
import { ToolApprovalMatrix } from "./components/ToolApprovalMatrix";

// 4-step wizard for creating a new agent. Steps:
//   1. Identity   — name, description, system prompt
//   2. Model      — provider adapter, LlmModel, optional Secret override
//   3. Permissions — role, owning team (optional), onBehalfOfRequired
//   4. Tools      — toolIds allowlist + per-tool approval policy
//
// State lives in a single object that we POST as-is on Save. Validation is
// per-step + final: every step's "Continue" button enables only when its
// required fields are present, and the Save button on step 4 does a last
// pass.
//
// Server-side creationGuard (Pass 3) is the source of truth for what a
// caller can mint. The wizard doesn't try to enforce the tier rules in JS
// — it just submits whatever the user picked and surfaces the 403 reason
// inline if the guard refuses.

type Step = 1 | 2 | 3 | 4;

interface WizardState {
  // Step 1 — Identity
  name: string;
  description: string;
  instructions: string;
  // Step 2 — Model
  modelProvider: ProviderKind;
  modelId: string;
  secretId: string | null;
  // Step 3 — Permissions
  role: "admin" | "member";
  owningTeamId: string | null;
  onBehalfOfRequired: boolean;
  // Step 4 — Tools
  toolIds: string[];
  toolApprovalPolicy: ToolApprovalPolicy;
}

const INITIAL: WizardState = {
  name: "",
  description: "",
  instructions: "You are a helpful agent.",
  modelProvider: "openai_compat",
  modelId: "",
  secretId: null,
  role: "member",
  owningTeamId: null,
  onBehalfOfRequired: true,
  toolIds: [],
  toolApprovalPolicy: {},
};

export function AgentNewWizard() {
  const api = useApi();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>(1);
  const [state, setState] = useState<WizardState>(INITIAL);
  const [tools, setTools] = useState<AgentToolDescriptor[]>([]);
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  // Caller's role drives which UI controls are enabled (role=admin and the
  // onBehalfOfRequired toggle are admin-only). Server-side creationGuard
  // is the authoritative check; this just shows the right affordance.
  const [callerRole, setCallerRole] = useState<"admin" | "member">("member");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.agents
      .listTools()
      .then((r) => setTools(r.items))
      .catch((e) => setError(e.message ?? "Failed to load tools"));
    api.teams
      .list()
      .then((r) => setTeams(r.items))
      .catch(() => {
        // teams optional
      });
    api.auth
      .me()
      .then((u) => {
        if (u) setCallerRole(u.role);
      })
      .catch(() => {
        // keep default
      });
  }, [api]);

  const stepValid = useMemo(() => stepValidator(state), [state]);

  function setProvider(v: ProviderPickerValue) {
    setState((s) => ({
      ...s,
      modelProvider: v.modelProvider,
      modelId: v.modelId,
      secretId: v.secretId,
    }));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const created = await api.agents.create({
        name: state.name,
        description: state.description || undefined,
        instructions: state.instructions,
        modelId: state.modelId,
        toolIds: state.toolIds,
        owningTeamId: state.owningTeamId,
        modelProvider: state.modelProvider,
        toolApprovalPolicy: state.toolApprovalPolicy,
        secretId: state.secretId,
        role: state.role,
        onBehalfOfRequired: state.onBehalfOfRequired,
      });
      // The detail page is keyed by backing User id, not Agent.id, so we
      // navigate to /agents/<userId>. The Agent type carries userId from
      // the Pass-1 schema extension.
      navigate(`/agents/${created.userId}`);
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  return (
    <PageLayout
      title="New agent"
      description="Configure an AI agent with its own model, tool permissions, and approval policy."
    >
      <div className="mx-auto max-w-3xl">
        <Stepper current={step} />

        <div className="mt-6 rounded-lg border border-app-border bg-app-surface p-5">
          {step === 1 && (
            <StepIdentity
              state={state}
              onChange={(patch) => setState((s) => ({ ...s, ...patch }))}
            />
          )}
          {step === 2 && (
            <StepModel
              value={{
                modelProvider: state.modelProvider,
                modelId: state.modelId,
                secretId: state.secretId,
              }}
              onChange={setProvider}
            />
          )}
          {step === 3 && (
            <StepPermissions
              state={state}
              teams={teams}
              isAdmin={callerRole === "admin"}
              onChange={(patch) => setState((s) => ({ ...s, ...patch }))}
            />
          )}
          {step === 4 && (
            <StepTools
              state={state}
              tools={tools}
              onChange={(patch) => setState((s) => ({ ...s, ...patch }))}
            />
          )}
        </div>

        {error && (
          <div className="mt-4 rounded-md border border-app-danger bg-app-surface px-3 py-2 text-sm text-app-danger">
            {error}
          </div>
        )}

        <div className="mt-4 flex items-center justify-between">
          <Link to="/agents" className="text-sm text-app-text-muted hover:underline">
            ← Cancel
          </Link>
          <div className="flex gap-2">
            {step > 1 && (
              <button
                type="button"
                onClick={() => setStep((s) => Math.max(1, (s - 1) as Step) as Step)}
                className="rounded-md border border-app-border bg-app-surface px-3 py-1.5 text-sm text-app-text hover:bg-app-surface-hover"
              >
                Back
              </button>
            )}
            {step < 4 && (
              <button
                type="button"
                disabled={!stepValid[step]}
                onClick={() => setStep((s) => Math.min(4, (s + 1) as Step) as Step)}
                className="rounded-md bg-app-primary px-3 py-1.5 text-sm font-medium text-app-primary-on hover:opacity-90 disabled:opacity-50"
              >
                Continue
              </button>
            )}
            {step === 4 && (
              <button
                type="button"
                disabled={
                  saving || !stepValid[1] || !stepValid[2] || !stepValid[3] || !stepValid[4]
                }
                onClick={() => void save()}
                className="rounded-md bg-app-primary px-3 py-1.5 text-sm font-medium text-app-primary-on hover:opacity-90 disabled:opacity-50"
              >
                {saving ? "Creating…" : "Create agent"}
              </button>
            )}
          </div>
        </div>
      </div>
    </PageLayout>
  );
}

// ---------------------------------------------------------------------------
// Step components
// ---------------------------------------------------------------------------

function StepIdentity({
  state,
  onChange,
}: {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
}) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-app-text">Identity</h3>
      <Field label="Name" required>
        <input
          type="text"
          value={state.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="e.g. Catalog Triage"
          className="w-full rounded-md border border-app-border bg-app-surface px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-app-primary"
        />
      </Field>
      <Field label="Description">
        <input
          type="text"
          value={state.description}
          onChange={(e) => onChange({ description: e.target.value })}
          placeholder="One-line summary"
          className="w-full rounded-md border border-app-border bg-app-surface px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-app-primary"
        />
      </Field>
      <Field label="System prompt" required>
        <textarea
          value={state.instructions}
          onChange={(e) => onChange({ instructions: e.target.value })}
          rows={8}
          className="w-full rounded-md border border-app-border bg-app-surface px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-app-primary"
        />
      </Field>
    </div>
  );
}

function StepModel({
  value,
  onChange,
}: {
  value: ProviderPickerValue;
  onChange: (v: ProviderPickerValue) => void;
}) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-app-text">Model & API key</h3>
      <ProviderPicker value={value} onChange={onChange} />
    </div>
  );
}

function StepPermissions({
  state,
  teams,
  isAdmin,
  onChange,
}: {
  state: WizardState;
  teams: TeamSummary[];
  isAdmin: boolean;
  onChange: (patch: Partial<WizardState>) => void;
}) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-app-text">Permissions</h3>
      <Field label="Role">
        <select
          value={state.role}
          onChange={(e) => onChange({ role: e.target.value as WizardState["role"] })}
          className="w-full rounded-md border border-app-border bg-app-surface px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-app-primary"
        >
          <option value="member">member, standard authenticated access</option>
          <option value="admin" disabled={!isAdmin}>
            admin, full platform access {!isAdmin && "(admins only)"}
          </option>
        </select>
        <p className="mt-1 text-xs text-app-text-muted">
          The role assigned to the agent's backing User. Tiered creation rules cap this server-side.
        </p>
      </Field>

      <Field label="Owning team (optional)">
        <select
          value={state.owningTeamId ?? ""}
          onChange={(e) => onChange({ owningTeamId: e.target.value || null })}
          className="w-full rounded-md border border-app-border bg-app-surface px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-app-primary"
        >
          <option value="">— Personal agent —</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-app-text-muted">
          Team-owned agents require team-lead privileges. Personal agents are owned by you.
        </p>
      </Field>

      <Field label="Autonomy">
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={state.onBehalfOfRequired}
            onChange={(e) => onChange({ onBehalfOfRequired: e.target.checked })}
            className="mt-0.5"
          />
          <span className="text-sm text-app-text">
            Require a human invoker for every action
            {!isAdmin && (
              <span className="ml-1 text-xs text-app-text-muted">(admin-only to disable)</span>
            )}
          </span>
        </label>
        <p className="mt-1 text-xs text-app-text-muted">
          When enabled, every action runs with permissions = min(agent grants ∩ invoker grants).
          Disable only for cron / webhook agents that have no in-session human.
        </p>
      </Field>
    </div>
  );
}

function StepTools({
  state,
  tools,
  onChange,
}: {
  state: WizardState;
  tools: AgentToolDescriptor[];
  onChange: (patch: Partial<WizardState>) => void;
}) {
  function toggleTool(toolId: string) {
    const next = state.toolIds.includes(toolId)
      ? state.toolIds.filter((id) => id !== toolId)
      : [...state.toolIds, toolId];
    onChange({ toolIds: next });
  }

  return (
    <div className="space-y-5">
      <h3 className="text-sm font-semibold text-app-text">Tools & approval policy</h3>

      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-app-text-muted">
          Allowed tools
        </h4>
        <div className="max-h-60 overflow-y-auto rounded-md border border-app-border">
          {tools.length === 0 && (
            <p className="p-3 text-xs text-app-text-muted">No tools available in registry.</p>
          )}
          {tools.map((t) => (
            <label
              key={t.id}
              className="flex cursor-pointer items-start gap-2 border-b border-app-border px-3 py-2 last:border-b-0 hover:bg-app-surface-hover"
            >
              <input
                type="checkbox"
                checked={state.toolIds.includes(t.id)}
                onChange={() => toggleTool(t.id)}
                className="mt-0.5"
              />
              <div className="min-w-0 flex-1">
                <div className="text-sm text-app-text">{t.name}</div>
                {t.description && (
                  <div className="text-xs text-app-text-muted">{t.description}</div>
                )}
              </div>
            </label>
          ))}
        </div>
      </div>

      <ToolApprovalMatrix
        policy={state.toolApprovalPolicy}
        enabledToolIds={state.toolIds}
        tools={tools}
        onChange={(policy) => onChange({ toolApprovalPolicy: policy })}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers + chrome
// ---------------------------------------------------------------------------

function Field({
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
      <span className="mb-1 block text-sm font-medium text-app-text">
        {label}
        {required && <span className="ml-1 text-app-danger">*</span>}
      </span>
      {children}
    </label>
  );
}

function Stepper({ current }: { current: Step }) {
  const labels: Record<Step, string> = {
    1: "Identity",
    2: "Model",
    3: "Permissions",
    4: "Tools",
  };
  return (
    <div className="flex items-center gap-2">
      {([1, 2, 3, 4] as Step[]).map((n, i) => {
        const active = current === n;
        const done = current > n;
        return (
          <div key={n} className="flex flex-1 items-center gap-2">
            <div
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                active
                  ? "bg-app-primary text-app-primary-on"
                  : done
                    ? "bg-app-success text-white"
                    : "bg-app-surface-hover text-app-text-muted"
              }`}
            >
              {n}
            </div>
            <span
              className={`text-sm ${active ? "text-app-text font-medium" : "text-app-text-muted"}`}
            >
              {labels[n]}
            </span>
            {i < 3 && <div className="h-px flex-1 bg-app-border" />}
          </div>
        );
      })}
    </div>
  );
}

function stepValidator(s: WizardState): Record<Step, boolean> {
  return {
    1: s.name.trim().length > 0 && s.instructions.trim().length > 0,
    2: s.modelProvider.length > 0 && s.modelId.length > 0,
    3: true, // role/team/onBehalfOfRequired all have safe defaults
    4: true, // tools and policy can be empty (= no tools)
  };
}
