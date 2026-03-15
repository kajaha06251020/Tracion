'use client'

import { trpc } from '@/lib/trpc'
import { formatCost, formatDuration, formatRelativeTime } from '@/lib/format'
import Link from 'next/link'

function StatCard({
  label,
  value,
  sub,
  color,
}: {
  label: string
  value: string | number
  sub?: string
  color?: string
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-5">
      <div className="text-sm font-medium text-gray-500 dark:text-gray-400">{label}</div>
      <div className={`mt-1 text-3xl font-bold tabular-nums ${color ?? 'text-gray-900 dark:text-white'}`}>
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-gray-400">{sub}</div>}
    </div>
  )
}

const STATUS_COLORS: Record<string, string> = {
  running: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  success: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  error: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
}

export default function DashboardPage() {
  const { data: stats, isLoading: statsLoading } = trpc.traces.stats.useQuery()
  const { data: recent, isLoading: recentLoading } = trpc.traces.list.useQuery({ limit: 5 })

  const recentTraces = recent?.items ?? []

  const errorRate =
    stats && stats.total > 0
      ? ((stats.error / stats.total) * 100).toFixed(1)
      : '0.0'

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Dashboard</h1>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {statsLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-5 animate-pulse">
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-24 mb-2" />
              <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-16" />
            </div>
          ))
        ) : (
          <>
            <StatCard
              label="Total Traces"
              value={stats?.total ?? 0}
              sub="all time"
            />
            <StatCard
              label="Success"
              value={stats?.success ?? 0}
              color="text-green-600 dark:text-green-400"
              sub={stats && stats.total > 0 ? `${((stats.success / stats.total) * 100).toFixed(1)}%` : undefined}
            />
            <StatCard
              label="Errors"
              value={stats?.error ?? 0}
              color={stats && stats.error > 0 ? 'text-red-600 dark:text-red-400' : undefined}
              sub={`${errorRate}% error rate`}
            />
            <StatCard
              label="Total Cost"
              value={formatCost(stats?.totalCostUsd ?? '0')}
              sub={stats?.avgDurationMs ? `avg ${formatDuration(new Date(0), new Date(stats.avgDurationMs))}` : undefined}
            />
          </>
        )}
      </div>

      {/* Running traces badge */}
      {stats && stats.running > 0 && (
        <div className="mb-6 flex items-center gap-2 px-4 py-3 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg text-sm text-blue-700 dark:text-blue-300">
          <span className="inline-block w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
          <span><strong>{stats.running}</strong> trace{stats.running !== 1 ? 's' : ''} currently running</span>
          <Link href="/traces?status=running" className="ml-auto underline hover:no-underline">View →</Link>
        </div>
      )}

      {/* Recent traces */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">Recent Traces</h2>
          <Link href="/traces" className="text-sm text-blue-600 dark:text-blue-400 hover:underline">
            View all →
          </Link>
        </div>

        {recentLoading ? (
          <div className="px-5 py-8 text-center text-sm text-gray-500">Loading...</div>
        ) : recentTraces.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <p className="text-sm text-gray-500 dark:text-gray-400">No traces yet.</p>
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
              Send a trace using the SDK or cURL to get started.
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900 text-xs">
              <tr>
                {['Name', 'Agent', 'Status', 'Duration', 'Cost', 'Time'].map((h) => (
                  <th key={h} className="text-left px-5 py-3 font-medium text-gray-500 dark:text-gray-400">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {recentTraces.map((trace) => (
                <tr key={trace.id} className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                  <td className="px-5 py-3 font-medium">
                    <Link href={`/traces/${trace.id}`} className="text-blue-600 dark:text-blue-400 hover:underline">
                      {trace.name}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-gray-500 dark:text-gray-400">{trace.agentId}</td>
                  <td className="px-5 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[trace.status]}`}>
                      {trace.status}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-gray-500 tabular-nums">
                    {formatDuration(trace.startTime, trace.endTime)}
                  </td>
                  <td className="px-5 py-3 text-gray-500 tabular-nums">
                    {formatCost(trace.totalCostUsd)}
                  </td>
                  <td className="px-5 py-3 text-gray-400 tabular-nums">
                    {formatRelativeTime(trace.startTime)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
