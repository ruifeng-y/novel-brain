FROM node:22-alpine

ENV NODE_OPTIONS=--dns-result-order=ipv4first
RUN corepack enable && corepack prepare pnpm@10.20.0 --activate
WORKDIR /app

COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @novel/worker... build

CMD ["node", "apps/worker/dist/main.js"]
