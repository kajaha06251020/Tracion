'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc'
import { formatCost, formatTokens } from '@/lib/format'

const RANGE_OPTIONS = [
  { label: '7 days', value: 7 },
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
]

// Pure-CSS horizontal bar chart — no chart library needed
function BarChart({
  rows,
  labelKey,
  valueKey,
  formatValue,
  color,
}: {
  rows: Record<string, unknown>[]
  labelKey: string
  valueKey: string
  formatValue: (v: number) => string
  color: string
}) {
  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-gray-400">No data for this period.</p>
  }
  const max = Math.max(...rows.map((r) => parseFloat(String(r[valueKey])) || 0))
  return (
    <div className="space-y-2">
      {rows.map((row, i) => {
        const value = parseFloat(String(row[valueKey])) || 0
        const pct = max > 0 ? (value / max) * 100 : 0
        return (
          <div key={i} className="flex items-center gap-3 text-sm">
            <div className="w-36 shrink-0 truncate text-gray-600 dark:text-gray-300 text-right text-xs">
              {String(row[labelKey])}
            </div>
            <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-5 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${color}`}
                style={{ width: `${Math.max(pct, 2)}%` }}
              />
            </div>
            <div className="w-20 shrink-0 text-right tabular-nums text-gray-700 dark:text-gray-300 text-xs font-medium">
              {formatValue(value)}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Time-series bar chart (cost by day)
function TimeSeriesChart({ rows }: { rows: { date: string; totalCostUsd: string; traceCount: number }[] }) {
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
            {/* Tooltip */}
            <div className="absolute bottom-full mb-1 hidden group-hover:flex flex-col items-center pointer-events-none z-10">
              <div className="bg-gray-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap">
                {row.date}<br />{formatCost(row.totalCostUsd)} · {row.traceCount} traces
              </div>
              <div className="w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900" />
            </div>
            <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-t overflow-hidden" style={{ height: '120px' }}>
              <div
                className="w-full bg-blue-500 rounded-t transition-all"
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

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
      <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-base font-semibold text-gray-900 dark:text-white">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </div>
  )
}

export default function AnalyticsPage() {
  const [days, setDays] = useState(30)
  const { data, isLoading } = trpc.traces.analytics.useQuery({ days })

  const totalCost = data?.byAgent.reduce((s, r) => s + parseFloat(r.totalCostUsd), 0) ?? 0
  const totalTraces = data?.byAgent.reduce((s, r) => s + r.traceCount, 0) ?? 0
  const totalTokens = data?.byAgent.reduce((s, r) => s + r.totalTokens, 0) ?? 0

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Analytics</h1>
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

      {/* Summary row */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
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
        <div className="py-16 text-center text-sm text-gray-400">Loading analytics...</div>
      ) : (
        <div className="space-y-6">
          {/* Cost by day */}
          <SectionCard title={`Daily cost — last ${days} days`}>
            <TimeSeriesChart rows={data?.byDay ?? []} />
          </SectionCard>

          {/* Cost by agent */}
          <SectionCard title="Cost by agent">
            <BarChart
              rows={data?.byAgent ?? []}
              labelKey="agentId"
              valueKey="totalCostUsd"
              formatValue={(v) => formatCost(v)}
              color="bg-purple-500"
            />
          </SectionCard>

          {/* Traces by agent */}
          <SectionCard title="Traces by agent">
            <BarChart
              rows={data?.byAgent ?? []}
              labelKey="agentId"
              valueKey="traceCount"
              formatValue={(v) => String(Math.round(v))}
              color="bg-blue-500"
            />
          </SectionCard>

          {/* Tokens by agent */}
          <SectionCard title="Tokens by agent">
            <BarChart
              rows={data?.byAgent ?? []}
              labelKey="agentId"
              valueKey="totalTokens"
              formatValue={(v) => formatTokens(Math.round(v))}
              color="bg-green-500"
            />
          </SectionCard>
        </div>
      )}
    </div>
  )
}
