# GitHub PR Auto-Comment — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a Tracion-instrumented agent completes a trace while working on a GitHub PR, automatically post a trace summary comment to that PR so teams get visibility with zero effort.

**Architecture:** Four layers — (1) TypeScript SDK detects PR context via `gh pr view` at trace creation and injects it as OTel resource attributes, (2) the OTLP parser extracts those attributes into `trace.metadata`, (3) a new `github-notify.ts` service builds and posts the GitHub comment, and (4) the ingest route fires the notify after an atomic `UPDATE ... WHERE IS NULL` guard prevents duplicate comments from concurrent OTLP payloads.

**Tech Stack:** Bun + Hono, Drizzle ORM (PostgreSQL), GitHub REST API v2022-11-28, TypeScript strict mode, Vitest.

**Spec:** `docs/superpowers/specs/2026-03-15-github-pr-auto-comment-design.md`

**Start from:** `origin/main` (journal index ends at 0). If Plan A (public trace sharing) was merged first, the journal ends at index 5; this plan's migration adds index 6. If running this plan alone, it adds index 1. Adjust the migration file name accordingly: `0001_github_notify.sql` (alone) or `0006_github_notify.sql` (after Plan A).

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `packages/sdk-typescript/src/tracer.ts` | Add `detectGithubPrContext()`, inject into resource attrs |
| Modify | `packages/sdk-typescript/src/sdk.test.ts` | Test that PR context is passed through to resource |
| Modify | `apps/api/src/otel/parser.ts` | Extract `github.pr.*` from resource attrs → `trace.metadata` |
| Modify | `apps/api/src/otel/parser.test.ts` | Tests for github.pr.* extraction |
| Create | `apps/api/src/db/migrations/0006_github_notify.sql` | Add `github_comment_posted_at TIMESTAMPTZ` column |
| Modify | `apps/api/src/db/schema.ts` | Add `githubCommentPostedAt` Drizzle field |
| Create | `apps/api/src/services/github-notify.ts` | `buildCommentBody` + `postGithubPrComment` |
| Create | `apps/api/src/services/github-notify.test.ts` | Unit tests for comment builder and service |
| Modify | `apps/api/src/routes/ingest.ts` | Atomic guard + async notify call |
| Modify | `.env.example` | Add `GITHUB_TOKEN` with scope instructions |

---

## Chunk 1: TypeScript SDK — PR Context Detection

### Task 1: Add `detectGithubPrContext()` to SDK tracer

**Files:**
- Modify: `packages/sdk-typescript/src/tracer.ts`

- [ ] **Step 1: Write a failing test for PR context detection**

In `packages/sdk-typescript/src/sdk.test.ts`, add a describe block (or add to the existing file) to test that when `gh pr view` returns valid data, the provider includes github resource attributes:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createTracerProvider } from './tracer'

// These tests mock 'child_process' to test detectGithubPrContext
describe('detectGithubPrContext (via createTracerProvider)', () => {
  const originalRequire = global.require

  beforeEach(() => {
    vi.resetModules()
  })

  it('injects github.pr.* resource attributes when gh pr view succeeds', () => {
    // Mock child_process.execSync at the module level
    vi.mock('child_process', () => ({
      execSync: vi.fn().mockReturnValue(
        JSON.stringify({
          number: 42,
          url: 'https://github.com/acme/frontend/pull/42',
          headRefName: 'feat/my-feature',
          baseRefName: 'main',
          headRepository: { nameWithOwner: 'acme/frontend' },
        })
      ),
    }))

    // Re-import tracer after mock is set up
    const { createTracerProvider } = require('./tracer')
    const provider = createTracerProvider({ agentId: 'claude-code', endpoint: 'http://localhost:4318' })

    // Access the resource attributes
    const resource = (provider as any)._resource
    const attrs = resource.attributes

    expect(attrs['github.pr.number']).toBe('42')
    expect(attrs['github.pr.url']).toBe('https://github.com/acme/frontend/pull/42')
    expect(attrs['github.repository']).toBe('acme/frontend')
  })

  it('does not inject github.pr.* attributes when gh is not installed (execSync throws)', () => {
    vi.mock('child_process', () => ({
      execSync: vi.fn().mockImplementation(() => { throw new Error('command not found: gh') }),
    }))

    const { createTracerProvider } = require('./tracer')
    const provider = createTracerProvider({ agentId: 'claude-code', endpoint: 'http://localhost:4318' })

    const resource = (provider as any)._resource
    const attrs = resource.attributes

    expect(attrs['github.pr.number']).toBeUndefined()
    expect(attrs['github.pr.url']).toBeUndefined()
    expect(attrs['github.repository']).toBeUndefined()
  })

  it('does not inject github.pr.* attributes when not on a PR branch (gh exits non-zero)', () => {
    vi.mock('child_process', () => ({
      execSync: vi.fn().mockImplementation(() => {
        const err = Object.assign(new Error('no pull requests found'), { status: 1 })
        throw err
      }),
    }))

    const { createTracerProvider } = require('./tracer')
    const provider = createTracerProvider({ agentId: 'claude-code', endpoint: 'http://localhost:4318' })

    const resource = (provider as any)._resource
    expect(resource.attributes['github.pr.number']).toBeUndefined()
  })

  it('parses headRepository.nameWithOwner correctly as "owner/repo"', () => {
    vi.mock('child_process', () => ({
      execSync: vi.fn().mockReturnValue(
        JSON.stringify({
          number: 7,
          url: 'https://github.com/org-name/my-repo/pull/7',
          headRefName: 'fix/bug',
          baseRefName: 'main',
          headRepository: { nameWithOwner: 'org-name/my-repo' },
        })
      ),
    }))

    const { createTracerProvider } = require('./tracer')
    const provider = createTracerProvider({ agentId: 'test', endpoint: 'http://localhost:4318' })

    expect((provider as any)._resource.attributes['github.repository']).toBe('org-name/my-repo')
  })
})
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd packages/sdk-typescript && bun run test
```

Expected: FAIL — tests import `detectGithubPrContext` behavior that doesn't exist yet.

- [ ] **Step 3: Implement `detectGithubPrContext` in tracer.ts**

Replace the contents of `packages/sdk-typescript/src/tracer.ts`:

```typescript
import { BasicTracerProvider, BatchSpanProcessor, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { Resource } from '@opentelemetry/resources'
import type { TracionConfig } from './types'
import { createExporter } from './exporter'

type GithubPrContext = {
  prNumber: string
  prUrl: string
  repository: string  // always "owner/repo" — never a URL
}

// Runs gh pr view synchronously at trace creation. Returns null if:
// - gh is not installed
// - the working directory is not on a PR branch
// - any other error (timeout, parse failure, etc.)
// Uses require() so this synchronous function does not need to be async.
function detectGithubPrContext(): GithubPrContext | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { execSync } = require('child_process') as typeof import('child_process')
    const raw = execSync(
      'gh pr view --json number,url,headRefName,baseRefName,headRepository',
      { encoding: 'utf-8', timeout: 3000, stdio: ['pipe', 'pipe', 'ignore'] }
    ) as string
    const pr = JSON.parse(raw) as {
      number: number
      url: string
      headRefName: string
      baseRefName: string
      headRepository: { nameWithOwner: string }
    }
    return {
      prNumber: String(pr.number),
      prUrl: pr.url,
      repository: pr.headRepository.nameWithOwner,  // guaranteed "owner/repo" format
    }
  } catch {
    return null  // gh not installed, not in a PR branch, or timed out — silently skip
  }
}

export function createTracerProvider(config: TracionConfig): BasicTracerProvider {
  const prContext = detectGithubPrContext()

  const resource = new Resource({
    'tracion.agent_id': config.agentId ?? 'unknown',
    'tracion.session_id': config.sessionId ?? 'default',
    'service.name': config.agentId ?? 'unknown',
    'process.runtime.version': process.version,
    'process.pid': process.pid,
    // Inject GitHub PR context if detected (undefined values are omitted by Resource)
    ...(prContext ? {
      'github.pr.number': prContext.prNumber,
      'github.pr.url': prContext.prUrl,
      'github.repository': prContext.repository,
    } : {}),
  })

  const exporter = config._exporter ?? createExporter(config)
  const provider = new BasicTracerProvider({ resource })

  if (config._exporter) {
    provider.addSpanProcessor(new SimpleSpanProcessor(exporter))
  } else {
    provider.addSpanProcessor(
      new BatchSpanProcessor(exporter, {
        maxExportBatchSize: config.batchSize ?? 512,
        scheduledDelayMillis: config.exportIntervalMs ?? 5000,
      })
    )
  }

  return provider
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/sdk-typescript && bun run test
```

Expected: All tests pass (including new PR context tests).

- [ ] **Step 5: Type-check**

```bash
cd packages/sdk-typescript && bun run typecheck
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add packages/sdk-typescript/src/tracer.ts packages/sdk-typescript/src/sdk.test.ts
git commit -m "feat(sdk): detect GitHub PR context and inject as OTel resource attributes"
```

---

## Chunk 2: Parser + DB — Extract PR Attributes and Migration

### Task 2: Parser extracts `github.pr.*` from resource attributes into `trace.metadata`

**Files:**
- Modify: `apps/api/src/otel/parser.ts`
- Modify: `apps/api/src/otel/parser.test.ts`

- [ ] **Step 1: Write failing tests for github.pr.* extraction**

Add to `apps/api/src/otel/parser.test.ts` (after the existing tests):

```typescript
  describe('github.pr.* resource attribute extraction', () => {
    const payloadWithPrAttrs: OtlpPayload = {
      resourceSpans: [
        {
          resource: {
            attributes: [
              { key: 'service.name', value: { stringValue: 'claude-code' } },
              { key: 'github.pr.number', value: { stringValue: '42' } },
              { key: 'github.pr.url', value: { stringValue: 'https://github.com/acme/frontend/pull/42' } },
              { key: 'github.repository', value: { stringValue: 'acme/frontend' } },
            ],
          },
          scopeSpans: [
            {
              spans: [
                {
                  traceId: 'aabbccdd00112233',
                  spanId: 'span001122334455',
                  name: 'fix_bug',
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

    it('stores github.pr.* in trace.metadata when resource attrs present', () => {
      const { trace } = parseOtlpPayload(payloadWithPrAttrs)
      expect(trace.metadata).toMatchObject({
        githubPrNumber: '42',
        githubPrUrl: 'https://github.com/acme/frontend/pull/42',
        githubRepository: 'acme/frontend',
      })
    })

    it('does not set github.pr.* in metadata when attrs are absent', () => {
      const { trace } = parseOtlpPayload(minimalPayload)
      expect(trace.metadata).not.toHaveProperty('githubPrNumber')
      expect(trace.metadata).not.toHaveProperty('githubPrUrl')
      expect(trace.metadata).not.toHaveProperty('githubRepository')
    })

    it('does not error when github.pr.* attrs are absent', () => {
      expect(() => parseOtlpPayload(minimalPayload)).not.toThrow()
    })
  })
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd apps/api && bun run test src/otel/parser.test.ts
```

Expected: FAIL — `trace.metadata` does not yet contain `githubPrNumber`.

- [ ] **Step 3: Implement github.pr.* extraction in parser.ts**

In `apps/api/src/otel/parser.ts`, find the section after `const sessionId = ...` and before the span loop, and add extraction of GitHub PR attributes from resource-level attrs:

```typescript
  const agentId =
    getStringAttr(resourceAttrs, 'tracion.agent_id') ??
    getStringAttr(resourceAttrs, 'service.name') ??
    'unknown'
  const sessionId = getStringAttr(resourceAttrs, 'tracion.session_id') ?? 'default'

  // --- ADD THESE LINES ---
  const githubPrUrl     = getStringAttr(resourceAttrs, 'github.pr.url')
  const githubPrNumber  = getStringAttr(resourceAttrs, 'github.pr.number')
  const githubRepo      = getStringAttr(resourceAttrs, 'github.repository')
  // -----------------------
```

Then in the trace object construction at the bottom of `parseOtlpPayload`, update the `metadata` field from `{}` to include the extracted values:

```typescript
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
    metadata: {
      ...(githubPrUrl    ? { githubPrUrl }                         : {}),
      ...(githubPrNumber ? { githubPrNumber }                      : {}),
      ...(githubRepo     ? { githubRepository: githubRepo }        : {}),
    },
  }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/api && bun run test src/otel/parser.test.ts
```

Expected: All tests pass including the 3 new github.pr.* tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/otel/parser.ts apps/api/src/otel/parser.test.ts
git commit -m "feat(api): extract github.pr.* OTel resource attrs into trace.metadata"
```

---

### Task 3: DB migration and schema update

**Files:**
- Create: `apps/api/src/db/migrations/0006_github_notify.sql`
- Modify: `apps/api/src/db/migrations/meta/_journal.json`
- Modify: `apps/api/src/db/schema.ts`

**Prerequisite:** Pull/merge `origin/main` to ensure the local migration journal is current before adding new entries. The journal on origin/main ends at index 0 (0000); with Plan A merged it ends at index 5 (0005). This task adds the next index.

- [ ] **Step 1: Check current journal max index**

```bash
cd apps/api && cat src/db/migrations/meta/_journal.json
```

Note the highest `"idx"` value in the `"entries"` array. The new migration uses `idx = max + 1`.

- [ ] **Step 2: Create migration SQL file**

If max idx is 5 (Plan A merged), create `0006_github_notify.sql`. If max idx is 0 (only origin/main), create `0001_github_notify.sql`. Adjust both the file name and journal entry below accordingly.

Using `0006` as the example (adjust if needed):

```sql
-- apps/api/src/db/migrations/0006_github_notify.sql
ALTER TABLE otel.traces
  ADD COLUMN github_comment_posted_at TIMESTAMPTZ;
```

- [ ] **Step 3: Add entry to journal**

Add to the end of the `"entries"` array in `apps/api/src/db/migrations/meta/_journal.json`:

```json
{
  "idx": 6,
  "version": "7",
  "when": 1773452660490,
  "tag": "0006_github_notify",
  "breakpoints": true
}
```

Adjust `idx` and `tag` to match the file name chosen in Step 2.

- [ ] **Step 4: Add `githubCommentPostedAt` to Drizzle schema**

In `apps/api/src/db/schema.ts`, add to the `traces` table imports and definition:

First, add `timestamp` to the pg imports if not present (it should already be imported).

Then inside the `traces` table definition, after the `metadata` line, add:

```typescript
  shareToken: text('share_token').unique(),           // (if Plan A is merged — skip if not)
  githubCommentPostedAt: timestamp('github_comment_posted_at', { withTimezone: true }),
```

If Plan A is not yet merged, only add `githubCommentPostedAt`:

```typescript
  githubCommentPostedAt: timestamp('github_comment_posted_at', { withTimezone: true }),
```

- [ ] **Step 5: Type-check**

```bash
cd apps/api && bun run typecheck
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/db/migrations/0006_github_notify.sql \
        apps/api/src/db/migrations/meta/_journal.json \
        apps/api/src/db/schema.ts
git commit -m "feat(api): add github_comment_posted_at column to traces table"
```

---

## Chunk 3: Notify Service + Ingest Route

### Task 4: GitHub notify service (TDD)

**Files:**
- Create: `apps/api/src/services/github-notify.ts`
- Create: `apps/api/src/services/github-notify.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// apps/api/src/services/github-notify.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildCommentBody, postGithubPrComment } from './github-notify'
import type { Trace } from '../types'

// A minimal complete Trace fixture for tests
const baseTrace: Trace = {
  id: 'trace-123',
  sessionId: 'sess-1',
  agentId: 'claude-code',
  name: 'fix bug in login',
  input: null,
  output: null,
  startTime: new Date('2026-01-01T00:00:00Z'),
  endTime: new Date('2026-01-01T00:01:30Z'),   // 1m 30s
  totalTokens: 5432,
  totalCostUsd: '0.180000',
  status: 'success',
  metadata: {
    githubPrUrl: 'https://github.com/acme/frontend/pull/42',
    githubPrNumber: '42',
    githubRepository: 'acme/frontend',
  },
}

describe('buildCommentBody', () => {
  it('contains status emoji ✅ for success', () => {
    const body = buildCommentBody(baseTrace)
    expect(body).toContain('✅ Success')
  })

  it('contains status emoji ❌ for error', () => {
    const body = buildCommentBody({ ...baseTrace, status: 'error' })
    expect(body).toContain('❌ Error')
  })

  it('formats totalCostUsd via parseFloat().toFixed(4) — not raw string', () => {
    const body = buildCommentBody({ ...baseTrace, totalCostUsd: '0.180000' })
    expect(body).toContain('$0.1800')
    expect(body).not.toContain('$0.180000')  // raw 6-decimal string must not appear
  })

  it('formats duration as "Xm Ys" for durations over 60s', () => {
    const body = buildCommentBody(baseTrace)  // 1m 30s
    expect(body).toContain('1m 30s')
  })

  it('formats duration as "Xs" for durations under 60s', () => {
    const shortTrace: Trace = {
      ...baseTrace,
      endTime: new Date('2026-01-01T00:00:45Z'),  // 45s
    }
    const body = buildCommentBody(shortTrace)
    expect(body).toContain('45s')
  })

  it('shows "—" for duration when endTime is null', () => {
    const body = buildCommentBody({ ...baseTrace, endTime: null })
    expect(body).toContain('| **Duration** | — |')
  })

  it('includes the trace link built from TRACION_WEB_URL', () => {
    process.env.TRACION_WEB_URL = 'https://tracion.example.com'
    const body = buildCommentBody(baseTrace)
    expect(body).toContain('https://tracion.example.com/traces/trace-123')
    delete process.env.TRACION_WEB_URL
  })

  it('includes formatted token count', () => {
    const body = buildCommentBody(baseTrace)
    expect(body).toContain('5,432')  // toLocaleString('en-US')
  })
})

describe('postGithubPrComment', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    process.env.GITHUB_TOKEN = 'ghp_test_token'
  })

  afterEach(() => {
    delete process.env.GITHUB_TOKEN
  })

  it('calls GitHub API with correct URL and Authorization header', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 1 }), { status: 201 })
    )

    await postGithubPrComment(baseTrace)

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.github.com/repos/acme/frontend/issues/42/comments',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer ghp_test_token',
          Accept: 'application/vnd.github+json',
        }),
      })
    )
  })

  it('throws when GitHub API returns non-ok status', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{"message":"Not Found"}', { status: 404 })
    )

    await expect(postGithubPrComment(baseTrace)).rejects.toThrow('GitHub API 404')
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd apps/api && bun run test src/services/github-notify.test.ts
```

Expected: FAIL — "Cannot find module './github-notify'"

- [ ] **Step 3: Implement `github-notify.ts`**

```typescript
// apps/api/src/services/github-notify.ts
import type { Trace } from '../types'

type GithubMetadata = {
  githubPrUrl: string
  githubPrNumber: string
  githubRepository: string   // "owner/repo" format — exactly one "/"
}

export async function postGithubPrComment(trace: Trace): Promise<void> {
  const meta = trace.metadata as GithubMetadata
  const [owner, repo] = meta.githubRepository.split('/')
  const prNumber = meta.githubPrNumber

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ body: buildCommentBody(trace) }),
    }
  )

  if (!response.ok) {
    throw new Error(`GitHub API ${response.status}: ${await response.text()}`)
  }
}

export function buildCommentBody(trace: Trace): string {
  const status = trace.status === 'success' ? '✅ Success' : '❌ Error'

  const durationMs = trace.endTime && trace.startTime
    ? new Date(trace.endTime).getTime() - new Date(trace.startTime).getTime()
    : null
  const durationStr = durationMs != null
    ? durationMs >= 60_000
      ? `${Math.floor(durationMs / 60_000)}m ${Math.floor((durationMs % 60_000) / 1000)}s`
      : `${Math.floor(durationMs / 1000)}s`
    : '—'

  // totalCostUsd is a numeric string from Drizzle (e.g. "0.180000") — format explicitly
  const costStr = `$${parseFloat(trace.totalCostUsd as string).toFixed(4)}`
  const traceUrl = `${process.env.TRACION_WEB_URL ?? 'http://localhost:3000'}/traces/${trace.id}`

  return [
    '## 🤖 Tracion — Agent Trace',
    '',
    '| | |',
    '|---|---|',
    `| **Status** | ${status} |`,
    `| **Agent** | ${trace.agentId} |`,
    `| **Duration** | ${durationStr} |`,
    `| **Cost** | ${costStr} |`,
    `| **Tokens** | ${trace.totalTokens.toLocaleString('en-US')} |`,
    '',
    `[View full trace →](${traceUrl})`,
    '',
    '<sub>Posted by [Tracion](https://github.com/kajaha06251020/Tracion)</sub>',
  ].join('\n')
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/api && bun run test src/services/github-notify.test.ts
```

Expected: All 9 tests pass.

- [ ] **Step 5: Type-check**

```bash
cd apps/api && bun run typecheck
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/github-notify.ts \
        apps/api/src/services/github-notify.test.ts
git commit -m "feat(api): add GitHub PR comment builder and notify service"
```

---

### Task 5: Ingest route — atomic guard + env var + `.env.example`

**Files:**
- Modify: `apps/api/src/routes/ingest.ts`
- Modify: `.env.example`

- [ ] **Step 1: Write failing tests for the ingest guard**

Add new test cases to a new describe block in a test file. If `apps/api/src/routes/ingest.test.ts` already exists, add to it. Otherwise create it:

```typescript
// Test additions for github notify guard — add to existing ingest test file or create new
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'

// Mock dependencies
vi.mock('../otel/parser', () => ({
  parseOtlpPayload: vi.fn().mockReturnValue({
    trace: {
      id: 'trace-1',
      agentId: 'claude',
      status: 'success',
      metadata: {
        githubPrUrl: 'https://github.com/acme/repo/pull/1',
        githubPrNumber: '1',
        githubRepository: 'acme/repo',
      },
    },
    spans: [],
  }),
}))
vi.mock('../services/trace', () => ({
  createTrace: vi.fn().mockResolvedValue({
    ok: true,
    data: {
      id: 'trace-1',
      status: 'success',
      metadata: {
        githubPrUrl: 'https://github.com/acme/repo/pull/1',
        githubPrNumber: '1',
        githubRepository: 'acme/repo',
      },
    },
  }),
}))
vi.mock('../services/span', () => ({
  createSpans: vi.fn().mockResolvedValue({ ok: true, data: [] }),
}))
vi.mock('../services/github-notify', () => ({
  postGithubPrComment: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../middleware/auth', () => ({
  apiKeyMiddleware: vi.fn(async (_c: unknown, next: () => Promise<void>) => next()),
}))

// Mock the DB update for the atomic guard
const mockReturning = vi.fn().mockResolvedValue([{ id: 'trace-1' }])  // claimed = winner
const mockWhere = vi.fn().mockReturnValue({ returning: mockReturning })
const mockSet = vi.fn().mockReturnValue({ where: mockWhere })
const mockUpdate = vi.fn().mockReturnValue({ set: mockSet })
vi.mock('../db/index', () => ({ db: { update: mockUpdate } }))

import { ingestRoute } from './ingest'
import { postGithubPrComment } from '../services/github-notify'

describe('ingest route — GitHub notify guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockReturning.mockResolvedValue([{ id: 'trace-1' }])
    process.env.GITHUB_TOKEN = 'ghp_test'
  })

  afterEach(() => {
    delete process.env.GITHUB_TOKEN
  })

  function buildApp() {
    const app = new Hono()
    app.route('/', ingestRoute)
    return app
  }

  it('skips GitHub notify when GITHUB_TOKEN is not set', async () => {
    delete process.env.GITHUB_TOKEN

    const app = buildApp()
    const res = await app.request('/v1/traces', {
      method: 'POST',
      body: JSON.stringify({ resourceSpans: [] }),
      headers: { 'Content-Type': 'application/json' },
    })

    expect(res.status).toBe(201)
    expect(postGithubPrComment).not.toHaveBeenCalled()
  })

  it('skips GitHub notify when trace has no githubPrUrl in metadata', async () => {
    const { createTrace } = await import('../services/trace')
    vi.mocked(createTrace).mockResolvedValueOnce({
      ok: true,
      data: { id: 'trace-2', status: 'success', metadata: {} } as any,
    })

    const app = buildApp()
    await app.request('/v1/traces', {
      method: 'POST',
      body: JSON.stringify({ resourceSpans: [] }),
      headers: { 'Content-Type': 'application/json' },
    })

    expect(postGithubPrComment).not.toHaveBeenCalled()
  })

  it('calls postGithubPrComment when guard is won (RETURNING returns row)', async () => {
    mockReturning.mockResolvedValueOnce([{ id: 'trace-1' }])  // won

    const app = buildApp()
    await app.request('/v1/traces', {
      method: 'POST',
      body: JSON.stringify({ resourceSpans: [] }),
      headers: { 'Content-Type': 'application/json' },
    })

    // Allow async fire-and-forget to settle
    await new Promise((r) => setTimeout(r, 10))
    expect(postGithubPrComment).toHaveBeenCalledTimes(1)
  })

  it('does NOT call postGithubPrComment when guard is lost (RETURNING returns empty)', async () => {
    mockReturning.mockResolvedValueOnce([])  // lost — another request already claimed it

    const app = buildApp()
    await app.request('/v1/traces', {
      method: 'POST',
      body: JSON.stringify({ resourceSpans: [] }),
      headers: { 'Content-Type': 'application/json' },
    })

    await new Promise((r) => setTimeout(r, 10))
    expect(postGithubPrComment).not.toHaveBeenCalled()
  })

  it('returns 201 even when postGithubPrComment throws', async () => {
    const { postGithubPrComment: notify } = await import('../services/github-notify')
    vi.mocked(notify).mockRejectedValueOnce(new Error('GitHub API 403'))

    const app = buildApp()
    const res = await app.request('/v1/traces', {
      method: 'POST',
      body: JSON.stringify({ resourceSpans: [] }),
      headers: { 'Content-Type': 'application/json' },
    })

    await new Promise((r) => setTimeout(r, 10))
    expect(res.status).toBe(201)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd apps/api && bun run test src/routes/ingest.test.ts
```

Expected: FAIL — ingest route does not yet have the atomic guard or `postGithubPrComment` call.

- [ ] **Step 3: Update ingest route with atomic guard**

Replace the full content of `apps/api/src/routes/ingest.ts`:

```typescript
import { Hono } from 'hono'
import { and, eq, isNull } from 'drizzle-orm'
import { apiKeyMiddleware } from '../middleware/auth'
import { parseOtlpPayload } from '../otel/parser'
import { createTrace } from '../services/trace'
import { createSpans } from '../services/span'
import { postGithubPrComment } from '../services/github-notify'
import { db } from '../db/index'
import { traces } from '../db/schema'
import { apiErr } from '../types'
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

  const trace = traceResult.data

  // GitHub PR auto-comment: fire after trace is saved.
  // The atomic UPDATE ... WHERE IS NULL RETURNING guard ensures exactly one
  // request posts even if multiple concurrent OTLP payloads arrive.
  if (
    trace.status !== 'running' &&
    trace.metadata?.githubPrUrl &&
    process.env.GITHUB_TOKEN
  ) {
    const claimed = await db
      .update(traces)
      .set({ githubCommentPostedAt: new Date() })
      .where(and(
        eq(traces.id, trace.id),
        isNull(traces.githubCommentPostedAt)  // only one request wins
      ))
      .returning({ id: traces.id })

    if (claimed.length > 0) {
      // Fire-and-forget: never fail the 201 response
      postGithubPrComment(trace).catch((err) =>
        logger.warn({ err, traceId: trace.id }, 'github pr comment failed')
      )
    }
  }

  logger.info({ traceId: trace.id }, 'trace ingested')
  return c.json({ success: true, traceId: trace.id }, 201)
})
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/api && bun run test src/routes/ingest.test.ts
```

Expected: All tests pass (including the 5 new guard tests).

- [ ] **Step 5: Run full API test suite**

```bash
cd apps/api && bun run test
```

Expected: All existing tests still pass.

- [ ] **Step 6: Add `GITHUB_TOKEN` to `.env.example`**

Add to `.env.example`:

```bash
# GitHub PR auto-comment (optional)
# Create a personal access token (classic) with "repo" scope, OR
# a fine-grained PAT with "Issues: Read and Write" permission.
# See: https://github.com/settings/tokens
# NOTE: "write:discussion" scope is for Gists/team discussions and will 403 on PR comments.
GITHUB_TOKEN=
```

- [ ] **Step 7: Type-check**

```bash
cd apps/api && bun run typecheck
```

Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/routes/ingest.ts .env.example
git commit -m "feat(api): add atomic GitHub PR auto-comment guard to ingest route"
```

---

## Final: Push to origin

```bash
git push origin feature/github-pr-auto-comment
# or if working on main:
git push origin main
```

Run a final type-check and full test suite:

```bash
cd apps/api && bun run test && bun run typecheck
cd packages/sdk-typescript && bun run test && bun run typecheck
```

Expected: All tests pass, 0 type errors in both.
