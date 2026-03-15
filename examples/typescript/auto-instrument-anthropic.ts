/**
 * TypeScript SDK — Anthropic auto-instrumentation example
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... bun run auto-instrument-anthropic.ts
 *
 * Auto-instrumentation patches the Anthropic SDK so every
 * messages.create() call is automatically traced.
 */

import Anthropic from '@anthropic-ai/sdk'
import { tracion } from '../../packages/sdk-typescript/src/index'
import { patchAnthropic } from '../../packages/sdk-typescript/src/instrumentation/anthropic'

const client = new Anthropic()

tracion.init({
  endpoint: process.env.TRACION_API_URL ?? 'http://localhost:3001',
  agentId: 'anthropic-example',
})

// One line to auto-instrument — all subsequent API calls are traced
patchAnthropic(client, tracion['sdk']!)

async function main() {
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 100,
    messages: [{ role: 'user', content: 'Say hello in one sentence.' }],
  })

  console.log(response.content[0])
  await new Promise(resolve => setTimeout(resolve, 6000))
  console.log('✓ Check http://localhost:3000/traces for the auto-traced call.')
  process.exit(0)
}

main().catch(err => { console.error(err); process.exit(1) })
