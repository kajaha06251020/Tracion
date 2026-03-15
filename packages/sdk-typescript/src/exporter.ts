import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import type { TracionConfig } from './types'

export function createExporter(config: TracionConfig): OTLPTraceExporter {
  const headers: Record<string, string> = {}
  if (config.apiKey) {
    headers['X-Tracion-Api-Key'] = config.apiKey
  }

  return new OTLPTraceExporter({
    url: `${config.endpoint}/v1/traces`,
    headers,
  })
}
