import { describe, it, expect, vi } from 'vitest'
import { InMemorySpanExporter, SimpleSpanProcessor, BasicTracerProvider } from '@opentelemetry/sdk-trace-base'
import { patchAnthropic } from './anthropic'

function setupProvider() {
  const exporter = new InMemorySpanExporter()
  const provider = new BasicTracerProvider()
  provider.addSpanProcessor(new SimpleSpanProcessor(exporter))
  provider.register()
  return { exporter, tracer: provider.getTracer('test') }
}

describe('patchAnthropic', () => {
  it('Anthropic SDK がない場合は何もしない（エラーにならない）', () => {
    const { tracer } = setupProvider()
    // require が失敗するケースをシミュレート（モジュールなし）
    expect(() => patchAnthropic(tracer, undefined)).not.toThrow()
  })

  it('Anthropic クライアントのメソッドをパッチしてトークンを記録する', async () => {
    const { exporter, tracer } = setupProvider()

    const mockCreate = vi.fn()
    const mockAnthropic = {
      messages: { create: mockCreate },
    }

    mockCreate.mockResolvedValue({
      model: 'claude-opus-4-6',
      usage: { input_tokens: 200, output_tokens: 100 },
      content: [{ type: 'text', text: 'Hello' }],
    })

    patchAnthropic(tracer, mockAnthropic as never)

    await mockAnthropic.messages.create({
      model: 'claude-opus-4-6',
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 100,
    })

    const spans = exporter.getFinishedSpans()
    expect(spans.length).toBeGreaterThan(0)
    const span = spans[0]!
    expect(span.attributes['llm.model']).toBe('claude-opus-4-6')
    expect(span.attributes['llm.input_tokens']).toBe(200)
    expect(span.attributes['llm.output_tokens']).toBe(100)
    expect(span.attributes['llm.provider']).toBe('anthropic')
    expect(span.attributes['traceforge.kind']).toBe('llm')
  })
})
