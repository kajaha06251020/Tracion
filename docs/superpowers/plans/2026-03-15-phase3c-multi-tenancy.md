# Phase 3C: Multi-tenancy / Organizations Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each organization sees only its own traces; users belong to organizations; personal org is auto-created on first login.

**Architecture:** New `organizations` + `org_members` tables. `active_org_id` added to BetterAuth `session` row. tRPC context reads `activeOrgId` from session via raw SQL; all `traces.*` queries filter by it. Lazy personal-org creation via BetterAuth session hook.

**Tech Stack:** Drizzle ORM, tRPC v11, Next.js 15 App Router, BetterAuth

**Spec:** `docs/superpowers/specs/2026-03-15-phase3-feature-expansion.md` — Feature 3

**Key codebase facts:**
- Routers live in `apps/api/src/trpc/routers/`
- DB type is `DB` from `apps/api/src/db/index`
- `AuthUser` is `typeof auth.$Infer.Session.user`
- tRPC context is created inline in `apps/api/src/routes/trpc.ts` as `createContext: () => ({ db, user: c.get('user') })`
- `traces` table is in the `otel` schema, not `public`
- BetterAuth tables are in `public` schema: `public.user`, `public.session`, `public.account`
- Migration numbering: last migration is `0001_better_auth_tables.sql`, Phase 3A creates `0002_api_keys.sql`. This plan creates `0003_organizations.sql`

**Prerequisites:** Phase 3A (API Keys) must be deployed first — `0003_organizations.sql` adds `org_id` to the `api_keys` table created in `0002_api_keys.sql`.

---

## File Map

| Action | File | Purpose |
|--------|------|---------|
| Create | `apps/api/src/db/migrations/0003_organizations.sql` | Organizations, org_id columns, session extension |
| Modify | `apps/api/src/db/schema.ts` | Add organizations, orgMembers Drizzle tables |
| Modify | `apps/api/src/db/schema.ts` | Add org_id columns to apiKeys and traces |
| Modify | `apps/api/src/routes/trpc.ts` | Extend createContext to include activeOrgId |
| Modify | `apps/api/src/trpc/context.ts` | Add activeOrgId to Context type |
| Create | `apps/api/src/trpc/routers/orgs.ts` | tRPC router: list, setActive |
| Create | `apps/api/src/trpc/routers/orgs.test.ts` | Unit tests |
| Modify | `apps/api/src/trpc/routers/traces.ts` | Filter by activeOrgId |
| Modify | `apps/api/src/trpc/router.ts` | Mount orgs router |
| Modify | `apps/api/src/auth/index.ts` | Auto-create personal org on first session |
| Create | `apps/web/components/nav/org-switcher.tsx` | Org dropdown in sidebar |
| Modify | `apps/web/components/nav/sidebar.tsx` | Add OrgSwitcher |
| Create | `apps/web/app/settings/organization/page.tsx` | Org settings stub |

---

## Chunk 1: Database Migration

### Task 1: Create organizations migration

**Files:**
- Read: `apps/api/src/db/schema.ts`
- Create: `apps/api/src/db/migrations/0003_organizations.sql`
- Modify: `apps/api/src/db/schema.ts`

- [ ] **Step 1: Read current schema**

```bash
cat apps/api/src/db/schema.ts
cat apps/api/src/db/migrations/meta/_journal.json
```

Confirm: `traces` table uses `otelSchema` (e.g. `otelSchema.table('traces', ...)`).

- [ ] **Step 2: Create the migration file**

```sql
-- apps/api/src/db/migrations/0003_organizations.sql
-- Prerequisites: 0002_api_keys.sql must have run

-- Organizations table
CREATE TABLE IF NOT EXISTS public.organizations (
  id         TEXT NOT NULL PRIMARY KEY,
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Organization membership
CREATE TABLE IF NOT EXISTS public.org_members (
  org_id     TEXT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'member',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);

-- Add org_id to traces (otel schema — nullable for backward compat with existing data)
ALTER TABLE otel.traces ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES public.organizations(id);
CREATE INDEX IF NOT EXISTS traces_org_id_idx ON otel.traces (org_id, created_at DESC) WHERE org_id IS NOT NULL;

-- Add org_id to api_keys (deferred from Phase 3A migration)
ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES public.organizations(id) ON DELETE CASCADE;

-- Add active_org_id to BetterAuth session table
-- MUST be AFTER organizations table is created above
ALTER TABLE public.session ADD COLUMN IF NOT EXISTS active_org_id TEXT REFERENCES public.organizations(id);
```

- [ ] **Step 3: Update Drizzle schema**

In `apps/api/src/db/schema.ts`, add:

```typescript
export const organizations = pgTable('organizations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const orgMembers = pgTable('org_members', {
  orgId: text('org_id').notNull(),
  userId: text('user_id').notNull(),
  role: text('role').notNull().default('member'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.orgId, t.userId] }),
}))
```

Also add `orgId` columns to existing tables:
- In `apiKeys` table: add `orgId: text('org_id'),`
- In `traces` table (in otelSchema): add `orgId: text('org_id'),`

The FK constraints are defined at the SQL level (migration); Drizzle schema only needs the column definition.

- [ ] **Step 4: Run migration**

```bash
cd apps/api && bun run db:migrate
```

- [ ] **Step 5: TypeScript check**

```bash
cd apps/api && bun run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/db/migrations/0003_organizations.sql apps/api/src/db/schema.ts
git commit -m "feat(api): add organizations table, org_id columns, and session extension"
```

---

## Chunk 2: tRPC Context Update

### Task 2: Add activeOrgId to tRPC context

**Files:**
- Read: `apps/api/src/trpc/context.ts`
- Read: `apps/api/src/routes/trpc.ts`
- Modify: `apps/api/src/trpc/context.ts`
- Modify: `apps/api/src/routes/trpc.ts`

- [ ] **Step 1: Read both files**

```bash
cat apps/api/src/trpc/context.ts
cat apps/api/src/routes/trpc.ts
```

- [ ] **Step 2: Update Context type in context.ts**

Add `activeOrgId: string | null` to the Context type:

```typescript
// In context.ts, update the Context type:
export type Context = {
  db: DB
  user: AuthUser
  activeOrgId: string | null
}
```

- [ ] **Step 3: Update inline createContext in routes/trpc.ts**

The `createContext` function is inline in `routes/trpc.ts`. Extend it to read `active_org_id` from the session:

```typescript
// In apps/api/src/routes/trpc.ts, update the fetchRequestHandler call:
import { sql } from 'drizzle-orm'
import { getCookie } from 'hono/cookie'

trpcRoute.all('/trpc/*', async (c) => {
  // Read session token from cookie to look up active_org_id
  const sessionToken = getCookie(c, 'better-auth.session_token') ?? ''
  let activeOrgId: string | null = null

  if (sessionToken) {
    try {
      const rows = await db.execute(
        sql`SELECT active_org_id FROM public.session WHERE token = ${sessionToken} AND expires_at > now() LIMIT 1`
      )
      const row = rows[0] as Record<string, unknown> | undefined
      activeOrgId = (row?.active_org_id as string | null) ?? null
    } catch {
      // non-critical — proceed without org
    }
  }

  return fetchRequestHandler({
    endpoint: '/trpc',
    req: c.req.raw,
    router: appRouter,
    createContext: () => ({ db, user: c.get('user'), activeOrgId }),
  })
})
```

**Note:** Read the actual cookie name from `apps/api/src/auth/index.ts` to ensure `'better-auth.session_token'` matches what BetterAuth sets.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/trpc/context.ts apps/api/src/routes/trpc.ts
git commit -m "feat(api): add activeOrgId to tRPC context from session row"
```

---

## Chunk 3: Orgs Router

### Task 3: Create orgs tRPC router

**Files:**
- Create: `apps/api/src/trpc/routers/orgs.ts`
- Create: `apps/api/src/trpc/routers/orgs.test.ts`
- Modify: `apps/api/src/trpc/router.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// apps/api/src/trpc/routers/orgs.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createCallerFactory } from '@trpc/server'
import { orgsRouter } from './orgs'
import type { DB } from '../../db/index'
import type { auth } from '../../auth/index'

type AuthUser = typeof auth.$Infer.Session.user

const mockDb = { select: vi.fn(), execute: vi.fn() } as unknown as DB
const mockUser = { id: 'user1', email: 'test@test.com', name: 'Test' } as unknown as AuthUser

const createCaller = createCallerFactory(orgsRouter)
const caller = createCaller({ db: mockDb, user: mockUser, activeOrgId: null })

beforeEach(() => vi.clearAllMocks())

describe('orgs.list', () => {
  it('returns orgs the user is a member of', async () => {
    mockDb.select = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            { id: 'org1', name: 'My Org', slug: 'my-org', role: 'owner' },
          ]),
        }),
      }),
    })
    const result = await caller.list()
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('My Org')
  })
})

describe('orgs.setActive', () => {
  it('calls db.execute to update session', async () => {
    mockDb.execute = vi.fn().mockResolvedValue(undefined)
    // setActive reads session token from ctx — pass it in the context
    const callerWithSessionToken = createCaller({
      db: mockDb,
      user: mockUser,
      activeOrgId: null,
      sessionToken: 'test-token',
    } as any)
    await expect(callerWithSessionToken.setActive({ orgId: 'org1' })).resolves.not.toThrow()
    expect(mockDb.execute).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to confirm failure**

```bash
cd apps/api && bunx vitest run src/trpc/routers/orgs.test.ts
```

- [ ] **Step 3: Write the router**

```typescript
// apps/api/src/trpc/routers/orgs.ts
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { sql } from 'drizzle-orm'
import { router, protectedProcedure } from '../init'
import { organizations, orgMembers } from '../../db/schema'

export const orgsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        role: orgMembers.role,
      })
      .from(organizations)
      .innerJoin(orgMembers, eq(orgMembers.orgId, organizations.id))
      .where(eq(orgMembers.userId, ctx.user.id))
  }),

  setActive: protectedProcedure
    .input(z.object({ orgId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Session token comes from context (set in routes/trpc.ts via cookie)
      const sessionToken = (ctx as any).sessionToken as string | undefined
      if (!sessionToken) return

      await ctx.db.execute(
        sql`UPDATE public.session SET active_org_id = ${input.orgId} WHERE token = ${sessionToken}`
      )
    }),
})
```

**Note:** Update `apps/api/src/routes/trpc.ts` to also pass `sessionToken` in the context (alongside `activeOrgId`):
```typescript
createContext: () => ({ db, user: c.get('user'), activeOrgId, sessionToken }),
```

Also update `Context` type in `context.ts` to add `sessionToken: string`.

- [ ] **Step 4: Mount in router.ts and run tests**

```bash
cd apps/api && bunx vitest run src/trpc/routers/orgs.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/trpc/routers/orgs.ts apps/api/src/trpc/routers/orgs.test.ts apps/api/src/trpc/router.ts apps/api/src/trpc/context.ts apps/api/src/routes/trpc.ts
git commit -m "feat(api): add orgs tRPC router with list and setActive"
```

---

## Chunk 4: Trace Scoping

### Task 4: Filter traces by activeOrgId

**Files:**
- Read: `apps/api/src/trpc/routers/traces.ts`
- Modify: `apps/api/src/trpc/routers/traces.ts`

- [ ] **Step 1: Read the traces router**

```bash
cat apps/api/src/trpc/routers/traces.ts
```

Find where `traces.list` query builds its WHERE clause.

- [ ] **Step 2: Add org_id filter**

Import `isNull` from drizzle-orm. In the `traces.list` query's where conditions array:

```typescript
import { eq, and, isNull } from 'drizzle-orm'

// In the query where clause, add org scoping:
...(ctx.activeOrgId
  ? [eq(traces.orgId, ctx.activeOrgId)]
  : [isNull(traces.orgId)]  // show legacy unscoped traces when user has no active org
)
```

- [ ] **Step 3: Run unit tests**

```bash
cd apps/api && bun run test
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/trpc/routers/traces.ts
git commit -m "feat(api): scope traces.list to active organization (with NULL fallback)"
```

---

## Chunk 5: Auto-create Personal Org on Login

### Task 5: Create personal org on first session creation

**Files:**
- Read: `apps/api/src/auth/index.ts`
- Modify: `apps/api/src/auth/index.ts`

- [ ] **Step 1: Read the BetterAuth configuration**

```bash
cat apps/api/src/auth/index.ts
```

Look for `databaseHooks`, `hooks`, or where to add session lifecycle callbacks.

- [ ] **Step 2: Add session creation hook**

In the BetterAuth config object inside `betterAuth({ ... })`, add:

```typescript
databaseHooks: {
  session: {
    create: {
      after: async (session) => {
        try {
          // Check if user already has org membership
          const memberships = await db
            .select({ orgId: orgMembers.orgId })
            .from(orgMembers)
            .where(eq(orgMembers.userId, session.userId))
            .limit(1)

          if (memberships.length === 0) {
            // Create a personal org for this user
            const orgId = crypto.randomUUID()
            const slug = `personal-${session.userId.substring(0, 8)}`

            // Get user name
            const userRows = await db.execute(
              sql`SELECT name FROM public."user" WHERE id = ${session.userId} LIMIT 1`
            )
            const userName = (userRows[0] as any)?.name ?? 'My workspace'
            const orgName = `${userName}'s workspace`

            await db.insert(organizations).values({ id: orgId, name: orgName, slug })
            await db.insert(orgMembers).values({ orgId, userId: session.userId, role: 'owner' })

            // Set as the active org on this new session
            await db.execute(
              sql`UPDATE public.session SET active_org_id = ${orgId} WHERE id = ${session.id}`
            )
          }
        } catch (err) {
          // Non-critical: log but don't block session creation
          console.error('[auth] Failed to create personal org:', err)
        }
      },
    },
  },
},
```

Add the necessary imports at the top of the file:
- `import { organizations, orgMembers } from '../db/schema'`
- `import { eq } from 'drizzle-orm'`
- `import { sql } from 'drizzle-orm'`

- [ ] **Step 3: Test manually**

Start the full stack and sign in. Then check:

```bash
# Exec into the DB container (name may vary — run docker ps first)
docker ps | grep db
docker exec -it <db-container-name> psql -U tracion -d tracion -c "SELECT * FROM public.organizations;"
docker exec -it <db-container-name> psql -U tracion -d tracion -c "SELECT * FROM public.org_members;"
```

Expected: One org row and one member row created for the signed-in user.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/auth/index.ts
git commit -m "feat(api): auto-create personal org on first session via BetterAuth hook"
```

---

## Chunk 6: Frontend Org Switcher

### Task 6: Add OrgSwitcher to sidebar

**Files:**
- Read: `apps/web/components/nav/sidebar.tsx`
- Read: `apps/web/lib/trpc.ts`
- Create: `apps/web/components/nav/org-switcher.tsx`
- Modify: `apps/web/components/nav/sidebar.tsx`
- Create: `apps/web/app/settings/organization/page.tsx`

- [ ] **Step 1: Read sidebar and trpc client**

```bash
cat apps/web/components/nav/sidebar.tsx
cat apps/web/lib/trpc.ts
```

- [ ] **Step 2: Create OrgSwitcher component**

```typescript
// apps/web/components/nav/org-switcher.tsx
'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc'

export function OrgSwitcher() {
  const [open, setOpen] = useState(false)
  const { data: orgs = [] } = trpc.orgs.list.useQuery()
  const setActive = trpc.orgs.setActive.useMutation({
    onSuccess: () => window.location.reload(),
  })

  if (orgs.length === 0) return null

  const activeOrg = orgs[0]

  return (
    <div className="relative mb-4">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-sm font-medium"
      >
        <span className="w-6 h-6 rounded bg-blue-600 text-white flex items-center justify-center text-xs font-bold flex-shrink-0">
          {activeOrg?.name?.[0]?.toUpperCase() ?? 'O'}
        </span>
        <span className="flex-1 text-left truncate text-gray-700 dark:text-gray-300">{activeOrg?.name ?? 'Select org'}</span>
        <span className="text-gray-400 text-xs">▼</span>
      </button>

      {open && orgs.length > 1 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50">
          {orgs.map((org) => (
            <button
              key={org.id}
              onClick={() => {
                setActive.mutate({ orgId: org.id })
                setOpen(false)
              }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-800 first:rounded-t-lg last:rounded-b-lg"
            >
              {org.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
```

**Note:** `setActive` now only passes `orgId`; the session token is read server-side from the cookie.

- [ ] **Step 3: Add OrgSwitcher to top of sidebar**

Read `apps/web/components/nav/sidebar.tsx`. Import `OrgSwitcher` and add `<OrgSwitcher />` at the top of the sidebar content, above the main navigation links.

- [ ] **Step 4: Create organization settings stub**

```typescript
// apps/web/app/settings/organization/page.tsx
export default function OrganizationSettingsPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-6">Organization</h1>
      <div className="p-6 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800">
        <p className="text-gray-500 text-sm">Member management and invites coming soon.</p>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: TypeScript check**

```bash
cd apps/web && bun run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/nav/org-switcher.tsx apps/web/components/nav/sidebar.tsx apps/web/app/settings/organization/page.tsx
git commit -m "feat(web): add org switcher to sidebar and organization settings stub"
```
