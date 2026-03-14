import type { ApiClient } from '../client'
import type { EventSource, NewTraceEvent } from './event-source'

export class PollingEventSource implements EventSource {
  private timer: ReturnType<typeof setInterval> | null = null
  private lastChecked: Date = new Date()

  constructor(
    private readonly client: ApiClient,
    private readonly intervalMs: number = 30_000
  ) {}

  start(onNewTrace: (event: NewTraceEvent) => void): void {
    // 起動時刻を記録してから最初のポーリングをスケジュール
    this.lastChecked = new Date()

    this.timer = setInterval(async () => {
      await this.poll(onNewTrace)
    }, this.intervalMs)
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private async poll(onNewTrace: (event: NewTraceEvent) => void): Promise<void> {
    const since = this.lastChecked.toISOString()
    this.lastChecked = new Date()

    try {
      const { items } = await this.client.listTraces({ since, limit: 20 })
      for (const trace of items) {
        onNewTrace({ traceId: trace.id, name: trace.name, agentId: trace.agentId })
      }
    } catch {
      // ポーリングエラーは静かに無視（次回リトライ）
    }
  }
}
