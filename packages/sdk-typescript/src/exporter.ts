import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import type { TraceforgeConfig } from './types'

export function createExporter(config: TraceforgeConfig): OTLPTraceExporter {
  const headers: Record<string, string> = {}
  if (config.apiKey) {
    headers['X-Traceforge-Api-Key'] = config.apiKey
  }

  return new OTLPTraceExporter({
    url: `${config.endpoint}/v1/traces`,
    headers,
  })
}
