import type { ApiClient } from '../client'
import type { Trace } from '../types'

type ListTracesInput = {
  limit?: number
  cursor?: string
  agentId?: string
  status?: 'running' | 'success' | 'error'
  since?: string
}

function formatDuration(start: string, end: string | null): string {
  if (!end) return 'running'
  const ms = new Date(end).getTime() - new Date(start).getTime()
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
}

function formatTrace(t: Trace, index: number): string {
  const duration = formatDuration(t.startTime, t.endTime)
  const cost = parseFloat(t.totalCostUsd) > 0 ? ` | $${parseFloat(t.totalCostUsd).toFixed(4)}` : ''
  return `${index + 1}. [${t.id}] ${t.name}
   agent: ${t.agentId} | status: ${t.status} | ${duration} | ${t.totalTokens} tokens${cost}
   開始: ${new Date(t.startTime).toLocaleString('ja-JP')}`
}

export async function handleListTraces(
  client: ApiClient,
  input: ListTracesInput
): Promise<string> {
  const result = await client.listTraces(input)
  const { items, nextCursor } = result

  if (items.length === 0 && !nextCursor) {
    return 'トレースが0件です。'
  }

  const lines = [
    `トレース一覧 (${items.length}件):`,
    '',
    ...items.map(formatTrace),
  ]

  if (nextCursor) {
    lines.push('', `次のページ: cursor: ${nextCursor} を指定してください`)
  }

  return lines.join('\n')
}
