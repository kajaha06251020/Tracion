import {
  pgSchema,
  text,
  integer,
  numeric,
  timestamp,
  jsonb,
  pgEnum,
} from 'drizzle-orm/pg-core'
import type { Json } from '../types'

export const otelSchema = pgSchema('otel')

// NOTE: enums are scoped to the otel schema (not public) via otelSchema.enum
// This differs from top-level pgEnum() — otelSchema.enum is the correct pattern here
export const statusEnum = otelSchema.enum('status', ['running', 'success', 'error'])
export const spanKindEnum = otelSchema.enum('span_kind', ['llm', 'tool', 'agent', 'retrieval', 'custom'])

export const traces = otelSchema.table('traces', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  agentId: text('agent_id').notNull(),
  name: text('name').notNull(),
  input: jsonb('input'),
  output: jsonb('output'),
  startTime: timestamp('start_time', { withTimezone: true }).notNull(),
  endTime: timestamp('end_time', { withTimezone: true }),
  totalTokens: integer('total_tokens').default(0).notNull(),
  totalCostUsd: numeric('total_cost_usd', { precision: 10, scale: 6 }).default('0').notNull(),
  status: statusEnum('status').default('running').notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
  shareToken: text('share_token').unique(),
  githubCommentPostedAt: timestamp('github_comment_posted_at', { withTimezone: true }),
  slackNotifiedAt: timestamp('slack_notified_at', { withTimezone: true }),
})

export const spans = otelSchema.table('spans', {
  id: text('id').primaryKey(),
  traceId: text('trace_id')
    .notNull()
    .references(() => traces.id, { onDelete: 'cascade' }),
  parentSpanId: text('parent_span_id'),
  kind: spanKindEnum('kind').default('custom').notNull(),
  name: text('name').notNull(),
  model: text('model'),
  inputTokens: integer('input_tokens').default(0).notNull(),
  outputTokens: integer('output_tokens').default(0).notNull(),
  costUsd: numeric('cost_usd', { precision: 10, scale: 6 }).default('0').notNull(),
  startTime: timestamp('start_time', { withTimezone: true }).notNull(),
  endTime: timestamp('end_time', { withTimezone: true }),
  status: statusEnum('status').default('running').notNull(),
  attributes: jsonb('attributes').$type<Record<string, unknown>>().default({}).notNull(),
  events: jsonb('events').$type<Json[]>().default([]).notNull(),
})

export type DbTrace = typeof traces.$inferSelect
export type DbSpan = typeof spans.$inferSelect
export type NewTrace = typeof traces.$inferInsert
export type NewSpan = typeof spans.$inferInsert
