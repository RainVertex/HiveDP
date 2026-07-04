# Per-run sandbox image for the coding runtime. Built and published separately from the monorepo; the
# coding worker draws one ephemeral `docker run --rm` of this image from a warm pool per coding run. The
# Node runner orchestrates git and drives Aider (the model-agnostic coding agent) as the brain, so the
# image carries Node (for the runner) plus Python + Aider + git. Run it locked down: gVisor (runsc)
# runtime, non-root user, all caps dropped, --read-only rootfs, tmpfs /work and /tmp, an egress-allowlist
# network, cpu/mem/pids limits, no-new-privileges. The whole job including secrets arrives as one JSON
# payload on stdin, and the single JSON result line is on stdout.
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

# Drop to the unprivileged node user (uid 1000, ships with the image and has a passwd entry so git and
# Aider find a real user). Every runtime write lands in the /work and /tmp tmpfs, so the read-only rootfs
# and non-root user do not get in the runner's way.
USER node

# The runner reads the job spec from stdin and writes one JSON result line to stdout.
ENTRYPOINT ["npx", "tsx", "src/index.ts"]
