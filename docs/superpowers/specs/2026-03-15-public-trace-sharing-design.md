# Public Trace Sharing — Design Spec

> *Last updated: 2026-03-15*

## Goal

Allow any trace to be shared via a secret URL that requires no login. The recipient sees the full trace waterfall and span details in a read-only view. The owner can revoke the link at any time.

---

## Problem

Tracion traces are currently visible only to authenticated users. Teams want to:
- Paste a trace link into a Slack message or PR comment
- Share a debugging session with someone outside the org
- Show a trace on a public blog post or README

Without public sharing, Tracion is invisible outside the team that runs it.

---

## Architecture

### Data Model

Migration `0005_share_token.sql` (index 5 in the journal — origin/main has entries 0000–0004):

```sql
ALTER TABLE otel.traces
  ADD COLUMN share_token TEXT UNIQUE;
```

Drizzle schema addition in `apps/api/src/db/schema.ts`:

```typescript
shareToken: text('share_token').unique(),
```

**Prerequisite:** Before generating this migration, pull/merge origin/main to sync migrations 0001–0004 into the local journal. Running `drizzle-kit generate` from a local branch that only knows about `0000` will produce `0001_share_token.sql` and create a numbering conflict on merge. The correct sequence: `git merge origin/main && bun run db:generate`.

(`github_comment_posted_at` is unrelated and belongs in Feature B's migration `0006_github_notify.sql`.)

### App Router Restructure

The current `apps/web/app/layout.tsx` renders `<TRPCProvider>` and `<Sidebar>` unconditionally for all routes. To create a truly public route (no sidebar, no tRPC session), the app must be restructured into two route groups:

**New structure:**

```
apps/web/app/
├── layout.tsx              ← Root: bare <html><body> only (no sidebar, no provider)
├── (app)/
│   ├── layout.tsx          ← Auth layout: TRPCProvider + Sidebar (same as current root)
│   ├── dashboard/page.tsx  ← moved
│   ├── traces/             ← moved
│   ├── analytics/          ← moved
│   └── settings/           ← moved
└── (public)/
    ├── layout.tsx          ← Public: bare layout (dark bg only)
    ├── login/page.tsx      ← moved (login has no sidebar)
    └── share/
        └── [token]/page.tsx ← new
```

**`apps/web/app/layout.tsx`** (new root — minimal):
```typescript
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
```

**`apps/web/app/(app)/layout.tsx`** (authenticated shell):
```typescript
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <TRPCProvider>
      <div className="flex bg-gray-50 dark:bg-gray-900 min-h-screen">
        <Sidebar />
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </TRPCProvider>
  )
}
```

**`apps/web/app/(public)/layout.tsx`** (no auth shell):
```typescript
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-gray-950 text-white min-h-screen">{children}</div>
  )
}
```

This is a file-move operation. The only code change is extracting the body content from the current root layout into `(app)/layout.tsx`. All existing page components are moved unchanged into `(app)/`.

### API: New Public Hono Route

New file: `apps/api/src/routes/public.ts`

**Endpoint:** `GET /api/public/traces/:token`
- No authentication required
- Returns 404 `{ success: false, error: { code: "NOT_FOUND", message: "Trace not found or no longer shared" } }` if token is not in the DB
- Returns 200 with the response shape below if found

**Response shape** — must satisfy the union of `SpanWaterfall` props (`id, name, kind, startTime, endTime, parentSpanId`) AND `SpanAttributes` props (`id, name, kind, model, inputTokens, outputTokens, costUsd, status, attributes, events`). Omitting any of these fields causes `SpanAttributes` to render `NaN` or crash on `span.events.length`:

```typescript
type PublicTraceResponse = {
  success: true
  data: {
    trace: {
      id: string
      name: string
      agentId: string
      status: 'running' | 'success' | 'error'
      startTime: string      // ISO 8601
      endTime: string | null
      totalTokens: number
      totalCostUsd: string   // numeric(10,6) serialized as string
    }
    spans: Array<{
      id: string
      traceId: string
      parentSpanId: string | null
      kind: 'llm' | 'tool' | 'agent' | 'retrieval' | 'custom'
      name: string
      model: string | null
      inputTokens: number
      outputTokens: number
      costUsd: string
      startTime: string
      endTime: string | null
      status: 'running' | 'success' | 'error'
      attributes: Record<string, unknown>
      events: unknown[]
    }>
  }
}
```

### Middleware: Add `/share` to Public Paths

**File:** `apps/web/middleware.ts`

Next.js middleware runs before the App Router and is independent of route groups. The existing `PUBLIC_PATHS` only includes `['/login', '/api']`. The `/share` route must be added:

```typescript
const PUBLIC_PATHS = ['/login', '/api', '/share']
```

Without this, unauthenticated visitors to `/share/[token]` will be redirected to `/login` before the page renders.

### API Mount Order

Mounted in `apps/api/src/index.ts` **before** any auth middleware:

```typescript
app.route('/', publicRoute)   // GET /api/public/* — no auth
app.route('/', ingestRoute)
app.route('/', trpcRoute)
```

### tRPC: Two New Procedures

In `apps/api/src/trpc/routers/traces.ts`, add after the existing `delete` procedure:

```typescript
createShareLink: protectedProcedure
  .input(z.object({ traceId: z.string() }))
  .mutation(async ({ input, ctx }) => {
    // 1. Access check: verify the trace is visible to this user
    //    (same org-scoping as traces.list: orgId = ctx.activeOrgId OR orgId IS NULL)
    //    If not found → throw new TRPCError({ code: 'NOT_FOUND' })
    //
    // 2. Generate token using CSPRNG:
    //    const bytes = new Uint8Array(24)
    //    crypto.getRandomValues(bytes)
    //    const token = btoa(String.fromCharCode(...bytes))
    //                    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
    //    → produces a 32-char base64url string (~143 bits of entropy)
    //
    // 3. UPDATE otel.traces SET share_token = $token WHERE id = $traceId
    //
    // 4. Return { token, shareUrl: `${process.env.TRACION_WEB_URL}/share/${token}` }
  })

revokeShareLink: protectedProcedure
  .input(z.object({ traceId: z.string() }))
  .mutation(async ({ input, ctx }) => {
    // 1. Same access check as createShareLink (NOT_FOUND if not visible)
    // 2. UPDATE otel.traces SET share_token = NULL WHERE id = $traceId
  })
```

**Access model:** Any authenticated user in the active org can share/revoke any trace visible to them. There is no per-user trace ownership in the current schema — `session_id` on traces is a free-text SDK field, not a FK into `auth.sessions`. Using org-based visibility (same as `traces.list`) is the correct and consistent approach.

### Web: Public Share Page

**File:** `apps/web/app/(public)/share/[token]/page.tsx`

Data fetching: **raw `fetch`** to `GET ${NEXT_PUBLIC_API_URL}/api/public/traces/${token}` with `{ cache: 'no-store' }`. This is a server component. tRPC is not used here — it requires auth session and is unavailable in the `(public)` layout.

```typescript
// Server component
async function getSharedTrace(token: string): Promise<PublicTraceResponse['data'] | null> {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/api/public/traces/${token}`,
    { cache: 'no-store' }  // No caching: revocation must take effect immediately
  )
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Unexpected error: ${res.status}`)
  const json = await res.json() as PublicTraceResponse
  return json.data
}
```

Layout: minimal header (Tracion logo + trace name + status badge + duration + cost), then the same two-panel layout as `/traces/[id]`: left `SpanWaterfall`, right `SpanAttributes`. Both components are used unchanged — they are purely presentational with no auth dependencies.

If `getSharedTrace` returns null, render a centered "This trace is no longer available" message.

Footer: `Powered by Tracion` with a link.

### Web: Share Button in Trace Detail

In `apps/web/app/(app)/traces/[id]/page.tsx` (moved to `(app)/`), add to the trace header:

- If `trace.shareToken` is null: `[Share]` button → calls `createShareLink` mutation → on success copies `${NEXT_PUBLIC_WEB_URL}/share/${token}` to clipboard and shows a toast "Link copied!"
- If `trace.shareToken` is set: `[Copy link]` button + `[Revoke]` button
- The `traces.get` tRPC procedure must include `shareToken` in its response (add to existing procedure's select)

Clipboard fallback: if `navigator.clipboard.writeText` throws (no HTTPS or permissions denied), show the URL in a `<input readOnly>` in a small inline modal.

---

## Data Flow

```
User clicks "Share" on /traces/[id]
  → tRPC traces.createShareLink(traceId)
  → API: access check (org visibility), then crypto.getRandomValues → 32-char base64url token
  → DB: UPDATE otel.traces SET share_token = $token
  → Returns { token, shareUrl }
  → Frontend copies URL to clipboard + toast

Recipient opens /share/<token>
  → Next.js server component: fetch /api/public/traces/<token> { cache: 'no-store' }
  → API: SELECT FROM otel.traces WHERE share_token = $token (+ spans JOIN)
  → Returns PublicTraceResponse
  → SpanWaterfall + SpanAttributes render in read-only layout

User clicks "Revoke"
  → tRPC traces.revokeShareLink(traceId)
  → DB: UPDATE otel.traces SET share_token = NULL
  → Subsequent fetch of that token → 404 → "no longer available"
```

---

## Error Handling

| Case | Behavior |
|------|----------|
| Invalid / revoked token | `GET /api/public/traces/:token` returns 404; page shows "no longer available" |
| Unauthenticated user calls createShareLink | `protectedProcedure` → 401 UNAUTHORIZED |
| User tries to share a trace not in their org | Access check returns NOT_FOUND |
| `navigator.clipboard` unavailable | Fallback: show URL in readonly input |
| fetch in share page returns non-404 error | Show generic error: "Failed to load trace" |

---

## File Map

| Action | File |
|--------|------|
| Create | `apps/api/src/db/migrations/0005_share_token.sql` |
| Modify | `apps/api/src/db/schema.ts` — add shareToken |
| Create | `apps/api/src/routes/public.ts` — GET /api/public/traces/:token |
| Modify | `apps/api/src/index.ts` — mount publicRoute before ingestRoute |
| Modify | `apps/api/src/trpc/routers/traces.ts` — createShareLink, revokeShareLink; include shareToken in traces.get |
| Modify | `apps/web/app/layout.tsx` — strip to bare html/body |
| Create | `apps/web/app/(app)/layout.tsx` — TRPCProvider + Sidebar (extracted from current root) |
| Move   | `apps/web/app/dashboard/` → `apps/web/app/(app)/dashboard/` |
| Move   | `apps/web/app/traces/` → `apps/web/app/(app)/traces/` |
| Move   | `apps/web/app/analytics/` → `apps/web/app/(app)/analytics/` |
| Move   | `apps/web/app/settings/` → `apps/web/app/(app)/settings/` |
| Create | `apps/web/app/(public)/layout.tsx` — minimal public layout |
| Move   | `apps/web/app/login/` → `apps/web/app/(public)/login/` |
| Create | `apps/web/app/(public)/share/[token]/page.tsx` — public share page |
| Modify | `apps/web/middleware.ts` — add `/share` to PUBLIC_PATHS |
| Create | `apps/api/src/routes/public.test.ts` — route tests |

---

## Testing

- `GET /api/public/traces/:token` with valid token → 200 with correct shape
- `GET /api/public/traces/:token` with invalid token → 404
- `GET /api/public/traces/:token` after `revokeShareLink` → 404
- `createShareLink` generates 32-char base64url token via `crypto.getRandomValues`
- `createShareLink` called twice replaces the token (new token each time)
- `revokeShareLink` sets share_token = NULL
- `createShareLink` with a traceId not visible to user's org → NOT_FOUND
- `revokeShareLink` with a traceId not visible to user's org → NOT_FOUND
- Share page renders SpanWaterfall + SpanAttributes with no auth session
- Share page renders "no longer available" when token is invalid

---

## Non-Goals (MVP)

- Expiry dates on share links
- Password-protected shares
- View count / analytics tracking
- Sharing individual spans (whole trace only)
- Rate limiting on the public endpoint
- Per-user trace ownership (org-level access is sufficient)
