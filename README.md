# Tracion

**Open-source observability for AI agents.**
Self-hosted. MCP-native. One command to start.

<!--
  Replace this comment with a demo GIF:
  ![Tracion Demo](docs/demo.gif)
-->

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue.svg)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-1.1-black.svg)](https://bun.sh/)

---

## What is Tracion?

Tracion answers: **"What did my agent do, and why did it make that decision?"**

It captures every LLM call, tool invocation, and sub-agent spawn — then renders them as a
causal graph you can click through. Built natively for Claude Code and the MCP ecosystem.

```
[Your agent / SDK / cURL]
        │  OpenTelemetry
        ▼
[Tracion API]  ──→  [PostgreSQL + TimescaleDB]
        │
        ▼
[Web Dashboard]
  ├── /dashboard     — cost + error rate at a glance
  ├── /traces        — filterable list, infinite scroll
  ├── /traces/[id]   — Gantt-style span waterfall
  └── /traces/[id]/graph  — React Flow causal DAG
```

---

## Quickstart

### Option A — Full stack (recommended)

```bash
git clone https://github.com/your-org/tracion
cd tracion
cp .env.example .env          # fill in OAuth secrets (optional for local dev)
docker compose up
```

Open **http://localhost:3000** — done.

### Option B — API only (no Docker)

```bash
cd apps/api
bun install
bun run db:migrate
bun run dev
```

---

## Claude Code users

```bash
claude mcp add tracion -- npx tracion-mcp
```

That's it. Your Claude Code agent traces appear in the dashboard automatically.

---

## SDKs

### TypeScript

```typescript
import { tracion } from '@tracion/sdk'

tracion.init({
  endpoint: 'http://localhost:3001',
  agentId: 'my-agent',
})

await tracion.trace('generate_code', async (span) => {
  span.setInput({ prompt: 'Write a sorting algorithm' })
  const result = await callClaude(prompt)
  span.setOutput({ code: result })
}, { kind: 'llm' })
```

### Python

```python
from tracion import TracionSDK

sdk = TracionSDK(endpoint="http://localhost:3001", agent_id="my-agent")

with sdk.trace("search_docs", kind="tool") as span:
    span.set_input({"query": "vector databases"})
    results = search(query)
    span.set_output({"count": len(results)})
```

### cURL (any OTel-compatible tool)

```bash
curl -X POST http://localhost:3001/v1/traces \
  -H "Content-Type: application/json" \
  -d @examples/curl/sample-trace.json
```

---

## Features

| Feature | Description |
|---------|-------------|
| **Causal DAG** | React Flow graph built from `parentSpanId` chains |
| **Span waterfall** | Gantt-style timeline with depth indentation |
| **Cost tracking** | Per-trace and per-span USD cost aggregation |
| **OAuth auth** | GitHub + Google sign-in via Better Auth |
| **MCP server** | Query traces from Claude Code via `list_traces`, `get_trace`, `search_traces` |
| **Auto-instrumentation** | Patch Anthropic/OpenAI SDKs with one line |
| **Self-hosted** | PostgreSQL + TimescaleDB, no external calls |
| **OTel-compatible** | Works with any OpenTelemetry-compatible SDK |

---

## Architecture

```
tracion/
├── apps/
│   ├── api/          — Hono + Bun backend (tRPC + OTel ingest + Better Auth)
│   └── web/          — Next.js 15 App Router dashboard
├── packages/
│   ├── sdk-typescript/   — @tracion/sdk
│   ├── sdk-python/       — tracion (PyPI)
│   └── mcp-server/       — tracion-mcp (npx)
└── docker-compose.yml    — TimescaleDB + Redis + API + Web
```

**Stack:** Bun · Hono · tRPC v11 · Next.js 15 · Tailwind · React Flow · dagre · PostgreSQL 16 + TimescaleDB · Drizzle ORM · Better Auth · Vitest · Playwright

---

## Screenshots

> _Screenshots coming soon. Run locally with `docker compose up` to see the dashboard._

---

## Configuration

Copy `.env.example` to `.env` and fill in your values:

```env
TRACION_DATABASE_URL=postgresql://tracion:tracion@db:5432/tracion
TRACION_WEB_URL=http://localhost:3000

# OAuth (optional — skip for local dev)
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
BETTER_AUTH_SECRET=your-random-secret-here
```

> **Dev mode:** Leave `TRACION_API_KEY` and OAuth vars empty to skip authentication entirely.

---

## Development

```bash
# Start all services with hot-reload
docker compose -f docker-compose.yml -f docker-compose.dev.yml up

# Run tests
bun run test

# Type check
bun run typecheck

# Lint
bun run lint
```

---

## Roadmap

- [ ] Real-time trace streaming (SSE)
- [ ] Cost analytics dashboard (by agent, model, date)
- [ ] Slack / webhook alerts on error threshold
- [ ] Agent comparison view (A/B trace diffing)
- [ ] Hosted cloud version (opt-in)

---

## Contributing

See [CONTRIBUTING.md](docs/CONTRIBUTING.md). PRs welcome — especially for:
- New SDK integrations (Gemini, Mistral, LangGraph, CrewAI)
- UI improvements
- Performance benchmarks

---

## License

MIT — see [LICENSE](LICENSE).

---

## Why not Langfuse / Langsmith?

| | Langfuse | Langsmith | **Tracion** |
|--|---------|-----------|----------------|
| Self-hosted | ✅ (complex) | ❌ SaaS only | ✅ One command |
| MCP-native | ❌ | ❌ | ✅ |
| Causal DAG | ❌ | Partial | ✅ |
| Setup time | ~30 min | instant (SaaS) | **< 5 min** |
| Data privacy | Partial | ❌ | ✅ |
| Open source | ✅ | ❌ | ✅ |
