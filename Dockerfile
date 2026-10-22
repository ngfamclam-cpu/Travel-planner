# Multi-stage build for the web app and the worker (one repo, two images).
FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/providers/package.json packages/providers/
COPY packages/db/package.json packages/db/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
RUN npm ci

FROM deps AS source
COPY . .
RUN npx prisma generate --schema packages/db/prisma/schema.prisma

FROM source AS web-build
# Pages are rendered on request; the build never touches the database.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- web: Next.js standalone server ----
FROM base AS web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=web-build /app/apps/web/.next/standalone ./
COPY --from=web-build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=web-build /app/apps/web/public ./apps/web/public
COPY --from=web-build /app/node_modules/.prisma ./node_modules/.prisma
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

# ---- worker: migrations, seed, scheduled jobs ----
FROM source AS worker
ENV NODE_ENV=production
CMD ["sh", "-c", "npx prisma migrate deploy --schema packages/db/prisma/schema.prisma && npm run db:seed && npm run worker"]
