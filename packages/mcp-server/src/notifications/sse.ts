// 将来実装: API に GET /v1/traces/events (SSE) エンドポイントを追加後に差し替える
// EventSource インターフェースを満たすため、現時点はスタブのみ

import type { EventSource, NewTraceEvent } from './event-source'

export class SseEventSource implements EventSource {
  constructor(
    private readonly _sseUrl: string,
    private readonly _apiKey?: string
  ) {}

  start(_onNewTrace: (event: NewTraceEvent) => void): void {
    throw new Error(
      'SseEventSource は未実装です。API に SSE エンドポイントを追加後に実装します。'
    )
  }

  stop(): void {
    // no-op
  }
}
