import { describe, it, expect } from 'vitest'
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base'
import { TraceforgeSDK } from './sdk'

function createTestSdk(overrides: { enabled?: boolean } = {}) {
  const exporter = new InMemorySpanExporter()
  const sdk = new TraceforgeSDK({
    endpoint: 'http://localhost:3001',
    agentId: 'test-agent',
    sessionId: 'test-session',
    _exporter: exporter,
    ...overrides,
  })
  return { sdk, exporter }
}

describe('TraceforgeSDK', () => {
  it('trace() はコールバックの戻り値を返す', async () => {
    const { sdk } = createTestSdk()
    const result = await sdk.trace('test-op', async () => 42)
    expect(result).toBe(42)
  })

  it('trace() 正常終了でスパンが記録される', async () => {
    const { sdk, exporter } = createTestSdk()
    await sdk.trace('generate_code', async (span) => {
      span.setInput('hello')
      span.setOutput('world')
    })

    const spans = exporter.getFinishedSpans()
    expect(spans).toHaveLength(1)
    expect(spans[0]!.name).toBe('generate_code')
    expect(spans[0]!.attributes['traceforge.input']).toBe('"hello"')
    expect(spans[0]!.attributes['traceforge.output']).toBe('"world"')
  })

  it('trace() 内で例外が throw されるとスパンが error になり再 throw される', async () => {
    const { sdk, exporter } = createTestSdk()
    await expect(
      sdk.trace('failing-op', async () => { throw new Error('something failed') })
    ).rejects.toThrow('something failed')

    const spans = exporter.getFinishedSpans()
    expect(spans).toHaveLength(1)
    expect(spans[0]!.status.code).toBe(2) // SpanStatusCode.ERROR = 2
  })

  it('startSpan() で手動スパンを開始・終了できる', async () => {
    const { sdk, exporter } = createTestSdk()
    const span = sdk.startSpan('tool_call', { kind: 'tool' })
    span.end({ status: 'success' })

    const spans = exporter.getFinishedSpans()
    expect(spans).toHaveLength(1)
    expect(spans[0]!.name).toBe('tool_call')
    expect(spans[0]!.attributes['traceforge.kind']).toBe('tool')
  })

  it('enabled: false のとき trace() はコールバックを実行して値を返す', async () => {
    const { sdk } = createTestSdk({ enabled: false })
    const result = await sdk.trace('noop', async () => 'ok')
    expect(result).toBe('ok')
  })

  it('enabled: false のとき startSpan() は NoopSpan を返す（エラーにならない）', () => {
    const { sdk } = createTestSdk({ enabled: false })
    const span = sdk.startSpan('noop')
    expect(() => span.end()).not.toThrow()
  })
})
