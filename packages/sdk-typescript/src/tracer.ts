import { BasicTracerProvider, BatchSpanProcessor, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { Resource } from '@opentelemetry/resources'
import type { TraceforgeConfig } from './types'
import { createExporter } from './exporter'

export function createTracerProvider(config: TraceforgeConfig): BasicTracerProvider {
  // agentId と sessionId は Resource 属性として設定（スパン属性ではない）
  // バックエンドパーサーは resourceSpans[].resource.attributes から読み取る
  const resource = new Resource({
    'traceforge.agent_id': config.agentId ?? 'unknown',
    'traceforge.session_id': config.sessionId ?? 'default',
    'service.name': config.agentId ?? 'unknown',  // OTel エコシステム互換
    'process.runtime.version': process.version,
    'process.pid': process.pid,
  })

  const exporter = config._exporter ?? createExporter(config)

  const provider = new BasicTracerProvider({ resource })

  // テスト時は _exporter が注入されるため SimpleSpanProcessor を使用して同期的にフラッシュする
  // 本番時は BatchSpanProcessor でバッファリングする
  if (config._exporter) {
    provider.addSpanProcessor(new SimpleSpanProcessor(exporter))
  } else {
    provider.addSpanProcessor(
      new BatchSpanProcessor(exporter, {
        maxExportBatchSize: config.batchSize ?? 512,
        scheduledDelayMillis: config.exportIntervalMs ?? 5000,
      })
    )
  }

  return provider
}
