'use client'

import { useState } from 'react'
import { SpanWaterfall } from '@/components/trace/span-waterfall'
import { SpanAttributes } from '@/components/trace/span-attributes'

type Span = {
  id: string
  traceId: string
  parentSpanId: string | null
  kind: 'llm' | 'tool' | 'agent' | 'retrieval' | 'custom'
  name: string
  model: string | null
  inputTokens: number
  outputTokens: number
  costUsd: string
  startTime: string
  endTime: string | null
  status: 'running' | 'success' | 'error'
  attributes: Record<string, unknown>
  events: unknown[]
}

export function SharePanels({ spans }: { spans: Span[] }) {
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null)
  const selectedSpan = spans.find((s) => s.id === selectedSpanId)

  return (
    <div className="flex gap-4">
      <div className="flex-1 bg-gray-900 rounded-lg border border-gray-700 overflow-hidden">
        <SpanWaterfall
          spans={spans}
          selectedSpanId={selectedSpanId}
          onSelectSpan={setSelectedSpanId}
        />
      </div>
      {selectedSpan && (
        <div className="w-80 shrink-0 bg-gray-900 rounded-lg border border-gray-700 overflow-hidden">
          <SpanAttributes span={selectedSpan} />
        </div>
      )}
    </div>
  )
}
