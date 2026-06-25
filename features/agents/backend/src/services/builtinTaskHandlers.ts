import { REPO_OPEN_YAML_PR } from "@feature/agents-shared";
import { registerAgentTaskHandler, type AgentTaskHandler } from "./agentTaskHandlers";
import { isAgentProviderReady } from "./providerReadiness";

// Task handlers for the platform's built-in agents. The catalog enricher is owned here (it is a
// seeded, protected agent), the catalog feature only enqueues "catalog-enrich" work.

const ENRICHER_AGENT_ID = "catalog-enricher";
// Terminal tool-error codes: retrying won't help (the entity simply can't be filled via a repo PR).
const SKIP_CODES = new Set(["no_repo", "no_installation", "not_github", "not_found"]);

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

const catalogEnrichHandler: AgentTaskHandler = {
  // Defer (rather than burn attempts) until the enricher's provider has a usable key.
  precheck: () => isAgentProviderReady(ENRICHER_AGENT_ID),

  buildRunInput: (payload) => ({ entityId: payload.entityId }),

  interpret: ({ result }) => {
    const prCall = result.toolCalls.find((c) => c.name === REPO_OPEN_YAML_PR);
    const prOut = prCall ? asRecord(prCall.output) : null;
    const prUrl = prOut && typeof prOut.prUrl === "string" ? prOut.prUrl : null;
    const errCode = prOut && typeof prOut.code === "string" ? prOut.code : null;

    if (prUrl) {
      return {
        status: "done",
        payloadPatch: {
          prUrl,
          branchName: prOut && typeof prOut.branchName === "string" ? prOut.branchName : null,
        },
      };
    }
    if (errCode && SKIP_CODES.has(errCode)) {
      return { status: "skipped", lastError: String(prOut?.error ?? errCode) };
    }
    // The agent judged the catalog-info.yaml already complete and opened no PR.
    if (result.status === "succeeded" && !prCall) return { status: "done" };
    if (result.status === "cancelled") return { status: "skipped", lastError: "Cancelled" };
    return {
      status: "retry",
      lastError:
        result.error ?? (prOut && typeof prOut.error === "string" ? prOut.error : "no PR opened"),
    };
  },
};

export function registerBuiltinAgentTaskHandlers(): void {
  registerAgentTaskHandler("catalog-enrich", catalogEnrichHandler);
}
