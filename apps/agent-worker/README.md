# agent-worker

A standalone process that drains **chat-runtime** agent tasks (`Agent.runtime === "chat"`) off the
shared `AgentTask` queue and runs each in-process with bounded async concurrency (`p-limit`).

It runs separately from the API so heavy, concurrent LLM tool loops never compete with HTTP request
handling on the API event loop. The `AgentTask` claim is atomic per row and fair (per-owner capped), so
many instances of this worker can drain the same table concurrently without double-running, and no single
user's backlog can starve another's.

## Deploy

Build the bundle and start it (process-supervised, e.g. systemd or pm2):

```
yarn workspace @internal/agent-worker build
node apps/agent-worker/dist/worker.js
```

### Required environment

- `DATABASE_URL` - same database as the API.
- `APP_SECRET_MASTER_KEY` - to decrypt each agent's provider `ProviderCredential` (the model API key).
- `WEB_ORIGIN` - used to build the MCP OAuth redirect for agents with attached MCP servers.

### Optional tuning

- `AGENT_WORKER_CONCURRENCY` (default 10) - max chat runs in flight (the `p-limit(N)` pool size).
- `AGENT_WORKER_USER_CAP` (default 3) - max simultaneously running tasks for one owner.
- `AGENT_WORKER_IDLE_MS` (default 1000) - poll interval when the queue had nothing claimable.
- `AGENT_RUN_TIMEOUT_MS` (default 600000) - hard wall-clock ceiling per chat run.
- `AGENT_CANCEL_POLL_MS` (default 3000) - how often a run checks for a cross-process Stop.

## Scaling

Run more instances for more throughput; they pull-balance off the shared queue. Each instance also
reconciles only chat runtime on boot, so it never disturbs a coding run another worker is executing.
