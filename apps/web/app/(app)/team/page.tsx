'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc'
import { formatCost, formatTokens, formatRelativeTime } from '@/lib/format'

const RANGE_OPTIONS = [
  { label: '7 days', value: 7 },
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
]

function StatusDot({ status }: { status: 'good' | 'warn' | 'error' }) {
  const colors = {
    good: 'bg-green-400',
    warn: 'bg-yellow-400',
    error: 'bg-red-400',
  }
  return <span className={`inline-block w-2 h-2 rounded-full ${colors[status]}`} />
}

function AgentCard({
  agent,
}: {
  agent: {
    agentId: string
    traceCount: number
    successCount: number
    errorCount: number
    totalCostUsd: string
    totalTokens: number
    avgDurationMs: number
    lastActiveAt: string | null
  }
}) {
  const errorRate = agent.traceCount > 0 ? agent.errorCount / agent.traceCount : 0
  const healthStatus = errorRate > 0.3 ? 'error' : errorRate > 0.1 ? 'warn' : 'good'
  const avgDuration = agent.avgDurationMs >= 60000
    ? `${Math.floor(agent.avgDurationMs / 60000)}m ${Math.floor((agent.avgDurationMs % 60000) / 1000)}s`
    : `${Math.floor(agent.avgDurationMs / 1000)}s`

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <StatusDot status={healthStatus} />
          <h3 className="font-semibold text-gray-900 dark:text-white truncate">{agent.agentId}</h3>
        </div>
        {agent.lastActiveAt && (
          <span className="text-xs text-gray-400">{formatRelativeTime(agent.lastActiveAt)}</span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <div className="text-xs text-gray-500 dark:text-gray-400">Cost</div>
          <div className="font-semibold tabular-nums text-gray-900 dark:text-white">
            {formatCost(agent.totalCostUsd)}
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-500 dark:text-gray-400">Tokens</div>
          <div className="font-semibold tabular-nums text-gray-900 dark:text-white">
            {formatTokens(agent.totalTokens)}
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-500 dark:text-gray-400">Traces</div>
          <div className="font-semibold tabular-nums text-gray-900 dark:text-white">
            {agent.traceCount}
            {agent.errorCount > 0 && (
              <span className="text-red-400 ml-1 text-xs">({agent.errorCount} err)</span>
            )}
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-500 dark:text-gray-400">Avg duration</div>
          <div className="font-semibold tabular-nums text-gray-900 dark:text-white">
            {avgDuration}
          </div>
        </div>
      </div>
    </div>
  )
}

function DailyCostChart({ rows }: { rows: { date: string; totalCostUsd: string; traceCount: number }[] }) {
  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-gray-400">No data for this period.</p>
  }
  const max = Math.max(...rows.map((r) => parseFloat(r.totalCostUsd) || 0))
  return (
    <div className="flex items-end gap-1 h-40">
      {rows.map((row) => {
        const value = parseFloat(row.totalCostUsd) || 0
        const pct = max > 0 ? (value / max) * 100 : 0
        const label = row.date.slice(5) // "MM-DD"
        return (
          <div key={row.date} className="flex-1 flex flex-col items-center gap-1 group relative">
            <div className="absolute bottom-full mb-1 hidden group-hover:flex flex-col items-center pointer-events-none z-10">
              <div className="bg-gray-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap">
                {row.date}<br />{formatCost(row.totalCostUsd)} · {row.traceCount} traces
              </div>
              <div className="w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900" />
            </div>
            <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-t overflow-hidden" style={{ height: '120px' }}>
              <div
                className="w-full bg-indigo-500 rounded-t transition-all"
                style={{ height: `${Math.max(pct, value > 0 ? 4 : 0)}%`, marginTop: 'auto' }}
              />
            </div>
            <span className="text-xs text-gray-400 rotate-45 origin-left">{label}</span>
          </div>
        )
      })}
    </div>
  )
}

export default function TeamPage() {
  const [days, setDays] = useState(30)
  const { data, isLoading } = trpc.traces.teamStats.useQuery({ days })

  const totalCost = data?.agents.reduce((s, r) => s + parseFloat(r.totalCostUsd), 0) ?? 0
  const totalTraces = data?.agents.reduce((s, r) => s + r.traceCount, 0) ?? 0
  const totalTokens = data?.agents.reduce((s, r) => s + r.totalTokens, 0) ?? 0
  const agentCount = data?.agents.length ?? 0

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Team</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Agent activity and cost breakdown</p>
        </div>
        <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setDays(opt.value)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                days === opt.value
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Active agents', value: String(agentCount) },
          { label: `Total cost (${days}d)`, value: formatCost(totalCost) },
          { label: `Total traces (${days}d)`, value: String(totalTraces) },
          { label: `Total tokens (${days}d)`, value: formatTokens(totalTokens) },
        ].map(({ label, value }) => (
          <div key={label} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
            <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
            <div className="mt-1 text-2xl font-bold tabular-nums text-gray-900 dark:text-white">
              {isLoading ? <span className="animate-pulse">—</span> : value}
            </div>
          </div>
        ))}
      </div>

      {isLoading ? (
        <div className="py-16 text-center text-sm text-gray-400">Loading team data...</div>
      ) : (
        <div className="space-y-6">
          {/* Daily cost chart */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
            <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                Daily team cost — last {days} days
              </h2>
            </div>
            <div className="p-5">
              <DailyCostChart rows={data?.dailyCost ?? []} />
            </div>
          </div>

          {/* Agent grid */}
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-3">
              Agents ({agentCount})
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {data?.agents.map((agent) => (
                <AgentCard key={agent.agentId} agent={agent} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
