// API から独立した型定義（モノレポの依存を増やさないため複製）

export type TraceStatus = 'running' | 'success' | 'error'
export type SpanKind = 'llm' | 'tool' | 'agent' | 'retrieval' | 'custom'

export type Trace = {
  id: string
  sessionId: string
  agentId: string
  name: string
  input: unknown
  output: unknown
  startTime: string   // API は ISO文字列で返す
  endTime: string | null
  totalTokens: number
  totalCostUsd: string
  status: TraceStatus
  metadata: Record<string, unknown>
}

export type Span = {
  id: string
  traceId: string
  parentSpanId: string | null
  kind: SpanKind
  name: string
  model: string | null
  inputTokens: number
  outputTokens: number
  costUsd: string
  startTime: string
  endTime: string | null
  status: TraceStatus
  attributes: Record<string, unknown>
  events: unknown[]
}

export type TraceWithSpans = Trace & { spans: Span[] }

export type ListTracesResult = {
  items: Trace[]
  nextCursor: string | null
}

export type ApiClientConfig = {
  baseUrl: string
  apiKey?: string | undefined
}
