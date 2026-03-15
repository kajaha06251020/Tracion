# Phase 3D: Alert Notifications Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Users can define alert rules per organization (cost/error thresholds); a BullMQ worker evaluates them every 60 seconds and sends notifications via email, webhook, or Slack.

**Architecture:** New `alert_rules` + `alert_firings` tables → BullMQ repeatable job evaluating rules with cooldown deduplication → notification channel handlers → tRPC CRUD router → `/settings/alerts` UI page.

**Tech Stack:** BullMQ, Redis, nodemailer, Drizzle ORM, tRPC v11, Next.js 15

**Spec:** `docs/superpowers/specs/2026-03-15-phase3-feature-expansion.md` — Feature 4

**Key codebase facts:**
- Routers live in `apps/api/src/trpc/routers/`
- DB type is `DB` from `apps/api/src/db/index`
- `protectedProcedure` exists after Phase 3A adds it to `apps/api/src/trpc/init.ts`
- `traces` table is in the `otel` schema
- Context type is `{ db: DB, user: AuthUser, activeOrgId: string | null, sessionToken: string }`

**Prerequisites:** Phase 3C (Multi-tenancy) must be deployed — alert rules require `org_id`.

---

## File Map

| Action | File | Purpose |
|--------|------|---------|
| Create | `apps/api/src/db/migrations/0004_alerts.sql` | DB migration |
| Modify | `apps/api/src/db/schema.ts` | Add alertRules, alertFirings tables |
| Create | `apps/api/src/workers/notify.ts` | Notification channel handlers |
| Create | `apps/api/src/workers/notify.test.ts` | Unit tests |
| Create | `apps/api/src/workers/alert-eval.ts` | BullMQ worker + evaluators |
| Create | `apps/api/src/workers/alert-eval.test.ts` | Unit tests |
| Modify | `apps/api/src/index.ts` | Bootstrap worker on startup |
| Create | `apps/api/src/trpc/routers/alerts.ts` | tRPC CRUD |
| Create | `apps/api/src/trpc/routers/alerts.test.ts` | Unit tests |
| Modify | `apps/api/src/trpc/router.ts` | Mount alerts router |
| Create | `apps/web/app/settings/alerts/page.tsx` | Alert rules UI |
| Modify | `apps/web/components/nav/sidebar.tsx` | Add Alerts link |
| Modify | `.env.example` | Add TRACION_SMTP_* variables |

---

## Chunk 1: Database Layer

### Task 1: Create alerts migration

**Files:**
- Create: `apps/api/src/db/migrations/0004_alerts.sql`
- Modify: `apps/api/src/db/schema.ts`

- [ ] **Step 1: Read current schema**

```bash
cat apps/api/src/db/schema.ts
cat apps/api/src/db/migrations/meta/_journal.json
```

Confirm the last migration is `0003_organizations.sql` (from Phase 3C).

- [ ] **Step 2: Create the migration**

```sql
-- apps/api/src/db/migrations/0004_alerts.sql
-- Prerequisites: 0003_organizations.sql must have run

CREATE TABLE IF NOT EXISTS public.alert_rules (
  id           TEXT NOT NULL PRIMARY KEY,
  org_id       TEXT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  condition    JSONB NOT NULL,
  channel      JSONB NOT NULL,
  enabled      BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS alert_rules_org_enabled_idx
  ON public.alert_rules (org_id) WHERE enabled = true;

CREATE TABLE IF NOT EXISTS public.alert_firings (
  id           TEXT NOT NULL PRIMARY KEY,
  rule_id      TEXT NOT NULL REFERENCES public.alert_rules(id) ON DELETE CASCADE,
  fired_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at  TIMESTAMPTZ,
  payload      JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS alert_firings_rule_idx
  ON public.alert_firings (rule_id, fired_at DESC);
```

- [ ] **Step 3: Add to Drizzle schema**

```typescript
export const alertRules = pgTable('alert_rules', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull(),
  name: text('name').notNull(),
  condition: jsonb('condition').notNull(),
  channel: jsonb('channel').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const alertFirings = pgTable('alert_firings', {
  id: text('id').primaryKey(),
  ruleId: text('rule_id').notNull(),
  firedAt: timestamp('fired_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  payload: jsonb('payload').notNull(),
})
```

Import `jsonb` and `boolean` from drizzle-orm/pg-core if not already imported.

- [ ] **Step 4: Update .env.example with SMTP vars**

Add to `.env.example`:
```
# Alert notifications — email channel
TRACION_SMTP_HOST=smtp.example.com
TRACION_SMTP_PORT=587
TRACION_SMTP_USER=
TRACION_SMTP_PASSWORD=
TRACION_SMTP_FROM=alerts@tracion.dev
```

- [ ] **Step 5: Run migration**

```bash
cd apps/api && bun run db:migrate
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/db/migrations/0004_alerts.sql apps/api/src/db/schema.ts .env.example
git commit -m "feat(api): add alert_rules and alert_firings tables"
```

---

## Chunk 2: Notification Channel Handlers

### Task 2: Write and test notification handlers

**Files:**
- Create: `apps/api/src/workers/notify.ts`
- Create: `apps/api/src/workers/notify.test.ts`

- [ ] **Step 1: Check if nodemailer is already installed**

```bash
cat apps/api/package.json | grep nodemailer
```

If not installed:
```bash
cd apps/api && bun add nodemailer && bun add -d @types/nodemailer
```

- [ ] **Step 2: Write failing tests**

```typescript
// apps/api/src/workers/notify.test.ts
import { describe, it, expect, vi } from 'vitest'
import { sendNotification } from './notify'

describe('sendNotification', () => {
  it('calls fetch for webhook channel', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'))
    await sendNotification(
      { type: 'webhook', url: 'https://example.com/hook' },
      { ruleName: 'Test', message: 'Alert fired' }
    )
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://example.com/hook',
      expect.objectContaining({ method: 'POST' })
    )
    fetchSpy.mockRestore()
  })

  it('calls fetch for slack channel', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'))
    await sendNotification(
      { type: 'slack', webhook_url: 'https://hooks.slack.com/test' },
      { ruleName: 'Cost alert', message: 'Threshold exceeded' }
    )
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://hooks.slack.com/test',
      expect.objectContaining({ method: 'POST' })
    )
    fetchSpy.mockRestore()
  })

  it('does not throw for email when SMTP not configured', async () => {
    // TRACION_SMTP_HOST not set in test env
    await expect(
      sendNotification(
        { type: 'email', to: 'user@example.com' },
        { ruleName: 'Test', message: 'Alert' }
      )
    ).resolves.not.toThrow()
  })
})
```

- [ ] **Step 3: Run tests to confirm failure**

```bash
cd apps/api && bunx vitest run src/workers/notify.test.ts
```

- [ ] **Step 4: Write the notification handler**

```typescript
// apps/api/src/workers/notify.ts
import nodemailer from 'nodemailer'

export type NotifyChannel =
  | { type: 'email'; to: string }
  | { type: 'webhook'; url: string }
  | { type: 'slack'; webhook_url: string }

export type NotifyPayload = {
  ruleName: string
  message: string
  details?: Record<string, unknown>
}

export async function sendNotification(channel: NotifyChannel, payload: NotifyPayload): Promise<void> {
  switch (channel.type) {
    case 'email': {
      const host = process.env.TRACION_SMTP_HOST
      if (!host) {
        console.warn('[alerts] Email channel skipped: TRACION_SMTP_HOST not set')
        return
      }
      const transporter = nodemailer.createTransport({
        host,
        port: Number(process.env.TRACION_SMTP_PORT ?? 587),
        auth: {
          user: process.env.TRACION_SMTP_USER,
          pass: process.env.TRACION_SMTP_PASSWORD,
        },
      })
      await transporter.sendMail({
        from: process.env.TRACION_SMTP_FROM ?? 'alerts@tracion.dev',
        to: channel.to,
        subject: `[Tracion Alert] ${payload.ruleName}`,
        text: payload.message,
      })
      break
    }

    case 'webhook': {
      await fetch(channel.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, source: 'tracion-alerts' }),
      })
      break
    }

    case 'slack': {
      await fetch(channel.webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `🚨 *${payload.ruleName}*\n${payload.message}`,
          blocks: [
            { type: 'section', text: { type: 'mrkdwn', text: `🚨 *${payload.ruleName}*\n${payload.message}` } },
          ],
        }),
      })
      break
    }
  }
}
```

- [ ] **Step 5: Run tests**

```bash
cd apps/api && bunx vitest run src/workers/notify.test.ts
```

Expected: All 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/workers/notify.ts apps/api/src/workers/notify.test.ts
git commit -m "feat(api): add notification channel handlers (email, webhook, slack)"
```

---

## Chunk 3: Alert Evaluator Worker

### Task 3: Write the BullMQ alert evaluation worker

**Files:**
- Read: `apps/api/package.json` (check if BullMQ is installed)
- Create: `apps/api/src/workers/alert-eval.ts`
- Create: `apps/api/src/workers/alert-eval.test.ts`

- [ ] **Step 1: Check BullMQ is installed**

```bash
cat apps/api/package.json | grep bullmq
```

If not installed:
```bash
cd apps/api && bun add bullmq
```

- [ ] **Step 2: Write failing tests**

```typescript
// apps/api/src/workers/alert-eval.test.ts
import { describe, it, expect, vi } from 'vitest'
import { evaluateCostPerTrace, evaluateErrorRate, evaluateDailyCost } from './alert-eval'

const mockDb = { execute: vi.fn() } as any

describe('evaluateCostPerTrace', () => {
  it('returns traces that exceed threshold', async () => {
    mockDb.execute = vi.fn().mockResolvedValue([
      { id: 'trace1', name: 'expensive', total_cost_usd: '2.50' },
    ])
    const result = await evaluateCostPerTrace(mockDb, 'org1', 1.00)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('trace1')
  })

  it('returns empty array when no traces exceed threshold', async () => {
    mockDb.execute = vi.fn().mockResolvedValue([])
    const result = await evaluateCostPerTrace(mockDb, 'org1', 1.00)
    expect(result).toHaveLength(0)
  })
})

describe('evaluateErrorRate', () => {
  it('returns true when error rate exceeds threshold', async () => {
    mockDb.execute = vi.fn().mockResolvedValue([{ error_rate: 0.15 }])
    const exceeded = await evaluateErrorRate(mockDb, 'org1', 10, 60)
    expect(exceeded).toBe(true)
  })

  it('returns false when error rate is below threshold', async () => {
    mockDb.execute = vi.fn().mockResolvedValue([{ error_rate: 0.05 }])
    const exceeded = await evaluateErrorRate(mockDb, 'org1', 10, 60)
    expect(exceeded).toBe(false)
  })
})

describe('evaluateDailyCost', () => {
  it('returns true when daily cost exceeds threshold', async () => {
    mockDb.execute = vi.fn().mockResolvedValue([{ daily_cost: '15.00' }])
    const exceeded = await evaluateDailyCost(mockDb, 'org1', 10.00)
    expect(exceeded).toBe(true)
  })

  it('returns false when daily cost is below threshold', async () => {
    mockDb.execute = vi.fn().mockResolvedValue([{ daily_cost: '5.00' }])
    const exceeded = await evaluateDailyCost(mockDb, 'org1', 10.00)
    expect(exceeded).toBe(false)
  })
})
```

- [ ] **Step 3: Run tests to confirm failure**

```bash
cd apps/api && bunx vitest run src/workers/alert-eval.test.ts
```

- [ ] **Step 4: Write the evaluator**

```typescript
// apps/api/src/workers/alert-eval.ts
import { Queue, Worker } from 'bullmq'
import { sql, eq, and, isNull, desc } from 'drizzle-orm'
import { alertRules, alertFirings } from '../db/schema'
import { sendNotification } from './notify'
import type { DB } from '../db/index'

// --- Pure evaluator functions (testable without BullMQ) ---

export async function evaluateCostPerTrace(
  db: DB,
  orgId: string,
  thresholdUsd: number
): Promise<Array<{ id: string; name: string; total_cost_usd: string }>> {
  const rows = await db.execute(sql`
    SELECT id, name, total_cost_usd::text
    FROM otel.traces
    WHERE org_id = ${orgId}
      AND created_at > now() - interval '5 minutes'
      AND total_cost_usd > ${thresholdUsd}
  `)
  return rows as any[]
}

export async function evaluateErrorRate(
  db: DB,
  orgId: string,
  thresholdPct: number,
  windowMinutes: number
): Promise<boolean> {
  // Validate windowMinutes is a positive integer to prevent injection
  const safeWindow = Math.max(1, Math.floor(Number(windowMinutes) || 60))

  const [row] = await db.execute(sql`
    SELECT
      COALESCE(
        COUNT(*) FILTER (WHERE status = 'error')::float / NULLIF(COUNT(*), 0),
        0
      ) AS error_rate
    FROM otel.traces
    WHERE org_id = ${orgId}
      AND created_at > now() - make_interval(mins => ${safeWindow})
  `) as any[]

  const rate = Number(row?.error_rate ?? 0)
  return rate * 100 >= thresholdPct
}

export async function evaluateDailyCost(
  db: DB,
  orgId: string,
  thresholdUsd: number
): Promise<boolean> {
  const [row] = await db.execute(sql`
    SELECT COALESCE(SUM(total_cost_usd), 0) AS daily_cost
    FROM otel.traces
    WHERE org_id = ${orgId}
      AND created_at >= date_trunc('day', now())
  `) as any[]
  const cost = Number(row?.daily_cost ?? 0)
  return cost >= thresholdUsd
}

// --- BullMQ worker bootstrap ---

export function startAlertWorker(db: DB, redisUrl: string) {
  const connection = { url: redisUrl }

  const queue = new Queue('tracion:alert-eval', { connection })

  // Add repeatable job (every 60 seconds)
  queue.add('evaluate', {}, {
    repeat: { every: 60_000 },
    removeOnComplete: 10,
    removeOnFail: 20,
  })

  const worker = new Worker('tracion:alert-eval', async () => {
    const rules = await db
      .select()
      .from(alertRules)
      .where(eq(alertRules.enabled, true))

    for (const rule of rules) {
      try {
        // Cooldown: skip if there is an unresolved firing in the last 5 minutes
        const recentFirings = await db
          .select({ id: alertFirings.id })
          .from(alertFirings)
          .where(and(
            eq(alertFirings.ruleId, rule.id),
            isNull(alertFirings.resolvedAt),
            sql`${alertFirings.firedAt} > now() - interval '5 minutes'`
          ))
          .limit(1)

        if (recentFirings.length > 0) continue  // still in cooldown

        const condition = rule.condition as any
        const channel = rule.channel as any
        let fired = false
        let payload: Record<string, unknown> = {}

        if (condition.type === 'cost_per_trace') {
          const matches = await evaluateCostPerTrace(db, rule.orgId, Number(condition.threshold_usd))
          if (matches.length > 0) {
            fired = true
            payload = { matches, threshold: condition.threshold_usd }
          }
        } else if (condition.type === 'error_rate') {
          const exceeded = await evaluateErrorRate(
            db, rule.orgId, Number(condition.threshold_pct), Number(condition.window_minutes ?? 60)
          )
          if (exceeded) {
            fired = true
            payload = { threshold_pct: condition.threshold_pct }
          }
        } else if (condition.type === 'daily_cost') {
          const exceeded = await evaluateDailyCost(db, rule.orgId, Number(condition.threshold_usd))
          if (exceeded) {
            fired = true
            payload = { threshold_usd: condition.threshold_usd }
          }
        }

        if (fired) {
          const firingId = crypto.randomUUID()
          await db.insert(alertFirings).values({ id: firingId, ruleId: rule.id, payload })

          await sendNotification(channel, {
            ruleName: rule.name,
            message: `Alert "${rule.name}" fired. ${JSON.stringify(payload)}`,
            details: payload,
          })
        }
      } catch (err) {
        console.error(`[alerts] Error evaluating rule ${rule.id}:`, err)
      }
    }
  }, { connection, concurrency: 1 })

  worker.on('failed', (job, err) => {
    console.error('[alerts] Worker job failed:', err)
  })

  return { queue, worker }
}
```

- [ ] **Step 5: Run tests**

```bash
cd apps/api && bunx vitest run src/workers/alert-eval.test.ts
```

Expected: All 6 tests pass.

- [ ] **Step 6: Bootstrap worker in index.ts**

Read `apps/api/src/index.ts`. After the server starts, add:

```typescript
import { startAlertWorker } from './workers/alert-eval'

// Start alert evaluation worker
const redisUrl = process.env.TRACION_REDIS_URL ?? 'redis://localhost:6379'
startAlertWorker(db, redisUrl)
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/workers/alert-eval.ts apps/api/src/workers/alert-eval.test.ts apps/api/src/index.ts apps/api/package.json
git commit -m "feat(api): add BullMQ alert evaluation worker with cooldown deduplication"
```

---

## Chunk 4: Alerts tRPC Router

### Task 4: Create alerts CRUD router

**Files:**
- Create: `apps/api/src/trpc/routers/alerts.ts`
- Create: `apps/api/src/trpc/routers/alerts.test.ts`
- Modify: `apps/api/src/trpc/router.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// apps/api/src/trpc/routers/alerts.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createCallerFactory } from '@trpc/server'
import { alertsRouter } from './alerts'
import type { DB } from '../../db/index'
import type { auth } from '../../auth/index'

type AuthUser = typeof auth.$Infer.Session.user

const mockDb = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
} as unknown as DB

const mockUser = { id: 'user1' } as unknown as AuthUser
const createCaller = createCallerFactory(alertsRouter)
const caller = createCaller({ db: mockDb, user: mockUser, activeOrgId: 'org1', sessionToken: '' })

beforeEach(() => vi.clearAllMocks())

describe('alerts.list', () => {
  it('returns rules for active org', async () => {
    mockDb.select = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          { id: 'r1', name: 'Cost alert', condition: {}, channel: {}, enabled: true, createdAt: new Date() },
        ]),
      }),
    })
    const result = await caller.list()
    expect(result).toHaveLength(1)
  })
})

describe('alerts.create', () => {
  it('inserts a new rule', async () => {
    mockDb.insert = vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 'r2' }]),
      }),
    })
    const result = await caller.create({
      name: 'Test rule',
      condition: { type: 'cost_per_trace', threshold_usd: 1.0 },
      channel: { type: 'webhook', url: 'https://example.com' },
    })
    expect(result.id).toBe('r2')
  })
})
```

- [ ] **Step 2: Write the router**

```typescript
// apps/api/src/trpc/routers/alerts.ts
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { TRPCError } from '@trpc/server'
import { router, protectedProcedure } from '../init'
import { alertRules, alertFirings } from '../../db/schema'

const conditionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('cost_per_trace'), threshold_usd: z.number().positive() }),
  z.object({ type: z.literal('error_rate'), threshold_pct: z.number().min(0).max(100), window_minutes: z.number().int().min(1).default(60) }),
  z.object({ type: z.literal('daily_cost'), threshold_usd: z.number().positive() }),
])

const channelSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('email'), to: z.string().email() }),
  z.object({ type: z.literal('webhook'), url: z.string().url() }),
  z.object({ type: z.literal('slack'), webhook_url: z.string().url() }),
])

export const alertsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.activeOrgId) throw new TRPCError({ code: 'FORBIDDEN', message: 'No active organization' })
    return ctx.db.select().from(alertRules).where(eq(alertRules.orgId, ctx.activeOrgId))
  }),

  create: protectedProcedure
    .input(z.object({ name: z.string().min(1), condition: conditionSchema, channel: channelSchema }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.activeOrgId) throw new TRPCError({ code: 'FORBIDDEN', message: 'No active organization' })
      const id = crypto.randomUUID()
      const [created] = await ctx.db
        .insert(alertRules)
        .values({ id, orgId: ctx.activeOrgId, name: input.name, condition: input.condition, channel: input.channel })
        .returning({ id: alertRules.id })
      return created
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.activeOrgId) throw new TRPCError({ code: 'FORBIDDEN', message: 'No active organization' })
      await ctx.db.delete(alertRules).where(and(eq(alertRules.id, input.id), eq(alertRules.orgId, ctx.activeOrgId)))
    }),

  firings: protectedProcedure
    .input(z.object({ ruleId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select()
        .from(alertFirings)
        .where(eq(alertFirings.ruleId, input.ruleId))
        .orderBy(desc(alertFirings.firedAt))
        .limit(20)
    }),
})
```

- [ ] **Step 3: Mount in router.ts, run tests**

```bash
cd apps/api && bunx vitest run src/trpc/routers/alerts.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/trpc/routers/alerts.ts apps/api/src/trpc/routers/alerts.test.ts apps/api/src/trpc/router.ts
git commit -m "feat(api): add alerts tRPC router with CRUD and firing history"
```

---

## Chunk 5: Frontend Alerts Page

### Task 5: Create /settings/alerts page

**Files:**
- Read: `apps/web/components/nav/sidebar.tsx`
- Create: `apps/web/app/settings/alerts/page.tsx`
- Modify: `apps/web/components/nav/sidebar.tsx`

- [ ] **Step 1: Read sidebar**

```bash
cat apps/web/components/nav/sidebar.tsx
```

- [ ] **Step 2: Create the alerts settings page**

```typescript
// apps/web/app/settings/alerts/page.tsx
'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc'

type ConditionType = 'cost_per_trace' | 'error_rate' | 'daily_cost'
type ChannelType = 'email' | 'webhook' | 'slack'

export default function AlertsPage() {
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({
    name: '',
    conditionType: 'cost_per_trace' as ConditionType,
    thresholdUsd: '',
    thresholdPct: '',
    windowMinutes: '60',
    channelType: 'webhook' as ChannelType,
    channelValue: '',
  })

  const { data: rules = [], refetch } = trpc.alerts.list.useQuery()
  const createRule = trpc.alerts.create.useMutation({ onSuccess: () => { refetch(); setShowCreate(false) } })
  const deleteRule = trpc.alerts.delete.useMutation({ onSuccess: () => refetch() })

  const handleCreate = () => {
    const condition = form.conditionType === 'cost_per_trace'
      ? { type: 'cost_per_trace' as const, threshold_usd: Number(form.thresholdUsd) }
      : form.conditionType === 'error_rate'
      ? { type: 'error_rate' as const, threshold_pct: Number(form.thresholdPct), window_minutes: Number(form.windowMinutes) }
      : { type: 'daily_cost' as const, threshold_usd: Number(form.thresholdUsd) }

    const channel = form.channelType === 'email'
      ? { type: 'email' as const, to: form.channelValue }
      : form.channelType === 'slack'
      ? { type: 'slack' as const, webhook_url: form.channelValue }
      : { type: 'webhook' as const, url: form.channelValue }

    createRule.mutate({ name: form.name, condition, channel })
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Alert Rules</h1>
        <button onClick={() => setShowCreate(true)} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium">
          Create Alert
        </button>
      </div>

      {showCreate && (
        <div className="mb-6 p-4 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 space-y-3">
          <h2 className="text-sm font-semibold">New Alert Rule</h2>
          <input placeholder="Rule name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            className="w-full border rounded px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600" />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Condition</label>
              <select value={form.conditionType} onChange={e => setForm(f => ({ ...f, conditionType: e.target.value as ConditionType }))}
                className="w-full border rounded px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600">
                <option value="cost_per_trace">Cost per trace &gt; $X</option>
                <option value="error_rate">Error rate &gt; X%</option>
                <option value="daily_cost">Daily cost &gt; $X</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">
                {form.conditionType === 'error_rate' ? 'Threshold (%)' : 'Threshold ($)'}
              </label>
              <input type="number"
                value={form.conditionType === 'error_rate' ? form.thresholdPct : form.thresholdUsd}
                onChange={e => setForm(f => form.conditionType === 'error_rate'
                  ? { ...f, thresholdPct: e.target.value }
                  : { ...f, thresholdUsd: e.target.value }
                )}
                className="w-full border rounded px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Channel</label>
              <select value={form.channelType} onChange={e => setForm(f => ({ ...f, channelType: e.target.value as ChannelType }))}
                className="w-full border rounded px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600">
                <option value="webhook">Webhook</option>
                <option value="slack">Slack</option>
                <option value="email">Email</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">
                {form.channelType === 'email' ? 'Email address' : 'Webhook URL'}
              </label>
              <input value={form.channelValue} onChange={e => setForm(f => ({ ...f, channelValue: e.target.value }))}
                placeholder={form.channelType === 'email' ? 'you@example.com' : 'https://...'}
                className="w-full border rounded px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleCreate} disabled={!form.name || !form.channelValue || createRule.isPending}
              className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50">
              {createRule.isPending ? 'Creating…' : 'Create'}
            </button>
            <button onClick={() => setShowCreate(false)} className="px-3 py-2 text-gray-500 text-sm">Cancel</button>
          </div>
        </div>
      )}

      {rules.length === 0 ? (
        <div className="text-center py-12 text-gray-500 text-sm">No alert rules yet.</div>
      ) : (
        <div className="space-y-3">
          {rules.map((rule) => (
            <div key={rule.id} className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 flex items-start justify-between">
              <div>
                <div className="font-medium text-sm">{rule.name}</div>
                <div className="text-xs text-gray-500 mt-1">
                  {(rule.condition as any).type} → {(rule.channel as any).type}
                </div>
              </div>
              <button onClick={() => deleteRule.mutate({ id: rule.id })} className="text-xs text-red-500 hover:text-red-700">Delete</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Add Alerts link to sidebar**

In `apps/web/components/nav/sidebar.tsx`, add a link to `/settings/alerts` in the Settings section (alongside API Keys from Phase 3A).

- [ ] **Step 4: TypeScript check**

```bash
cd apps/web && bun run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/settings/alerts/page.tsx apps/web/components/nav/sidebar.tsx
git commit -m "feat(web): add alert rules management UI at /settings/alerts"
```
