'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc'
import { formatCost, formatTokens, formatRelativeTime } from '@/lib/format'

const RANGE_OPTIONS = [
  { label: '7 days', value: 7 },
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
]

export default function PullRequestsPage() {
  const [days, setDays] = useState(30)
  const { data, isLoading } = trpc.traces.prCosts.useQuery({ days })

  const totalCost = data?.reduce((s, r) => s + parseFloat(r.totalCostUsd), 0) ?? 0
  const totalPRs = data?.length ?? 0
  const totalTraces = data?.reduce((s, r) => s + r.traceCount, 0) ?? 0

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Pull Requests</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Agent cost per pull request</p>
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
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: `PRs with agent activity (${days}d)`, value: String(totalPRs) },
          { label: `Total PR cost (${days}d)`, value: formatCost(totalCost) },
          { label: `Total traces (${days}d)`, value: String(totalTraces) },
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
        <div className="py-16 text-center text-sm text-gray-400">Loading PR data...</div>
      ) : !data || data.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-sm text-gray-400">No PR-linked traces found in the last {days} days.</p>
          <p className="text-xs text-gray-500 mt-2">
            PR tracking is automatic when agents run on branches with open pull requests.
          </p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700 text-left">
                <th className="px-5 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Pull Request
                </th>
                <th className="px-5 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider text-right">
                  Cost
                </th>
                <th className="px-5 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider text-right">
                  Tokens
                </th>
                <th className="px-5 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider text-right">
                  Traces
                </th>
                <th className="px-5 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Agents
                </th>
                <th className="px-5 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider text-right">
                  Last active
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {data.map((pr) => (
                <tr key={`${pr.repository}#${pr.prNumber}`} className="hover:bg-gray-50 dark:hover:bg-gray-750">
                  <td className="px-5 py-3">
                    <a
                      href={pr.prUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
                    >
                      {pr.repository}#{pr.prNumber}
                    </a>
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums font-medium text-gray-900 dark:text-white">
                    {formatCost(pr.totalCostUsd)}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums text-gray-600 dark:text-gray-300">
                    {formatTokens(pr.totalTokens)}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums text-gray-600 dark:text-gray-300">
                    {pr.traceCount}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex flex-wrap gap-1">
                      {pr.agents.map((agent) => (
                        <span
                          key={agent}
                          className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
                        >
                          {agent}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-right text-xs text-gray-400">
                    {pr.lastTraceAt ? formatRelativeTime(pr.lastTraceAt) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
