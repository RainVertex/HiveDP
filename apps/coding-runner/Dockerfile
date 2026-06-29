# Per-run sandbox image for the coding runtime. Built and published separately from the monorepo; the
# coding worker draws one ephemeral `docker run --rm` of this image from a warm pool per coding run. The
# Node runner orchestrates git and drives Aider (the model-agnostic coding agent) as the brain, so the
# image carries Node (for the runner) plus Python + Aider + git. Run it locked down: --read-only rootfs,
# tmpfs /work, an egress-allowlist network, cpu/mem limits, --security-opt no-new-privileges. The whole
# job including secrets arrives as one JSON payload on stdin; the single JSON result line is on stdout.
FROM node:22-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates python3 python3-venv \
  && rm -rf /var/lib/apt/lists/*

# Aider in an isolated venv (avoids Debian's externally-managed-environment restriction), on PATH.
RUN python3 -m venv /opt/aider \
  && /opt/aider/bin/pip install --no-cache-dir aider-chat
ENV PATH="/opt/aider/bin:${PATH}"

WORKDIR /app

COPY package.json ./
RUN npm install --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src

ENV NODE_ENV=production
ENV CODING_WORKDIR_ROOT=/work

# The runner reads the job spec from stdin and writes one JSON result line to stdout.
ENTRYPOINT ["npx", "tsx", "src/index.ts"]
