# syntax=docker/dockerfile:1

# Yalniz manifestler: install katmani kaynak degisikliginde cache'te kalir.
FROM node:22-bookworm-slim AS manifests
WORKDIR /app
COPY . .
RUN find . -mindepth 1 -type f ! -name "package.json" ! -name "yarn.lock" -delete \
  && find . -mindepth 1 -type d -empty -delete

FROM node:22-bookworm-slim AS builder
WORKDIR /app
ENV HUSKY=0
COPY --from=manifests /app ./
RUN yarn install --frozen-lockfile
COPY . .
RUN yarn db:generate
RUN yarn build

# Runtime for api, agent-worker ve coding-worker (compose command ile secilir).
# Bundle'lar workspace kodunu iceriyor, node_modules yalnizca third party icin gerekli.
FROM node:22-bookworm-slim AS app
ENV NODE_ENV=production
WORKDIR /app
# coding-worker her kosu icin "docker run" cagirir, statik CLI yeterli (soket compose'dan mount edilir).
COPY --from=docker:28-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/db/package.json ./packages/db/package.json
COPY --from=builder /app/packages/db/prisma.config.ts ./packages/db/prisma.config.ts
COPY --from=builder /app/packages/db/prisma ./packages/db/prisma
COPY --from=builder /app/packages/db/src ./packages/db/src
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/agent-worker/dist ./apps/agent-worker/dist
COPY --from=builder /app/apps/coding-worker/dist ./apps/coding-worker/dist
CMD ["node", "apps/api/dist/server.js"]

# SPA'yi servis eden ve /api trafigini api konteynerine geciren Caddy.
FROM caddy:2-alpine AS web
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=builder /app/apps/web/dist /srv
