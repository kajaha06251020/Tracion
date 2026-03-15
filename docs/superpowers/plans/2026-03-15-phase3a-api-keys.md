# Phase 3A: API Key Management UI Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Users can create, view, and revoke personal API keys from `/settings/api-keys`, replacing the single env-var key with per-user DB-backed keys.

**Architecture:** New `public.api_keys` table → rewritten `requireAuth` middleware using `Bun.password` bcrypt → new `apiKeys` tRPC router → `/settings/api-keys` Next.js page.

**Tech Stack:** Drizzle ORM, Bun.password, tRPC v11, Next.js 15 App Router, shadcn/ui

**Spec:** `docs/superpowers/specs/2026-03-15-phase3-feature-expansion.md` — Feature 1

**Key codebase facts (read before implementing):**
- Routers live in `apps/api/src/trpc/routers/` (e.g. `traces.ts`, `spans.ts`)
- Main router is `apps/api/src/trpc/router.ts`
- DB type is `DB` exported from `apps/api/src/db/index.ts`
- `AuthUser` is `typeof auth.$Infer.Session.user` — defined in `apps/api/src/trpc/context.ts`
- `requireAuth` is mounted in `apps/api/src/routes/trpc.ts` (NOT index.ts)
- `apps/api/src/trpc/init.ts` only exports `router` and `publicProcedure` — `protectedProcedure` must be added
- `context.ts` defines `Context = { db: DB, user: AuthUser }`

---

## File Map

| Action | File | Purpose |
|--------|------|---------|
| Create | `apps/api/src/db/migrations/0002_api_keys.sql` | DB migration |
| Modify | `apps/api/src/db/schema.ts` | Add apiKeys table to Drizzle schema |
| Modify | `apps/api/src/trpc/init.ts` | Add `protectedProcedure` |
| Modify | `apps/api/src/middleware/require-auth.ts` | Rewrite to use DB lookup + Bun.password |
| Modify | `apps/api/src/middleware/require-auth.test.ts` | Update tests for new factory pattern |
| Modify | `apps/api/src/routes/trpc.ts` | Use `makeRequireAuth(db)` factory |
| Create | `apps/api/src/trpc/routers/api-keys.ts` | tRPC router for key CRUD |
| Create | `apps/api/src/trpc/routers/api-keys.test.ts` | Unit tests for router |
| Modify | `apps/api/src/trpc/router.ts` | Mount apiKeys router |
| Create | `apps/web/app/settings/api-keys/page.tsx` | Settings page |
| Modify | `apps/web/components/nav/sidebar.tsx` | Add Settings link |

---

## Chunk 1: Database Layer + protectedProcedure

### Task 1: Create migration, update schema, add protectedProcedure

**Files:**
- Read: `apps/api/src/db/schema.ts`
- Read: `apps/api/src/trpc/init.ts`
- Create: `apps/api/src/db/migrations/0002_api_keys.sql`
- Modify: `apps/api/src/db/schema.ts`
- Modify: `apps/api/src/trpc/init.ts`

- [ ] **Step 1: Read the current schema and init files**

```bash
cat apps/api/src/db/schema.ts
cat apps/api/src/trpc/init.ts
cat apps/api/src/trpc/context.ts
cat apps/api/src/db/migrations/meta/_journal.json
```

- [ ] **Step 2: Create the migration file**

```sql
-- apps/api/src/db/migrations/0002_api_keys.sql
CREATE TABLE IF NOT EXISTS public.api_keys (
  id          TEXT NOT NULL PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  key_hash    TEXT NOT NULL UNIQUE,
  key_prefix  TEXT NOT NULL,
  last_used   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS api_keys_user_prefix_idx
  ON public.api_keys (user_id, key_prefix)
  WHERE revoked_at IS NULL;
```

- [ ] **Step 3: Add apiKeys to Drizzle schema**

In `apps/api/src/db/schema.ts`, add following existing table patterns:

```typescript
export const apiKeys = pgTable('api_keys', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  keyHash: text('key_hash').notNull().unique(),
  keyPrefix: text('key_prefix').notNull(),
  lastUsed: timestamp('last_used', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
})
```

- [ ] **Step 4: Add `protectedProcedure` to init.ts**

In `apps/api/src/trpc/init.ts`, add after the existing exports:

```typescript
import { TRPCError } from '@trpc/server'

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED' })
  }
  return next({ ctx: { ...ctx, user: ctx.user } })
})
```

- [ ] **Step 5: Run migration**

```bash
cd apps/api && bun run db:migrate
```

Expected: Migration applies without error.

- [ ] **Step 6: TypeScript check**

```bash
cd apps/api && bun run typecheck
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/db/migrations/0002_api_keys.sql apps/api/src/db/schema.ts apps/api/src/trpc/init.ts
git commit -m "feat(api): add api_keys migration, Drizzle schema, and protectedProcedure"
```

---

## Chunk 2: Auth Middleware Rewrite

### Task 2: Rewrite requireAuth to use DB lookup

**Files:**
- Read: `apps/api/src/middleware/require-auth.ts`
- Read: `apps/api/src/routes/trpc.ts` (this is where requireAuth is mounted, NOT index.ts)
- Modify: `apps/api/src/middleware/require-auth.ts`
- Modify: `apps/api/src/middleware/require-auth.test.ts`
- Modify: `apps/api/src/routes/trpc.ts`

- [ ] **Step 1: Read current files**

```bash
cat apps/api/src/middleware/require-auth.ts
cat apps/api/src/middleware/require-auth.test.ts
cat apps/api/src/routes/trpc.ts
```

- [ ] **Step 2: Write failing tests**

Replace `apps/api/src/middleware/require-auth.test.ts` with:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { makeRequireAuth } from './require-auth'
import type { DB } from '../db/index'

const makeMockDb = () => ({
  select: vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    }),
  }),
  update: vi.fn().mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  }),
}) as unknown as DB

const makeApp = (db: DB) => {
  const app = new Hono()
  app.use('*', makeRequireAuth(db))
  app.get('/test', (c) => c.json({ ok: true }))
  return app
}

describe('makeRequireAuth', () => {
  it('returns 401 when no key and no session cookie', async () => {
    const db = makeMockDb()
    const app = makeApp(db)
    const res = await app.request('/test')
    expect(res.status).toBe(401)
  })

  it('returns 401 when API key not found in DB', async () => {
    const db = makeMockDb()
    // DB returns empty — no matching key
    const app = makeApp(db)
    const res = await app.request('/test', {
      headers: { 'X-Tracion-Api-Key': 'tracion_notexist1234567890abcdef' },
    })
    expect(res.status).toBe(401)
  })

  it('returns 200 when valid API key matches DB record', async () => {
    const rawKey = 'tracion_testkey1234567890abcdef'
    const hash = await Bun.password.hash(rawKey, { algorithm: 'bcrypt', cost: 4 })
    const prefix = rawKey.substring(0, 16)

    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{
            id: 'key1',
            userId: 'user1',
            keyHash: hash,
            keyPrefix: prefix,
            revokedAt: null,
          }]),
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    } as unknown as DB

    const app = makeApp(db)
    const res = await app.request('/test', {
      headers: { 'X-Tracion-Api-Key': rawKey },
    })
    expect(res.status).toBe(200)
  })
})
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
cd apps/api && bunx vitest run src/middleware/require-auth.test.ts
```

Expected: Tests fail because `makeRequireAuth` doesn't exist yet.

- [ ] **Step 4: Rewrite the middleware**

Replace `apps/api/src/middleware/require-auth.ts` with:

```typescript
import { createMiddleware } from 'hono/factory'
import { eq, and, isNull } from 'drizzle-orm'
import { apiKeys } from '../db/schema'
import type { DB } from '../db/index'
import type { auth } from '../auth/index'

type AuthUser = typeof auth.$Infer.Session.user

export type RequireAuthEnv = {
  Variables: { user: AuthUser }
}

export const makeRequireAuth = (db: DB) =>
  createMiddleware<RequireAuthEnv>(async (c, next) => {
    const apiKey = c.req.header('X-Tracion-Api-Key')

    if (apiKey) {
      // First 16 chars of the key are the prefix — stored in key_prefix column
      const prefix = apiKey.substring(0, 16)

      const candidates = await db
        .select()
        .from(apiKeys)
        .where(and(eq(apiKeys.keyPrefix, prefix), isNull(apiKeys.revokedAt)))

      for (const candidate of candidates) {
        const valid = await Bun.password.verify(apiKey, candidate.keyHash)
        if (valid) {
          // Fire-and-forget: update last_used (non-critical)
          db.update(apiKeys)
            .set({ lastUsed: new Date() })
            .where(eq(apiKeys.id, candidate.id))
            .catch(() => {})

          c.set('user', { id: candidate.userId } as unknown as AuthUser)
          return next()
        }
      }

      return c.json({ error: 'Unauthorized' }, 401)
    }

    // No API key — check session cookie via BetterAuth
    const { auth } = await import('../auth/index')
    const session = await auth.api.getSession({ headers: c.req.raw.headers })
    if (!session) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    c.set('user', session.user)
    return next()
  })
```

- [ ] **Step 5: Update apps/api/src/routes/trpc.ts to use the factory**

In `apps/api/src/routes/trpc.ts`, change:
```typescript
// Before:
import { requireAuth } from '../middleware/require-auth'
// ...
trpcRoute.use('/trpc/*', requireAuth)

// After:
import { makeRequireAuth } from '../middleware/require-auth'
import { db } from '../db/index'
// ...
trpcRoute.use('/trpc/*', makeRequireAuth(db))
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd apps/api && bunx vitest run src/middleware/require-auth.test.ts
```

Expected: All 3 tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/middleware/require-auth.ts apps/api/src/middleware/require-auth.test.ts apps/api/src/routes/trpc.ts
git commit -m "feat(api): rewrite requireAuth to factory pattern with DB-backed API keys"
```

---

## Chunk 3: tRPC Router

### Task 3: Create apiKeys tRPC router

**Files:**
- Read: `apps/api/src/trpc/routers/traces.ts` (understand router pattern)
- Read: `apps/api/src/trpc/router.ts` (understand how routers are mounted)
- Create: `apps/api/src/trpc/routers/api-keys.ts`
- Create: `apps/api/src/trpc/routers/api-keys.test.ts`
- Modify: `apps/api/src/trpc/router.ts`

- [ ] **Step 1: Read existing router files to understand the exact import/export pattern**

```bash
cat apps/api/src/trpc/routers/traces.ts
cat apps/api/src/trpc/router.ts
```

- [ ] **Step 2: Write failing tests**

```typescript
// apps/api/src/trpc/routers/api-keys.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createCallerFactory } from '@trpc/server'
import { apiKeysRouter } from './api-keys'
import type { DB } from '../../db/index'
import type { auth } from '../../auth/index'

type AuthUser = typeof auth.$Infer.Session.user

const mockDb = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
} as unknown as DB

const mockUser = { id: 'user1', email: 'test@test.com', name: 'Test' } as unknown as AuthUser

const createCaller = createCallerFactory(apiKeysRouter)
const caller = createCaller({ db: mockDb, user: mockUser })

beforeEach(() => vi.clearAllMocks())

describe('apiKeys.list', () => {
  it('returns list of keys without keyHash field', async () => {
    const mockKeys = [
      { id: 'k1', userId: 'user1', name: 'My Key', keyPrefix: 'tracion_ab12ef34', lastUsed: null, createdAt: new Date() },
    ]
    mockDb.select = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(mockKeys),
      }),
    })

    const result = await caller.list()
    expect(result).toHaveLength(1)
    expect(result[0]).not.toHaveProperty('keyHash')
    expect(result[0].name).toBe('My Key')
  })
})

describe('apiKeys.create', () => {
  it('returns rawKey starting with tracion_ and stores hash', async () => {
    mockDb.insert = vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 'k2' }]),
      }),
    })

    const result = await caller.create({ name: 'New Key' })
    expect(result.rawKey).toMatch(/^tracion_/)
    expect(result.rawKey.length).toBeGreaterThan(20)
    expect(result.id).toBe('k2')
  })
})

describe('apiKeys.revoke', () => {
  it('calls update to set revokedAt', async () => {
    mockDb.update = vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    })

    await expect(caller.revoke({ id: 'k1' })).resolves.not.toThrow()
    expect(mockDb.update).toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run tests to confirm failure**

```bash
cd apps/api && bunx vitest run src/trpc/routers/api-keys.test.ts
```

- [ ] **Step 4: Write the router**

```typescript
// apps/api/src/trpc/routers/api-keys.ts
import { z } from 'zod'
import { eq, and, isNull } from 'drizzle-orm'
import { router, protectedProcedure } from '../init'
import { apiKeys } from '../../db/schema'

export const apiKeysRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        keyPrefix: apiKeys.keyPrefix,
        lastUsed: apiKeys.lastUsed,
        createdAt: apiKeys.createdAt,
      })
      .from(apiKeys)
      .where(and(eq(apiKeys.userId, ctx.user.id), isNull(apiKeys.revokedAt)))
  }),

  create: protectedProcedure
    .input(z.object({ name: z.string().min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      const randomBytes = crypto.getRandomValues(new Uint8Array(16))
      const hex = Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0')).join('')
      const rawKey = `tracion_${hex}`
      const keyPrefix = rawKey.substring(0, 16)

      const keyHash = await Bun.password.hash(rawKey, { algorithm: 'bcrypt', cost: 12 })
      const id = crypto.randomUUID()

      const [created] = await ctx.db
        .insert(apiKeys)
        .values({ id, userId: ctx.user.id, name: input.name, keyHash, keyPrefix })
        .returning({ id: apiKeys.id })

      return { id: created.id, rawKey }
    }),

  revoke: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(apiKeys)
        .set({ revokedAt: new Date() })
        .where(and(eq(apiKeys.id, input.id), eq(apiKeys.userId, ctx.user.id)))
    }),
})
```

- [ ] **Step 5: Mount the router in router.ts**

Read `apps/api/src/trpc/router.ts` and add:
```typescript
import { apiKeysRouter } from './routers/api-keys'
// Inside appRouter:
apiKeys: apiKeysRouter,
```

- [ ] **Step 6: Run tests**

```bash
cd apps/api && bunx vitest run src/trpc/routers/api-keys.test.ts
```

Expected: All 3 tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/trpc/routers/api-keys.ts apps/api/src/trpc/routers/api-keys.test.ts apps/api/src/trpc/router.ts
git commit -m "feat(api): add apiKeys tRPC router with list, create, revoke"
```

---

## Chunk 4: Frontend Page

### Task 4: Create /settings/api-keys page

**Files:**
- Read: `apps/web/app/dashboard/page.tsx`
- Read: `apps/web/lib/trpc.ts`
- Read: `apps/web/components/nav/sidebar.tsx`
- Create: `apps/web/app/settings/api-keys/page.tsx`
- Modify: `apps/web/components/nav/sidebar.tsx`

- [ ] **Step 1: Read existing patterns**

```bash
cat apps/web/app/dashboard/page.tsx
cat apps/web/lib/trpc.ts
cat apps/web/components/nav/sidebar.tsx
```

- [ ] **Step 2: Create the API keys settings page**

```typescript
// apps/web/app/settings/api-keys/page.tsx
'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc'

export default function ApiKeysPage() {
  const [newKeyName, setNewKeyName] = useState('')
  const [createdKey, setCreatedKey] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [revoking, setRevoking] = useState<string | null>(null)

  const { data: keys = [], refetch } = trpc.apiKeys.list.useQuery()
  const createKey = trpc.apiKeys.create.useMutation({
    onSuccess: (data) => {
      setCreatedKey(data.rawKey)
      setNewKeyName('')
      setShowCreate(false)
      refetch()
    },
  })
  const revokeKey = trpc.apiKeys.revoke.useMutation({
    onSuccess: () => { setRevoking(null); refetch() },
  })

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">API Keys</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
        >
          Create API Key
        </button>
      </div>

      {createdKey && (
        <div className="mb-6 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
          <p className="text-sm font-medium text-green-800 dark:text-green-200 mb-2">
            API key created. Copy it now — it will not be shown again.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-white dark:bg-gray-900 border rounded px-3 py-2 text-sm font-mono break-all">
              {createdKey}
            </code>
            <button
              onClick={() => { navigator.clipboard.writeText(createdKey); setCreatedKey(null) }}
              className="px-3 py-2 bg-green-600 text-white rounded text-sm hover:bg-green-700"
            >
              Copy & Dismiss
            </button>
          </div>
        </div>
      )}

      {showCreate && (
        <div className="mb-6 p-4 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800">
          <h2 className="text-sm font-medium mb-3">New API Key</h2>
          <div className="flex gap-2">
            <input
              type="text"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="Key name (e.g. Production, CI)"
              className="flex-1 border rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600"
            />
            <button
              onClick={() => createKey.mutate({ name: newKeyName })}
              disabled={!newKeyName.trim() || createKey.isPending}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
            >
              {createKey.isPending ? 'Creating…' : 'Create'}
            </button>
            <button onClick={() => setShowCreate(false)} className="px-3 py-2 text-gray-500 text-sm">Cancel</button>
          </div>
        </div>
      )}

      {keys.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          No API keys yet. Create one to use the SDK or MCP server.
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-gray-500">
              <th className="pb-2 font-medium">Name</th>
              <th className="pb-2 font-medium">Key</th>
              <th className="pb-2 font-medium">Last used</th>
              <th className="pb-2 font-medium">Created</th>
              <th className="pb-2"></th>
            </tr>
          </thead>
          <tbody>
            {keys.map((key) => (
              <tr key={key.id} className="border-b border-gray-100 dark:border-gray-800">
                <td className="py-3 font-medium">{key.name}</td>
                <td className="py-3 font-mono text-gray-500">{key.keyPrefix}…</td>
                <td className="py-3 text-gray-500">{key.lastUsed ? new Date(key.lastUsed).toLocaleDateString() : 'Never'}</td>
                <td className="py-3 text-gray-500">{new Date(key.createdAt).toLocaleDateString()}</td>
                <td className="py-3">
                  {revoking === key.id ? (
                    <span className="flex items-center gap-2 text-xs">
                      <span className="text-red-600">Revoke?</span>
                      <button onClick={() => revokeKey.mutate({ id: key.id })} className="text-red-600 underline">Yes</button>
                      <button onClick={() => setRevoking(null)} className="text-gray-500 underline">No</button>
                    </span>
                  ) : (
                    <button onClick={() => setRevoking(key.id)} className="text-xs text-red-500 hover:text-red-700">Revoke</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Add Settings section to sidebar**

Read `apps/web/components/nav/sidebar.tsx`. Add a nav link to `/settings/api-keys` following the existing link pattern. Add a "Settings" section heading before it if the sidebar has sections.

- [ ] **Step 4: TypeScript check**

```bash
cd apps/web && bun run typecheck
```

Fix any type errors (usually from tRPC procedure type inference — may need to check the generated router types).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/settings/api-keys/page.tsx apps/web/components/nav/sidebar.tsx
git commit -m "feat(web): add API key management UI at /settings/api-keys"
```
