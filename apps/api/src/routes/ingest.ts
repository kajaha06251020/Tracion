import { Hono } from 'hono'
import { apiKeyMiddleware } from '../middleware/auth'
import { parseOtlpPayload } from '../otel/parser'
import { createTrace } from '../services/trace'
import { createSpans } from '../services/span'
import { db } from '../db/index'
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

  logger.info({ traceId: traceResult.data.id }, 'trace ingested')
  // Flat response per spec: { success: true, traceId: "..." } (NOT wrapped in data)
  return c.json({ success: true, traceId: traceResult.data.id }, 201)
})
