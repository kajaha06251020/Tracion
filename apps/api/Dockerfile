FROM oven/bun:1.1-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json ./
COPY apps/api/package.json ./apps/api/
# Copy packages/ directory (may be empty at Phase 1, but required for workspace resolution)
COPY packages/ ./packages/
RUN bun install

FROM base AS runner
COPY --from=deps /app/node_modules ./node_modules
COPY . .

WORKDIR /app/apps/api
CMD ["bun", "run", "src/index.ts"]
