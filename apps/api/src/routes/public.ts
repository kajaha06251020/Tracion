import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db } from '../db/index'
import { traces, spans } from '../db/schema'
import { apiErr } from '../types'

export const publicRoute = new Hono()

publicRoute.get('/api/public/traces/:token', async (c) => {
  const token = c.req.param('token')

  const [trace] = await db
    .select({
      id: traces.id,
      name: traces.name,
      agentId: traces.agentId,
      status: traces.status,
      startTime: traces.startTime,
      endTime: traces.endTime,
      totalTokens: traces.totalTokens,
      totalCostUsd: traces.totalCostUsd,
    })
    .from(traces)
    .where(eq(traces.shareToken, token))
    .limit(1)

  if (!trace) {
    return c.json(apiErr('NOT_FOUND', 'Trace not found or no longer shared'), 404)
  }

  const traceSpans = await db
    .select({
      id: spans.id,
      traceId: spans.traceId,
      parentSpanId: spans.parentSpanId,
      kind: spans.kind,
      name: spans.name,
      model: spans.model,
      inputTokens: spans.inputTokens,
      outputTokens: spans.outputTokens,
      costUsd: spans.costUsd,
      startTime: spans.startTime,
      endTime: spans.endTime,
      status: spans.status,
      attributes: spans.attributes,
      events: spans.events,
    })
    .from(spans)
    .where(eq(spans.traceId, trace.id))

  return c.json({ success: true, data: { trace, spans: traceSpans } }, 200)
})
