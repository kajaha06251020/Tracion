import { SpanStatusCode } from '@opentelemetry/api'
import type { Span as OtelSpan } from '@opentelemetry/api'
import type { SpanEndOptions } from './types'

export interface TraceforgeSpan {
  setInput(value: unknown): void
  setOutput(value: unknown): void
  setAttribute(key: string, value: unknown): void
  addEvent(name: string, attributes?: Record<string, unknown>): void
  end(options?: SpanEndOptions): void
}

export class OtelTraceforgeSpan implements TraceforgeSpan {
  constructor(private readonly otelSpan: OtelSpan) {}

  setInput(value: unknown): void {
    this.otelSpan.setAttribute('traceforge.input', JSON.stringify(value))
  }

  setOutput(value: unknown): void {
    this.otelSpan.setAttribute('traceforge.output', JSON.stringify(value))
  }

  setAttribute(key: string, value: unknown): void {
    this.otelSpan.setAttribute(key, JSON.stringify(value))
  }

  addEvent(name: string, attributes?: Record<string, unknown>): void {
    this.otelSpan.addEvent(name, attributes as Record<string, string | number | boolean>)
  }

  end(options?: SpanEndOptions): void {
    if (options?.status === 'error') {
      const message = options.error instanceof Error
        ? options.error.message
        : String(options.error ?? '')
      this.otelSpan.setStatus({ code: SpanStatusCode.ERROR, message })
    } else {
      this.otelSpan.setStatus({ code: SpanStatusCode.OK })
    }
    this.otelSpan.end()
  }
}

export class NoopTraceforgeSpan implements TraceforgeSpan {
  setInput(_value: unknown): void { /* no-op */ }
  setOutput(_value: unknown): void { /* no-op */ }
  setAttribute(_key: string, _value: unknown): void { /* no-op */ }
  addEvent(_name: string, _attributes?: Record<string, unknown>): void { /* no-op */ }
  end(_options?: SpanEndOptions): void { /* no-op */ }
}
