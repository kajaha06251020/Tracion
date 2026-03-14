import type { Tracer } from '@opentelemetry/api'
import { SpanStatusCode } from '@opentelemetry/api'
import shimmer from 'shimmer'

type OpenAICompletionsCreate = (params: {
  model: string
  messages: unknown[]
  [key: string]: unknown
}) => Promise<{
  model: string
  usage: { prompt_tokens: number; completion_tokens: number } | null | undefined
  [key: string]: unknown
}>

type OpenAILike = {
  chat: { completions: { create: OpenAICompletionsCreate } }
}

export function patchOpenAI(tracer: Tracer, client: OpenAILike | undefined): void {
  if (!client) return

  shimmer.wrap(client.chat.completions, 'create', (original: OpenAICompletionsCreate) => {
    return async function patchedCreate(
      this: unknown,
      params: Parameters<OpenAICompletionsCreate>[0]
    ): Promise<Awaited<ReturnType<OpenAICompletionsCreate>>> {
      const span = tracer.startSpan('openai.chat.completions.create')
      span.setAttribute('traceforge.kind', 'llm')
      span.setAttribute('llm.provider', 'openai')
      span.setAttribute('llm.model', params.model)

      try {
        const result = await original.call(this, params)
        if (result.usage) {
          span.setAttribute('llm.input_tokens', result.usage.prompt_tokens)
          span.setAttribute('llm.output_tokens', result.usage.completion_tokens)
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

/** OpenAI SDK インスタンスを自動検出してパッチする */
export function tryPatchOpenAI(tracer: Tracer): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { OpenAI } = require('openai') as { OpenAI: new () => OpenAILike }
    const proto = OpenAI.prototype as unknown as OpenAILike
    patchOpenAI(tracer, proto)
  } catch {
    // openai がインストールされていない場合はスキップ
  }
}
