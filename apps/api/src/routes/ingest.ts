import { Hono } from 'hono'
import { and, eq, isNull } from 'drizzle-orm'
import { apiKeyMiddleware } from '../middleware/auth'
import { parseOtlpPayload } from '../otel/parser'
import { createTrace } from '../services/trace'
import { createSpans } from '../services/span'
import { postGithubPrComment } from '../services/github-notify'
import { postSlackTraceNotification } from '../services/slack-notify'
import { db } from '../db/index'
import { traces } from '../db/schema'
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

  const trace = traceResult.data

  // GitHub PR auto-comment: atomic guard prevents duplicate comments
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
        isNull(traces.githubCommentPostedAt)
      ))
      .returning({ id: traces.id })

    if (claimed.length > 0) {
      postGithubPrComment(trace).catch((err) =>
        logger.warn({ err, traceId: trace.id }, 'github pr comment failed')
      )
    }
  }

  // Slack notification: atomic guard prevents duplicate notifications
  if (
    trace.status !== 'running' &&
    process.env.SLACK_WEBHOOK_URL
  ) {
    const claimed = await db
      .update(traces)
      .set({ slackNotifiedAt: new Date() })
      .where(and(
        eq(traces.id, trace.id),
        isNull(traces.slackNotifiedAt)
      ))
      .returning({ id: traces.id })

    if (claimed.length > 0) {
      postSlackTraceNotification(trace).catch((err) =>
        logger.warn({ err, traceId: trace.id }, 'slack notification failed')
      )
    }
  }

  logger.info({ traceId: trace.id }, 'trace ingested')
  return c.json({ success: true, traceId: trace.id }, 201)
})
