# Traceforge Phase 0 — Design Spec

**Date:** 2026-03-14
**Scope:** Full Phase 0 MVP — Infrastructure → API → Web → SDK → MCP
**Approach:** Vertical Slice (縦切り) — one full trace flows end-to-end before expanding

---

## Goal

Build a working observability platform where:
1. A developer can send an OTel trace from any tool (cURL, SDK, Claude Code)
2. The trace is stored in TimescaleDB
3. The developer can view it in a web dashboard with a causal graph

---

## Architecture Overview

```
[Agent / SDK / cURL]
        │  OTLP/HTTP JSON
        ▼
[apps/api — Hono + Bun]
   ├─ POST /v1/traces        OTel ingest (synchronous, no queue)
   ├─ /trpc/traces.*         tRPC CRUD (via Hono fetch adapter)
   └─ /trpc/spans.*          tRPC CRUD (via Hono fetch adapter)
        │
        ▼
[PostgreSQL + TimescaleDB]
   ├─ schema: otel      (traces, spans — hypertable on start_time)
   └─ schema: app       (future: sessions, agents, settings)
        │
[apps/web — Next.js 15]
   ├─ /traces           Trace list (RSC streaming)
   ├─ /traces/[id]      Trace detail + Span timeline
   └─ /traces/[id]/graph  React Flow causal graph
        │
[packages/mcp-server]
   └─ Claude Code MCP   query traces, get span detail
```

**Note:** BullMQ / Redis is NOT used in Phase 0. Ingest is synchronous. Redis stays in docker-compose for Phase 1+ but the API does not depend on it yet.

---

## Phase 1: Infrastructure

### Monorepo Setup

- **Package manager**: Bun workspaces
- **Root `package.json`**: workspace globs `["apps/*", "packages/*"]`
- **Shared tsconfig**: `tsconfig.base.json` at root; each app/package extends it with `"extends": "../../tsconfig.base.json"`
- **Root scripts**: `dev`, `test`, `typecheck`, `lint`, `lint:fix` delegating to workspaces

### Docker Compose Files

Two files per CLAUDE.md:

**`docker-compose.yml`** (production-like, no hot-reload):
| Service | Image | Port |
|---------|-------|------|
| `db` | `timescale/timescaledb:latest-pg16` | 5432 |
| `redis` | `redis:7-alpine` | 6379 |
| `api` | build from `apps/api/Dockerfile` | 3001 |
| `web` | build from `apps/web/Dockerfile` | 3000 |

**`docker-compose.dev.yml`** (Compose merge overlay — used with `-f docker-compose.yml -f docker-compose.dev.yml`):
- Defines only `api` and `web` service overrides (command + volume mount)
- `db` and `redis` are inherited from `docker-compose.yml` via Compose merge semantics
- Correct dev startup command: `docker compose -f docker-compose.yml -f docker-compose.dev.yml up`
- The root `bun run dev` script uses this two-file form

### Environment Variables

`.env.example` at repo root (all apps read from this via docker-compose):

```
# Database
TRACEFORGE_DATABASE_URL=postgresql://traceforge:traceforge@db:5432/traceforge

# Redis (reserved for Phase 1+)
TRACEFORGE_REDIS_URL=redis://redis:6379

# API Security (optional in dev — if unset, all requests are accepted)
TRACEFORGE_API_KEY=

# API URL (used by web, MCP server, SDKs)
TRACEFORGE_API_URL=http://localhost:3001

# MCP server
TRACEFORGE_MCP_API_URL=http://localhost:3001
TRACEFORGE_MCP_API_KEY=
```

### Database Schema (Drizzle ORM)

**Schema: `otel`**

```typescript
import { pgSchema, text, integer, numeric, timestamp, jsonb, pgEnum } from 'drizzle-orm/pg-core'
import { type Json } from '../types'

export const otelSchema = pgSchema('otel')

export const statusEnum = pgEnum('status', ['running', 'success', 'error'])
export const spanKindEnum = pgEnum('span_kind', ['llm', 'tool', 'agent', 'retrieval', 'custom'])

export const traces = otelSchema.table('traces', {
  id: text('id').primaryKey(),                     // ULID
  sessionId: text('session_id').notNull(),          // fallback: 'default'
  agentId: text('agent_id').notNull(),              // fallback: 'unknown'
  name: text('name').notNull(),
  input: jsonb('input'),
  output: jsonb('output'),
  startTime: timestamp('start_time', { withTimezone: true }).notNull(), // hypertable partition key
  endTime: timestamp('end_time', { withTimezone: true }),
  totalTokens: integer('total_tokens').default(0).notNull(),
  totalCostUsd: numeric('total_cost_usd', { precision: 10, scale: 6 }).default('0').notNull(),
  status: statusEnum('status').default('running').notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
})

export const spans = otelSchema.table('spans', {
  id: text('id').primaryKey(),
  traceId: text('trace_id').notNull().references(() => traces.id, { onDelete: 'cascade' }),
  parentSpanId: text('parent_span_id'),             // null = root span
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
  events: jsonb('events').$type<Json[]>().default([]).notNull(),  // OTel span events
})
```

After migration, promote `traces` to TimescaleDB hypertable:
```sql
SELECT create_hypertable('otel.traces', 'start_time');
```

---

## Phase 2: API

### tRPC + Hono Integration

Use `@trpc/server/adapters/fetch` with a Hono route:

```typescript
// apps/api/src/routes/trpc.ts
import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import { appRouter } from '../trpc/router'

export const trpcRoute = new Hono().all('/trpc/*', (c) =>
  fetchRequestHandler({
    endpoint: '/trpc',
    req: c.req.raw,
    router: appRouter,
    createContext: () => ({ db }),
  })
)
```

### Authentication (Optional Dev Mode)

All routes check `X-Traceforge-Api-Key` header against `TRACEFORGE_API_KEY`.
If `TRACEFORGE_API_KEY` is empty/unset, **all requests are accepted** (dev mode).

```typescript
// apps/api/src/middleware/auth.ts
export const apiKeyMiddleware = createMiddleware(async (c, next) => {
  const apiKey = process.env.TRACEFORGE_API_KEY
  if (!apiKey) return next()  // dev mode: no auth
  if (c.req.header('X-Traceforge-Api-Key') !== apiKey) {
    return c.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid API key' } }, 401)
  }
  return next()
})
```

### OTel Ingest Endpoint — OTLP/HTTP JSON Mapping

`POST /v1/traces` — accepts OTLP/HTTP JSON (`Content-Type: application/json`).

**OTLP envelope shape:**
```json
{
  "resourceSpans": [{
    "resource": {
      "attributes": [
        { "key": "service.name", "value": { "stringValue": "my-agent" } },
        { "key": "traceforge.agent_id", "value": { "stringValue": "claude-code" } },
        { "key": "traceforge.session_id", "value": { "stringValue": "session-abc" } }
      ]
    },
    "scopeSpans": [{
      "spans": [{
        "traceId": "...",       // hex string → used as trace.id (ULID generated server-side)
        "spanId": "...",        // hex string → span.id
        "parentSpanId": "...",  // hex string or absent
        "name": "generate_code",
        "startTimeUnixNano": "1234567890000000000",
        "endTimeUnixNano": "1234567900000000000",
        "status": { "code": 1 },  // 0=unset, 1=ok, 2=error
        "attributes": [
          { "key": "traceforge.kind", "value": { "stringValue": "llm" } },
          { "key": "llm.model", "value": { "stringValue": "claude-opus-4-6" } },
          { "key": "llm.input_tokens", "value": { "intValue": "1500" } },
          { "key": "llm.output_tokens", "value": { "intValue": "800" } },
          { "key": "llm.cost_usd", "value": { "doubleValue": 0.012 } },
          { "key": "traceforge.input", "value": { "stringValue": "{\"prompt\": \"...\"}" } },
          { "key": "traceforge.output", "value": { "stringValue": "{\"code\": \"...\"}" } }
        ],
        "events": [...]
      }]
    }]
  }]
}
```

**Mapping rules (OTLP → internal):**

| Internal field | Source | Fallback |
|----------------|--------|---------|
| `trace.agentId` | resource attr `traceforge.agent_id` | resource attr `service.name` → `"unknown"` |
| `trace.sessionId` | resource attr `traceforge.session_id` | `"default"` |
| `trace.name` | root span (no parentSpanId) `.name` | first span name |
| `trace.input` | root span attr `traceforge.input` (JSON parse) | `null` |
| `trace.output` | root span attr `traceforge.output` (JSON parse) | `null` |
| `trace.totalTokens` | sum of all span `llm.input_tokens` + `llm.output_tokens` | `0` |
| `trace.totalCostUsd` | sum of all span `llm.cost_usd` | `0` |
| `trace.status` | any span with OTel status 2 → `"error"`, else → `"success"` | `"success"` |
| `span.kind` | span attr `traceforge.kind` | `"custom"` |
| `span.model` | span attr `llm.model` | `null` |
| `span.inputTokens` | span attr `llm.input_tokens` | `0` |
| `span.outputTokens` | span attr `llm.output_tokens` | `0` |
| `span.costUsd` | span attr `llm.cost_usd` | `0` |

Response: `{ success: true, traceId: "<ulid>" }` (synchronous, no queue).

### tRPC Router

```typescript
// Keyset pagination: cursor encodes { startTime: ISO string, id: ULID } as base64 JSON
// Sort: ORDER BY start_time DESC, id DESC — cursor provides exact restart point
// Decode: const { startTime, id } = JSON.parse(atob(cursor))
// Query: WHERE (start_time, id) < (cursorStartTime, cursorId)

traces.list({
  cursor?: string   // base64(JSON({ startTime: string, id: string })) of last seen trace
  limit?: number    // default 20, max 100
  agentId?: string
  status?: 'running' | 'success' | 'error'
  search?: string   // pg full-text search on name + metadata (tsquery)
}) → { items: Trace[], nextCursor: string | null }

traces.get(id: string) → Trace & { spans: Span[] }

traces.delete(id: string) → void

spans.get(id: string) → Span
spans.listByTrace(traceId: string) → Span[]

// Used by MCP search_traces tool
traces.search(query: string, limit?: number) → Trace[]
```

### Error Handling

```typescript
type Result<T, E> = { ok: true; data: T } | { ok: false; error: E }

type TraceError =
  | { code: 'NOT_FOUND'; traceId: string }      // matches CLAUDE.md
  | { code: 'VALIDATION_FAILED'; field: string; message: string }
  | { code: 'DB_ERROR'; cause: unknown }
  | { code: 'PARSE_ERROR'; message: string }
```

All service functions return `Result<T, TraceError>`. Routes map to HTTP responses.

---

## Phase 3: Web Frontend

### tRPC Client Setup

```typescript
// apps/web/lib/trpc.ts
import { createTRPCReact } from '@trpc/react-query'
import type { AppRouter } from '../../api/src/trpc/router'

export const trpc = createTRPCReact<AppRouter>()
```

### Pages

| Route | Rendering | Data |
|-------|-----------|------|
| `/` | Server redirect | → `/traces` |
| `/traces` | RSC + Suspense | `traces.list()` infinite |
| `/traces/[id]` | RSC | `traces.get(id)` |
| `/traces/[id]/graph` | Client Component | `spans.listByTrace(id)` |

### TraceList
- Infinite scroll via `useInfiniteQuery` + `traces.list` cursor
- Columns: name, agent, status badge, total tokens, cost ($), duration, relative time
- Status badge: running=blue, success=green, error=red
- Click row → navigate to `/traces/[id]`

### TraceDetail
- Header card: agentId, sessionId, totalTokens, totalCostUsd, duration
- Span waterfall: sorted by `startTime ASC`, width proportional to duration
- Click span → expand inline to show `attributes` + `events` as JSON tree

### AgentGraph (React Flow)
- Each `Span` → one node (kind determines color: llm=purple, tool=orange, agent=blue, retrieval=green, custom=gray)
- Edges from `parentSpanId` → `id`
- Layout: `dagre` library (top-down, `rankdir: 'TB'`)
- Click node → Zustand sets `selectedSpanId` → slide-over panel renders span detail
- Zustand store shape:
  ```typescript
  type GraphStore = {
    selectedSpanId: string | null
    setSelectedSpanId: (id: string | null) => void
  }
  ```

---

## Phase 4: SDK + MCP

### TypeScript SDK (`@traceforge/sdk`)

Thin wrapper over `@opentelemetry/sdk-node` + `@opentelemetry/exporter-trace-otlp-http`:

```typescript
import { TraceforgeSDK } from '@traceforge/sdk'

const sdk = new TraceforgeSDK({
  endpoint: process.env.TRACEFORGE_API_URL ?? 'http://localhost:3001',
  agentId: 'my-agent',
  sessionId: 'optional-session',   // defaults to 'default'
  apiKey: process.env.TRACEFORGE_API_KEY,  // optional
})

await sdk.start()
const tracer = sdk.getTracer('my-agent')

const span = tracer.startSpan('generate_code', {
  attributes: {
    'traceforge.kind': 'llm',
    'llm.model': 'claude-opus-4-6',
  }
})
// ... do work
span.end()
await sdk.shutdown()
```

Internally sets OTel resource attributes:
- `service.name` = `agentId`
- `traceforge.agent_id` = `agentId`
- `traceforge.session_id` = `sessionId`

### Python SDK (`traceforge`)

```python
from traceforge import TraceforgeSDK
import os

sdk = TraceforgeSDK(
    endpoint=os.getenv("TRACEFORGE_API_URL", "http://localhost:3001"),
    agent_id="my-agent",
    session_id="optional-session",
    api_key=os.getenv("TRACEFORGE_API_KEY"),
)

with sdk:
    tracer = sdk.get_tracer("my-agent")
    with tracer.start_as_current_span("search_docs") as span:
        span.set_attribute("traceforge.kind", "retrieval")
        span.set_attribute("query", "how does X work")
        # ... do work
```

### MCP Server (`traceforge-mcp`)

**Environment variables:**
```
TRACEFORGE_MCP_API_URL=http://localhost:3001   # required
TRACEFORGE_MCP_API_KEY=                         # optional (matches TRACEFORGE_API_KEY)
```

**Tools:**

| Tool | tRPC call | Description |
|------|-----------|-------------|
| `list_traces` | `traces.list` | List recent traces with optional filters |
| `get_trace` | `traces.get` | Full trace with all spans |
| `get_span` | `spans.get` | Single span detail |
| `search_traces` | `traces.search` | Full-text search over trace names |

Zero-config: `claude mcp add traceforge -- npx traceforge-mcp`
Reads `TRACEFORGE_MCP_API_URL` from environment (defaults to `http://localhost:3001`).

---

## Testing Strategy

| Layer | Tool | Type | Notes |
|-------|------|------|-------|
| API services | Vitest | Unit | Result union assertions, no DB |
| API routes | Vitest + Hono test client | Integration | Real PostgreSQL via Docker |
| OTel ingest parser | Vitest | Unit | Test OTLP → internal mapping |
| Web components | Vitest + RTL | Unit | Mock tRPC calls |
| E2E | Playwright | Smoke | Trace list renders after ingest |
| TS SDK | Vitest | Unit | Mock OTLP exporter, verify attributes |
| Python SDK | pytest | Unit | Mock OTLP exporter, verify attributes |
| MCP tools | Vitest | Unit | Mock API calls, verify tool output |

---

## Success Criteria (Phase 0 Complete)

- [ ] `docker compose -f docker-compose.yml -f docker-compose.dev.yml up` starts all 4 services cleanly
- [ ] `curl -X POST localhost:3001/v1/traces` with OTLP JSON → `{ success: true, traceId }` + trace in DB
- [ ] `localhost:3000/traces` lists the trace (agentId, name, status, tokens, cost)
- [ ] `/traces/[id]/graph` renders a DAG with nodes colored by span kind
- [ ] `claude mcp add traceforge -- npx traceforge-mcp` → `list_traces` returns JSON
- [ ] TypeScript SDK: `sdk.start()` + 3 spans → trace appears in dashboard
- [ ] Python SDK: context manager + 3 spans → trace appears in dashboard

---

*Spec created: 2026-03-14 | Rev 2 (post-review fixes)*
