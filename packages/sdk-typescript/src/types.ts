import type { SpanExporter } from '@opentelemetry/sdk-trace-base'

export type TraceStatus = 'running' | 'success' | 'error'
export type SpanKind = 'llm' | 'tool' | 'agent' | 'retrieval' | 'custom'

export type SpanOptions = {
  kind?: SpanKind
}

export type SpanEndOptions = {
  status?: TraceStatus
  error?: unknown
}

export type TracionConfig = {
  endpoint: string            // 必須: Tracion API の base URL（例: "http://localhost:3001"）
  apiKey?: string             // オプション: X-Tracion-Api-Key ヘッダー
  agentId?: string            // → OTel Resource 属性 tracion.agent_id と service.name に設定
  sessionId?: string          // → OTel Resource 属性 tracion.session_id に設定
  enabled?: boolean           // デフォルト true。false でノーオペレーション
  batchSize?: number          // デフォルト 512: BatchSpanProcessor の maxExportBatchSize
  exportIntervalMs?: number   // デフォルト 5000: BatchSpanProcessor の scheduledDelayMillis
  _exporter?: SpanExporter    // テスト専用: InMemorySpanExporter を注入する際に使用
}
