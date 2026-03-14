import type { ApiClient } from '../client'
import type { Span } from '../types'

function buildSpanTree(
  spans: Span[],
  parentId: string | null = null,
  indent = 0
): string[] {
  const children = spans.filter((s) => s.parentSpanId === parentId)
  const lines: string[] = []

  for (const span of children) {
    const prefix = indent === 0 ? '└─' : '  '.repeat(indent) + '└─'
    const duration = span.endTime
      ? `${((new Date(span.endTime).getTime() - new Date(span.startTime).getTime()) / 1000).toFixed(2)}s`
      : 'running'
    const model = span.model ? ` (${span.model})` : ''
    lines.push(`  ${prefix} [${span.kind}] ${span.name}${model} — ${duration} — ${span.status}`)
    lines.push(...buildSpanTree(spans, span.id, indent + 1))
  }

  return lines
}

export async function handleGetTrace(
  client: ApiClient,
  traceId: string
): Promise<string> {
  try {
    const trace = await client.getTrace(traceId)

    const duration = trace.endTime
      ? `${((new Date(trace.endTime).getTime() - new Date(trace.startTime).getTime()) / 1000).toFixed(2)}s`
      : 'running'

    const cost = parseFloat(trace.totalCostUsd) > 0
      ? ` | $${parseFloat(trace.totalCostUsd).toFixed(4)}`
      : ''

    const lines = [
      `# トレース: ${trace.name}`,
      `ID: ${trace.id}`,
      `Agent: ${trace.agentId} | Session: ${trace.sessionId}`,
      `Status: ${trace.status} | Duration: ${duration} | ${trace.totalTokens} tokens${cost}`,
      `開始: ${new Date(trace.startTime).toLocaleString('ja-JP')}`,
      '',
      `## スパン (${trace.spans.length}件)`,
      ...buildSpanTree(trace.spans),
    ]

    return lines.join('\n')
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('NOT_FOUND')) {
      return `トレース "${traceId}" が見つかりません。`
    }
    return `エラー: ${msg}`
  }
}
