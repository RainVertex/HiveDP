# coding-runner

The per-run sandbox image for the coding runtime. The coding worker spawns one ephemeral container of
this image per coding run (`docker run --rm`). The Node runner clones the target repo into tmpfs, drives
**Aider** (the model-agnostic coding agent) over the working tree, pushes any changes to a branch, and
prints a single JSON result line.

This package is **not** part of the running API or worker process. Aider (and the untrusted shell/git it
drives) live only inside this image. Aider is model-agnostic, so the same image runs GPT-5.5, Claude,
Gemini, etc. depending on the agent's configured model.

## Contract

- **stdin**: one JSON `CodingJobPayload`: `{ spec, llmApiKey, gitToken }`. `spec` is the non-secret `CodingJobSpec` (`repoUrl, owner, repo, branch, message, aiderModel, apiKeyEnvVar, apiBase`); `llmApiKey` is the agent's provider key (exported under `apiKeyEnvVar` for Aider, empty for keyless); `gitToken` is a short-lived installation token (~1h). Secrets travel on stdin (not argv, not env) so they never appear in `ps` or `docker inspect`, and so a pre-warmed container can be handed them only once a job is assigned.
- **stdout**: exactly one JSON `CodingRunnerResult` line: `{ ok, hadChanges, branch, finalText, usage, error }`. All logs go to stderr. Token counts come from Aider's analytics log; the host turns them into cost with the platform's own model pricing.

## Cost note

Aider does not enforce a hard token/cost budget. The platform bounds spend with the container timeout,
the per-model daily token cap (checked before the run), and per-agent model choice. A budget-capping
OpenAI-compatible gateway behind `apiBase` is the way to add a hard spend ceiling.

## Build

```
docker build -t coding-runner:latest apps/coding-runner
```

Set `CODING_RUNNER_IMAGE=coding-runner:latest` on the coding worker.

## Run hardening (enforced by the worker)

The worker runs each container with `--rm -i --read-only --tmpfs /work --tmpfs /tmp --security-opt
no-new-privileges --cpus --memory` (HOME points at the writable `/work` tmpfs) and an egress-allowlist
network (`CODING_RUNNER_NETWORK`) that permits only the model provider API (e.g. OpenAI) and GitHub.
Create that network on the host before enabling the runtime; the default (`none`) fails closed (no
egress, so the clone cannot reach GitHub). For local dev use `bridge`.
