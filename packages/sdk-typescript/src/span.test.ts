import { describe, it, expect, vi } from 'vitest'
import { SpanStatusCode } from '@opentelemetry/api'
import type { Span as OtelSpan } from '@opentelemetry/api'
import { OtelTracionSpan, NoopTracionSpan } from './span'

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

describe('OtelTracionSpan', () => {
  it('setInput は tracion.input 属性に JSON 文字列を設定する', () => {
    const otel = mockOtelSpan()
    const span = new OtelTracionSpan(otel)
    span.setInput({ prompt: 'hello' })
    expect(otel.setAttribute).toHaveBeenCalledWith('tracion.input', '{"prompt":"hello"}')
  })

  it('setOutput は tracion.output 属性に JSON 文字列を設定する', () => {
    const otel = mockOtelSpan()
    const span = new OtelTracionSpan(otel)
    span.setOutput('result text')
    expect(otel.setAttribute).toHaveBeenCalledWith('tracion.output', '"result text"')
  })

  it('end({ status: success }) は OTel status OK を設定する', () => {
    const otel = mockOtelSpan()
    const span = new OtelTracionSpan(otel)
    span.end({ status: 'success' })
    expect(otel.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.OK })
    expect(otel.end).toHaveBeenCalled()
  })

  it('end({ status: error, error }) は OTel status ERROR とメッセージを設定する', () => {
    const otel = mockOtelSpan()
    const span = new OtelTracionSpan(otel)
    span.end({ status: 'error', error: new Error('boom') })
    expect(otel.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.ERROR, message: 'boom' })
    expect(otel.end).toHaveBeenCalled()
  })
})

describe('NoopTracionSpan', () => {
  it('全メソッドがエラーを投げない', () => {
    const span = new NoopTracionSpan()
    expect(() => span.setInput('x')).not.toThrow()
    expect(() => span.setOutput('x')).not.toThrow()
    expect(() => span.setAttribute('k', 'v')).not.toThrow()
    expect(() => span.addEvent('e')).not.toThrow()
    expect(() => span.end()).not.toThrow()
  })
})
