// Result monad — never throw in service layer
export type Result<T, E> = { ok: true; data: T } | { ok: false; error: E }

export const ok = <T>(data: T): Result<T, never> => ({ ok: true, data })
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error })

// Typed errors
export type TraceError =
  | { code: 'NOT_FOUND'; traceId: string }
  | { code: 'VALIDATION_FAILED'; field: string; message: string }
  | { code: 'DB_ERROR'; cause: unknown }
  | { code: 'PARSE_ERROR'; message: string }

// JSON type for jsonb columns
export type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [key: string]: Json }

// HTTP response shape
export type ApiSuccess<T> = { success: true; data: T }
export type ApiError = { success: false; error: { code: string; message: string; details?: unknown } }
export type ApiResponse<T> = ApiSuccess<T> | ApiError

export const apiOk = <T>(data: T): ApiSuccess<T> => ({ success: true, data })
export const apiErr = (code: string, message: string, details?: unknown): ApiError => ({
  success: false,
  error: { code, message, details },
})

// Trace/Span domain types
export type TraceStatus = 'running' | 'success' | 'error'
export type SpanKind = 'llm' | 'tool' | 'agent' | 'retrieval' | 'custom'

export type Trace = {
  id: string
  sessionId: string
  agentId: string
  name: string
  input: Json | null
  output: Json | null
  startTime: Date
  endTime: Date | null
  totalTokens: number
  totalCostUsd: string  // numeric from DB comes as string
  status: TraceStatus
  metadata: Record<string, unknown>
  shareToken: string | null
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
  costUsd: string  // numeric from DB comes as string
  startTime: Date
  endTime: Date | null
  status: TraceStatus
  attributes: Record<string, unknown>
  events: Json[]
}
