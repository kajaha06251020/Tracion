import { eq, and, desc, sql } from 'drizzle-orm'
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
