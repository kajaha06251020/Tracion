import { eq, and, desc, gte, sql } from 'drizzle-orm'
import type { DB } from '../db/index'
import { traces, spans } from '../db/schema'
import type { NewTrace } from '../db/schema'
import { ok, err, type Result, type TraceError, type Trace, type Span } from '../types'

export type TraceStats = {
  total: number
  running: number
  success: number
  error: number
  totalCostUsd: string
  avgDurationMs: number
}

type ListTracesInput = {
  cursor?: string | undefined
  limit?: number | undefined
  agentId?: string | undefined
  status?: 'running' | 'success' | 'error' | undefined
  search?: string | undefined
  since?: string | undefined
}

type Cursor = { startTime: string; id: string }

function encodeCursor(trace: { startTime: Date; id: string }): string {
  const payload: Cursor = { startTime: trace.startTime.toISOString(), id: trace.id }
  return btoa(JSON.stringify(payload))
}

function decodeCursor(cursor: string): Cursor | null {
  try {
    return JSON.parse(atob(cursor)) as Cursor
  } catch {
    return null
  }
}

export async function createTrace(
  db: DB,
  input: NewTrace
): Promise<Result<{ id: string }, TraceError>> {
  try {
    const [row] = await db.insert(traces).values(input).returning({ id: traces.id })
    if (!row) return err({ code: 'DB_ERROR', cause: 'no row returned' })
    return ok({ id: row.id })
  } catch (cause) {
    return err({ code: 'DB_ERROR', cause })
  }
}

export async function getTrace(
  db: DB,
  traceId: string
): Promise<Result<Trace & { spans: Span[] }, TraceError>> {
  try {
    const [row] = await db.select().from(traces).where(eq(traces.id, traceId)).limit(1)
    if (!row) return err({ code: 'NOT_FOUND', traceId })

    const spanRows = await db
      .select()
      .from(spans)
      .where(eq(spans.traceId, traceId))
      .orderBy(spans.startTime)

    const trace: Trace & { spans: Span[] } = {
      ...row,
      spans: spanRows as Span[],
    } as Trace & { spans: Span[] }

    return ok(trace)
  } catch (cause) {
    return err({ code: 'DB_ERROR', cause })
  }
}

export async function listTraces(
  db: DB,
  input: ListTracesInput
): Promise<Result<{ items: Trace[]; nextCursor: string | null }, TraceError>> {
  try {
    const limit = Math.min(input.limit ?? 20, 100)
    const cursor = input.cursor ? decodeCursor(input.cursor) : null

    const conditions = []

    if (cursor) {
      const cursorTime = new Date(cursor.startTime)
      conditions.push(
        sql`(${traces.startTime}, ${traces.id}) < (${cursorTime}, ${cursor.id})`
      )
    }
    if (input.agentId) conditions.push(eq(traces.agentId, input.agentId))
    if (input.status) conditions.push(eq(traces.status, input.status))
    if (input.search) {
      conditions.push(sql`${traces.name} ILIKE ${'%' + input.search + '%'}`)
    }
    if (input.since) {
      conditions.push(sql`${traces.startTime} >= ${new Date(input.since)}`)
    }

    const rows = await db
      .select()
      .from(traces)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(traces.startTime), desc(traces.id))
      .limit(limit + 1)

    const hasMore = rows.length > limit
    const items = hasMore ? rows.slice(0, limit) : rows
    const lastItem = items.at(-1)
    const nextCursor = hasMore && lastItem ? encodeCursor(lastItem) : null

    return ok({ items: items as Trace[], nextCursor })
  } catch (cause) {
    return err({ code: 'DB_ERROR', cause })
  }
}

export async function deleteTrace(
  db: DB,
  traceId: string
): Promise<Result<void, TraceError>> {
  try {
    const result = await db.delete(traces).where(eq(traces.id, traceId)).returning({ id: traces.id })
    if (result.length === 0) return err({ code: 'NOT_FOUND', traceId })
    return ok(undefined)
  } catch (cause) {
    return err({ code: 'DB_ERROR', cause })
  }
}

export async function searchTraces(
  db: DB,
  query: string,
  limit = 20,
  since?: string,
  until?: string,
): Promise<Result<Trace[], TraceError>> {
  try {
    const conditions = [sql`${traces.name} ILIKE ${'%' + query + '%'}`]
    if (since) conditions.push(sql`${traces.startTime} >= ${new Date(since)}`)
    if (until) conditions.push(sql`${traces.startTime} <= ${new Date(until)}`)

    const rows = await db
      .select()
      .from(traces)
      .where(and(...conditions))
      .orderBy(desc(traces.startTime))
      .limit(Math.min(limit, 100))
    return ok(rows as Trace[])
  } catch (cause) {
    return err({ code: 'DB_ERROR', cause })
  }
}

export async function getTraceStats(db: DB): Promise<Result<TraceStats, TraceError>> {
  try {
    const rows = await db
      .select({
        status: traces.status,
        count: sql<number>`count(*)::int`,
        totalCost: sql<string>`coalesce(sum(${traces.totalCostUsd}), 0)::text`,
        avgDurationMs: sql<number>`coalesce(avg(extract(epoch from (${traces.endTime} - ${traces.startTime})) * 1000) filter (where ${traces.endTime} is not null), 0)::float`,
      })
      .from(traces)
      .groupBy(traces.status)

    const stats: TraceStats = {
      total: 0,
      running: 0,
      success: 0,
      error: 0,
      totalCostUsd: '0',
      avgDurationMs: 0,
    }

    let totalCost = 0
    let weightedDuration = 0
    let durationCount = 0

    for (const row of rows) {
      stats.total += row.count
      stats[row.status] = row.count
      totalCost += parseFloat(row.totalCost)
      if (row.status !== 'running') {
        weightedDuration += row.avgDurationMs * row.count
        durationCount += row.count
      }
    }

    stats.totalCostUsd = totalCost.toFixed(6)
    stats.avgDurationMs = durationCount > 0 ? Math.round(weightedDuration / durationCount) : 0

    return ok(stats)
  } catch (cause) {
    return err({ code: 'DB_ERROR', cause })
  }
}

// ── Analytics ─────────────────────────────────────────────────────────────────

export type CostByAgent = {
  agentId: string
  traceCount: number
  totalCostUsd: string
  totalTokens: number
}

export type CostByDay = {
  date: string        // ISO date string e.g. "2026-03-15"
  totalCostUsd: string
  traceCount: number
}

export type AnalyticsData = {
  byAgent: CostByAgent[]
  byDay: CostByDay[]
}

export async function getAnalytics(db: DB, days = 30): Promise<Result<AnalyticsData, TraceError>> {
  try {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

    const [byAgentRows, byDayRows] = await Promise.all([
      db
        .select({
          agentId: traces.agentId,
          traceCount: sql<number>`count(*)::int`,
          totalCostUsd: sql<string>`coalesce(sum(${traces.totalCostUsd}), 0)::text`,
          totalTokens: sql<number>`coalesce(sum(${traces.totalTokens}), 0)::int`,
        })
        .from(traces)
        .where(gte(traces.startTime, since))
        .groupBy(traces.agentId)
        .orderBy(sql`sum(${traces.totalCostUsd}) desc`)
        .limit(20),

      db
        .select({
          date: sql<string>`date_trunc('day', ${traces.startTime})::date::text`,
          totalCostUsd: sql<string>`coalesce(sum(${traces.totalCostUsd}), 0)::text`,
          traceCount: sql<number>`count(*)::int`,
        })
        .from(traces)
        .where(gte(traces.startTime, since))
        .groupBy(sql`date_trunc('day', ${traces.startTime})`)
        .orderBy(sql`date_trunc('day', ${traces.startTime}) asc`),
    ])

    return ok({
      byAgent: byAgentRows,
      byDay: byDayRows,
    })
  } catch (cause) {
    return err({ code: 'DB_ERROR', cause })
  }
}
// ── Team Stats ────────────────────────────────────────────────────────────────

export type AgentStats = {
  agentId: string
  traceCount: number
  successCount: number
  errorCount: number
  totalCostUsd: string
  totalTokens: number
  avgDurationMs: number
  lastActiveAt: string | null
}

export type TeamStatsData = {
  agents: AgentStats[]
  dailyCost: CostByDay[]
}

export async function getTeamStats(db: DB, days = 30): Promise<Result<TeamStatsData, TraceError>> {
  try {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

    const [agentRows, dailyRows] = await Promise.all([
      db
        .select({
          agentId: traces.agentId,
          traceCount: sql<number>`count(*)::int`,
          successCount: sql<number>`count(*) filter (where ${traces.status} = 'success')::int`,
          errorCount: sql<number>`count(*) filter (where ${traces.status} = 'error')::int`,
          totalCostUsd: sql<string>`coalesce(sum(${traces.totalCostUsd}), 0)::text`,
          totalTokens: sql<number>`coalesce(sum(${traces.totalTokens}), 0)::int`,
          avgDurationMs: sql<number>`coalesce(avg(extract(epoch from (${traces.endTime} - ${traces.startTime})) * 1000) filter (where ${traces.endTime} is not null), 0)::float`,
          lastActiveAt: sql<string | null>`max(${traces.startTime})::text`,
        })
        .from(traces)
        .where(gte(traces.startTime, since))
        .groupBy(traces.agentId)
        .orderBy(sql`sum(${traces.totalCostUsd}) desc`),

      db
        .select({
          date: sql<string>`date_trunc('day', ${traces.startTime})::date::text`,
          totalCostUsd: sql<string>`coalesce(sum(${traces.totalCostUsd}), 0)::text`,
          traceCount: sql<number>`count(*)::int`,
        })
        .from(traces)
        .where(gte(traces.startTime, since))
        .groupBy(sql`date_trunc('day', ${traces.startTime})`)
        .orderBy(sql`date_trunc('day', ${traces.startTime}) asc`),
    ])

    return ok({ agents: agentRows, dailyCost: dailyRows })
  } catch (cause) {
    return err({ code: 'DB_ERROR', cause })
  }
}

// ── PR Costs ──────────────────────────────────────────────────────────────────

export type PrCostEntry = {
  prNumber: string
  prUrl: string
  repository: string
  traceCount: number
  totalCostUsd: string
  totalTokens: number
  agents: string[]
  lastTraceAt: string | null
}

export async function getPrCosts(db: DB, days = 30): Promise<Result<PrCostEntry[], TraceError>> {
  try {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

    // Filter traces that have GitHub PR metadata
    const rows = await db
      .select({
        metadata: traces.metadata,
        totalCostUsd: traces.totalCostUsd,
        totalTokens: traces.totalTokens,
        agentId: traces.agentId,
        startTime: traces.startTime,
      })
      .from(traces)
      .where(and(
        gte(traces.startTime, since),
        sql`${traces.metadata}->>'githubPrNumber' IS NOT NULL`,
      ))
      .orderBy(desc(traces.startTime))

    // Group by PR number + repository in JS (jsonb grouping in SQL is cumbersome)
    const prMap = new Map<string, {
      prNumber: string
      prUrl: string
      repository: string
      traceCount: number
      totalCostUsd: number
      totalTokens: number
      agents: Set<string>
      lastTraceAt: Date | null
    }>()

    for (const row of rows) {
      const meta = row.metadata as Record<string, unknown>
      const prNumber = meta.githubPrNumber as string
      const prUrl = meta.githubPrUrl as string
      const repository = (meta.githubRepository as string) ?? ''
      const key = `${repository}#${prNumber}`

      let entry = prMap.get(key)
      if (!entry) {
        entry = {
          prNumber,
          prUrl,
          repository,
          traceCount: 0,
          totalCostUsd: 0,
          totalTokens: 0,
          agents: new Set(),
          lastTraceAt: null,
        }
        prMap.set(key, entry)
      }

      entry.traceCount++
      entry.totalCostUsd += parseFloat(row.totalCostUsd)
      entry.totalTokens += row.totalTokens
      entry.agents.add(row.agentId)
      if (!entry.lastTraceAt || row.startTime > entry.lastTraceAt) {
        entry.lastTraceAt = row.startTime
      }
    }

    const result: PrCostEntry[] = [...prMap.values()]
      .map((e) => ({
        prNumber: e.prNumber,
        prUrl: e.prUrl,
        repository: e.repository,
        traceCount: e.traceCount,
        totalCostUsd: e.totalCostUsd.toFixed(6),
        totalTokens: e.totalTokens,
        agents: [...e.agents],
        lastTraceAt: e.lastTraceAt?.toISOString() ?? null,
      }))
      .sort((a, b) => parseFloat(b.totalCostUsd) - parseFloat(a.totalCostUsd))

    return ok(result)
  } catch (cause) {
    return err({ code: 'DB_ERROR', cause })
  }
}
