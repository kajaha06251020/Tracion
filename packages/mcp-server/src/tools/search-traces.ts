import type { ApiClient } from '../client'
import type { Trace } from '../types'

type SearchTracesInput = {
  query: string
  limit?: number
  agentId?: string
  status?: 'running' | 'success' | 'error'
  since?: string
  until?: string
}

function formatTrace(t: Trace, index: number): string {
  const duration = t.endTime
    ? `${((new Date(t.endTime).getTime() - new Date(t.startTime).getTime()) / 1000).toFixed(1)}s`
    : 'running'
  return `${index + 1}. [${t.id}] ${t.name}
   agent: ${t.agentId} | status: ${t.status} | ${duration} | ${t.totalTokens} tokens
   開始: ${new Date(t.startTime).toLocaleString('ja-JP')}`
}

export async function handleSearchTraces(
  client: ApiClient,
  input: SearchTracesInput
): Promise<string> {
  const traces = await client.searchTraces(input)

  if (traces.length === 0) {
    return `"${input.query}" に一致するトレースが見つかりませんでした。`
  }

  const filters: string[] = []
  if (input.agentId) filters.push(`agent: ${input.agentId}`)
  if (input.status) filters.push(`status: ${input.status}`)
  if (input.since) filters.push(`since: ${input.since}`)
  if (input.until) filters.push(`until: ${input.until}`)
  const filterStr = filters.length > 0 ? ` (${filters.join(', ')})` : ''

  return [
    `"${input.query}" の検索結果 ${traces.length}件${filterStr}:`,
    '',
    ...traces.map(formatTrace),
  ].join('\n')
}
