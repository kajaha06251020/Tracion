'use client'

import { use, useState } from 'react'
import Link from 'next/link'
import { trpc } from '@/lib/trpc'
import { SpanWaterfall } from '@/components/trace/span-waterfall'
import { SpanAttributes } from '@/components/trace/span-attributes'
import { formatDuration, formatTokens, formatCost } from '@/lib/format'

const STATUS_COLORS: Record<string, string> = {
  running: 'bg-blue-100 text-blue-800',
  success: 'bg-green-100 text-green-800',
  error: 'bg-red-100 text-red-800',
}

export default function TraceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null)

  const { data: trace, isLoading: traceLoading } = trpc.traces.get.useQuery(id, {
    refetchInterval: (query) => query.state.data?.status === 'running' ? 2000 : false,
  })
  const { data: spans = [], isLoading: spansLoading } = trpc.spans.listByTrace.useQuery(id, {
    refetchInterval: trace?.status === 'running' ? 2000 : false,
  })

  const selectedSpan = spans.find((s) => s.id === selectedSpanId)

  if (traceLoading || spansLoading) {
    return <div className="p-8 text-center text-gray-500">Loading...</div>
  }

  if (!trace) {
    return <div className="p-8 text-center text-gray-500">Trace not found</div>
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-6">
          <Link href="/traces" className="text-sm text-blue-600 dark:text-blue-400 hover:underline mb-2 inline-block">
            ← Back to traces
          </Link>
          <div className="flex items-start justify-between">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{trace.name}</h1>
            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[trace.status]}`}>
              {trace.status === 'running' && (
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
              )}
              {trace.status}
            </span>
          </div>
          <div className="flex gap-4 mt-2 text-sm text-gray-500">
            <span>{formatDuration(trace.startTime, trace.endTime)}</span>
            <span>{formatTokens(trace.totalTokens)} tokens</span>
            <span>{formatCost(trace.totalCostUsd)}</span>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-4 border-b border-gray-200 dark:border-gray-700">
          <span className="px-4 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400">
            Waterfall
          </span>
          <Link
            href={`/traces/${id}/graph`}
            className="px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          >
            Graph
          </Link>
        </div>

        {/* Two-panel layout */}
        <div className="flex gap-4">
          <div className="flex-1 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <SpanWaterfall
              spans={spans}
              selectedSpanId={selectedSpanId}
              onSelectSpan={setSelectedSpanId}
            />
          </div>

          {selectedSpan && (
            <div className="w-80 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shrink-0">
              <SpanAttributes span={selectedSpan} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
