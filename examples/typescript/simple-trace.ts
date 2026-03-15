/**
 * TypeScript SDK — simple trace example
 *
 * Usage:
 *   cd examples/typescript
 *   bun run simple-trace.ts
 *
 * Requires Tracion API running at http://localhost:3001
 * Start with: docker compose up
 */

import { tracion } from '../../packages/sdk-typescript/src/index'

tracion.init({
  endpoint: process.env.TRACION_API_URL ?? 'http://localhost:3001',
  apiKey: process.env.TRACION_API_KEY,
  agentId: 'example-agent',
  sessionId: `session-${Date.now()}`,
})

async function main() {
  console.log('Sending trace to Tracion...')

  await tracion.trace('research_and_summarize', async (rootSpan) => {
    rootSpan.setInput({ task: 'Summarize recent TypeScript releases' })

    // Simulate an LLM call
    await tracion.trace('llm_plan', async (span) => {
      span.setInput({ prompt: 'Create a research plan' })
      await sleep(80)
      span.setOutput({ steps: ['search', 'read', 'summarize'] })
      span.setAttribute('tracion.model', 'claude-opus-4-6')
      span.setAttribute('tracion.input_tokens', 256)
      span.setAttribute('tracion.output_tokens', 64)
    }, { kind: 'llm' })

    // Simulate a tool call
    await tracion.trace('tool_search', async (span) => {
      span.setInput({ query: 'TypeScript 5.6 release notes' })
      await sleep(120)
      span.setOutput({ results: 3, topResult: 'TypeScript 5.6 adds...' })
      span.setAttribute('tracion.tool_name', 'web_search')
    }, { kind: 'tool' })

    // Simulate final LLM summarization
    await tracion.trace('llm_summarize', async (span) => {
      span.setInput({ context: '3 search results' })
      await sleep(200)
      span.setOutput({ summary: 'TypeScript 5.6 improves...' })
      span.setAttribute('tracion.model', 'claude-opus-4-6')
      span.setAttribute('tracion.input_tokens', 1024)
      span.setAttribute('tracion.output_tokens', 256)
    }, { kind: 'llm' })

    rootSpan.setOutput({ summary: 'TypeScript 5.6 improves type inference and...' })
  }, { kind: 'agent' })

  // Wait for BatchSpanProcessor to flush
  await sleep(6000)
  console.log('✓ Trace sent! Open http://localhost:3000/traces to view it.')
  process.exit(0)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

main().catch(err => { console.error(err); process.exit(1) })
