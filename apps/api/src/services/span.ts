import { eq } from 'drizzle-orm'
import type { DB } from '../db/index'
import { spans } from '../db/schema'
import type { NewSpan } from '../db/schema'
import { ok, err, type Result, type TraceError, type Span } from '../types'

export async function createSpans(
  db: DB,
  input: NewSpan[]
): Promise<Result<void, TraceError>> {
  if (input.length === 0) return ok(undefined)
  try {
    await db.insert(spans).values(input)
    return ok(undefined)
  } catch (cause) {
    return err({ code: 'DB_ERROR', cause })
  }
}

export async function getSpan(
  db: DB,
  spanId: string
): Promise<Result<Span, TraceError>> {
  try {
    const [row] = await db.select().from(spans).where(eq(spans.id, spanId)).limit(1)
    // Reuse TraceError.NOT_FOUND — traceId field holds the lookup id (span id in this case)
    if (!row) return err({ code: 'NOT_FOUND', traceId: spanId })
    return ok(row as Span)
  } catch (cause) {
    return err({ code: 'DB_ERROR', cause })
  }
}

export async function listSpansByTrace(
  db: DB,
  traceId: string
): Promise<Result<Span[], TraceError>> {
  try {
    const rows = await db
      .select()
      .from(spans)
      .where(eq(spans.traceId, traceId))
      .orderBy(spans.startTime)
    return ok(rows as Span[])
  } catch (cause) {
    return err({ code: 'DB_ERROR', cause })
  }
}
