import { spawn, execFile, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { CodingJobPayload, CodingRunnerResult } from "./types";

// Host side of the coding sandbox. Containers are pre-warmed by the pool (started blocked on stdin, so
// the image, Node runtime, and tmpfs are already up), then handed a job: we write the payload (spec plus
// secrets) to stdin and read the runner's single JSON result line from stdout. The container is the only
// place untrusted shell, git, and Aider execute. Secrets travel on stdin, never argv or env, so they are
// invisible to `ps` and `docker inspect`.

export const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;

export interface CodingContainer {
  name: string;
  child: ChildProcess;
  createdAt: number;
  state: "idle" | "busy" | "dead";
  stdout: string;
  stderr: string;
  closed: Promise<number | null>;
}

function dockerRunArgs(name: string): string[] {
  const image = process.env.CODING_RUNNER_IMAGE;
  if (!image) throw new Error("CODING_RUNNER_IMAGE is not set.");
  // Egress-allowlist network (model API + GitHub). Defaults to "none" so a misconfigured deploy fails
  // closed (the clone cannot reach GitHub) rather than getting unrestricted egress.
  const network = process.env.CODING_RUNNER_NETWORK ?? "none";
  const cpus = process.env.CODING_RUNNER_CPUS ?? "2";
  const memory = process.env.CODING_RUNNER_MEMORY ?? "4g";
  return [
    "run",
    "--rm",
    "-i",
    "--name",
    name,
    "--network",
    network,
    "--cpus",
    cpus,
    "--memory",
    memory,
    "--read-only",
    "--tmpfs",
    "/work:rw,exec,size=2g",
    // Writable /tmp for tsx's IPC dir, git, and Aider/LiteLLM temp files (rootfs is read-only).
    "--tmpfs",
    "/tmp:rw,exec,size=512m",
    "--security-opt",
    "no-new-privileges",
    // Aider and its caches/history write under $HOME; point it at the writable tmpfs.
    "--env",
    "HOME=/work",
    image,
  ];
}

// Starts a container that immediately blocks reading stdin (the runner reads all of stdin before doing
// anything), so it sits warm until a job is written to it.
export function spawnCodingContainer(): CodingContainer {
  const name = `coding-warm-${randomUUID()}`;
  const child = spawn("docker", dockerRunArgs(name), { stdio: ["pipe", "pipe", "pipe"] });
  const c: CodingContainer = {
    name,
    child,
    createdAt: Date.now(),
    state: "idle",
    stdout: "",
    stderr: "",
    closed: new Promise<number | null>((res) => child.on("close", (code) => res(code))),
  };
  child.stdout?.on("data", (d: Buffer) => {
    c.stdout += d.toString();
  });
  child.stderr?.on("data", (d: Buffer) => {
    c.stderr += d.toString();
  });
  return c;
}

// Hands a job to a container: write the payload to its stdin, then read the single JSON result line once
// it exits. Timeout or abort docker-kills the container (which makes it exit and `--rm` clean up).
export async function runInContainer(
  c: CodingContainer,
  payload: CodingJobPayload,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<CodingRunnerResult> {
  c.state = "busy";
  if (!c.child.stdin || c.child.exitCode !== null) {
    throw new Error("Coding container is not usable (it exited before the job started).");
  }
  const killTimer = setTimeout(() => dockerKill(c.name), timeoutMs);
  const onAbort = (): void => dockerKill(c.name);
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    c.child.stdin.write(JSON.stringify(payload));
    c.child.stdin.end();
    const code = await c.closed;
    const parsed = parseResult(c.stdout);
    if (parsed) return parsed;
    if (signal.aborted) throw new Error("Coding run cancelled.");
    throw new Error(
      `coding-runner exited ${code ?? "null"} without a result. stderr tail: ${c.stderr.slice(-1500)}`,
    );
  } finally {
    clearTimeout(killTimer);
    signal.removeEventListener("abort", onAbort);
  }
}

export function dockerKill(name: string): void {
  execFile("docker", ["kill", name], () => {});
}

// Logs from git and the SDK go to stderr; the runner prints exactly one JSON result line to stdout.
// Scan from the end so any stray stdout noise before it is ignored.
function parseResult(stdout: string): CodingRunnerResult | null {
  const lines = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const obj = JSON.parse(lines[i]) as unknown;
      if (obj && typeof obj === "object" && "hadChanges" in obj) {
        return obj as CodingRunnerResult;
      }
    } catch {
      // not the result line
    }
  }
  return null;
}
