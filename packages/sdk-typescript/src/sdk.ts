import { trace, context } from '@opentelemetry/api'
import { createTracerProvider } from './tracer'
import { OtelTracionSpan, NoopTracionSpan } from './span'
import type { TracionSpan } from './span'
import type { TracionConfig, SpanOptions } from './types'

export class TracionSDK {
  private readonly tracer: ReturnType<typeof trace.getTracer> | null
  private readonly enabled: boolean

  constructor(config: TracionConfig) {
    this.enabled = config.enabled ?? true

    if (this.enabled) {
      const provider = createTracerProvider(config)
      provider.register()
      this.tracer = provider.getTracer('@tracion/sdk', '0.1.0')
    } else {
      this.tracer = null
    }
  }

  async trace<T>(
    name: string,
    fn: (span: TracionSpan) => Promise<T>,
    options?: SpanOptions
  ): Promise<T> {
    if (!this.enabled || !this.tracer) {
      return fn(new NoopTracionSpan())
    }

    const otelSpan = this.tracer.startSpan(name)
    if (options?.kind) {
      otelSpan.setAttribute('tracion.kind', options.kind)
    }
    const tfSpan = new OtelTracionSpan(otelSpan)

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

  startSpan(name: string, options?: SpanOptions): TracionSpan {
    if (!this.enabled || !this.tracer) {
      return new NoopTracionSpan()
    }

    const otelSpan = this.tracer.startSpan(name)
    if (options?.kind) {
      otelSpan.setAttribute('tracion.kind', options.kind)
    }
    return new OtelTracionSpan(otelSpan)
  }
}
