FROM node:24-alpine AS base

RUN corepack enable && apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/ai/package.json packages/ai/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/db/package.json packages/db/package.json

RUN pnpm install --frozen-lockfile

FROM base AS build

COPY . .
RUN pnpm build

FROM node:24-alpine AS runtime-base

RUN corepack enable && apk add --no-cache libc6-compat
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=build /app/packages ./packages

FROM runtime-base AS api

COPY --from=build /app/apps/api ./apps/api
CMD ["node", "apps/api/dist/main.js"]

FROM runtime-base AS worker

COPY --from=build /app/apps/worker ./apps/worker
CMD ["node", "apps/worker/dist/main.js"]

FROM runtime-base AS web

COPY --from=build /app/apps/web ./apps/web
WORKDIR /app/apps/web
CMD ["node", "node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0"]
