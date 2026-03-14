import { describe, it, expect, vi } from 'vitest'
import { SpanStatusCode } from '@opentelemetry/api'
import type { Span as OtelSpan } from '@opentelemetry/api'
import { OtelTraceforgeSpan, NoopTraceforgeSpan } from './span'

function mockOtelSpan(): OtelSpan {
  return {
    setAttribute: vi.fn(),
    addEvent: vi.fn(),
    setStatus: vi.fn(),
    end: vi.fn(),
    spanContext: vi.fn(() => ({ traceId: '', spanId: '', traceFlags: 0 })),
    isRecording: vi.fn(() => true),
    recordException: vi.fn(),
    updateName: vi.fn(),
    setAttributes: vi.fn(),
  } as unknown as OtelSpan
}

describe('OtelTraceforgeSpan', () => {
  it('setInput は traceforge.input 属性に JSON 文字列を設定する', () => {
    const otel = mockOtelSpan()
    const span = new OtelTraceforgeSpan(otel)
    span.setInput({ prompt: 'hello' })
    expect(otel.setAttribute).toHaveBeenCalledWith('traceforge.input', '{"prompt":"hello"}')
  })

  it('setOutput は traceforge.output 属性に JSON 文字列を設定する', () => {
    const otel = mockOtelSpan()
    const span = new OtelTraceforgeSpan(otel)
    span.setOutput('result text')
    expect(otel.setAttribute).toHaveBeenCalledWith('traceforge.output', '"result text"')
  })

  it('end({ status: success }) は OTel status OK を設定する', () => {
    const otel = mockOtelSpan()
    const span = new OtelTraceforgeSpan(otel)
    span.end({ status: 'success' })
    expect(otel.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.OK })
    expect(otel.end).toHaveBeenCalled()
  })

  it('end({ status: error, error }) は OTel status ERROR とメッセージを設定する', () => {
    const otel = mockOtelSpan()
    const span = new OtelTraceforgeSpan(otel)
    span.end({ status: 'error', error: new Error('boom') })
    expect(otel.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.ERROR, message: 'boom' })
    expect(otel.end).toHaveBeenCalled()
  })
})

describe('NoopTraceforgeSpan', () => {
  it('全メソッドがエラーを投げない', () => {
    const span = new NoopTraceforgeSpan()
    expect(() => span.setInput('x')).not.toThrow()
    expect(() => span.setOutput('x')).not.toThrow()
    expect(() => span.setAttribute('k', 'v')).not.toThrow()
    expect(() => span.addEvent('e')).not.toThrow()
    expect(() => span.end()).not.toThrow()
  })
})
