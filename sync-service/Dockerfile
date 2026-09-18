# syntax=docker/dockerfile:1

# ---------- Inkwell sync service (WebSocket + Yjs rooms) ----------
# NOTE: the build context is the REPO ROOT, not sync-service/. The service
# imports the wire contract shared with the Next.js app (shared/protocol.js,
# shared/roles.js, shared/timing-safe.js), so those files must be inside the
# build context.
#
# Build:  docker build -t inkwell-sync -f sync-service/Dockerfile .
# Run:    docker run --env-file .env -p 1234:1234 inkwell-sync
#
# The image mirrors the repo layout (/app/shared + /app/sync-service/src) so
# the same `../../shared/...` relative imports resolve identically here and in
# local dev. sync-service/Dockerfile.dockerignore keeps the context small.
#
# Needs an always-on process — deploy on Railway/Fly/Render (>=2 instances to
# exercise the Redis cross-server broadcast path), never on serverless.

FROM node:24-alpine AS deps
WORKDIR /app/sync-service
COPY sync-service/package.json sync-service/package-lock.json ./
# npm ci (not install) so the image gets exactly the locked dependency tree.
RUN npm ci --omit=dev

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    SYNC_PORT=1234

# node:24-alpine ships a built-in non-root `node` user — reuse it.
COPY --from=deps /app/sync-service/node_modules ./sync-service/node_modules
COPY shared ./shared
COPY sync-service/src ./sync-service/src
COPY sync-service/package.json ./sync-service/package.json
RUN chown -R node:node /app

USER node
EXPOSE 1234

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.SYNC_PORT||1234)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "sync-service/src/server.js"]
