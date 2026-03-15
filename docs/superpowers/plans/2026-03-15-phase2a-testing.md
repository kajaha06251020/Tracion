# Phase 2A: Test Coverage Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Achieve ≥80% service coverage and 3 passing Playwright E2E tests against the running docker compose stack.

**Architecture:** Verify existing test files pass, add integration tests for ingest and tRPC routes using a real DB, and confirm the 3 existing E2E spec files produce passing tests.

**Tech Stack:** Vitest, Playwright, docker compose, Bun, tRPC test client, Hono test client

**Spec:** `docs/superpowers/specs/2026-03-15-phase2-testing-release-prep.md`

---

## File Map

| Action | File | Purpose |
|--------|------|---------|
| Verify | `apps/web/lib/spans-to-graph.test.ts` | Already exists — verify it passes |
| Create | `apps/api/src/routes/ingest.integration.test.ts` | Integration: ingest endpoint |
| Create | `apps/api/src/routes/trpc.integration.test.ts` | Integration: tRPC auth + traces.list |
| Verify | `apps/web/e2e/auth.spec.ts` | Already exists — verify it passes |
| Verify | `apps/web/e2e/trace-detail.spec.ts` | Already exists — verify it passes |
| Verify | `apps/web/e2e/trace-graph.spec.ts` | Already exists — verify it passes |

---

## Chunk 1: Verify Existing Unit Tests

### Task 1: Verify spans-to-graph tests pass

**Files:**
- Read: `apps/web/lib/spans-to-graph.test.ts` (already exists)

- [ ] **Step 1: Read the existing test file to understand current state**

```bash
cat apps/web/lib/spans-to-graph.test.ts
cat apps/web/lib/spans-to-graph.ts
```

- [ ] **Step 2: Run the existing tests**

```bash
cd apps/web && bun run test lib/spans-to-graph.test.ts
```

Expected: All tests pass. If they fail, read the error and fix the test assertions to match the actual `spansToGraph` function signature.

- [ ] **Step 3: Verify API unit tests all pass**

```bash
cd apps/api && bun run test
```

Expected: All tests in `src/services/`, `src/otel/`, `src/middleware/` pass.

- [ ] **Step 4: Commit if any fixes were needed**

```bash
git add -p
git commit -m "test: fix unit test assertions to match current implementation"
```

---

## Chunk 2: API Integration Tests

### Task 2: Ingest route integration test

**Files:**
- Read: `apps/api/src/routes/ingest.ts`
- Read: `apps/api/src/index.ts` (understand default export shape)
- Create: `apps/api/src/routes/ingest.integration.test.ts`

- [ ] **Step 1: Read the ingest route and index.ts**

```bash
cat apps/api/src/routes/ingest.ts
cat apps/api/src/index.ts
```

Note: `src/index.ts` exports `{ port, fetch: app.fetch }`. The test must call `server.fetch(req)`.

- [ ] **Step 2: Start the DB**

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db
# Wait for DB to be ready
sleep 3
```

- [ ] **Step 3: Write the integration test**

```typescript
// apps/api/src/routes/ingest.integration.test.ts
import { describe, it, expect, beforeAll } from 'vitest'
import { execSync } from 'child_process'
import server from '../index'

beforeAll(() => {
  execSync('bun run db:migrate', { cwd: process.cwd(), stdio: 'inherit' })
})

// Minimal valid OTLP JSON payload
const minimalOtlpPayload = {
  resourceSpans: [
    {
      resource: { attributes: [] },
      scopeSpans: [
        {
          scope: { name: 'test' },
          spans: [
            {
              traceId: '0'.repeat(32),
              spanId: '0'.repeat(16),
              parentSpanId: '',
              name: 'test-span',
              kind: 1,
              startTimeUnixNano: String(Date.now() * 1_000_000),
              endTimeUnixNano: String((Date.now() + 1000) * 1_000_000),
              status: { code: 1 },
              attributes: [
                { key: 'gen_ai.system', value: { stringValue: 'anthropic' } },
              ],
              events: [],
            },
          ],
        },
      ],
    },
  ],
}

describe('POST /v1/traces', () => {
  it('returns 201 for valid OTLP payload', async () => {
    const req = new Request('http://localhost/v1/traces', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tracion-Api-Key': process.env.TRACION_API_KEY ?? 'test-key',
      },
      body: JSON.stringify(minimalOtlpPayload),
    })
    const res = await server.fetch(req)
    expect(res.status).toBe(201)
  })

  it('returns 401 without API key', async () => {
    const req = new Request('http://localhost/v1/traces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(minimalOtlpPayload),
    })
    const res = await server.fetch(req)
    expect(res.status).toBe(401)
  })
})
```

- [ ] **Step 4: Run the integration test**

```bash
cd apps/api && DATABASE_URL=$DATABASE_URL TRACION_API_KEY=test-key bunx vitest run src/routes/ingest.integration.test.ts
```

Expected: Both tests pass. If the OTLP payload is rejected (400), read `src/otel/parser.ts` and `src/otel/parser.test.ts` to understand what shape is required, then adjust the payload.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/ingest.integration.test.ts
git commit -m "test(api): add ingest route integration test"
```

### Task 3: tRPC route integration test

**Files:**
- Create: `apps/api/src/routes/trpc.integration.test.ts`

- [ ] **Step 1: Write the integration test**

```typescript
// apps/api/src/routes/trpc.integration.test.ts
import { describe, it, expect, beforeAll } from 'vitest'
import { execSync } from 'child_process'
import server from '../index'

beforeAll(() => {
  execSync('bun run db:migrate', { cwd: process.cwd(), stdio: 'inherit' })
})

describe('tRPC /trpc/traces.list', () => {
  it('returns 401 without session or API key', async () => {
    const input = encodeURIComponent(JSON.stringify({ '0': { json: {} } }))
    const req = new Request(`http://localhost/trpc/traces.list?batch=1&input=${input}`, {
      method: 'GET',
    })
    const res = await server.fetch(req)
    expect(res.status).toBe(401)
  })

  it('returns 200 with valid API key', async () => {
    const input = encodeURIComponent(JSON.stringify({ '0': { json: {} } }))
    const req = new Request(`http://localhost/trpc/traces.list?batch=1&input=${input}`, {
      method: 'GET',
      headers: {
        'X-Tracion-Api-Key': process.env.TRACION_API_KEY ?? 'test-key',
      },
    })
    const res = await server.fetch(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test**

```bash
cd apps/api && DATABASE_URL=$DATABASE_URL TRACION_API_KEY=test-key bunx vitest run src/routes/trpc.integration.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/trpc.integration.test.ts
git commit -m "test(api): add tRPC route integration test"
```

---

## Chunk 3: E2E Tests

### Task 4: Verify E2E tests pass

**Files:**
- Read: `apps/web/e2e/auth.spec.ts` (already exists)
- Read: `apps/web/e2e/trace-detail.spec.ts` (already exists)
- Read: `apps/web/e2e/trace-graph.spec.ts` (already exists)
- Read: `apps/web/playwright.config.ts`

- [ ] **Step 1: Read all existing E2E files**

```bash
cat apps/web/e2e/auth.spec.ts
cat apps/web/e2e/trace-detail.spec.ts
cat apps/web/e2e/trace-graph.spec.ts
cat apps/web/playwright.config.ts
cat apps/web/e2e/setup/ 2>/dev/null || ls apps/web/e2e/setup/
```

- [ ] **Step 2: Start full docker compose stack**

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
sleep 15  # wait for services to be healthy
```

- [ ] **Step 3: Install Playwright browsers**

```bash
cd apps/web && bunx playwright install chromium
```

- [ ] **Step 4: Run E2E tests**

```bash
cd apps/web && bunx playwright test --reporter=list
```

Expected: 3 test files pass. If `trace-detail.spec.ts` or `trace-graph.spec.ts` fail due to missing auth session, read the `globalSetup` file (likely `e2e/setup/create-test-session.ts`) to understand what endpoint it calls. Check if `GET /api/test/session` or similar exists in the API. If not, this endpoint needs to be added.

- [ ] **Step 5: If globalSetup creates a session via test endpoint, verify it exists in the API**

```bash
grep -r "test/session\|test-session\|testSession" apps/api/src/ 2>/dev/null
```

If the endpoint is missing, add it to the API (read the globalSetup file first to understand what URL it calls and what response format is expected).

- [ ] **Step 6: Commit any fixes**

```bash
git add -p
git commit -m "test(e2e): ensure all 3 E2E test files pass"
```

---

## Chunk 4: Coverage Verification

### Task 5: Verify coverage targets

- [ ] **Step 1: Install coverage provider**

```bash
cd apps/api && bun add -d @vitest/coverage-v8
```

- [ ] **Step 2: Run API unit tests with coverage**

```bash
cd apps/api && bunx vitest run --coverage --coverage.provider=v8 --coverage.reporter=text
```

Check output: `src/services/trace.ts` and `src/services/span.ts` should show ≥ 80%.

- [ ] **Step 3: If below threshold, add targeted tests for uncovered error paths**

For each uncovered line in `src/services/`, add a test case. Example:

```typescript
it('returns DB_ERROR when database throws', async () => {
  vi.spyOn(db, 'select').mockRejectedValueOnce(new Error('connection refused'))
  const result = await getTrace('any-id', db)
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.error.code).toBe('DB_ERROR')
})
```

- [ ] **Step 4: Run SDK TypeScript tests**

```bash
cd packages/sdk-typescript && bun run test
```

Expected: ≥ 90% coverage.

- [ ] **Step 5: Commit**

```bash
git add -p
git commit -m "test: add @vitest/coverage-v8 and improve coverage to meet targets"
```
