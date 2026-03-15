# Phase 2: Testing & OSS Release Preparation — Design Specification

**Date:** 2026-03-15
**Status:** Approved
**Scope:** Test coverage, CI/CD pipeline, SDK publishing, v0.1.0-alpha release

---

## Overview

Phase 1 (infra + API) and MVP1 (web dashboard) are functionally complete. Phase 2 locks in quality through automated testing and prepares Tracion for its first public OSS release.

**Goal:** Ship `v0.1.0-alpha` to GitHub with confidence — working CI, published SDKs, and a documented onboarding path.

---

## Part A — Test Coverage

### Unit Tests (Vitest)

**Target files (new):**
- `apps/web/lib/spans-to-graph.test.ts` — pure function tests for DAG transform

**spans-to-graph tests must cover:**
1. Single root span → 1 node, 0 edges
2. Linear chain (A → B → C) → 3 nodes, 2 edges
3. Branching (A → B, A → C) → 3 nodes, 2 edges
4. Empty input → 0 nodes, 0 edges

**Existing test files to verify pass:**
- `apps/api/src/services/trace.test.ts`
- `apps/api/src/services/span.test.ts`
- `apps/api/src/otel/parser.test.ts`
- `apps/api/src/middleware/require-auth.test.ts`
- `packages/sdk-typescript/src/**/*.test.ts`

### Integration Tests (Vitest + real DB)

**New files:**
- `apps/api/src/routes/ingest.integration.test.ts`
- `apps/api/src/routes/trpc.integration.test.ts`

**DB lifecycle for integration tests:**
- Uses env var `DATABASE_URL` pointing to the test PostgreSQL instance
- `docker-compose.dev.yml` provides the DB; in CI the `ci.yml` workflow starts docker-compose services before running integration tests
- Each test suite runs `db:migrate` in a `beforeAll` hook via `execSync('bun run db:migrate')`
- Each test suite uses a unique schema prefix or truncates tables in `afterEach` to avoid cross-test pollution

**Test cases:**
- `ingest.integration.test.ts`: POST `/v1/traces` with valid OTLP JSON payload → 200, trace row in DB
- `trpc.integration.test.ts`: `traces.list` with valid session cookie → 200 with data; without session → 401

### E2E Tests (Playwright)

Three critical paths in `apps/web/e2e/` (files already exist, fill in test bodies):

1. **`auth.spec.ts`** — Visit `/traces` as unauthenticated user → assert redirect to `/login` → assert sign-in buttons visible
2. **`trace-detail.spec.ts`** — Seed a trace via API, visit `/traces`, click row → assert waterfall renders → click span row → assert attributes panel shows model and token data
3. **`trace-graph.spec.ts`** — From trace detail, click "Graph" tab → assert React Flow canvas renders → assert at least one node is visible

**E2E environment:** Uses `docker compose` for real DB + API. Playwright config is at `apps/web/playwright.config.ts`.

Note: Full OAuth mock flow (complete login cycle) is out of scope for Phase 2 E2E. The auth test covers the unauthenticated redirect only. Full OAuth E2E is deferred to Phase 3 (when organization flows require it).

### Coverage Targets

| Layer | Minimum |
|-------|---------|
| Services (unit) | 80% |
| Routes (integration) | 70% |
| SDK TypeScript (unit) | 90% |
| E2E critical paths | 3 passing |

---

## Part B — GitHub Actions CI

### Prerequisites

Before setting up CI, perform these one-time steps:

1. **Remove `"private": true`** from `packages/sdk-typescript/package.json` and `packages/mcp-server/package.json`
2. **Rename Python package**: Update `packages/sdk-python/pyproject.toml` — change `name = "tracion"` to `name = "tracion"`
3. **Initialize changesets**: Run `bun add -d @changesets/cli -w && bun changeset init` and commit `.changeset/config.json`
4. **Add twine**: Add `twine` and `build` as Python dev dependencies in `packages/sdk-python/pyproject.toml`

### MCP server npm name clarification

`packages/mcp-server/package.json` has `name: "@tracion/mcp-server"` but the binary is `tracion-mcp`. The npm package name to publish is `@tracion/mcp-server`; the README `npx` invocation must use the scoped name: `npx @tracion/mcp-server`.

### Workflows

**`.github/workflows/ci.yml`** — triggers on PR + push to main

```yaml
jobs:
  lint:        biome check (apps/api, apps/web, packages/sdk-typescript, packages/mcp-server)
               + ruff check packages/sdk-python
  typecheck:   tsc --noEmit for apps/api, apps/web, packages/sdk-typescript
  test-unit:   vitest run (apps/api + packages/sdk-typescript + apps/web/lib)
  test-integration:
               docker compose up -d db
               bun run db:migrate
               vitest run --reporter=verbose apps/api/src/routes/*.integration.test.ts
  test-e2e:    docker compose up -d (all services)
               cd apps/web && bunx playwright test
  build:       docker build apps/api + apps/web (validates Dockerfiles)
```

**`.github/workflows/release.yml`** — triggers on tag `v*`

```yaml
jobs:
  publish-npm-sdk:
    cd packages/sdk-typescript
    npm publish --access public
  publish-npm-mcp:
    cd packages/mcp-server
    npm publish --access public
  publish-pypi:
    cd packages/sdk-python
    python -m build
    twine upload dist/*
  docker-push:
    docker buildx build + push tracion/api:$TAG
    docker buildx build + push tracion/web:$TAG
```

**`.github/workflows/security.yml`** — weekly cron (Sunday 00:00 UTC)

```yaml
jobs:
  audit:
    npm audit --prefix packages/sdk-typescript
    npm audit --prefix packages/mcp-server
    pip install pip-audit && pip-audit -r packages/sdk-python/requirements.txt
```

### Required GitHub Secrets (document in CONTRIBUTING.md)

- `NPM_TOKEN` — npm publish token with write access
- `PYPI_TOKEN` — PyPI API token
- `DOCKERHUB_USERNAME` + `DOCKERHUB_TOKEN`

---

## Part C — v0.1.0-alpha Release

### Release checklist

- [ ] `"private": true` removed from sdk-typescript + mcp-server package.json
- [ ] Python package renamed to `tracion` in pyproject.toml
- [ ] Changesets initialized and `.changeset/config.json` committed
- [ ] All CI jobs green on main
- [ ] Run `bun changeset` to create a changeset entry, then `bun changeset version` to bump package versions to `0.1.0-alpha.0`
- [ ] `CHANGELOG.md` generated at root
- [ ] Git tag `v0.1.0-alpha.0` pushed → triggers release.yml
- [ ] Verify GitHub Release created with changelog excerpt
- [ ] Verify `@tracion/sdk` published to npm
- [ ] Verify `@tracion/mcp-server` published to npm
- [ ] Verify `tracion` published to PyPI
- [ ] Verify Docker images pushed to Docker Hub

### README updates

- `README.md` — add npm install badges, Docker Hub badge, CI badge
- `README.ja.md` — Japanese translation of full README

### CLAUDE.md update

Replace the `## Current Phase` section in `docs/CLAUDE.md` with the following exact content:

```markdown
## Current Phase

**Phase 2 — Testing & OSS Release** ✅ Complete

### Completed
- [x] Repository structure & base configuration
- [x] Docker Compose setup (prod + dev with hot-reload)
- [x] DB schema design (Drizzle ORM, TimescaleDB)
- [x] OTel collector ingest endpoint
- [x] Trace / Span CRUD API (tRPC)
- [x] Web dashboard (stats, trace list, trace detail waterfall, DAG graph, cost analytics)
- [x] OAuth authentication (GitHub + Google via BetterAuth)
- [x] TypeScript SDK (`@tracion/sdk`)
- [x] Python SDK (`tracion`)
- [x] MCP Server (`tracion-mcp`)
- [x] Test coverage (unit, integration, E2E)
- [x] GitHub Actions CI/CD pipeline
- [x] v0.1.0-alpha release (npm + PyPI + Docker Hub)

### Up Next — Phase 3: Feature Expansion
1. API key management UI (`/settings/api-keys`)
2. LLM content viewer (conversation-style span detail)
3. Multi-tenancy / Organizations
4. Alert notifications (cost/error thresholds via email, webhook, Slack)
```

Also update line 255 of CLAUDE.md: change `bun audit` to `npm audit`.

---

## Success Criteria

Phase 2 is complete when:

- [ ] `bun run test` passes with ≥ 80% service coverage
- [ ] All 3 Playwright E2E tests pass against `docker compose`
- [ ] CI pipeline runs green on every PR
- [ ] `v0.1.0-alpha.0` tag triggers automatic SDK + Docker publish
- [ ] `README.ja.md` exists
- [ ] `docker compose up` + MCP registration works end-to-end per README
