import { describe, it, expect, vi } from 'vitest'
import { InMemorySpanExporter, SimpleSpanProcessor, BasicTracerProvider } from '@opentelemetry/sdk-trace-base'
import { patchOpenAI } from './openai'

function setupProvider() {
  const exporter = new InMemorySpanExporter()
  const provider = new BasicTracerProvider()
  provider.addSpanProcessor(new SimpleSpanProcessor(exporter))
  provider.register()
  return { exporter, tracer: provider.getTracer('test') }
}

describe('patchOpenAI', () => {
  it('OpenAI SDK がない場合は何もしない', () => {
    const { tracer } = setupProvider()
    expect(() => patchOpenAI(tracer, undefined)).not.toThrow()
  })

  it('OpenAI クライアントのメソッドをパッチしてトークンを記録する', async () => {
    const { exporter, tracer } = setupProvider()

    const mockCreate = vi.fn()
    const mockOpenAI = {
      chat: { completions: { create: mockCreate } },
    }

    mockCreate.mockResolvedValue({
      model: 'gpt-4o',
      usage: { prompt_tokens: 150, completion_tokens: 80 },
      choices: [{ message: { content: 'Hello' } }],
    })

    patchOpenAI(tracer, mockOpenAI as never)

    await mockOpenAI.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hi' }],
    })

    const spans = exporter.getFinishedSpans()
    expect(spans.length).toBeGreaterThan(0)
    const span = spans[0]!
    expect(span.attributes['llm.model']).toBe('gpt-4o')
    expect(span.attributes['llm.input_tokens']).toBe(150)
    expect(span.attributes['llm.output_tokens']).toBe(80)
    expect(span.attributes['llm.provider']).toBe('openai')
    expect(span.attributes['traceforge.kind']).toBe('llm')
  })
})
