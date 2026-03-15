'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { trpc } from '@/lib/trpc'
import { formatDuration, formatTokens, formatCost, formatRelativeTime } from '@/lib/format'
import Link from 'next/link'

type StatusFilter = 'all' | 'running' | 'success' | 'error'
type DateRange = 'hour' | 'day' | 'week' | 'custom'

const STATUS_COLORS: Record<string, string> = {
  running: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  success: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  error: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
}

function dateRangeToSince(range: DateRange): string | undefined {
  const now = Date.now()
  if (range === 'hour') return new Date(now - 60 * 60 * 1000).toISOString()
  if (range === 'day') return new Date(now - 24 * 60 * 60 * 1000).toISOString()
  if (range === 'week') return new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString()
  return undefined
}

export default function TracesPage() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [agentFilter, setAgentFilter] = useState('')
  const [dateRange, setDateRange] = useState<DateRange>('day')

  const bottomRef = useRef<HTMLDivElement>(null)

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } =
    trpc.traces.list.useInfiniteQuery(
      {
        limit: 20,
        status: statusFilter === 'all' ? undefined : statusFilter,
        agentId: agentFilter || undefined,
        since: dateRangeToSince(dateRange),
      },
      {
        getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
        refetchInterval: (query) => {
          // Auto-refresh every 5s if any running traces are visible
          const pages = query.state.data?.pages ?? []
          const hasRunning = pages.some((p) =>
            p.items.some((t) => t.status === 'running')
          )
          return hasRunning ? 5000 : false
        },
      }
    )

  const traces = data?.pages.flatMap((p) => p.items) ?? []

  // Infinite scroll via Intersection Observer
  const onIntersect = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  useEffect(() => {
    const el = bottomRef.current
    if (!el) return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) onIntersect()
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [onIntersect])

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex items-center gap-3 mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Traces</h1>
          {traces.some((t) => t.status === 'running') && (
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
              Live
            </span>
          )}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-6">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
          >
            <option value="all">All status</option>
            <option value="running">Running</option>
            <option value="success">Success</option>
            <option value="error">Error</option>
          </select>

          <input
            type="text"
            placeholder="Filter by agent ID"
            value={agentFilter}
            onChange={(e) => setAgentFilter(e.target.value)}
            className="px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm w-48"
          />

          <select
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value as DateRange)}
            className="px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
          >
            <option value="hour">Last hour</option>
            <option value="day">Last 24h</option>
            <option value="week">Last 7 days</option>
            <option value="custom">All time</option>
          </select>
        </div>

        {/* Table */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
              <tr>
                {['Name', 'Agent', 'Status', 'Duration', 'Tokens', 'Cost', 'Time'].map((h) => (
                  <th key={h} className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {isLoading && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-500">Loading...</td>
                </tr>
              )}
              {traces.map((trace) => (
                <tr key={trace.id} className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                  <td className="px-4 py-3 font-medium">
                    <Link href={`/traces/${trace.id}`} className="text-blue-600 dark:text-blue-400 hover:underline">
                      {trace.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{trace.agentId}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[trace.status]}`}>
                      {trace.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400 tabular-nums">
                    {formatDuration(trace.startTime, trace.endTime)}
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400 tabular-nums">
                    {formatTokens(trace.totalTokens)}
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400 tabular-nums">
                    {formatCost(trace.totalCostUsd)}
                  </td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-500">
                    {formatRelativeTime(trace.startTime)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div ref={bottomRef} className="h-4" />
          {isFetchingNextPage && (
            <div className="px-4 py-3 text-center text-sm text-gray-500">Loading more...</div>
          )}
        </div>
      </div>
    </div>
  )
}
