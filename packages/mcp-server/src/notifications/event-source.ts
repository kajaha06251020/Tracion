// SSE への移行パスを確保するための抽象インターフェース
// PollingEventSource: 現在実装（30秒ポーリング）
// SseEventSource: 将来実装（APIに GET /v1/traces/events を追加後に差し替え）

export type NewTraceEvent = {
  traceId: string
  name: string
  agentId: string
}

export interface EventSource {
  start(onNewTrace: (event: NewTraceEvent) => void): void
  stop(): void
}
