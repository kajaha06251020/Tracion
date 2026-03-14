import { trace, context } from '@opentelemetry/api'
import { createTracerProvider } from './tracer'
import { OtelTraceforgeSpan, NoopTraceforgeSpan } from './span'
import type { TraceforgeSpan } from './span'
import type { TraceforgeConfig, SpanOptions } from './types'

export class TraceforgeSDK {
  private readonly tracer: ReturnType<typeof trace.getTracer> | null
  private readonly enabled: boolean

  constructor(config: TraceforgeConfig) {
    this.enabled = config.enabled ?? true

    if (this.enabled) {
      const provider = createTracerProvider(config)
      provider.register()
      this.tracer = provider.getTracer('@traceforge/sdk', '0.1.0')
    } else {
      this.tracer = null
    }
  }

  async trace<T>(
    name: string,
    fn: (span: TraceforgeSpan) => Promise<T>,
    options?: SpanOptions
  ): Promise<T> {
    if (!this.enabled || !this.tracer) {
      return fn(new NoopTraceforgeSpan())
    }

    const otelSpan = this.tracer.startSpan(name)
    if (options?.kind) {
      otelSpan.setAttribute('traceforge.kind', options.kind)
    }
    const tfSpan = new OtelTraceforgeSpan(otelSpan)

    return context.with(trace.setSpan(context.active(), otelSpan), async () => {
      try {
        const result = await fn(tfSpan)
        tfSpan.end({ status: 'success' })
        return result
      } catch (e) {
        tfSpan.end({ status: 'error', error: e })
        throw e
      }
    })
  }

  startSpan(name: string, options?: SpanOptions): TraceforgeSpan {
    if (!this.enabled || !this.tracer) {
      return new NoopTraceforgeSpan()
    }

    const otelSpan = this.tracer.startSpan(name)
    if (options?.kind) {
      otelSpan.setAttribute('traceforge.kind', options.kind)
    }
    return new OtelTraceforgeSpan(otelSpan)
  }
}
