import type {
  ApiClientConfig,
  ListTracesResult,
  Trace,
  TraceWithSpans,
} from './types'

type ListTracesInput = {
  limit?: number
  cursor?: string
  agentId?: string
  status?: 'running' | 'success' | 'error'
  since?: string
}

type SearchTracesInput = {
  query: string
  limit?: number
  agentId?: string
  status?: 'running' | 'success' | 'error'
  since?: string
  until?: string
}

async function trpcQuery<T>(
  config: ApiClientConfig,
  procedure: string,
  input: unknown
): Promise<T> {
  const url = `${config.baseUrl}/trpc/${procedure}?input=${encodeURIComponent(JSON.stringify(input))}`
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (config.apiKey) headers['X-Traceforge-Api-Key'] = config.apiKey

  const res = await fetch(url, { headers })
  const json = await res.json() as {
    result?: { data: T }
    error?: { message: string; data?: { code: string } }
  }

  if (!res.ok || json.error) {
    throw new Error(json.error?.message ?? `HTTP ${res.status}`)
  }
  return json.result!.data
}

export type ApiClient = {
  listTraces(input: ListTracesInput): Promise<ListTracesResult>
  getTrace(traceId: string): Promise<TraceWithSpans>
  searchTraces(input: SearchTracesInput): Promise<Trace[]>
}

export function createApiClient(config: ApiClientConfig): ApiClient {
  return {
    listTraces: (input) =>
      trpcQuery<ListTracesResult>(config, 'traces.list', input),

    getTrace: (traceId) =>
      trpcQuery<TraceWithSpans>(config, 'traces.get', traceId),

    searchTraces: (input) =>
      trpcQuery<Trace[]>(config, 'traces.search', input),
  }
}
