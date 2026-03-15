import { TracionSDK } from './sdk'
import { NoopTracionSpan } from './span'
import type { TracionSpan } from './span'
import type { TracionConfig, SpanOptions } from './types'

export { TracionSDK } from './sdk'
export type { TracionSpan } from './span'
export type { TracionConfig, SpanOptions, TraceStatus, SpanKind } from './types'

/** インスタンスを生成する（テスト・マルチエンドポイント向け） */
export function createTracion(config: TracionConfig): TracionSDK {
  return new TracionSDK(config)
}

/** グローバルシングルトン（アプリ全体で使い回す） */
class GlobalTracion {
  private sdk: TracionSDK | null = null

  init(config: TracionConfig): void {
    this.sdk = new TracionSDK(config)
  }

  async trace<T>(
    name: string,
    fn: (span: TracionSpan) => Promise<T>,
    options?: SpanOptions
  ): Promise<T> {
    if (!this.sdk) {
      // init() 前でも動作する（enabled: false 相当）
      return fn(new NoopTracionSpan())
    }
    return this.sdk.trace(name, fn, options)
  }

  startSpan(name: string, options?: SpanOptions): TracionSpan {
    if (!this.sdk) {
      return new NoopTracionSpan()
    }
    return this.sdk.startSpan(name, options)
  }
}

export const tracion = new GlobalTracion()
