import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { publicRoute } from './public'

vi.mock('../db/index', () => ({
  db: {
    select: vi.fn(),
  },
}))

vi.mock('../db/schema', () => ({
  traces: {
    id: 'id',
    name: 'name',
    agentId: 'agentId',
    status: 'status',
    startTime: 'startTime',
    endTime: 'endTime',
    totalTokens: 'totalTokens',
    totalCostUsd: 'totalCostUsd',
    shareToken: 'shareToken',
  },
  spans: {
    id: 'id',
    traceId: 'traceId',
    parentSpanId: 'parentSpanId',
    kind: 'kind',
    name: 'name',
    model: 'model',
    inputTokens: 'inputTokens',
    outputTokens: 'outputTokens',
    costUsd: 'costUsd',
    startTime: 'startTime',
    endTime: 'endTime',
    status: 'status',
    attributes: 'attributes',
    events: 'events',
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
}))

import { db } from '../db/index'

function buildApp() {
  const app = new Hono()
  app.route('/', publicRoute)
  return app
}

const mockTrace = {
  id: 'trace-123',
  name: 'test-trace',
  agentId: 'claude-code',
  status: 'success',
  startTime: new Date('2026-01-01T00:00:00Z'),
  endTime: new Date('2026-01-01T00:01:00Z'),
  totalTokens: 1000,
  totalCostUsd: '0.018000',
  shareToken: 'abc-token-xyz',
}

const mockSpans = [
  {
    id: 'span-1',
    traceId: 'trace-123',
    parentSpanId: null,
    kind: 'llm',
    name: 'chat',
    model: 'claude-opus-4-6',
    inputTokens: 800,
    outputTokens: 200,
    costUsd: '0.018000',
    startTime: new Date('2026-01-01T00:00:00Z'),
    endTime: new Date('2026-01-01T00:01:00Z'),
    status: 'success',
    attributes: {},
    events: [],
  },
]

describe('GET /api/public/traces/:token', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns 200 with trace and spans for valid token', async () => {
    const mockDb = db as unknown as { select: ReturnType<typeof vi.fn> }
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([mockTrace]),
        }),
      }),
    })
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(mockSpans),
      }),
    })

    const app = buildApp()
    const res = await app.request('/api/public/traces/abc-token-xyz')
    expect(res.status).toBe(200)
    const body = await res.json() as { success: boolean; data: { trace: typeof mockTrace; spans: typeof mockSpans } }
    expect(body.success).toBe(true)
    expect(body.data.trace.id).toBe('trace-123')
    expect(body.data.spans).toHaveLength(1)
  })

  it('returns 404 for unknown token', async () => {
    const mockDb = db as unknown as { select: ReturnType<typeof vi.fn> }
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    })

    const app = buildApp()
    const res = await app.request('/api/public/traces/nonexistent-token')
    expect(res.status).toBe(404)
    const body = await res.json() as { success: boolean; error: { code: string } }
    expect(body.success).toBe(false)
    expect(body.error.code).toBe('NOT_FOUND')
  })
})
