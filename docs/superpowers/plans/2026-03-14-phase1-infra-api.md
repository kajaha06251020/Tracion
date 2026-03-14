# Traceforge Phase 1 — Infrastructure + API Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a fully working Traceforge backend — monorepo, Docker, DB schema, OTel ingest endpoint, and tRPC CRUD API — so a developer can send traces via cURL and query them via tRPC.

**Architecture:** Bun monorepo with workspaces; Hono API with tRPC via fetch adapter; PostgreSQL + TimescaleDB via Drizzle ORM; synchronous OTel ingest with OTLP/HTTP JSON mapping.

**Tech Stack:** Bun, Hono, tRPC v11, Drizzle ORM, PostgreSQL 16 + TimescaleDB, Vitest, Biome

**Spec:** `docs/superpowers/specs/2026-03-14-traceforge-phase0-design.md`

---

## File Map

```
(root)
├── package.json                          CREATE — bun workspaces root
├── tsconfig.base.json                    CREATE — shared TS strict config
├── biome.json                            CREATE — linter/formatter config
├── .gitignore                            CREATE — standard Bun/Node ignores
├── .env.example                          CREATE — all TRACEFORGE_ vars
├── docker-compose.yml                    CREATE — prod-like services
├── docker-compose.dev.yml                CREATE — merge overlay with hot-reload

apps/api/
├── package.json                          CREATE — api workspace deps
├── tsconfig.json                         CREATE — extends tsconfig.base.json
├── src/
│   ├── index.ts                          CREATE — Hono app + server entry
│   ├── types.ts                          CREATE — Result<T,E>, TraceError, Json
│   ├── middleware/
│   │   └── auth.ts                       CREATE — X-Traceforge-Api-Key check
│   ├── db/
│   │   ├── index.ts                      CREATE — Drizzle client + pg pool
│   │   ├── schema.ts                     CREATE — traces + spans tables
│   │   └── migrate.ts                    CREATE — run migrations script
│   ├── otel/
│   │   └── parser.ts                     CREATE — OTLP JSON → internal mapping
│   ├── services/
│   │   ├── trace.ts                      CREATE — createTrace, getTrace, listTraces, deleteTrace, searchTraces
│   │   └── span.ts                       CREATE — getSpan, listSpansByTrace
│   ├── trpc/
│   │   ├── context.ts                    CREATE — tRPC context (db)
│   │   ├── router.ts                     CREATE — appRouter combining sub-routers
│   │   └── routers/
│   │       ├── traces.ts                 CREATE — traces tRPC router
│   │       └── spans.ts                  CREATE — spans tRPC router
│   └── routes/
│       ├── ingest.ts                     CREATE — POST /v1/traces
│       └── trpc.ts                       CREATE — mount tRPC on Hono
│
├── src/otel/parser.test.ts               CREATE — unit tests for OTLP parser
├── src/services/trace.test.ts            CREATE — unit tests for trace service
├── src/services/span.test.ts             CREATE — unit tests for span service
└── Dockerfile                            CREATE — multi-stage Bun image
```

---

## Chunk 1: Monorepo Scaffold + Docker

### Task 1: Root package.json + workspaces

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `biome.json`
- Create: `.gitignore`

- [ ] **Step 1: Create root `package.json`**

```json
{
  "name": "traceforge",
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev": "docker compose -f docker-compose.yml -f docker-compose.dev.yml up",
    "test": "bun run --filter='*' test",
    "typecheck": "bun run --filter='*' typecheck",
    "lint": "biome check .",
    "lint:fix": "biome check --write ."
  }
}
```

- [ ] **Step 2: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ESNext"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  }
}
```

- [ ] **Step 3: Create `biome.json`**

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "organizeImports": { "enabled": true },
  "linter": {
    "enabled": true,
    "rules": { "recommended": true }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2
  }
}
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
.env
.env.local
dist/
.next/
.turbo/
*.tsbuildinfo
bun.lockb
```

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.base.json biome.json .gitignore
git commit -m "chore: init bun monorepo with workspaces and shared tsconfig"
```

---

### Task 2: Environment variables + Docker Compose

**Files:**
- Create: `.env.example`
- Create: `docker-compose.yml`
- Create: `docker-compose.dev.yml`

- [ ] **Step 1: Create `.env.example`**

```env
# Database
TRACEFORGE_DATABASE_URL=postgresql://traceforge:traceforge@db:5432/traceforge

# Redis (reserved for Phase 1+, not used by API yet)
TRACEFORGE_REDIS_URL=redis://redis:6379

# API Security (leave empty in dev to disable auth)
TRACEFORGE_API_KEY=

# API URL (used by web, MCP, SDKs)
TRACEFORGE_API_URL=http://localhost:3001

# MCP server
TRACEFORGE_MCP_API_URL=http://localhost:3001
TRACEFORGE_MCP_API_KEY=
```

- [ ] **Step 2: Copy for local use**

```bash
cp .env.example .env
```

- [ ] **Step 3: Create `docker-compose.yml`**

```yaml
services:
  db:
    image: timescale/timescaledb:latest-pg16
    environment:
      POSTGRES_DB: traceforge
      POSTGRES_USER: traceforge
      POSTGRES_PASSWORD: traceforge
    ports:
      - "5432:5432"
    volumes:
      - db_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U traceforge"]
      interval: 5s
      timeout: 5s
      retries: 10

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

  api:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    ports:
      - "3001:3001"
    env_file: .env
    depends_on:
      db:
        condition: service_healthy

  web:
    build:
      context: .
      dockerfile: apps/web/Dockerfile
    ports:
      - "3000:3000"
    env_file: .env
    depends_on:
      - api

volumes:
  db_data:
```

- [ ] **Step 4: Create `docker-compose.dev.yml`**

```yaml
# Merge overlay: run with:
# docker compose -f docker-compose.yml -f docker-compose.dev.yml up
services:
  api:
    command: bun run dev
    volumes:
      - ./apps/api:/app/apps/api
      - /app/apps/api/node_modules
    environment:
      NODE_ENV: development

  web:
    command: bun run dev
    volumes:
      - ./apps/web:/app/apps/web
      - /app/apps/web/node_modules
    environment:
      NODE_ENV: development
```

- [ ] **Step 5: Commit**

```bash
git add .env.example docker-compose.yml docker-compose.dev.yml
git commit -m "chore: add docker-compose and env template"
```

---

## Chunk 2: API Package Setup + Types

### Task 3: API package.json + tsconfig

**Files:**
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`

- [ ] **Step 1: Create `apps/api/package.json`**

```json
{
  "name": "@traceforge/api",
  "private": true,
  "scripts": {
    "dev": "bun run --hot src/index.ts",
    "start": "bun run src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "db:migrate": "bun run src/db/migrate.ts",
    "db:generate": "drizzle-kit generate"
  },
  "dependencies": {
    "hono": "^4.6.0",
    "@hono/node-server": "^1.13.0",
    "@trpc/server": "^11.0.0",
    "drizzle-orm": "^0.38.0",
    "pg": "^8.13.0",
    "ulid": "^2.3.0",
    "pino": "^9.5.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.4",
    "@types/pg": "^8.11.0",
    "drizzle-kit": "^0.30.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `apps/api/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Install dependencies**

```bash
cd apps/api && bun install
```

Expected: `bun.lockb` updated, `node_modules` created.

- [ ] **Step 4: Create `apps/api/vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/package.json apps/api/tsconfig.json apps/api/vitest.config.ts bun.lockb
git commit -m "chore(api): add package.json, tsconfig, and vitest config"
```

---

### Task 4: Shared types

**Files:**
- Create: `apps/api/src/types.ts`

- [ ] **Step 1: Write `apps/api/src/types.ts`**

```typescript
// Result monad — never throw in service layer
export type Result<T, E> = { ok: true; data: T } | { ok: false; error: E }

export const ok = <T>(data: T): Result<T, never> => ({ ok: true, data })
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error })

// Typed errors
export type TraceError =
  | { code: 'NOT_FOUND'; traceId: string }
  | { code: 'VALIDATION_FAILED'; field: string; message: string }
  | { code: 'DB_ERROR'; cause: unknown }
  | { code: 'PARSE_ERROR'; message: string }

// JSON type for jsonb columns
export type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [key: string]: Json }

// HTTP response shape
export type ApiSuccess<T> = { success: true; data: T }
export type ApiError = { success: false; error: { code: string; message: string; details?: unknown } }
export type ApiResponse<T> = ApiSuccess<T> | ApiError

export const apiOk = <T>(data: T): ApiSuccess<T> => ({ success: true, data })
export const apiErr = (code: string, message: string, details?: unknown): ApiError => ({
  success: false,
  error: { code, message, details },
})

// Trace/Span domain types
export type TraceStatus = 'running' | 'success' | 'error'
export type SpanKind = 'llm' | 'tool' | 'agent' | 'retrieval' | 'custom'

export type Trace = {
  id: string
  sessionId: string
  agentId: string
  name: string
  input: Json | null
  output: Json | null
  startTime: Date
  endTime: Date | null
  totalTokens: number
  totalCostUsd: string  // numeric from DB comes as string
  status: TraceStatus
  metadata: Record<string, unknown>
}

export type Span = {
  id: string
  traceId: string
  parentSpanId: string | null
  kind: SpanKind
  name: string
  model: string | null
  inputTokens: number
  outputTokens: number
  costUsd: string  // numeric from DB comes as string
  startTime: Date
  endTime: Date | null
  status: TraceStatus
  attributes: Record<string, unknown>
  events: Json[]
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/types.ts
git commit -m "feat(api): add shared Result type, errors, and domain types"
```

---

## Chunk 3: Database Layer

### Task 5: Drizzle schema + DB connection

**Files:**
- Create: `apps/api/src/db/schema.ts`
- Create: `apps/api/src/db/index.ts`
- Create: `apps/api/src/db/migrate.ts`
- Create: `apps/api/drizzle.config.ts`

- [ ] **Step 1: Write `apps/api/src/db/schema.ts`**

```typescript
import {
  pgSchema,
  text,
  integer,
  numeric,
  timestamp,
  jsonb,
  pgEnum,
} from 'drizzle-orm/pg-core'
import type { Json } from '../types'

export const otelSchema = pgSchema('otel')

// NOTE: enums are scoped to the otel schema (not public) via otelSchema.enum
// This differs from top-level pgEnum() — otelSchema.enum is the correct pattern here
export const statusEnum = otelSchema.enum('status', ['running', 'success', 'error'])
export const spanKindEnum = otelSchema.enum('span_kind', ['llm', 'tool', 'agent', 'retrieval', 'custom'])

export const traces = otelSchema.table('traces', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  agentId: text('agent_id').notNull(),
  name: text('name').notNull(),
  input: jsonb('input'),
  output: jsonb('output'),
  startTime: timestamp('start_time', { withTimezone: true }).notNull(),
  endTime: timestamp('end_time', { withTimezone: true }),
  totalTokens: integer('total_tokens').default(0).notNull(),
  totalCostUsd: numeric('total_cost_usd', { precision: 10, scale: 6 }).default('0').notNull(),
  status: statusEnum('status').default('running').notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
})

export const spans = otelSchema.table('spans', {
  id: text('id').primaryKey(),
  traceId: text('trace_id')
    .notNull()
    .references(() => traces.id, { onDelete: 'cascade' }),
  parentSpanId: text('parent_span_id'),
  kind: spanKindEnum('kind').default('custom').notNull(),
  name: text('name').notNull(),
  model: text('model'),
  inputTokens: integer('input_tokens').default(0).notNull(),
  outputTokens: integer('output_tokens').default(0).notNull(),
  costUsd: numeric('cost_usd', { precision: 10, scale: 6 }).default('0').notNull(),
  startTime: timestamp('start_time', { withTimezone: true }).notNull(),
  endTime: timestamp('end_time', { withTimezone: true }),
  status: statusEnum('status').default('running').notNull(),
  attributes: jsonb('attributes').$type<Record<string, unknown>>().default({}).notNull(),
  events: jsonb('events').$type<Json[]>().default([]).notNull(),
})

export type DbTrace = typeof traces.$inferSelect
export type DbSpan = typeof spans.$inferSelect
export type NewTrace = typeof traces.$inferInsert
export type NewSpan = typeof spans.$inferInsert
```

- [ ] **Step 2: Write `apps/api/src/db/index.ts`**

```typescript
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

const pool = new Pool({
  connectionString: process.env.TRACEFORGE_DATABASE_URL,
})

export const db = drizzle(pool, { schema })
export type DB = typeof db
```

- [ ] **Step 3: Write `apps/api/src/db/migrate.ts`**

```typescript
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'

const pool = new Pool({
  connectionString: process.env.TRACEFORGE_DATABASE_URL,
})

const db = drizzle(pool)

async function main(): Promise<void> {
  console.log('Running migrations...')
  await migrate(db, { migrationsFolder: './src/db/migrations' })
  console.log('Migrations complete.')
  await pool.end()
}

main().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
```

- [ ] **Step 4: Write `apps/api/drizzle.config.ts`**

```typescript
import type { Config } from 'drizzle-kit'

export default {
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.TRACEFORGE_DATABASE_URL ?? '',
  },
  schemaFilter: ['otel'],
} satisfies Config
```

- [ ] **Step 5: Generate initial migration**

```bash
cd apps/api && bun run db:generate
```

Expected: `src/db/migrations/0000_initial.sql` created with CREATE SCHEMA and table DDL.

- [ ] **Step 6: Add TimescaleDB hypertable to migration**

Open `apps/api/src/db/migrations/0000_initial.sql`, append at the end:

```sql
-- Enable TimescaleDB and create hypertable
CREATE EXTENSION IF NOT EXISTS timescaledb;
SELECT create_hypertable('otel.traces', 'start_time', if_not_exists => TRUE);
```

- [ ] **Step 7: Start DB and run migration to verify**

```bash
docker compose up db -d
# Wait for healthcheck to pass (about 10s)
cd apps/api && bun run db:migrate
```

Expected:
```
Running migrations...
Migrations complete.
```

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/db/ apps/api/drizzle.config.ts
git commit -m "feat(api): add drizzle schema, db connection, migration with timescaledb hypertable"
```

---

## Chunk 4: Auth Middleware + OTLP Parser

### Task 6: Auth middleware

**Files:**
- Create: `apps/api/src/middleware/auth.ts`

- [ ] **Step 1: Write `apps/api/src/middleware/auth.ts`**

```typescript
import { createMiddleware } from 'hono/factory'
import { apiErr } from '../types'

export const apiKeyMiddleware = createMiddleware(async (c, next) => {
  const requiredKey = process.env.TRACEFORGE_API_KEY
  // Dev mode: no auth if key is unset or empty
  if (!requiredKey) {
    return next()
  }
  const providedKey = c.req.header('X-Traceforge-Api-Key')
  if (providedKey !== requiredKey) {
    return c.json(apiErr('UNAUTHORIZED', 'Invalid or missing API key'), 401)
  }
  return next()
})
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/middleware/auth.ts
git commit -m "feat(api): add optional API key auth middleware"
```

---

### Task 7: OTLP parser (with TDD)

**Files:**
- Create: `apps/api/src/otel/parser.ts`
- Create: `apps/api/src/otel/parser.test.ts`

- [ ] **Step 1: Write the failing tests first**

Create `apps/api/src/otel/parser.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { parseOtlpPayload } from './parser'

const minimalPayload = {
  resourceSpans: [
    {
      resource: {
        attributes: [
          { key: 'service.name', value: { stringValue: 'my-agent' } },
        ],
      },
      scopeSpans: [
        {
          spans: [
            {
              traceId: 'aabbccdd00112233',
              spanId: 'span001122334455',
              name: 'generate_code',
              startTimeUnixNano: '1700000000000000000',
              endTimeUnixNano: '1700000001000000000',
              status: { code: 1 },
              attributes: [],
              events: [],
            },
          ],
        },
      ],
    },
  ],
}

describe('parseOtlpPayload', () => {
  it('extracts agentId from traceforge.agent_id attribute', () => {
    const payload = structuredClone(minimalPayload)
    payload.resourceSpans[0]!.resource.attributes.push(
      { key: 'traceforge.agent_id', value: { stringValue: 'claude-code' } }
    )
    const { trace } = parseOtlpPayload(payload)
    expect(trace.agentId).toBe('claude-code')
  })

  it('falls back agentId to service.name', () => {
    const { trace } = parseOtlpPayload(minimalPayload)
    expect(trace.agentId).toBe('my-agent')
  })

  it('falls back agentId to "unknown" when no resource attrs', () => {
    const payload = structuredClone(minimalPayload)
    payload.resourceSpans[0]!.resource.attributes = []
    const { trace } = parseOtlpPayload(payload)
    expect(trace.agentId).toBe('unknown')
  })

  it('defaults sessionId to "default"', () => {
    const { trace } = parseOtlpPayload(minimalPayload)
    expect(trace.sessionId).toBe('default')
  })

  it('extracts sessionId from traceforge.session_id attribute', () => {
    const payload = structuredClone(minimalPayload)
    payload.resourceSpans[0]!.resource.attributes.push(
      { key: 'traceforge.session_id', value: { stringValue: 'sess-abc' } }
    )
    const { trace } = parseOtlpPayload(payload)
    expect(trace.sessionId).toBe('sess-abc')
  })

  it('uses root span name as trace name', () => {
    const { trace } = parseOtlpPayload(minimalPayload)
    expect(trace.name).toBe('generate_code')
  })

  it('maps OTel status code 2 to "error"', () => {
    const payload = structuredClone(minimalPayload)
    payload.resourceSpans[0]!.scopeSpans[0]!.spans[0]!.status.code = 2
    const { trace } = parseOtlpPayload(payload)
    expect(trace.status).toBe('error')
  })

  it('maps OTel status code 1 to "success"', () => {
    const { trace } = parseOtlpPayload(minimalPayload)
    expect(trace.status).toBe('success')
  })

  it('parses unix nano timestamps to Date', () => {
    const { spans } = parseOtlpPayload(minimalPayload)
    expect(spans[0]!.startTime).toBeInstanceOf(Date)
    expect(spans[0]!.startTime.getFullYear()).toBe(2023)
  })

  it('maps traceforge.kind span attribute to span.kind', () => {
    const payload = structuredClone(minimalPayload)
    payload.resourceSpans[0]!.scopeSpans[0]!.spans[0]!.attributes.push(
      { key: 'traceforge.kind', value: { stringValue: 'llm' } }
    )
    const { spans } = parseOtlpPayload(payload)
    expect(spans[0]!.kind).toBe('llm')
  })

  it('sums tokens across all spans for trace.totalTokens', () => {
    const payload = structuredClone(minimalPayload)
    payload.resourceSpans[0]!.scopeSpans[0]!.spans[0]!.attributes.push(
      { key: 'llm.input_tokens', value: { intValue: '500' } },
      { key: 'llm.output_tokens', value: { intValue: '300' } }
    )
    const { trace } = parseOtlpPayload(payload)
    expect(trace.totalTokens).toBe(800)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd apps/api && bun run test src/otel/parser.test.ts
```

Expected: FAIL — `parseOtlpPayload` not found.

- [ ] **Step 3: Implement `apps/api/src/otel/parser.ts`**

```typescript
import { ulid } from 'ulid'
import type { NewTrace, NewSpan } from '../db/schema'
import type { TraceStatus, SpanKind } from '../types'

// OTLP/HTTP JSON types (subset we care about)
type OtlpAttributeValue =
  | { stringValue: string }
  | { intValue: string }
  | { doubleValue: number }
  | { boolValue: boolean }

type OtlpAttribute = { key: string; value: OtlpAttributeValue }

type OtlpSpan = {
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  startTimeUnixNano: string
  endTimeUnixNano?: string
  status?: { code?: number }
  attributes?: OtlpAttribute[]
  events?: unknown[]
}

type OtlpPayload = {
  resourceSpans: Array<{
    resource?: { attributes?: OtlpAttribute[] }
    scopeSpans: Array<{ spans: OtlpSpan[] }>
  }>
}

type ParseResult = {
  trace: NewTrace
  spans: NewSpan[]
}

function getStringAttr(attrs: OtlpAttribute[] | undefined, key: string): string | undefined {
  const attr = attrs?.find((a) => a.key === key)
  if (!attr) return undefined
  return 'stringValue' in attr.value ? attr.value.stringValue : undefined
}

function getNumberAttr(attrs: OtlpAttribute[] | undefined, key: string): number {
  const attr = attrs?.find((a) => a.key === key)
  if (!attr) return 0
  const v = attr.value
  if ('intValue' in v) return parseInt(v.intValue, 10)
  if ('doubleValue' in v) return v.doubleValue
  return 0
}

function nanoToDate(nano: string): Date {
  return new Date(Number(BigInt(nano) / 1_000_000n))
}

function otlpStatusToInternal(code?: number): TraceStatus {
  if (code === 2) return 'error'
  if (code === 1) return 'success'
  return 'success'
}

// NOTE: Phase 0 processes only the first resourceSpan in a batch.
// Multi-service batches (multiple resourceSpans) are a Phase 1+ concern.
export function parseOtlpPayload(payload: OtlpPayload): ParseResult {
  const firstResourceSpan = payload.resourceSpans[0]
  if (!firstResourceSpan) {
    throw new Error('Empty OTLP payload: no resourceSpans')
  }

  const traceId = ulid()
  const allSpans: NewSpan[] = []
  let rootSpan: OtlpSpan | undefined
  let totalTokens = 0
  let totalCostUsd = 0
  let hasError = false

  const resourceAttrs = firstResourceSpan.resource?.attributes ?? []
  const agentId =
    getStringAttr(resourceAttrs, 'traceforge.agent_id') ??
    getStringAttr(resourceAttrs, 'service.name') ??
    'unknown'
  const sessionId = getStringAttr(resourceAttrs, 'traceforge.session_id') ?? 'default'

  for (const scopeSpan of firstResourceSpan.scopeSpans) {
    for (const span of scopeSpan.spans) {
      const spanAttrs = span.attributes ?? []

      const inputTokens = getNumberAttr(spanAttrs, 'llm.input_tokens')
      const outputTokens = getNumberAttr(spanAttrs, 'llm.output_tokens')
      const costUsd = getNumberAttr(spanAttrs, 'llm.cost_usd')

      totalTokens += inputTokens + outputTokens
      totalCostUsd += costUsd

      const statusCode = span.status?.code
      if (statusCode === 2) hasError = true

      const kind = (getStringAttr(spanAttrs, 'traceforge.kind') ?? 'custom') as SpanKind

      const newSpan: NewSpan = {
        id: span.spanId,
        traceId,
        parentSpanId: span.parentSpanId ?? null,
        kind,
        name: span.name,
        model: getStringAttr(spanAttrs, 'llm.model') ?? null,
        inputTokens,
        outputTokens,
        costUsd: costUsd.toFixed(6),
        startTime: nanoToDate(span.startTimeUnixNano),
        endTime: span.endTimeUnixNano ? nanoToDate(span.endTimeUnixNano) : null,
        status: otlpStatusToInternal(statusCode),
        attributes: Object.fromEntries(
          spanAttrs.map((a) => [a.key, Object.values(a.value)[0]])
        ) as Record<string, unknown>,
        events: (span.events ?? []) as NewSpan['events'],
      }

      if (!span.parentSpanId) {
        rootSpan = span
      }

      ;(newSpan.attributes as Record<string, unknown>)['traceforge.agent_id'] = agentId
      ;(newSpan.attributes as Record<string, unknown>)['traceforge.session_id'] = sessionId

      allSpans.push(newSpan)
    }
  }

  const rootAttrs = rootSpan?.attributes ?? []
  const inputRaw = getStringAttr(rootAttrs, 'traceforge.input')
  const outputRaw = getStringAttr(rootAttrs, 'traceforge.output')
  const firstSpanStart = firstResourceSpan.scopeSpans[0]?.spans[0]?.startTimeUnixNano

  const trace: NewTrace = {
    id: traceId,
    sessionId,
    agentId,
    name: rootSpan?.name ?? allSpans[0]?.name ?? 'unknown',
    input: inputRaw ? (JSON.parse(inputRaw) as NewTrace['input']) : null,
    output: outputRaw ? (JSON.parse(outputRaw) as NewTrace['output']) : null,
    startTime: nanoToDate(rootSpan?.startTimeUnixNano ?? firstSpanStart ?? '0'),
    endTime: rootSpan?.endTimeUnixNano ? nanoToDate(rootSpan.endTimeUnixNano) : null,
    totalTokens,
    totalCostUsd: totalCostUsd.toFixed(6),
    status: hasError ? 'error' : 'success',
    metadata: {},
  }

  return { trace, spans: allSpans }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd apps/api && bun run test src/otel/parser.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/otel/
git commit -m "feat(api): add OTLP/HTTP JSON parser with full field mapping"
```

---

## Chunk 5: Service Layer

### Task 8: Trace service (with TDD)

**Files:**
- Create: `apps/api/src/services/trace.ts`
- Create: `apps/api/src/services/trace.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/api/src/services/trace.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { DB } from '../db/index'

// We test services with a mock DB — real DB tests go in integration tests
const mockDb = {
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis(),
  returning: vi.fn(),
} as unknown as DB

// Reset mocks before each test
beforeEach(() => {
  vi.clearAllMocks()
})

describe('createTrace', () => {
  it('returns ok result with trace id on success', async () => {
    const { createTrace } = await import('./trace')
    mockDb.insert = vi.fn().mockReturnThis()
    ;(mockDb as unknown as { values: ReturnType<typeof vi.fn> }).values = vi.fn().mockReturnThis()
    ;(mockDb as unknown as { returning: ReturnType<typeof vi.fn> }).returning = vi
      .fn()
      .mockResolvedValue([{ id: 'trace-001' }])

    const result = await createTrace(mockDb, {
      id: 'trace-001',
      sessionId: 'default',
      agentId: 'test-agent',
      name: 'test',
      startTime: new Date(),
      totalTokens: 0,
      totalCostUsd: '0',
      status: 'success',
      metadata: {},
    })

    expect(result.ok).toBe(true)
  })

  it('returns DB_ERROR result when insert throws', async () => {
    const { createTrace } = await import('./trace')
    mockDb.insert = vi.fn().mockReturnThis()
    ;(mockDb as unknown as { values: ReturnType<typeof vi.fn> }).values = vi.fn().mockReturnThis()
    ;(mockDb as unknown as { returning: ReturnType<typeof vi.fn> }).returning = vi
      .fn()
      .mockRejectedValue(new Error('connection refused'))

    const result = await createTrace(mockDb, {
      id: 'trace-001',
      sessionId: 'default',
      agentId: 'test-agent',
      name: 'test',
      startTime: new Date(),
      totalTokens: 0,
      totalCostUsd: '0',
      status: 'success',
      metadata: {},
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('DB_ERROR')
  })
})

describe('getTrace', () => {
  it('returns NOT_FOUND when trace does not exist', async () => {
    const { getTrace } = await import('./trace')
    mockDb.select = vi.fn().mockReturnThis()
    ;(mockDb as unknown as { from: ReturnType<typeof vi.fn> }).from = vi.fn().mockReturnThis()
    ;(mockDb as unknown as { where: ReturnType<typeof vi.fn> }).where = vi.fn().mockReturnThis()
    ;(mockDb as unknown as { limit: ReturnType<typeof vi.fn> }).limit = vi
      .fn()
      .mockResolvedValue([])

    const result = await getTrace(mockDb, 'nonexistent')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND')
      expect(result.error.traceId).toBe('nonexistent')
    }
  })
})
```

- [ ] **Step 2: Run tests — confirm FAIL**

```bash
cd apps/api && bun run test src/services/trace.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `apps/api/src/services/trace.ts`**

```typescript
import { eq, lt, and, desc, sql } from 'drizzle-orm'
import type { DB } from '../db/index'
import { traces, spans } from '../db/schema'
import type { NewTrace } from '../db/schema'
import { ok, err, type Result, type TraceError, type Trace, type Span } from '../types'

type ListTracesInput = {
  cursor?: string
  limit?: number
  agentId?: string
  status?: 'running' | 'success' | 'error'
  search?: string
}

type Cursor = { startTime: string; id: string }

function encodeCursor(trace: { startTime: Date; id: string }): string {
  const payload: Cursor = { startTime: trace.startTime.toISOString(), id: trace.id }
  return btoa(JSON.stringify(payload))
}

function decodeCursor(cursor: string): Cursor | null {
  try {
    return JSON.parse(atob(cursor)) as Cursor
  } catch {
    return null
  }
}

export async function createTrace(
  db: DB,
  input: NewTrace
): Promise<Result<{ id: string }, TraceError>> {
  try {
    const [row] = await db.insert(traces).values(input).returning({ id: traces.id })
    if (!row) return err({ code: 'DB_ERROR', cause: 'no row returned' })
    return ok({ id: row.id })
  } catch (cause) {
    return err({ code: 'DB_ERROR', cause })
  }
}

export async function getTrace(
  db: DB,
  traceId: string
): Promise<Result<Trace & { spans: Span[] }, TraceError>> {
  try {
    const [row] = await db.select().from(traces).where(eq(traces.id, traceId)).limit(1)
    if (!row) return err({ code: 'NOT_FOUND', traceId })

    const spanRows = await db
      .select()
      .from(spans)
      .where(eq(spans.traceId, traceId))
      .orderBy(spans.startTime)

    const trace: Trace & { spans: Span[] } = {
      ...row,
      spans: spanRows as Span[],
    } as Trace & { spans: Span[] }

    return ok(trace)
  } catch (cause) {
    return err({ code: 'DB_ERROR', cause })
  }
}

export async function listTraces(
  db: DB,
  input: ListTracesInput
): Promise<Result<{ items: Trace[]; nextCursor: string | null }, TraceError>> {
  try {
    const limit = Math.min(input.limit ?? 20, 100)
    const cursor = input.cursor ? decodeCursor(input.cursor) : null

    const conditions = []

    if (cursor) {
      const cursorTime = new Date(cursor.startTime)
      conditions.push(
        sql`(${traces.startTime}, ${traces.id}) < (${cursorTime}, ${cursor.id})`
      )
    }
    if (input.agentId) conditions.push(eq(traces.agentId, input.agentId))
    if (input.status) conditions.push(eq(traces.status, input.status))
    if (input.search) {
      conditions.push(sql`${traces.name} ILIKE ${'%' + input.search + '%'}`)
    }

    const rows = await db
      .select()
      .from(traces)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(traces.startTime), desc(traces.id))
      .limit(limit + 1)

    const hasMore = rows.length > limit
    const items = hasMore ? rows.slice(0, limit) : rows
    const lastItem = items.at(-1)
    const nextCursor = hasMore && lastItem ? encodeCursor(lastItem) : null

    return ok({ items: items as Trace[], nextCursor })
  } catch (cause) {
    return err({ code: 'DB_ERROR', cause })
  }
}

export async function deleteTrace(
  db: DB,
  traceId: string
): Promise<Result<void, TraceError>> {
  try {
    const result = await db.delete(traces).where(eq(traces.id, traceId)).returning({ id: traces.id })
    if (result.length === 0) return err({ code: 'NOT_FOUND', traceId })
    return ok(undefined)
  } catch (cause) {
    return err({ code: 'DB_ERROR', cause })
  }
}

export async function searchTraces(
  db: DB,
  query: string,
  limit = 20
): Promise<Result<Trace[], TraceError>> {
  try {
    const rows = await db
      .select()
      .from(traces)
      .where(sql`${traces.name} ILIKE ${'%' + query + '%'}`)
      .orderBy(desc(traces.startTime))
      .limit(Math.min(limit, 100))
    return ok(rows as Trace[])
  } catch (cause) {
    return err({ code: 'DB_ERROR', cause })
  }
}
```

- [ ] **Step 4: Run tests — confirm PASS**

```bash
cd apps/api && bun run test src/services/trace.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/trace.ts apps/api/src/services/trace.test.ts
git commit -m "feat(api): add trace service with Result error handling and keyset pagination"
```

---

### Task 9: Span service

**Files:**
- Create: `apps/api/src/services/span.ts`
- Create: `apps/api/src/services/span.test.ts`

- [ ] **Step 1: Write `apps/api/src/services/span.test.ts`**

```typescript
import { describe, it, expect, vi } from 'vitest'
import type { DB } from '../db/index'

const mockDb = {
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  returning: vi.fn(),
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
} as unknown as DB

describe('getSpan', () => {
  it('returns NOT_FOUND for missing span', async () => {
    const { getSpan } = await import('./span')
    ;(mockDb as unknown as { limit: ReturnType<typeof vi.fn> }).limit = vi
      .fn()
      .mockResolvedValue([])

    const result = await getSpan(mockDb, 'nonexistent')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND')
  })
})

describe('listSpansByTrace', () => {
  it('returns empty array when no spans exist', async () => {
    const { listSpansByTrace } = await import('./span')
    ;(mockDb as unknown as { orderBy: ReturnType<typeof vi.fn> }).orderBy = vi
      .fn()
      .mockResolvedValue([])

    const result = await listSpansByTrace(mockDb, 'trace-001')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data).toEqual([])
  })
})
```

- [ ] **Step 2: Run — confirm FAIL**

```bash
cd apps/api && bun run test src/services/span.test.ts
```

- [ ] **Step 3: Implement `apps/api/src/services/span.ts`**

```typescript
import { eq } from 'drizzle-orm'
import type { DB } from '../db/index'
import { spans } from '../db/schema'
import type { NewSpan } from '../db/schema'
import { ok, err, type Result, type TraceError, type Span } from '../types'

export async function createSpans(
  db: DB,
  input: NewSpan[]
): Promise<Result<void, TraceError>> {
  if (input.length === 0) return ok(undefined)
  try {
    await db.insert(spans).values(input)
    return ok(undefined)
  } catch (cause) {
    return err({ code: 'DB_ERROR', cause })
  }
}

export async function getSpan(
  db: DB,
  spanId: string
): Promise<Result<Span, TraceError>> {
  try {
    const [row] = await db.select().from(spans).where(eq(spans.id, spanId)).limit(1)
    // Reuse TraceError.NOT_FOUND — traceId field holds the lookup id (span id in this case)
    if (!row) return err({ code: 'NOT_FOUND', traceId: spanId })
    return ok(row as Span)
  } catch (cause) {
    return err({ code: 'DB_ERROR', cause })
  }
}

export async function listSpansByTrace(
  db: DB,
  traceId: string
): Promise<Result<Span[], TraceError>> {
  try {
    const rows = await db
      .select()
      .from(spans)
      .where(eq(spans.traceId, traceId))
      .orderBy(spans.startTime)
    return ok(rows as Span[])
  } catch (cause) {
    return err({ code: 'DB_ERROR', cause })
  }
}
```

- [ ] **Step 4: Run — confirm PASS**

```bash
cd apps/api && bun run test src/services/span.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/span.ts apps/api/src/services/span.test.ts
git commit -m "feat(api): add span service"
```

---

## Chunk 6: tRPC Router + Hono Routes

### Task 10: tRPC setup

**Files:**
- Create: `apps/api/src/trpc/context.ts`
- Create: `apps/api/src/trpc/router.ts`
- Create: `apps/api/src/trpc/routers/traces.ts`
- Create: `apps/api/src/trpc/routers/spans.ts`

- [ ] **Step 1: Write `apps/api/src/trpc/context.ts`**

```typescript
import { db } from '../db/index'
import type { DB } from '../db/index'

export type Context = {
  db: DB
}

export function createContext(): Context {
  return { db }
}
```

- [ ] **Step 2: Write `apps/api/src/trpc/router.ts`**

```typescript
import { initTRPC } from '@trpc/server'
import type { Context } from './context'
import { tracesRouter } from './routers/traces'
import { spansRouter } from './routers/spans'

const t = initTRPC.context<Context>().create()

export const router = t.router
export const publicProcedure = t.procedure

export const appRouter = router({
  traces: tracesRouter,
  spans: spansRouter,
})

export type AppRouter = typeof appRouter
```

- [ ] **Step 3: Write `apps/api/src/trpc/routers/traces.ts`**

```typescript
import { z } from 'zod'
import { router, publicProcedure } from '../router'
import {
  getTrace,
  listTraces,
  deleteTrace,
  searchTraces,
} from '../../services/trace'
import { TRPCError } from '@trpc/server'

function traceErrorToTRPC(code: string): TRPCError {
  if (code === 'NOT_FOUND') return new TRPCError({ code: 'NOT_FOUND' })
  return new TRPCError({ code: 'INTERNAL_SERVER_ERROR' })
}

export const tracesRouter = router({
  list: publicProcedure
    .input(
      z.object({
        cursor: z.string().optional(),
        limit: z.number().min(1).max(100).default(20),
        agentId: z.string().optional(),
        status: z.enum(['running', 'success', 'error']).optional(),
        search: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const result = await listTraces(ctx.db, input)
      if (!result.ok) throw traceErrorToTRPC(result.error.code)
      return result.data
    }),

  get: publicProcedure
    .input(z.string())
    .query(async ({ ctx, input }) => {
      const result = await getTrace(ctx.db, input)
      if (!result.ok) throw traceErrorToTRPC(result.error.code)
      return result.data
    }),

  delete: publicProcedure
    .input(z.string())
    .mutation(async ({ ctx, input }) => {
      const result = await deleteTrace(ctx.db, input)
      if (!result.ok) throw traceErrorToTRPC(result.error.code)
    }),

  search: publicProcedure
    .input(z.object({ query: z.string(), limit: z.number().default(20) }))
    .query(async ({ ctx, input }) => {
      const result = await searchTraces(ctx.db, input.query, input.limit)
      if (!result.ok) throw traceErrorToTRPC(result.error.code)
      return result.data
    }),
})
```

- [ ] **Step 4: Write `apps/api/src/trpc/routers/spans.ts`**

```typescript
import { z } from 'zod'
import { router, publicProcedure } from '../router'
import { getSpan, listSpansByTrace } from '../../services/span'
import { TRPCError } from '@trpc/server'

export const spansRouter = router({
  get: publicProcedure
    .input(z.string())
    .query(async ({ ctx, input }) => {
      const result = await getSpan(ctx.db, input)
      if (!result.ok) throw new TRPCError({ code: 'NOT_FOUND' })
      return result.data
    }),

  listByTrace: publicProcedure
    .input(z.string())
    .query(async ({ ctx, input }) => {
      const result = await listSpansByTrace(ctx.db, input)
      if (!result.ok) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' })
      return result.data
    }),
})
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/trpc/
git commit -m "feat(api): add tRPC router with traces and spans procedures"
```

---

### Task 11: Hono routes (ingest + tRPC mount)

**Files:**
- Create: `apps/api/src/routes/ingest.ts`
- Create: `apps/api/src/routes/trpc.ts`
- Create: `apps/api/src/index.ts`
- Create: `apps/api/Dockerfile`

- [ ] **Step 1: Write `apps/api/src/routes/ingest.ts`**

```typescript
import { Hono } from 'hono'
import { apiKeyMiddleware } from '../middleware/auth'
import { parseOtlpPayload } from '../otel/parser'
import { createTrace } from '../services/trace'
import { createSpans } from '../services/span'
import { db } from '../db/index'
import { apiOk, apiErr } from '../types'
import pino from 'pino'

const logger = pino()

export const ingestRoute = new Hono()

ingestRoute.post('/v1/traces', apiKeyMiddleware, async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(apiErr('PARSE_ERROR', 'Invalid JSON body'), 400)
  }

  let parsed: ReturnType<typeof parseOtlpPayload>
  try {
    parsed = parseOtlpPayload(body as Parameters<typeof parseOtlpPayload>[0])
  } catch (e) {
    return c.json(apiErr('PARSE_ERROR', e instanceof Error ? e.message : 'OTLP parse error'), 400)
  }

  const traceResult = await createTrace(db, parsed.trace)
  if (!traceResult.ok) {
    logger.error({ error: traceResult.error }, 'failed to save trace')
    return c.json(apiErr('DB_ERROR', 'Failed to save trace'), 500)
  }

  const spansResult = await createSpans(db, parsed.spans)
  if (!spansResult.ok) {
    logger.error({ error: spansResult.error }, 'failed to save spans')
    return c.json(apiErr('DB_ERROR', 'Failed to save spans'), 500)
  }

  logger.info({ traceId: traceResult.data.id }, 'trace ingested')
  // Flat response per spec: { success: true, traceId: "..." } (NOT wrapped in data)
  return c.json({ success: true, traceId: traceResult.data.id }, 201)
})
```

- [ ] **Step 2: Write `apps/api/src/routes/trpc.ts`**

```typescript
import { Hono } from 'hono'
import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import { appRouter } from '../trpc/router'
import { createContext } from '../trpc/context'
import { apiKeyMiddleware } from '../middleware/auth'

export const trpcRoute = new Hono()

trpcRoute.use('/trpc/*', apiKeyMiddleware)

trpcRoute.all('/trpc/*', (c) =>
  fetchRequestHandler({
    endpoint: '/trpc',
    req: c.req.raw,
    router: appRouter,
    createContext,
  })
)
```

- [ ] **Step 3: Write `apps/api/src/index.ts`**

```typescript
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger as honoLogger } from 'hono/logger'
import { ingestRoute } from './routes/ingest'
import { trpcRoute } from './routes/trpc'

const app = new Hono()

app.use('*', honoLogger())
app.use('*', cors({ origin: '*' }))

app.route('/', ingestRoute)
app.route('/', trpcRoute)

app.get('/health', (c) => c.json({ status: 'ok' }))

const port = parseInt(process.env.PORT ?? '3001', 10)
console.log(`API running on http://localhost:${port}`)

export default {
  port,
  fetch: app.fetch,
}
```

- [ ] **Step 4: Write `apps/api/Dockerfile`**

```dockerfile
FROM oven/bun:1.1-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json bun.lockb ./
COPY apps/api/package.json ./apps/api/
# Copy packages/ directory (may be empty at Phase 1, but required for workspace resolution)
COPY packages/ ./packages/
RUN bun install --frozen-lockfile

FROM base AS runner
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY . .

WORKDIR /app/apps/api
CMD ["bun", "run", "src/index.ts"]
```

- [ ] **Step 5: Run API locally to smoke test**

```bash
# Terminal 1: start DB
docker compose up db -d
cd apps/api && bun run db:migrate

# Terminal 2: start API
cd apps/api && bun run dev
# Expected: "API running on http://localhost:3001"

# Terminal 3: health check
curl http://localhost:3001/health
# Expected: {"status":"ok"}

# Send a minimal OTLP trace
curl -X POST http://localhost:3001/v1/traces \
  -H "Content-Type: application/json" \
  -d '{
    "resourceSpans": [{
      "resource": {
        "attributes": [
          {"key": "service.name", "value": {"stringValue": "test-agent"}},
          {"key": "traceforge.agent_id", "value": {"stringValue": "test-agent"}}
        ]
      },
      "scopeSpans": [{
        "spans": [{
          "traceId": "abc123",
          "spanId": "span001",
          "name": "test_trace",
          "startTimeUnixNano": "1700000000000000000",
          "endTimeUnixNano": "1700000001000000000",
          "status": {"code": 1},
          "attributes": [],
          "events": []
        }]
      }]
    }]
  }'
# Expected: {"success":true,"data":{"traceId":"<ulid>"}}
```

- [ ] **Step 6: Run full test suite**

```bash
cd apps/api && bun run test
```

Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/ apps/api/src/index.ts apps/api/Dockerfile
git commit -m "feat(api): wire up Hono app with OTel ingest and tRPC mount"
```

---

## Chunk 7: Final Verification

### Task 12: Full stack smoke test

- [ ] **Step 1: Start all services**

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

Expected: `db`, `redis`, `api`, `web` all start (web will error — that's fine for Plan 1).
`api` health: `curl http://localhost:3001/health` → `{"status":"ok"}`

- [ ] **Step 2: Run migration in running container**

```bash
docker compose exec api bun run db:migrate
```

Expected: `Migrations complete.`

- [ ] **Step 3: Send test trace and verify**

```bash
TRACE_RESULT=$(curl -s -X POST http://localhost:3001/v1/traces \
  -H "Content-Type: application/json" \
  -d '{
    "resourceSpans": [{
      "resource": {"attributes": [{"key": "traceforge.agent_id", "value": {"stringValue": "smoke-test"}}]},
      "scopeSpans": [{"spans": [
        {"traceId": "smoke001", "spanId": "s001", "name": "root_span",
         "startTimeUnixNano": "1700000000000000000", "endTimeUnixNano": "1700000002000000000",
         "status": {"code": 1}, "attributes": [], "events": []},
        {"traceId": "smoke001", "spanId": "s002", "parentSpanId": "s001", "name": "child_span",
         "startTimeUnixNano": "1700000000500000000", "endTimeUnixNano": "1700000001500000000",
         "status": {"code": 1}, "attributes": [{"key": "traceforge.kind", "value": {"stringValue": "llm"}}], "events": []}
      ]}]
    }]
  }')

echo $TRACE_RESULT
# Expected: {"success":true,"traceId":"<ulid>"}
```

- [ ] **Step 4: Query via tRPC HTTP**

```bash
# {} must be URL-encoded as %7B%7D for the tRPC fetch adapter to parse correctly
curl "http://localhost:3001/trpc/traces.list?input=%7B%7D"
# Expected: {"result":{"data":{"items":[...],"nextCursor":null}}}
```

- [ ] **Step 5: Run full test suite**

```bash
bun run test
bun run typecheck
bun run lint
```

Expected: All pass.

- [ ] **Step 6: Final commit**

```bash
git add .
git commit -m "feat: complete Phase 1 — Infra + API with OTel ingest and tRPC CRUD"
```

---

## Success Criteria

- [ ] `docker compose -f docker-compose.yml -f docker-compose.dev.yml up` starts db, redis, api cleanly
- [ ] `GET /health` returns `{"status":"ok"}`
- [ ] `POST /v1/traces` with OTLP JSON returns `{"success":true,"traceId":"<ulid>"}`
- [ ] `GET /trpc/traces.list` returns the ingested trace
- [ ] All unit tests pass (`bun run test`)
- [ ] TypeScript strict mode passes (`bun run typecheck`)
- [ ] Linter passes (`bun run lint`)

---

*Plan 1 of 3 | Next: `2026-03-14-phase2-web.md`*
