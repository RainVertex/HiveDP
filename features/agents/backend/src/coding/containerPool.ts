import {
  spawnCodingContainer,
  runInContainer,
  dockerKill,
  DEFAULT_TIMEOUT_MS,
  type CodingContainer,
} from "./container";
import type { CodingJobPayload, CodingJobSpec, CodingRunnerResult } from "./types";

// Warm pool of sandbox containers. It keeps `size` containers pre-started and blocked on stdin so a job
// gets a ready container instead of paying full container/runtime startup. Each container is single use:
// a job is written to it, it runs and exits (`--rm`), and the pool spawns a replacement to stay at size.
//
// Failure handling, because the happy path is not enough:
//  - A container that dies while idle (OOM/crash) is dropped via its close/error event and the reaper
//    tops the pool back up, so the pool never silently shrinks.
//  - acquire() never blocks or fails a job: if no warm container is ready (boot, churn, mass death) it
//    cold-spawns one on demand and the reaper refills in the background.
//  - The reaper recycles idle containers older than ttlMs, so after a new image is deployed the warm
//    containers are replaced with the fresh image within the TTL window instead of running stale.

interface ContainerPoolOptions {
  size: number;
  ttlMs: number;
  healthMs: number;
}

class ContainerPool {
  private idle: CodingContainer[] = [];
  private reaper: NodeJS.Timeout | null = null;
  private stopping = false;
  constructor(private readonly opts: ContainerPoolOptions) {}

  start(): void {
    this.replenish();
    this.reaper = setInterval(() => this.reap(), this.opts.healthMs);
    this.reaper.unref();
  }

  stop(): void {
    this.stopping = true;
    if (this.reaper) clearInterval(this.reaper);
    for (const c of [...this.idle]) {
      this.removeIdle(c);
      dockerKill(c.name);
    }
  }

  async run(
    payload: CodingJobPayload,
    signal: AbortSignal,
    timeoutMs: number,
  ): Promise<CodingRunnerResult> {
    const c = this.acquire();
    return runInContainer(c, payload, signal, timeoutMs);
  }

  private acquire(): CodingContainer {
    const warm = this.idle.shift();
    if (warm) {
      this.replenish();
      return warm;
    }
    // Cold fallback: nothing pre-warmed right now. Spawn on demand so the task still runs; the reaper
    // and the next replenish bring the pool back to size in the background.
    return spawnCodingContainer();
  }

  private replenish(): void {
    if (this.stopping) return;
    while (this.idle.length < this.opts.size) {
      try {
        this.idle.push(this.makeIdle());
      } catch {
        // Spawn failed synchronously (e.g. CODING_RUNNER_IMAGE unset). Stop this pass rather than throw
        // out of boot or the reaper interval; the next reaper tick retries once configured.
        break;
      }
    }
  }

  private makeIdle(): CodingContainer {
    const c = spawnCodingContainer();
    const onGone = (): void => {
      c.state = "dead";
      this.removeIdle(c);
    };
    c.child.on("close", onGone);
    c.child.on("error", onGone);
    return c;
  }

  private removeIdle(c: CodingContainer): void {
    const i = this.idle.indexOf(c);
    if (i >= 0) this.idle.splice(i, 1);
  }

  private reap(): void {
    if (this.stopping) return;
    const now = Date.now();
    for (const c of [...this.idle]) {
      if (now - c.createdAt > this.opts.ttlMs) {
        this.removeIdle(c);
        dockerKill(c.name);
      }
    }
    this.replenish();
  }
}

export interface RunContainerInput {
  spec: CodingJobSpec;
  // The resolved provider key; empty for keyless providers (Ollama).
  apiKey: string;
  gitToken: string;
  signal: AbortSignal;
}

let pool: ContainerPool | null = null;

export function initContainerPool(): void {
  if (pool) return;
  pool = new ContainerPool({
    size: Number(process.env.CODING_WARM_POOL_SIZE ?? 3),
    ttlMs: Number(process.env.CODING_WARM_TTL_MS ?? 1_800_000),
    healthMs: Number(process.env.CODING_WARM_HEALTH_MS ?? 30_000),
  });
  pool.start();
}

export function shutdownContainerPool(): void {
  pool?.stop();
  pool = null;
}

function getPool(): ContainerPool {
  if (!pool) initContainerPool();
  return pool as ContainerPool;
}

// Runs one coding job in a (pre-warmed when available) sandbox container and returns its result.
export function runCodingContainer(input: RunContainerInput): Promise<CodingRunnerResult> {
  const timeoutMs = Number(process.env.CODING_RUNNER_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  const payload: CodingJobPayload = {
    spec: input.spec,
    llmApiKey: input.apiKey,
    gitToken: input.gitToken,
  };
  return getPool().run(payload, input.signal, timeoutMs);
}
