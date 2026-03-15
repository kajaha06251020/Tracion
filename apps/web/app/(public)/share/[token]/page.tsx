import { formatDuration, formatTokens, formatCost } from '@/lib/format'
import { SharePanels } from './share-panels'

type SharePageProps = {
  params: Promise<{ token: string }>
}

type PublicSpan = {
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

type PublicTrace = {
  id: string
  name: string
  agentId: string
  status: 'running' | 'success' | 'error'
  startTime: string
  endTime: string | null
  totalTokens: number
  totalCostUsd: string
}

async function getSharedTrace(
  token: string
): Promise<{ trace: PublicTrace; spans: PublicSpan[] } | null> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'
  const res = await fetch(
    `${apiUrl}/api/public/traces/${token}`,
    { cache: 'no-store' }
  )
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Unexpected API error: ${res.status}`)
  const json = await res.json() as { success: true; data: { trace: PublicTrace; spans: PublicSpan[] } }
  return json.data
}

const STATUS_COLORS: Record<string, string> = {
  running: 'bg-blue-100 text-blue-800',
  success: 'bg-green-100 text-green-800',
  error: 'bg-red-100 text-red-800',
}

export default async function SharePage({ params }: SharePageProps) {
  const { token } = await params
  const data = await getSharedTrace(token).catch(() => null)

  if (!data) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <h1 className="text-xl font-semibold text-gray-200 mb-2">
            This trace is no longer available
          </h1>
          <p className="text-gray-400 text-sm">
            The share link may have been revoked.
          </p>
        </div>
      </div>
    )
  }

  const { trace, spans } = data

  return (
    <div className="min-h-screen">
      <div className="border-b border-gray-800 px-6 py-4">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-gray-500 mb-1">Shared trace</div>
              <h1 className="text-lg font-semibold text-white">{trace.name}</h1>
              <div className="flex gap-3 mt-1 text-sm text-gray-400">
                <span>{formatDuration(trace.startTime, trace.endTime)}</span>
                <span>{formatTokens(trace.totalTokens)} tokens</span>
                <span>{formatCost(trace.totalCostUsd)}</span>
              </div>
            </div>
            <span
              className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[trace.status]}`}
            >
              {trace.status}
            </span>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        <SharePanels spans={spans} />
      </div>

      <div className="text-center pb-8 text-xs text-gray-600">
        Powered by{' '}
        <a
          href="https://github.com/kajaha06251020/Tracion"
          className="underline hover:text-gray-400"
          target="_blank"
          rel="noopener noreferrer"
        >
          Tracion
        </a>
      </div>
    </div>
  )
}
