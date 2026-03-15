'use client'

import { use } from 'react'
import Link from 'next/link'
import { trpc } from '@/lib/trpc'
import { spansToGraph } from '@/lib/spans-to-graph'
import { AgentGraph } from '@/components/graph/agent-graph'

export default function TraceGraphPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)

  const { data: spans = [], isLoading } = trpc.spans.listByTrace.useQuery(id)

  if (isLoading) {
    return <div className="p-8 text-center text-gray-500">Loading graph...</div>
  }

  const { nodes, edges } = spansToGraph(spans)

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-6">
          <Link href={`/traces/${id}`} className="text-sm text-blue-600 dark:text-blue-400 hover:underline mb-2 inline-block">
            ← Back to waterfall
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Agent Graph</h1>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-4 border-b border-gray-200 dark:border-gray-700">
          <Link
            href={`/traces/${id}`}
            className="px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          >
            Waterfall
          </Link>
          <span className="px-4 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400">
            Graph
          </span>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          <AgentGraph initialNodes={nodes} initialEdges={edges} spans={spans} />
        </div>
      </div>
    </div>
  )
}
