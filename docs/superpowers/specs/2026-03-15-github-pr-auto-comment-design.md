# GitHub PR Auto-Comment — Design Spec

> *Last updated: 2026-03-15*

## Goal

When Claude Code (or any Tracion-instrumented agent) completes a trace while working on a GitHub PR, automatically post a summary comment to that PR. Teams see agent cost, duration, and a trace link without doing anything extra.

---

## Problem

When a developer uses Claude Code to modify code for a PR, that agent activity is invisible to the team. Automatically posting a trace summary to the PR gives everyone visibility with zero effort.

---

## Architecture

### Detection: TypeScript SDK injects PR context at trace start

PR detection happens in **`packages/sdk-typescript/src/tracer.ts`** at the moment a root span is created, not at MCP server startup. The MCP server is a long-lived stdio daemon reused across multiple traces and branches; running `gh pr view` at daemon startup would capture a stale branch.

Instead, the TypeScript SDK's `tracer.startTrace()` (or equivalent root span creation) runs `gh pr view` synchronously each time:

```typescript
// packages/sdk-typescript/src/tracer.ts

async function detectGithubPrContext(): Promise<GithubPrContext | null> {
  try {
    const { execSync } = await import('child_process')
    // --json returns structured data; fails if not in a PR branch
    const raw = execSync(
      'gh pr view --json number,url,headRefName,baseRefName,headRepository',
      { encoding: 'utf-8', timeout: 3000, stdio: ['pipe', 'pipe', 'ignore'] }
    )
    const pr = JSON.parse(raw) as {
      number: number
      url: string
      headRefName: string
      baseRefName: string
      headRepository: { nameWithOwner: string }  // "owner/repo" format
    }
    return {
      prNumber: String(pr.number),
      prUrl: pr.url,
      repository: pr.headRepository.nameWithOwner,  // always "owner/repo"
    }
  } catch {
    return null  // gh not installed, not in a PR, or network issue — silently skip
  }
}
```

These values are added to the **OTel resource attributes** when a root span is created:

```
github.pr.number    = "123"
github.pr.url       = "https://github.com/owner/repo/pull/123"
github.repository   = "owner/repo"      ← always "nameWithOwner" format, e.g. "acme/frontend"
```

The `headRepository.nameWithOwner` field from `gh pr view --json` always returns `"owner/repo"` format (not a URL, not an SSH remote). Parsing: `const [owner, repo] = githubRepository.split('/')` — safe because `nameWithOwner` is guaranteed to contain exactly one `/`.

If `gh` is not installed or the branch has no associated PR, detection returns null and no attributes are set. The SDK does not error.

### Ingestion: Parser extracts PR context into `trace.metadata`

**File:** `apps/api/src/otel/parser.ts`

In `parseOtlpPayload`, extract from resource-level attributes alongside the existing `agentId`/`sessionId` extraction:

```typescript
const githubPrUrl    = getStringAttr(resourceAttrs, 'github.pr.url')
const githubPrNumber = getStringAttr(resourceAttrs, 'github.pr.number')
const githubRepo     = getStringAttr(resourceAttrs, 'github.repository')
```

Store in `trace.metadata`:

```typescript
metadata: {
  ...(existingMetadata),
  ...(githubPrUrl     ? { githubPrUrl }     : {}),
  ...(githubPrNumber  ? { githubPrNumber }  : {}),
  ...(githubRepo      ? { githubRepository: githubRepo } : {}),
}
```

No schema change needed — `metadata` is already `jsonb` on `otel.traces`.

### New Migration: `0006_github_notify.sql`

```sql
ALTER TABLE otel.traces
  ADD COLUMN github_comment_posted_at TIMESTAMPTZ;
```

Drizzle schema addition:

```typescript
githubCommentPostedAt: timestamp('github_comment_posted_at', { withTimezone: true }),
```

**Prerequisite:** Same as Feature A — pull/merge origin/main before generating this migration. The journal on origin/main ends at index 5 (`0005_share_token`); this adds index 6.

### Notification: Atomic guard in ingest route

The guard against duplicate comments **must be atomic at the DB layer**. Traces can arrive in multiple incremental OTLP payloads; a naive in-memory check on `traceResult.data.githubCommentPostedAt` is subject to a race condition (two concurrent payloads both reading `null`, both attempting to post).

**File:** `apps/api/src/routes/ingest.ts`

After `createTrace`, use a conditional UPDATE as the lock:

```typescript
// Attempt to claim the "notify slot" atomically
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
      isNull(traces.githubCommentPostedAt)   // Only succeeds once
    ))
    .returning({ id: traces.id })

  // Only post if this request was the one that set the timestamp
  if (claimed.length > 0) {
    postGithubPrComment(db, trace).catch((err) =>
      logger.warn({ err, traceId: trace.id }, 'github pr comment failed, timestamp already set')
    )
  }
}
```

The `.update(...WHERE github_comment_posted_at IS NULL RETURNING id)` pattern ensures exactly one request wins the race. Only the request that gets a returned row proceeds to post. If the GitHub API call subsequently fails, the timestamp is already set — a commented-out retry is acceptable for MVP (notifications are best-effort).

A GitHub API failure never fails the ingest response (201 is always returned).

### GitHub Notify Service

**New file:** `apps/api/src/services/github-notify.ts`

```typescript
type GithubMetadata = {
  githubPrUrl: string
  githubPrNumber: string
  githubRepository: string   // "owner/repo" format, exactly one "/"
}

export async function postGithubPrComment(
  db: DB,
  trace: Trace
): Promise<void> {
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

function buildCommentBody(trace: Trace): string {
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
  const traceUrl = `${process.env.TRACION_WEB_URL}/traces/${trace.id}`

  return [
    '## 🤖 Tracion — Agent Trace',
    '',
    '| | |',
    '|---|---|',
    `| **Status** | ${status} |`,
    `| **Agent** | ${trace.agentId} |`,
    `| **Duration** | ${durationStr} |`,
    `| **Cost** | ${costStr} |`,
    `| **Tokens** | ${trace.totalTokens.toLocaleString()} |`,
    '',
    `[View full trace →](${traceUrl})`,
    '',
    '<sub>Posted by [Tracion](https://github.com/kajaha06251020/Tracion)</sub>',
  ].join('\n')
}
```

### Configuration

Add to `.env.example`:

```bash
# GitHub PR auto-comment (optional)
# Create a personal access token (classic) with "repo" scope, OR
# a fine-grained PAT with "Issues: Read and Write" permission.
# See: https://github.com/settings/tokens
GITHUB_TOKEN=
```

**Required scope:** `repo` (classic PAT) or "Issues: Read and Write" (fine-grained PAT). The endpoint used is `POST /repos/{owner}/{repo}/issues/{number}/comments`, which requires repo write access. The `write:discussion` scope is for Gist and team discussions and will cause 403 on this endpoint.

### Org-scoping note

Phase 3C adds `org_id` to traces. The notification trigger currently reads `trace.metadata.githubPrUrl` without checking org. Until multi-tenancy is fully deployed, this is acceptable (single self-hosted org). When multi-tenancy is active and `org_id` is enforced, the notify service must confirm the trace's `org_id` matches a known org before posting, to prevent a malicious SDK client from injecting arbitrary PR URLs into metadata and triggering cross-tenant comments.

---

## Data Flow

```
Developer opens PR #42 on repo "acme/frontend"
Claude Code / SDK starts a trace
  → TypeScript SDK calls detectGithubPrContext()
  → gh pr view → { number: 42, url: "...", headRepository: { nameWithOwner: "acme/frontend" } }
  → Injects github.pr.* as OTel resource attributes on root span

Agent completes
  → SDK sends OTLP payload to POST /v1/traces
  → parser.ts: extracts github.pr.* from resource attrs → trace.metadata
  → createTrace saves trace with status 'success' and metadata
  → Ingest route: UPDATE ... SET github_comment_posted_at = now()
      WHERE id = $id AND github_comment_posted_at IS NULL RETURNING id
  → Row returned → this request "won" → call postGithubPrComment()
  → GitHub API: POST .../repos/acme/frontend/issues/42/comments
  → PR gets comment with trace summary + link
```

---

## Error Handling

| Case | Behavior |
|------|----------|
| `gh` not installed | `detectGithubPrContext()` returns null; no attrs; no comment |
| Branch has no open PR | `gh pr view` exits non-zero; returns null |
| `GITHUB_TOKEN` not set | Ingest route skips notification silently |
| Concurrent OTLP delivery | Atomic `WHERE IS NULL RETURNING` — only one request posts |
| GitHub API 403 (bad token/scope) | Logged as warn; ingest returns 201 |
| GitHub API 404 (wrong repo/PR) | Logged as warn; ingest returns 201 |
| `githubRepository` missing `/` | `split('/')` returns `['owner']`; `repo` is undefined; GitHub API returns 422; logged as warn |

---

## File Map

| Action | File |
|--------|------|
| Modify | `packages/sdk-typescript/src/tracer.ts` — add `detectGithubPrContext()`, call at root span creation |
| Modify | `apps/api/src/otel/parser.ts` — extract `github.pr.*` from resource attrs → `trace.metadata` |
| Create | `apps/api/src/services/github-notify.ts` — comment builder + GitHub API call |
| Modify | `apps/api/src/routes/ingest.ts` — atomic `UPDATE ... WHERE IS NULL RETURNING` + async notify |
| Modify | `apps/api/src/db/schema.ts` — add `githubCommentPostedAt` |
| Create | `apps/api/src/db/migrations/0006_github_notify.sql` |
| Modify | `.env.example` — add `GITHUB_TOKEN` with scope comment |
| Create | `apps/api/src/services/github-notify.test.ts` |

---

## Testing

- `detectGithubPrContext()` returns null when `gh` exits non-zero
- `detectGithubPrContext()` correctly parses `headRepository.nameWithOwner` as `"owner/repo"`
- Parser stores `github.pr.*` in `trace.metadata` when resource attrs present
- Parser does not error when `github.pr.*` attrs are absent
- `buildCommentBody()` formats `totalCostUsd` via `parseFloat().toFixed(4)` (not raw string)
- `buildCommentBody()` produces correct status emoji for success and error
- `postGithubPrComment` calls `GITHUB_TOKEN` bearer auth header
- Ingest skips notification when `GITHUB_TOKEN` unset
- Ingest: concurrent requests for same trace — only one posts (atomic WHERE IS NULL guard)
- Ingest: GitHub API failure does not fail the 201 response (`.catch` swallows error)
- Ingest: second OTLP payload with `githubCommentPostedAt` already set does not re-post

---

## Non-Goals (MVP)

- GitHub App installation (PAT is sufficient)
- Updating or replacing existing comments (each trace creates a new comment)
- Configuring per-repo or per-org enable/disable
- Showing diff of files changed by the agent
- Retry on transient GitHub API failures
