FROM node:22-alpine

ENV NODE_OPTIONS=--dns-result-order=ipv4first
ENV API_INTERNAL_URL=http://api:3001
RUN corepack enable && corepack prepare pnpm@10.20.0 --activate
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @novel/web... build

EXPOSE 3000
CMD ["pnpm", "--filter", "@novel/web", "start"]
