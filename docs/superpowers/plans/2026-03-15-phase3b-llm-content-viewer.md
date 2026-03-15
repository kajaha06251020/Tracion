# Phase 3B: LLM Content Viewer Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a span has `kind = "llm"`, the span attributes panel shows a "Messages" tab with conversation-style LLM prompt/response display.

**Architecture:** Pure frontend change. No backend modifications. Read `gen_ai.prompt` / `gen_ai.completion` from the existing `attributes` JSON. Render as chat bubbles with role-based styling.

**Tech Stack:** Next.js 15, React, TypeScript, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-03-15-phase3-feature-expansion.md` — Feature 2

**Current `SpanAttributes` structure (line 19-70 of `apps/web/components/trace/span-attributes.tsx`):**
- Uses `showRaw` boolean state (not a tab system)
- Has `data-testid="span-attributes"` on the root div
- Sections: title, grid of key metrics, events list, raw attributes toggle

---

## File Map

| Action | File | Purpose |
|--------|------|---------|
| Create | `apps/web/lib/parse-llm-messages.ts` | Pure function: extract messages from attributes |
| Create | `apps/web/lib/parse-llm-messages.test.ts` | Unit tests for parser |
| Create | `apps/web/components/trace/llm-messages.tsx` | Chat bubble message renderer |
| Modify | `apps/web/components/trace/span-attributes.tsx` | Add Messages tab for llm spans |

---

## Chunk 1: Message Parser (Pure Function)

### Task 1: Write and test the message parser

**Files:**
- Create: `apps/web/lib/parse-llm-messages.ts`
- Create: `apps/web/lib/parse-llm-messages.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// apps/web/lib/parse-llm-messages.test.ts
import { describe, it, expect } from 'vitest'
import { parseLlmMessages } from './parse-llm-messages'

describe('parseLlmMessages', () => {
  it('returns null for attributes with no message keys', () => {
    expect(parseLlmMessages({ 'some.other.key': 'value' })).toBeNull()
  })

  it('returns null for empty attributes', () => {
    expect(parseLlmMessages({})).toBeNull()
  })

  it('parses gen_ai.prompt and gen_ai.completion into ordered messages', () => {
    const attrs = {
      'gen_ai.prompt': JSON.stringify([
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hello!' },
      ]),
      'gen_ai.completion': JSON.stringify([
        { role: 'assistant', content: 'Hi there!' },
      ]),
    }
    const result = parseLlmMessages(attrs)
    expect(result).not.toBeNull()
    expect(result!.messages).toHaveLength(3)
    expect(result!.messages[0].role).toBe('system')
    expect(result!.messages[1].role).toBe('user')
    expect(result!.messages[2].role).toBe('assistant')
  })

  it('falls back to llm.input_messages when gen_ai.prompt absent', () => {
    const attrs = {
      'llm.input_messages': JSON.stringify([{ role: 'user', content: 'test' }]),
    }
    const result = parseLlmMessages(attrs)
    expect(result).not.toBeNull()
    expect(result!.messages[0].role).toBe('user')
  })

  it('returns null when JSON is invalid', () => {
    expect(parseLlmMessages({ 'gen_ai.prompt': 'not valid json' })).toBeNull()
  })

  it('handles tool role messages', () => {
    const attrs = {
      'gen_ai.prompt': JSON.stringify([
        { role: 'tool', content: '{"result": 42}', tool_call_id: 'call_1' },
      ]),
    }
    const result = parseLlmMessages(attrs)
    expect(result!.messages[0].role).toBe('tool')
    expect(result!.messages[0].toolCallId).toBe('call_1')
  })
})
```

- [ ] **Step 2: Run tests to confirm failure**

```bash
cd apps/web && bun run test lib/parse-llm-messages.test.ts
```

- [ ] **Step 3: Write the parser**

```typescript
// apps/web/lib/parse-llm-messages.ts

export type LlmMessage = {
  role: string
  content: string
  toolCallId?: string
}

export type ParsedLlmMessages = {
  messages: LlmMessage[]
}

export function parseLlmMessages(
  attributes: Record<string, unknown>
): ParsedLlmMessages | null {
  const inputKey = 'gen_ai.prompt' in attributes
    ? 'gen_ai.prompt'
    : 'llm.input_messages' in attributes
    ? 'llm.input_messages'
    : null

  const outputKey = 'gen_ai.completion' in attributes
    ? 'gen_ai.completion'
    : 'llm.output_messages' in attributes
    ? 'llm.output_messages'
    : null

  if (!inputKey && !outputKey) return null

  const parseMessages = (raw: unknown): LlmMessage[] | null => {
    if (typeof raw !== 'string') return null
    try {
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return null
      return parsed
        .map((m: unknown): LlmMessage | null => {
          if (typeof m !== 'object' || m === null) return null
          const msg = m as Record<string, unknown>
          return {
            role: String(msg.role ?? 'unknown'),
            content: typeof msg.content === 'string'
              ? msg.content
              : JSON.stringify(msg.content ?? ''),
            toolCallId: typeof msg.tool_call_id === 'string' ? msg.tool_call_id : undefined,
          }
        })
        .filter((m): m is LlmMessage => m !== null)
    } catch {
      return null
    }
  }

  const inputMessages = inputKey ? (parseMessages(attributes[inputKey]) ?? []) : []
  const outputMessages = outputKey ? (parseMessages(attributes[outputKey]) ?? []) : []

  // If input parsing failed (invalid JSON) and there's no output key either, return null
  if (inputKey && parseMessages(attributes[inputKey]) === null && !outputKey) return null

  const messages = [...inputMessages, ...outputMessages]
  if (messages.length === 0) return null

  return { messages }
}
```

- [ ] **Step 4: Run tests**

```bash
cd apps/web && bun run test lib/parse-llm-messages.test.ts
```

Expected: All 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/parse-llm-messages.ts apps/web/lib/parse-llm-messages.test.ts
git commit -m "feat(web): add LLM message parser for gen_ai.prompt attributes"
```

---

## Chunk 2: Message Renderer Component

### Task 2: Create LlmMessages component

**Files:**
- Create: `apps/web/components/trace/llm-messages.tsx`

- [ ] **Step 1: Write the component**

```typescript
// apps/web/components/trace/llm-messages.tsx
'use client'

import { useState } from 'react'
import type { LlmMessage } from '@/lib/parse-llm-messages'

const MAX_CONTENT_LENGTH = 300

function MessageBubble({ message }: { message: LlmMessage }) {
  const [expanded, setExpanded] = useState(false)
  const isLong = message.content.length > MAX_CONTENT_LENGTH
  const displayContent = isLong && !expanded
    ? message.content.slice(0, MAX_CONTENT_LENGTH) + '…'
    : message.content

  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'
  const isTool = message.role === 'tool'

  return (
    <div className={isUser ? 'flex justify-end' : 'flex justify-start'}>
      <div className={`max-w-[85%] ${isSystem ? 'w-full' : ''}`}>
        <div className="text-xs text-gray-400 mb-1 capitalize">{message.role}</div>
        <div className={
          isSystem
            ? 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg px-3 py-2 text-xs'
            : isUser
            ? 'bg-blue-600 text-white rounded-lg px-3 py-2 text-sm'
            : isTool
            ? 'bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded px-3 py-2 text-xs font-mono'
            : 'bg-gray-200 dark:bg-gray-600 text-gray-900 dark:text-gray-100 rounded-lg px-3 py-2 text-sm'
        }>
          {isTool ? (
            <pre className="whitespace-pre-wrap break-all">{displayContent}</pre>
          ) : (
            <p className="whitespace-pre-wrap break-words">{displayContent}</p>
          )}
        </div>
        {isLong && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-blue-500 hover:underline mt-1"
          >
            {expanded ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>
    </div>
  )
}

export function LlmMessages({ messages }: { messages: LlmMessage[] }) {
  if (messages.length === 0) {
    return (
      <div className="py-6 text-center text-sm text-gray-400">
        No message content available
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 p-4 overflow-y-auto max-h-96">
      {messages.map((msg, i) => (
        <MessageBubble key={i} message={msg} />
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/trace/llm-messages.tsx
git commit -m "feat(web): add LlmMessages chat bubble component"
```

---

## Chunk 3: Integrate into SpanAttributes

### Task 3: Rewrite SpanAttributes with Messages tab

**Files:**
- Modify: `apps/web/components/trace/span-attributes.tsx`

The current component (70 lines) uses a simple `showRaw` boolean. Replace it with a 3-tab system (`overview` | `messages` | `raw`). The `messages` tab only shows for `kind === 'llm'` spans that have parseable message content.

- [ ] **Step 1: Replace span-attributes.tsx with the complete new version**

```typescript
// apps/web/components/trace/span-attributes.tsx
'use client'

import { useState } from 'react'
import { formatTokens, formatCost } from '@/lib/format'
import { parseLlmMessages } from '@/lib/parse-llm-messages'
import { LlmMessages } from './llm-messages'

type Span = {
  id: string
  name: string
  kind: string
  model: string | null
  inputTokens: number
  outputTokens: number
  costUsd: string | number
  status: string
  attributes: Record<string, unknown>
  events: unknown[]
}

type Tab = 'overview' | 'messages' | 'raw'

export function SpanAttributes({ span }: { span: Span }) {
  const llmMessages = span.kind === 'llm'
    ? parseLlmMessages(span.attributes)
    : null

  const [activeTab, setActiveTab] = useState<Tab>('overview')

  return (
    <div data-testid="span-attributes" className="text-sm">
      {/* Tab navigation */}
      <div className="flex border-b border-gray-200 dark:border-gray-700 px-4 pt-4">
        {([
          { id: 'overview' as Tab, label: 'Overview' },
          ...(llmMessages ? [{ id: 'messages' as Tab, label: 'Messages' }] : []),
          { id: 'raw' as Tab, label: 'Attributes' },
        ] as { id: Tab; label: string }[]).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-2 text-xs font-medium mr-1 border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Overview tab */}
      {activeTab === 'overview' && (
        <div className="p-4 space-y-4">
          <h3 className="font-semibold text-gray-900 dark:text-white">{span.name}</h3>

          <div className="grid grid-cols-2 gap-2">
            {[
              ['Kind', span.kind],
              ['Status', span.status],
              ['Model', span.model ?? '—'],
              ['Input tokens', formatTokens(span.inputTokens)],
              ['Output tokens', formatTokens(span.outputTokens)],
              ['Cost', formatCost(span.costUsd)],
            ].map(([label, value]) => (
              <div key={label}>
                <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
                <div className="font-medium text-gray-900 dark:text-white">{value}</div>
              </div>
            ))}
          </div>

          {span.events.length > 0 && (
            <div>
              <div className="text-xs font-medium text-gray-500 mb-1">Events ({span.events.length})</div>
              <div className="space-y-1">
                {span.events.map((ev, i) => (
                  <div key={i} className="text-xs bg-gray-50 dark:bg-gray-800 rounded p-2 font-mono">
                    {JSON.stringify(ev)}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Messages tab — only shown for llm spans with parseable content */}
      {activeTab === 'messages' && llmMessages && (
        <LlmMessages messages={llmMessages.messages} />
      )}

      {/* Raw attributes tab */}
      {activeTab === 'raw' && (
        <div className="p-4">
          <pre className="text-xs bg-gray-50 dark:bg-gray-800 rounded p-3 overflow-auto max-h-96">
            {JSON.stringify(span.attributes, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: TypeScript check**

```bash
cd apps/web && bun run typecheck
```

- [ ] **Step 3: Start dev server and manually verify**

```bash
cd apps/web && bun run dev
```

Find a trace with an LLM span. Click it. Verify:
- Overview tab shows metrics (same as before)
- Messages tab appears only for `kind === "llm"` spans with `gen_ai.prompt`
- Non-LLM spans show Overview + Attributes only (no Messages tab)
- Long messages have "Show more" toggle

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/trace/span-attributes.tsx
git commit -m "feat(web): add Messages tab to SpanAttributes for LLM spans"
```
