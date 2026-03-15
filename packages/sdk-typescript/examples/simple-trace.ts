/**
 * simple-trace.ts — Tracion TypeScript SDK のサンプル
 *
 * 使い方:
 *   # Docker Compose を起動してから実行
 *   bun run examples/simple-trace.ts
 *
 * 実行すると 3 つのスパン（agent → llm + tool）を含むトレースが
 * Tracion API に送信され、ダッシュボード (/traces) に表示されます。
 */

import { tracion } from '../src/index'

// ── SDK の初期化 ──────────────────────────────────────────────────────────────
tracion.init({
  endpoint: process.env.TRACION_API_URL ?? 'http://localhost:3001',
  apiKey: process.env.TRACION_API_KEY,
  agentId: 'example-agent',
  sessionId: `session-${Date.now()}`,
})

// ── シミュレート: LLM + ツール呼び出しを含むエージェント実行 ──────────────────
async function main(): Promise<void> {
  await tracion.trace('generate_and_search', async (rootSpan) => {
    rootSpan.setInput({ task: 'Find and summarize recent AI news' })

    // Step 1: LLM 呼び出し（検索クエリ生成）
    await tracion.trace('llm_generate_query', async (llmSpan) => {
      llmSpan.setInput({ prompt: 'Generate a search query for recent AI news' })
      // 実際のアプリでは ここで Anthropic / OpenAI SDK を呼ぶ
      await sleep(50)
      llmSpan.setOutput({ query: 'latest AI research 2026' })
      llmSpan.setAttribute('tracion.model', 'claude-opus-4-6')
      llmSpan.setAttribute('tracion.input_tokens', 128)
      llmSpan.setAttribute('tracion.output_tokens', 32)
    }, { kind: 'llm' })

    // Step 2: ツール呼び出し（ウェブ検索）
    await tracion.trace('tool_web_search', async (toolSpan) => {
      toolSpan.setInput({ query: 'latest AI research 2026' })
      await sleep(100)
      toolSpan.setOutput({ results: ['Result A', 'Result B', 'Result C'] })
      toolSpan.setAttribute('tracion.tool_name', 'web_search')
    }, { kind: 'tool' })

    rootSpan.setOutput({ summary: 'Found 3 results about recent AI developments.' })
  }, { kind: 'agent' })

  // BatchSpanProcessor がバックグラウンドでエクスポートするまで少し待つ
  await sleep(6000)
  console.log('Trace sent. Open http://localhost:3000/traces to view it.')
  process.exit(0)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
