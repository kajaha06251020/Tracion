import { TraceforgeSDK } from './sdk'
import { NoopTraceforgeSpan } from './span'
import type { TraceforgeSpan } from './span'
import type { TraceforgeConfig, SpanOptions } from './types'

export { TraceforgeSDK } from './sdk'
export type { TraceforgeSpan } from './span'
export type { TraceforgeConfig, SpanOptions, TraceStatus, SpanKind } from './types'

/** インスタンスを生成する（テスト・マルチエンドポイント向け） */
export function createTraceforge(config: TraceforgeConfig): TraceforgeSDK {
  return new TraceforgeSDK(config)
}

/** グローバルシングルトン（アプリ全体で使い回す） */
class GlobalTraceforge {
  private sdk: TraceforgeSDK | null = null

  init(config: TraceforgeConfig): void {
    this.sdk = new TraceforgeSDK(config)
  }

  async trace<T>(
    name: string,
    fn: (span: TraceforgeSpan) => Promise<T>,
    options?: SpanOptions
  ): Promise<T> {
    if (!this.sdk) {
      // init() 前でも動作する（enabled: false 相当）
      return fn(new NoopTraceforgeSpan())
    }
    return this.sdk.trace(name, fn, options)
  }

  startSpan(name: string, options?: SpanOptions): TraceforgeSpan {
    if (!this.sdk) {
      return new NoopTraceforgeSpan()
    }
    return this.sdk.startSpan(name, options)
  }
}

export const traceforge = new GlobalTraceforge()
