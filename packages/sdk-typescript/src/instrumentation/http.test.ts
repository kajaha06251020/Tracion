import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base'
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base'
import { trace } from '@opentelemetry/api'
import { patchFetch, unpatchFetch } from './http'

function setupProvider(): { exporter: InMemorySpanExporter; tracer: ReturnType<typeof trace.getTracer> } {
  const exporter = new InMemorySpanExporter()
  const { SimpleSpanProcessor } = require('@opentelemetry/sdk-trace-base')
  const provider = new BasicTracerProvider()
  provider.addSpanProcessor(new SimpleSpanProcessor(exporter))
  provider.register()
  const tracer = provider.getTracer('test')
  return { exporter, tracer }
}

describe('patchFetch', () => {
  let exporter: InMemorySpanExporter
  let tracer: ReturnType<typeof trace.getTracer>

  beforeEach(() => {
    const setup = setupProvider()
    exporter = setup.exporter
    tracer = setup.tracer
    patchFetch(setup.tracer)
  })

  afterEach(() => {
    unpatchFetch()
    exporter.reset()
  })

  it('Anthropic API への fetch でスパンを自動生成する', async () => {
    // Re-patch with mock as the base fetch so the interceptor can call the mock
    unpatchFetch()
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      clone: () => ({
        json: async () => ({
          model: 'claude-opus-4-6',
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
      }),
    }) as unknown as typeof fetch
    patchFetch(tracer)

    await globalThis.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      body: JSON.stringify({ model: 'claude-opus-4-6', messages: [] }),
    })

    // 非同期でスパンが記録されるまで少し待つ
    await new Promise((r) => setTimeout(r, 50))

    const spans = exporter.getFinishedSpans()
    expect(spans.length).toBeGreaterThan(0)
    const span = spans[0]!
    expect(span.attributes['llm.provider']).toBe('anthropic')
    expect(span.attributes['traceforge.kind']).toBe('llm')
  })

  it('Anthropic 以外の URL は通常の fetch として処理する', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, clone: () => ({ json: async () => ({}) }) })
    globalThis.fetch = mockFetch as unknown as typeof fetch

    patchFetch(trace.getTracer('test'))
    await globalThis.fetch('https://example.com/api')

    const spans = exporter.getFinishedSpans()
    expect(spans).toHaveLength(0)
  })
})
