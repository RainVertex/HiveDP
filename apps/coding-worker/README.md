# coding-worker

A standalone process that drains **coding-runtime** agent tasks (`Agent.runtime === "code"`) off the
shared `AgentTask` queue and executes each in an ephemeral Docker sandbox (the `coding-runner` image).

It runs separately from the API and the chat agent worker so a multi-minute coding run never blocks
other work, and so untrusted shell/git only ever runs on a host that has Docker plus the
egress-allowlist network configured. The `AgentTask` claim is atomic per row and fair (per-owner
capped), so multiple workers safely drain the same table concurrently without double-running, and no
single user's backlog can starve another's. This worker claims only `runtime:"code"`; the agent worker
claims `runtime:"chat"`.

Runs execute with bounded concurrency, each in its own single-use container drawn from a warm pool: the
pool keeps containers pre-started (blocked on stdin) so a run skips container/runtime startup, then the
container takes the job, runs, and is destroyed (`--rm`) while the pool spawns a replacement.

## Deploy

Run it on a VPS that has the Docker CLI and daemon available; it spawns sibling containers via
`docker run` (no docker-in-docker needed). Build the bundle and start it:

```
yarn workspace @internal/coding-worker build
node apps/coding-worker/dist/worker.js
```

### Required environment

- `DATABASE_URL` - same database as the API.
- `APP_SECRET_MASTER_KEY` - to decrypt the agent's provider `ProviderCredential` (the model API key).
- GitHub App vars (`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`) - to mint installation tokens and open PRs.
- `CODING_RUNNER_IMAGE` - the published `coding-runner` image tag (Aider-based).
- `CODING_RUNNER_NETWORK` - a Docker network that allows egress only to the model provider API (e.g. OpenAI) and GitHub. Defaults to `none` (fails closed).

### Optional tuning

- `CODING_WORKER_CONCURRENCY` (default 3), `CODING_WORKER_USER_CAP` (default 2).
- `CODING_WARM_POOL_SIZE` (default 3), `CODING_WARM_TTL_MS` (default 1800000), `CODING_WARM_HEALTH_MS` (default 30000).
- `CODING_RUNNER_CPUS` (default 2), `CODING_RUNNER_MEMORY` (default 4g), `CODING_RUNNER_TIMEOUT_MS` (default 1200000).

Size `CODING_WARM_POOL_SIZE` with `CODING_WORKER_CONCURRENCY` (roughly one warm container per slot). Each
container can use up to `CODING_RUNNER_CPUS` / `CODING_RUNNER_MEMORY`, so a high concurrency is heavy on
host resources.

The worker sets `CODING_RUNTIME_ENABLED=1` for itself; the API process never sets it, so a coding run
that lands there fails closed instead of spawning Docker on the API host.

## Cross-process cancellation

A Stop issued from the API sets `AgentRun.cancelRequestedAt`, and the run (executing here) polls that
flag (`AGENT_CANCEL_POLL_MS`, default 3000) and aborts itself, which `docker kill`s the container. A hard
wall-clock ceiling and worker shutdown also abort the run.
