'use client'

import { formatTokens, formatCost } from '@/lib/format'
import { useState } from 'react'

type Span = {
  id: string
  name: string
  kind: string
  model: string | null
  inputTokens: number
  outputTokens: number
  costUsd: string | number
  status: string
  attributes: Record<string, unknown>
  events: unknown[]
}

export function SpanAttributes({ span }: { span: Span }) {
  const [showRaw, setShowRaw] = useState(false)

  return (
    <div data-testid="span-attributes" className="p-4 space-y-4 text-sm">
      <h3 className="font-semibold text-gray-900 dark:text-white">{span.name}</h3>

      <div className="grid grid-cols-2 gap-2">
        {[
          ['Kind', span.kind],
          ['Status', span.status],
          ['Model', span.model ?? '—'],
          ['Input tokens', formatTokens(span.inputTokens)],
          ['Output tokens', formatTokens(span.outputTokens)],
          ['Cost', formatCost(span.costUsd)],
        ].map(([label, value]) => (
          <div key={label}>
            <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
            <div className="font-medium text-gray-900 dark:text-white">{value}</div>
          </div>
        ))}
      </div>

      {span.events.length > 0 && (
        <div>
          <div className="text-xs font-medium text-gray-500 mb-1">Events ({span.events.length})</div>
          <div className="space-y-1">
            {span.events.map((ev, i) => (
              <div key={i} className="text-xs bg-gray-50 dark:bg-gray-800 rounded p-2 font-mono">
                {JSON.stringify(ev)}
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <button
          onClick={() => setShowRaw(!showRaw)}
          className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
        >
          {showRaw ? 'Hide' : 'Show'} raw attributes
        </button>
        {showRaw && (
          <pre className="mt-2 text-xs bg-gray-50 dark:bg-gray-800 rounded p-3 overflow-auto max-h-64">
            {JSON.stringify(span.attributes, null, 2)}
          </pre>
        )}
      </div>
    </div>
  )
}
