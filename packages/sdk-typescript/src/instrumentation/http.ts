import type { Tracer } from '@opentelemetry/api'
import { SpanStatusCode } from '@opentelemetry/api'

const LLM_ENDPOINTS = [
  { host: 'api.anthropic.com', provider: 'anthropic' },
  { host: 'api.openai.com', provider: 'openai' },
] as const

type LlmEndpoint = typeof LLM_ENDPOINTS[number]

let originalFetch: typeof globalThis.fetch | undefined

function getUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

function detectEndpoint(url: string): LlmEndpoint | undefined {
  return LLM_ENDPOINTS.find((e) => url.includes(e.host))
}

function extractModel(body: unknown): string | undefined {
  if (typeof body !== 'string') return undefined
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>
    return typeof parsed['model'] === 'string' ? parsed['model'] : undefined
  } catch {
    return undefined
  }
}

function extractTokens(
  data: unknown,
  provider: string
): { inputTokens?: number; outputTokens?: number } {
  const d = data as Record<string, unknown>
  const usage = d?.['usage'] as Record<string, unknown> | undefined
  if (!usage) return {}

  if (provider === 'anthropic') {
    const result: { inputTokens?: number; outputTokens?: number } = {}
    if (typeof usage['input_tokens'] === 'number') result.inputTokens = usage['input_tokens']
    if (typeof usage['output_tokens'] === 'number') result.outputTokens = usage['output_tokens']
    return result
  }
  if (provider === 'openai') {
    const result: { inputTokens?: number; outputTokens?: number } = {}
    if (typeof usage['prompt_tokens'] === 'number') result.inputTokens = usage['prompt_tokens']
    if (typeof usage['completion_tokens'] === 'number') result.outputTokens = usage['completion_tokens']
    return result
  }
  return {}
}

export function patchFetch(tracer: Tracer): void {
  if (!originalFetch) {
    originalFetch = globalThis.fetch
  }

  const original = originalFetch

  globalThis.fetch = async function patchedFetch(
    input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> {
    const url = getUrl(input)
    const endpoint = detectEndpoint(url)

    if (!endpoint) {
      return original(input, init)
    }

    const span = tracer.startSpan(`${endpoint.provider}.request`)
    span.setAttribute('traceforge.kind', 'llm')
    span.setAttribute('llm.provider', endpoint.provider)

    const model = extractModel(init?.body)
    if (model) span.setAttribute('llm.model', model)

    try {
      const response = await original(input, init)

      // レスポンスを複製してトークン情報を非同期で抽出（元のレスポンスは消費しない）
      const clone = response.clone()
      clone.json().then((data: unknown) => {
        const { inputTokens, outputTokens } = extractTokens(data, endpoint.provider)
        if (inputTokens !== undefined) span.setAttribute('llm.input_tokens', inputTokens)
        if (outputTokens !== undefined) span.setAttribute('llm.output_tokens', outputTokens)
        span.setStatus({ code: SpanStatusCode.OK })
        span.end()
      }).catch(() => {
        span.setStatus({ code: SpanStatusCode.OK }) // ボディ解析失敗でもリクエスト成功
        span.end()
      })

      return response
    } catch (e) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: e instanceof Error ? e.message : String(e),
      })
      span.end()
      throw e
    }
  }
}

export function unpatchFetch(): void {
  if (originalFetch) {
    globalThis.fetch = originalFetch
    originalFetch = undefined
  }
}
