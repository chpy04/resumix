# Resumix app image — the **production lane only**.
#
# Development never builds this. `npm run dev` runs Next on the host against
# the `db` and `latex` containers in `docker-compose.yml`; this image exists
# solely for `docker-compose.prod.yml` (see docs/DEPLOYMENT.md).
#
# Why an image at all, when prod runs on the same laptop as dev: so the prod
# instance owns its own `.next`. Two Next processes sharing one build
# directory corrupt it — the `ENOENT .next/routes-manifest.json` failure
# CLAUDE.md warns about — and a prod server that falls over whenever someone
# runs `npm run build` in the checkout is not a prod server (D-031).

# Pinned to a major, not `latest`: the runtime stage relies on Node's
# type-stripping to run `scripts/*.ts` directly (see the migrate stage note
# below), which is default-on from 23.6 and would silently change meaning
# under a major bump.
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# No DATABASE_URL on purpose. D-014's lazy client is what makes `next build`
# work on a machine with no database, and building here without one is a
# standing test that it still does.
RUN npm run build

# ---------------------------------------------------------------------------
# Migration/seed image. Full source + full node_modules, so `scripts/*.ts`
# run exactly as they do on a developer's machine. `docker-compose.prod.yml`
# runs this under a compose profile, so it is never started by `up` — only
# by `docker compose run --rm migrate` from scripts/deploy-prod.sh.
#
# Separate from the runtime stage below because the runtime stage is Next's
# `standalone` output, whose `.next/package.json` is `{"type":"commonjs"}`;
# running ESM TypeScript under it is a coin flip we do not need to take.
# ---------------------------------------------------------------------------
FROM build AS migrate
WORKDIR /app
CMD ["npm", "run", "db:migrate"]

# ---------------------------------------------------------------------------
# Runtime. `output: 'standalone'` traces the runtime dependency graph into
# `.next/standalone`, so this stage carries neither the full node_modules nor
# the toolchain that built it.
# ---------------------------------------------------------------------------
FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

USER node
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://localhost:3000/login').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
