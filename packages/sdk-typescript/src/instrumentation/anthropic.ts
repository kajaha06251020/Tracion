import type { Tracer } from '@opentelemetry/api'
import { SpanStatusCode } from '@opentelemetry/api'
import shimmer from 'shimmer'

type AnthropicMessagesCreate = (params: {
  model: string
  messages: unknown[]
  max_tokens: number
  [key: string]: unknown
}) => Promise<{
  model: string
  usage: { input_tokens: number; output_tokens: number } | null | undefined
  [key: string]: unknown
}>

type AnthropicLike = {
  messages: { create: AnthropicMessagesCreate }
}

export function patchAnthropic(tracer: Tracer, client: AnthropicLike | undefined): void {
  if (!client) return

  shimmer.wrap(client.messages, 'create', (original: AnthropicMessagesCreate) => {
    return async function patchedCreate(
      this: unknown,
      params: Parameters<AnthropicMessagesCreate>[0]
    ): Promise<Awaited<ReturnType<AnthropicMessagesCreate>>> {
      const span = tracer.startSpan('anthropic.messages.create')
      span.setAttribute('tracion.kind', 'llm')
      span.setAttribute('llm.provider', 'anthropic')
      span.setAttribute('llm.model', params.model)

      try {
        const result = await original.call(this, params)
        if (result.usage) {
          span.setAttribute('llm.input_tokens', result.usage.input_tokens)
          span.setAttribute('llm.output_tokens', result.usage.output_tokens)
        }
        span.setStatus({ code: SpanStatusCode.OK })
        span.end()
        return result
      } catch (e) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: e instanceof Error ? e.message : String(e),
        })
        span.end()
        throw e
      }
    }
  })
}

/** Anthropic SDK インスタンスを自動検出してパッチする */
export function tryPatchAnthropic(tracer: Tracer): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Anthropic } = require('@anthropic-ai/sdk') as { Anthropic: new () => AnthropicLike }
    const proto = Anthropic.prototype as unknown as AnthropicLike
    patchAnthropic(tracer, proto)
  } catch {
    // @anthropic-ai/sdk がインストールされていない場合はスキップ
  }
}
