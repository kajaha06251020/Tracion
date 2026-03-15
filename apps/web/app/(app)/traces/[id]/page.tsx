'use client'

import { use, useState, useEffect } from 'react'
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
  const [shareToken, setShareToken] = useState<string | null>(null)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null)

  const { data: trace, isLoading: traceLoading } = trpc.traces.get.useQuery(id, {
    refetchInterval: (query) => query.state.data?.status === 'running' ? 2000 : false,
  })
  const { data: spans = [], isLoading: spansLoading } = trpc.spans.listByTrace.useQuery(id, {
    refetchInterval: trace?.status === 'running' ? 2000 : false,
  })

  const selectedSpan = spans.find((s) => s.id === selectedSpanId)

  useEffect(() => {
    if (trace?.shareToken !== undefined) {
      setShareToken(trace.shareToken ?? null)
    }
  }, [trace?.shareToken])

  function copyToClipboard(url: string) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url)
        .then(() => {
          setCopied(true)
          setFallbackUrl(null)
          setTimeout(() => setCopied(false), 2000)
        })
        .catch(() => {
          setFallbackUrl(url)
        })
    } else {
      setFallbackUrl(url)
    }
  }

  const createShare = trpc.traces.createShareLink.useMutation({
    onSuccess: ({ token, shareUrl: url }) => {
      setShareToken(token)
      setShareUrl(url)
      copyToClipboard(url)
    },
  })

  const revokeShare = trpc.traces.revokeShareLink.useMutation({
    onSuccess: () => {
      setShareToken(null)
      setShareUrl(null)
      setFallbackUrl(null)
    },
  })

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
            <div className="flex flex-col items-end gap-1">
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[trace.status]}`}>
                  {trace.status === 'running' && (
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                  )}
                  {trace.status}
                </span>
                {!shareToken ? (
                  <button
                    onClick={() => createShare.mutate({ traceId: id })}
                    disabled={createShare.isPending}
                    className="text-xs px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                  >
                    {createShare.isPending ? 'Sharing...' : 'Share'}
                  </button>
                ) : (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        const url = shareUrl ?? `${process.env.NEXT_PUBLIC_WEB_URL ?? 'http://localhost:3000'}/share/${shareToken}`
                        copyToClipboard(url)
                      }}
                      className="text-xs px-3 py-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
                    >
                      {copied ? 'Copied!' : 'Copy link'}
                    </button>
                    <button
                      onClick={() => revokeShare.mutate({ traceId: id })}
                      disabled={revokeShare.isPending}
                      className="text-xs px-3 py-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded disabled:opacity-50"
                    >
                      Revoke
                    </button>
                  </div>
                )}
              </div>
              {fallbackUrl && (
                <div className="flex items-center gap-1 mt-1">
                  <input
                    type="text"
                    readOnly
                    value={fallbackUrl}
                    className="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded w-64 select-all"
                    onFocus={(e) => e.target.select()}
                  />
                  <button
                    onClick={() => setFallbackUrl(null)}
                    className="text-xs text-gray-400 hover:text-gray-600 px-1"
                    aria-label="Dismiss"
                  >
                    x
                  </button>
                </div>
              )}
            </div>
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
