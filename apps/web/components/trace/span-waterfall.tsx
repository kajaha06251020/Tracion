'use client'

import { formatDuration } from '@/lib/format'

const KIND_COLORS: Record<string, string> = {
  llm: 'bg-blue-500',
  tool: 'bg-green-500',
  agent: 'bg-purple-500',
  retrieval: 'bg-orange-500',
  custom: 'bg-gray-500',
}

const KIND_TEXT_COLORS: Record<string, string> = {
  llm: 'text-blue-700 bg-blue-100 dark:text-blue-300 dark:bg-blue-900',
  tool: 'text-green-700 bg-green-100 dark:text-green-300 dark:bg-green-900',
  agent: 'text-purple-700 bg-purple-100 dark:text-purple-300 dark:bg-purple-900',
  retrieval: 'text-orange-700 bg-orange-100 dark:text-orange-300 dark:bg-orange-900',
  custom: 'text-gray-700 bg-gray-100 dark:text-gray-300 dark:bg-gray-800',
}

export type SpanRow = {
  id: string
  name: string
  kind: string
  startTime: Date | string
  endTime: Date | string | null
  parentSpanId: string | null
  depth: number
  offsetPct: number
  widthPct: number
}

function computeRows(spans: {
  id: string
  name: string
  kind: string
  startTime: Date | string
  endTime: Date | string | null
  parentSpanId: string | null
}[]): SpanRow[] {
  if (spans.length === 0) return []

  const sorted = [...spans].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  )

  const traceStart = new Date(sorted[0].startTime).getTime()
  const traceEnd = Math.max(...sorted.map((s) => new Date(s.endTime ?? s.startTime).getTime()))
  const totalDuration = traceEnd - traceStart || 1

  // Compute depth via BFS
  const parentMap = new Map<string, string | null>(sorted.map((s) => [s.id, s.parentSpanId]))
  const depthMap = new Map<string, number>()
  for (const span of sorted) {
    let depth = 0
    let p = span.parentSpanId
    while (p) {
      depth++
      p = parentMap.get(p) ?? null
    }
    depthMap.set(span.id, depth)
  }

  return sorted.map((span) => {
    const start = new Date(span.startTime).getTime() - traceStart
    const end = span.endTime
      ? new Date(span.endTime).getTime() - traceStart
      : traceEnd - traceStart
    return {
      ...span,
      depth: depthMap.get(span.id) ?? 0,
      offsetPct: (start / totalDuration) * 100,
      widthPct: Math.max(((end - start) / totalDuration) * 100, 0.5),
    }
  })
}

type Props = {
  spans: {
    id: string
    name: string
    kind: string
    startTime: Date | string
    endTime: Date | string | null
    parentSpanId: string | null
  }[]
  selectedSpanId: string | null
  onSelectSpan: (id: string) => void
}

export function SpanWaterfall({ spans, selectedSpanId, onSelectSpan }: Props) {
  const rows = computeRows(spans)

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
          <tr>
            <th className="text-left px-4 py-2 font-medium text-gray-500 w-64">Span</th>
            <th className="text-left px-4 py-2 font-medium text-gray-500 w-20">Kind</th>
            <th className="text-left px-4 py-2 font-medium text-gray-500">Timeline</th>
            <th className="text-right px-4 py-2 font-medium text-gray-500 w-20">Duration</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
          {rows.map((row) => (
            <tr
              key={row.id}
              onClick={() => onSelectSpan(row.id)}
              className={`cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${
                selectedSpanId === row.id ? 'bg-blue-50 dark:bg-blue-950' : ''
              }`}
            >
              <td className="px-4 py-2">
                <span style={{ paddingLeft: `${row.depth * 16}px` }} className="inline-block truncate max-w-xs">
                  {row.name}
                </span>
              </td>
              <td className="px-4 py-2">
                <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${KIND_TEXT_COLORS[row.kind] ?? KIND_TEXT_COLORS.custom}`}>
                  {row.kind}
                </span>
              </td>
              <td className="px-4 py-2">
                <div className="relative h-4 bg-gray-100 dark:bg-gray-700 rounded overflow-hidden">
                  <div
                    className={`absolute top-0 h-full rounded ${KIND_COLORS[row.kind] ?? KIND_COLORS.custom}`}
                    style={{ left: `${row.offsetPct}%`, width: `${row.widthPct}%` }}
                  />
                </div>
              </td>
              <td className="px-4 py-2 text-right text-gray-500 tabular-nums">
                {formatDuration(row.startTime, row.endTime)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
