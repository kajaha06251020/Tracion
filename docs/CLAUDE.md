# Traceforge — CLAUDE.md

> **This file is the project constitution.** Changes require team consensus.
> *Last updated: 2026-03-14*

---

## What Is Traceforge?

**Traceforge** is an open-source observability platform for AI agents.
It answers: *"What did my agent do, and why did it make that decision?"*

### Mission
- The only OSS tracer built natively for Claude Code / MCP
- Visualize multi-agent causal graphs (an unsolved problem space)
- Full stack launches with `docker compose up` — one command, zero config
- Self-hosted by default — your data never leaves your machine

### Who Is It For?
| User | Use Case |
|------|----------|
| AI-first developers | Trace Claude Code / Cursor / Aider workflows |
| Multi-agent teams | Debug n8n / Dify / LangGraph pipelines |
| Langfuse migrants | Self-hosted alternative after ClickHouse acquisition uncertainty |

---

## Quick Start (5 minutes)

```bash
# 1. Clone
git clone https://github.com/<org>/traceforge && cd traceforge

# 2. Start everything
docker compose up

# 3. Open dashboard
open http://localhost:3000

# 4. Register MCP server (Claude Code users)
claude mcp add traceforge -- npx traceforge-mcp
```

That's it. Traces appear automatically.

---

## Architecture

### Tech Stack

#### Backend (`apps/api`)
| Layer | Technology | Why |
|-------|-----------|-----|
| Runtime | **Bun** | 3× faster than Node for I/O-heavy workloads |
| Framework | **Hono** | Tiny bundle, edge-ready, typed routes |
| Time-series DB | **PostgreSQL + TimescaleDB** | SQL familiarity + columnar compression; no ClickHouse |
| Session DB | PostgreSQL (separate schema) | Single infra, no extra ops cost |
| Cache / Queue | **Redis + BullMQ** | Standard job queue, easy to swap |
| Trace ingest | **OpenTelemetry Collector** | Vendor-neutral; works with any OTel SDK |
| ORM | **Drizzle ORM** | Type-safe, zero-runtime schema; migration-first |

#### Frontend (`apps/web`)
| Layer | Technology | Why |
|-------|-----------|-----|
| Framework | **Next.js 15 (App Router)** | RSC streaming for large trace lists |
| UI | **shadcn/ui + Tailwind** | Copy-paste components, no vendor lock |
| Graph | **React Flow** | DAG rendering for agent causal graphs |
| Charts | **Recharts** | Lightweight, composable |
| State | **Zustand** | Minimal boilerplate |
| API Client | **tRPC** | End-to-end type safety across monorepo |

#### SDKs (`packages/`)
| Package | Language | Registry |
|---------|----------|---------|
| `@traceforge/sdk` | TypeScript | npm |
| `traceforge` | Python | PyPI |
| `traceforge-mcp` | TypeScript | npx |

### Design Principles

1. **OTel-first** — SDKs are thin wrappers over OpenTelemetry. Interoperable with any OTel-compatible tool.
2. **MCP-native** — `claude mcp add traceforge -- npx traceforge-mcp` is zero-config.
3. **Lightweight** — TimescaleDB only. No Elasticsearch, no ClickHouse, no Kafka.
4. **Privacy-first** — Offline by default. External calls are opt-in only.
5. **DX-first** — Setup in under 5 minutes. One command in the README works.

---

## Repository Layout

```
traceforge/
├── apps/
│   ├── api/                  # Hono backend (Bun)
│   │   ├── src/
│   │   │   ├── routes/       # HTTP route handlers
│   │   │   ├── services/     # Business logic (pure functions preferred)
│   │   │   ├── db/           # Drizzle schema + migrations
│   │   │   │   └── migrations/
│   │   │   └── otel/         # OTel collector implementation
│   │   └── Dockerfile
│   └── web/                  # Next.js frontend
│       ├── app/              # App Router pages
│       └── components/
│           ├── graph/        # React Flow agent graph
│           ├── trace/        # Trace detail view
│           └── dashboard/    # Metrics dashboard
├── packages/
│   ├── sdk-typescript/       # @traceforge/sdk
│   ├── sdk-python/           # traceforge (PyPI)
│   └── mcp-server/           # traceforge-mcp
├── .github/
│   └── PULL_REQUEST_TEMPLATE.md
├── docker-compose.yml        # Production-like
├── docker-compose.dev.yml    # With hot-reload
├── CLAUDE.md                 # This file
├── CONTRIBUTING.md           # How to contribute
└── SECURITY.md               # Vulnerability disclosure
```

---

## Data Model

### Trace
One full execution session of an AI agent.

```typescript
type Trace = {
  id: string           // ULID — sortable, URL-safe
  sessionId: string    // User session grouping
  agentId: string      // Agent identifier (e.g. "claude-code", "my-bot")
  name: string         // Human-readable name ("generate_code", "search_docs")
  input: Json          // What was sent in
  output: Json         // What came out
  startTime: Date
  endTime: Date | null // null means still running
  totalTokens: number
  totalCostUsd: number
  status: "running" | "success" | "error"
  metadata: Json       // Arbitrary key-value pairs
}
```

### Span
A single step inside a Trace — an LLM call, tool invocation, or sub-agent call.

```typescript
type Span = {
  id: string
  traceId: string
  parentSpanId: string | null  // null = root span
  kind: "llm" | "tool" | "agent" | "retrieval" | "custom"
  name: string
  model: string | null         // e.g. "claude-opus-4-6"
  inputTokens: number
  outputTokens: number
  costUsd: number
  startTime: Date
  endTime: Date | null
  status: "running" | "success" | "error"
  attributes: Json             // OTel-standard key-value attributes
  events: Json[]               // OTel span events (logs within a span)
}
```

### AgentGraph
A DAG auto-generated from `parentSpanId` chains. Rendered with React Flow.

---

## Coding Standards

### Universal Rules
- **TypeScript**: `strict` mode always. No `any`. Explicit return types on all exports.
- **Python**: Type hints required everywhere. `mypy --strict` must pass.
- **Commits**: [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`, `test:`)
- **Testing**: Vitest (TypeScript) / pytest (Python). TDD preferred.
- **Linting**: Biome (TypeScript) / Ruff (Python). CI blocks on lint errors.

### TypeScript Patterns

```typescript
// ✅ Explicit types, pure functions
export async function createTrace(input: CreateTraceInput): Promise<Result<Trace, TraceError>> {
  // ...
}

// ❌ Implicit types, any, side effects mixed into core logic
export async function createTrace(input: any) {
  db.save(input)
}
```

### Error Handling — Typed Result Union

Never throw in the service layer. Return typed errors instead.

```typescript
type Result<T, E> = { ok: true; data: T } | { ok: false; error: E }

type TraceError =
  | { code: "NOT_FOUND"; traceId: string }
  | { code: "VALIDATION_FAILED"; field: string; message: string }
  | { code: "DB_ERROR"; cause: unknown }
```

### API Response Shape (all endpoints)

```typescript
// Success
{ success: true, data: T }

// Error
{ success: false, error: { code: string, message: string, details?: unknown } }
```

### Logging

Use structured logging. Never log PII (emails, tokens, user content).

```typescript
// ✅ Structured, no PII
logger.info({ traceId, agentId, durationMs }, "trace completed")

// ❌ Unstructured, potential PII leak
console.log(`Trace done for user ${userEmail}`)
```

Log levels: `debug` (dev only) → `info` (milestones) → `warn` (recoverable) → `error` (needs attention).

### Database Access

- Use Drizzle ORM for all queries. Raw SQL only for complex aggregations.
- Migrations live in `apps/api/src/db/migrations/`. Never edit existing migrations.
- Always run `bun run db:migrate` before testing locally.

### Environment Variables

- Keep `.env.example` up to date for every new variable.
- Never hardcode secrets. CI will fail if secrets appear in diffs.
- All variables use the `TRACEFORGE_` prefix.

```
TRACEFORGE_DATABASE_URL=postgresql://...
TRACEFORGE_REDIS_URL=redis://...
TRACEFORGE_SECRET_KEY=...
```

### Dependency Policy

- Prefer packages with >1M weekly downloads or a clear maintenance history.
- Add only what you need — no "just in case" dependencies.
- Run `bun audit` / `pip-audit` before opening a PR.

---

## Testing Strategy

### Unit Tests
- Pure functions and service layer only.
- Mock at service boundaries, never at the DB level.
- File convention: `*.test.ts` co-located with the file under test.

```typescript
// apps/api/src/services/trace.test.ts
describe("createTrace", () => {
  it("returns NOT_FOUND when agent does not exist", async () => {
    const result = await createTrace({ agentId: "ghost", ... })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe("NOT_FOUND")
  })
})
```

### Integration Tests
- Test the full HTTP stack (route → service → DB).
- Use a real PostgreSQL instance (via Docker in CI).
- File convention: `*.integration.test.ts`

### End-to-End Tests
- Playwright for critical user journeys (trace list → detail → graph).
- Runs in CI only, not on every local commit.
- File convention: `e2e/*.spec.ts`

### Coverage Targets
| Layer | Minimum |
|-------|---------|
| Services (unit) | 80% |
| Routes (integration) | 70% |
| SDK (unit) | 90% |

---

## Common Commands

```bash
# Start all services (dev, with hot-reload)
# docker-compose.dev.yml is a merge overlay — both files are required
docker compose -f docker-compose.yml -f docker-compose.dev.yml up

# Backend only
cd apps/api && bun run dev

# Frontend only
cd apps/web && bun run dev

# Run DB migrations
cd apps/api && bun run db:migrate

# Run all tests
bun run test

# Type check
bun run typecheck

# Lint (auto-fix)
bun run lint:fix

# Register MCP server (dev build)
claude mcp add traceforge-dev -- bun run packages/mcp-server/src/index.ts
```

---

## Agentic Development (Claude Code / Cursor / Aider)

When giving instructions to an AI coding assistant in this repo, use this format:

```
[target file or feature]: [what to do]
constraints: [rules to follow]
```

**Examples:**

```
apps/api/src/otel/collector.ts: implement OTel trace ingest endpoint that saves to DB
constraints: use Hono + Drizzle ORM, return typed Result errors, explicit types only
```

```
apps/web/components/graph/AgentGraph.tsx: render agent causal graph from Span parentSpanId tree
constraints: use React Flow, Zustand for selection state, no inline styles
```

---

## Release Process

- **Versioning**: [Semantic Versioning](https://semver.org/) (`MAJOR.MINOR.PATCH`)
- **Branches**: `main` (stable) → `develop` (next) → `feat/*` (features)
- **Release**: tag `vX.Y.Z` on `main` → GitHub Actions builds and publishes SDKs to npm / PyPI
- **Changelog**: Auto-generated from Conventional Commits via `changesets`
- **First release target**: `v0.1.0-alpha`

---

## GitHub Strategy

| Item | Value |
|------|-------|
| Repository | `traceforge` |
| License | MIT (core) / BSL-1.1 (enterprise features) |
| README | English primary, `README.ja.md` for Japanese |
| Issues | Bug Report / Feature Request / Question templates |
| Contributing | See `CONTRIBUTING.md` |
| Security | See `SECURITY.md` |

---

## Current Phase

**Phase 0 — MVP**

### Completed
- [x] Repository structure & base configuration
- [x] Docker Compose initial setup
- [x] DB schema design (Drizzle ORM)

### Up Next (priority order)
1. `apps/api` — OTel collector ingest endpoint
2. `apps/api` — Trace / Span CRUD API
3. `apps/web` — Trace list page
4. `apps/web` — React Flow agent graph view
5. `packages/mcp-server` — Claude Code MCP connection

---

*This file is the project constitution. Changes require team consensus.*
*Last updated: 2026-03-14*
