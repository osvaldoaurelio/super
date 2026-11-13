FROM oven/bun:1.3.14-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

FROM deps AS build
COPY . .
RUN bun run typecheck && bun run lint && bun run test

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build --chown=bun:bun /app/package.json ./package.json
COPY --from=build --chown=bun:bun /app/bun.lock ./bun.lock
RUN bun install --production --frozen-lockfile
COPY --from=build --chown=bun:bun /app/src ./src
COPY --from=build --chown=bun:bun /app/drizzle ./drizzle
USER bun
EXPOSE 3000
CMD ["bun", "run", "start"]
