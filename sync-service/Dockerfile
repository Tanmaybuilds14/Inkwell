# syntax=docker/dockerfile:1

# ---------- Inkwell sync service (WebSocket + Yjs rooms) ----------
# Build (from repo root):  docker build -t inkwell-sync -f sync-service/Dockerfile sync-service
# Run:                     docker run --env-file .env -p 1234:1234 inkwell-sync
#
# Needs an always-on process — deploy on Railway/Fly/Render (>=2 instances to
# exercise the Redis cross-server broadcast path), never on serverless.

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    SYNC_PORT=1234

# node:24-alpine ships a built-in non-root `node` user — reuse it.
COPY --from=deps /app/node_modules ./node_modules
COPY src ./src
COPY package.json ./
RUN chown -R node:node /app

USER node
EXPOSE 1234

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.SYNC_PORT||1234)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
