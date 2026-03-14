import { ulid } from 'ulid'
import type { NewTrace, NewSpan } from '../db/schema'
import type { TraceStatus, SpanKind } from '../types'

// OTLP/HTTP JSON types (subset we care about)
export type OtlpAttributeValue =
  | { stringValue: string }
  | { intValue: string }
  | { doubleValue: number }
  | { boolValue: boolean }

export type OtlpAttribute = { key: string; value: OtlpAttributeValue }

export type OtlpSpan = {
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  startTimeUnixNano: string
  endTimeUnixNano?: string
  status?: { code?: number }
  attributes?: OtlpAttribute[]
  events?: unknown[]
}

export type OtlpPayload = {
  resourceSpans: Array<{
    resource?: { attributes?: OtlpAttribute[] }
    scopeSpans: Array<{ spans: OtlpSpan[] }>
  }>
}

type ParseResult = {
  trace: NewTrace
  spans: NewSpan[]
}

function getStringAttr(attrs: OtlpAttribute[] | undefined, key: string): string | undefined {
  const attr = attrs?.find((a) => a.key === key)
  if (!attr) return undefined
  return 'stringValue' in attr.value ? attr.value.stringValue : undefined
}

function getNumberAttr(attrs: OtlpAttribute[] | undefined, key: string): number {
  const attr = attrs?.find((a) => a.key === key)
  if (!attr) return 0
  const v = attr.value
  if ('intValue' in v) return parseInt(v.intValue, 10)
  if ('doubleValue' in v) return v.doubleValue
  return 0
}

function nanoToDate(nano: string): Date {
  return new Date(Number(BigInt(nano) / 1_000_000n))
}

function otlpStatusToInternal(code?: number): TraceStatus {
  if (code === 2) return 'error'
  if (code === 1) return 'success'
  return 'success'
}

// NOTE: Phase 0 processes only the first resourceSpan in a batch.
// Multi-service batches (multiple resourceSpans) are a Phase 1+ concern.
export function parseOtlpPayload(payload: OtlpPayload): ParseResult {
  const firstResourceSpan = payload.resourceSpans[0]
  if (!firstResourceSpan) {
    throw new Error('Empty OTLP payload: no resourceSpans')
  }

  const traceId = ulid()
  const allSpans: NewSpan[] = []
  let rootSpan: OtlpSpan | undefined
  let totalTokens = 0
  let totalCostUsd = 0
  let hasError = false

  const resourceAttrs = firstResourceSpan.resource?.attributes ?? []
  const agentId =
    getStringAttr(resourceAttrs, 'traceforge.agent_id') ??
    getStringAttr(resourceAttrs, 'service.name') ??
    'unknown'
  const sessionId = getStringAttr(resourceAttrs, 'traceforge.session_id') ?? 'default'

  for (const scopeSpan of firstResourceSpan.scopeSpans) {
    for (const span of scopeSpan.spans) {
      const spanAttrs = span.attributes ?? []

      const inputTokens = getNumberAttr(spanAttrs, 'llm.input_tokens')
      const outputTokens = getNumberAttr(spanAttrs, 'llm.output_tokens')
      const costUsd = getNumberAttr(spanAttrs, 'llm.cost_usd')

      totalTokens += inputTokens + outputTokens
      totalCostUsd += costUsd

      const statusCode = span.status?.code
      if (statusCode === 2) hasError = true

      const kind = (getStringAttr(spanAttrs, 'traceforge.kind') ?? 'custom') as SpanKind

      const newSpan: NewSpan = {
        id: span.spanId,
        traceId,
        parentSpanId: span.parentSpanId ?? null,
        kind,
        name: span.name,
        model: getStringAttr(spanAttrs, 'llm.model') ?? null,
        inputTokens,
        outputTokens,
        costUsd: costUsd.toFixed(6),
        startTime: nanoToDate(span.startTimeUnixNano),
        endTime: span.endTimeUnixNano ? nanoToDate(span.endTimeUnixNano) : null,
        status: otlpStatusToInternal(statusCode),
        attributes: Object.fromEntries(
          spanAttrs.map((a) => [a.key, Object.values(a.value)[0]])
        ) as Record<string, unknown>,
        events: (span.events ?? []) as NewSpan['events'],
      }

      if (!span.parentSpanId) {
        rootSpan = span
      }

      ;(newSpan.attributes as Record<string, unknown>)['traceforge.agent_id'] = agentId
      ;(newSpan.attributes as Record<string, unknown>)['traceforge.session_id'] = sessionId

      allSpans.push(newSpan)
    }
  }

  const rootAttrs = rootSpan?.attributes ?? []
  const inputRaw = getStringAttr(rootAttrs, 'traceforge.input')
  const outputRaw = getStringAttr(rootAttrs, 'traceforge.output')
  const firstSpanStart = firstResourceSpan.scopeSpans[0]?.spans[0]?.startTimeUnixNano

  const trace: NewTrace = {
    id: traceId,
    sessionId,
    agentId,
    name: rootSpan?.name ?? allSpans[0]?.name ?? 'unknown',
    input: inputRaw ? (JSON.parse(inputRaw) as NewTrace['input']) : null,
    output: outputRaw ? (JSON.parse(outputRaw) as NewTrace['output']) : null,
    startTime: nanoToDate(rootSpan?.startTimeUnixNano ?? firstSpanStart ?? '0'),
    endTime: rootSpan?.endTimeUnixNano ? nanoToDate(rootSpan.endTimeUnixNano) : null,
    totalTokens,
    totalCostUsd: totalCostUsd.toFixed(6),
    status: hasError ? 'error' : 'success',
    metadata: {},
  }

  return { trace, spans: allSpans }
}
