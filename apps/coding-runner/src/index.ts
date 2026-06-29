import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The sandbox runner: the only place untrusted shell, git, and the LLM run. It reads one JSON job payload
// from stdin (the spec plus the provider key and a short-lived git token, so secrets never appear in argv
// or env), clones the repo into the container's tmpfs, drives Aider over the working tree, pushes any
// changes to a branch, and prints exactly one JSON result line to stdout (all logs go to stderr so stdout
// stays parseable).

interface CodingJobSpec {
  repoUrl: string;
  owner: string;
  repo: string;
  branch: string;
  message: string;
  aiderModel: string;
  apiKeyEnvVar: string | null;
  apiBase: string | null;
}

interface CodingJobPayload {
  spec: CodingJobSpec;
  llmApiKey: string;
  gitToken: string;
}

interface CodingUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

interface CodingRunnerResult {
  ok: boolean;
  hadChanges: boolean;
  branch: string;
  finalText: string | null;
  usage: CodingUsage;
  error: string | null;
}

function log(msg: string): void {
  process.stderr.write(`[coding-runner] ${msg}\n`);
}

function emit(result: CodingRunnerResult): void {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

// Runs Aider non-interactively and resolves with its exit code. Aider's own output goes to stderr so it
// never pollutes our single stdout result line. Boolean/path options are passed via AIDER_* env vars to
// avoid depending on exact flag spelling; only the model and message go as args.
function runAider(spec: CodingJobSpec, cwd: string, analyticsLog: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn("aider", ["--model", spec.aiderModel, "--message", spec.message], {
      cwd,
      env: {
        ...process.env,
        AIDER_YES_ALWAYS: "true",
        AIDER_STREAM: "false",
        AIDER_CHECK_UPDATE: "false",
        AIDER_AUTO_COMMITS: "true",
        AIDER_GIT: "true",
        // Don't let Aider add ".aider*" to the target repo's .gitignore; we remove its artifacts ourselves.
        AIDER_GITIGNORE: "false",
        AIDER_ANALYTICS_LOG: analyticsLog,
      },
      stdio: ["ignore", "inherit", "inherit"],
    });
    child.on("error", (err) => {
      log(`aider spawn error: ${err.message}`);
      resolve(127);
    });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

// Aider writes one JSON event per LLM exchange to the analytics log. Sum prompt/completion tokens; our
// own pricing turns these into cost on the host, so Aider's dollar figures (often unknown for a brand
// new model) are ignored.
function parseUsage(analyticsLog: string): CodingUsage {
  const usage: CodingUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  if (!existsSync(analyticsLog)) return usage;
  for (const line of readFileSync(analyticsLog, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    try {
      const ev = JSON.parse(t) as { event?: string; properties?: Record<string, unknown> };
      if (ev.event !== "message_send" || !ev.properties) continue;
      const p = ev.properties;
      const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
      usage.input += n(p.prompt_tokens);
      usage.output += n(p.completion_tokens);
    } catch {
      // not a usage line
    }
  }
  return usage;
}

async function main(): Promise<void> {
  const payload = JSON.parse(await readStdin()) as CodingJobPayload;
  const spec = payload.spec;
  const token = payload.gitToken;
  if (!token) throw new Error("gitToken is missing from the job payload.");

  // Hand the provider key to Aider under the name it expects, and point it at a custom endpoint if any.
  if (spec.apiKeyEnvVar) process.env[spec.apiKeyEnvVar] = payload.llmApiKey ?? "";
  if (spec.apiBase) {
    if (spec.aiderModel.startsWith("ollama/")) process.env.OLLAMA_API_BASE = spec.apiBase;
    else process.env.OPENAI_API_BASE = spec.apiBase;
  }

  const workRoot = process.env.CODING_WORKDIR_ROOT || tmpdir();
  const dir = mkdtempSync(join(workRoot, "repo-"));
  // Token lives only in the remote URL inside this ephemeral clone; never logged.
  const remote = `https://x-access-token:${token}@github.com/${spec.owner}/${spec.repo}.git`;

  log(`cloning ${spec.owner}/${spec.repo}`);
  git(["clone", "--depth=1", remote, dir], workRoot);
  git(["config", "user.name", "platform-coding-agent[bot]"], dir);
  git(["config", "user.email", "coding-agent@users.noreply.github.com"], dir);
  git(["checkout", "-b", spec.branch], dir);
  const baseSha = git(["rev-parse", "HEAD"], dir).trim();

  // Keep the analytics log out of the repo so it never lands in the PR.
  const analyticsLog = join(workRoot, "aider-analytics.jsonl");
  log(`running aider (model ${spec.aiderModel})`);
  const code = await runAider(spec, dir, analyticsLog);
  const usage = parseUsage(analyticsLog);

  // Drop Aider's own working files (chat history, repo-map cache) so they cannot be committed.
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".aider")) rmSync(join(dir, name), { recursive: true, force: true });
  }

  // Aider auto-commits, but commit any stragglers so the branch is clean before we compare.
  git(["add", "-A"], dir);
  if (git(["status", "--porcelain"], dir).trim()) {
    git(["commit", "-m", "chore: coding agent changes"], dir);
  }
  const headSha = git(["rev-parse", "HEAD"], dir).trim();
  const hadChanges = headSha !== baseSha;

  if (!hadChanges) {
    const error = code !== 0 ? `aider exited ${code} and produced no changes` : null;
    log(error ?? "no changes produced");
    emit({ ok: code === 0, hadChanges: false, branch: spec.branch, finalText: null, usage, error });
    return;
  }

  const finalText = git(["log", "-1", "--pretty=%B"], dir).trim() || null;
  log("pushing branch");
  git(["push", "-u", "origin", spec.branch], dir);
  emit({ ok: true, hadChanges: true, branch: spec.branch, finalText, usage, error: null });
}

main().catch((err) => {
  emit({
    ok: false,
    hadChanges: false,
    branch: "",
    finalText: null,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    error: err instanceof Error ? err.message : String(err),
  });
  process.exitCode = 1;
});
