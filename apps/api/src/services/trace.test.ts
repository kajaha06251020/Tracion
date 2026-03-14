import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { DB } from '../db/index'

// We test services with a mock DB — real DB tests go in integration tests
const mockDb = {
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis(),
  returning: vi.fn(),
} as unknown as DB

// Reset mocks before each test
beforeEach(() => {
  vi.clearAllMocks()
})

describe('createTrace', () => {
  it('returns ok result with trace id on success', async () => {
    const { createTrace } = await import('./trace')
    mockDb.insert = vi.fn().mockReturnThis()
    ;(mockDb as unknown as { values: ReturnType<typeof vi.fn> }).values = vi.fn().mockReturnThis()
    ;(mockDb as unknown as { returning: ReturnType<typeof vi.fn> }).returning = vi
      .fn()
      .mockResolvedValue([{ id: 'trace-001' }])

    const result = await createTrace(mockDb, {
      id: 'trace-001',
      sessionId: 'default',
      agentId: 'test-agent',
      name: 'test',
      startTime: new Date(),
      totalTokens: 0,
      totalCostUsd: '0',
      status: 'success',
      metadata: {},
    })

    expect(result.ok).toBe(true)
  })

  it('returns DB_ERROR result when insert throws', async () => {
    const { createTrace } = await import('./trace')
    mockDb.insert = vi.fn().mockReturnThis()
    ;(mockDb as unknown as { values: ReturnType<typeof vi.fn> }).values = vi.fn().mockReturnThis()
    ;(mockDb as unknown as { returning: ReturnType<typeof vi.fn> }).returning = vi
      .fn()
      .mockRejectedValue(new Error('connection refused'))

    const result = await createTrace(mockDb, {
      id: 'trace-001',
      sessionId: 'default',
      agentId: 'test-agent',
      name: 'test',
      startTime: new Date(),
      totalTokens: 0,
      totalCostUsd: '0',
      status: 'success',
      metadata: {},
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('DB_ERROR')
  })
})

describe('getTrace', () => {
  it('returns NOT_FOUND when trace does not exist', async () => {
    const { getTrace } = await import('./trace')
    mockDb.select = vi.fn().mockReturnThis()
    ;(mockDb as unknown as { from: ReturnType<typeof vi.fn> }).from = vi.fn().mockReturnThis()
    ;(mockDb as unknown as { where: ReturnType<typeof vi.fn> }).where = vi.fn().mockReturnThis()
    ;(mockDb as unknown as { limit: ReturnType<typeof vi.fn> }).limit = vi
      .fn()
      .mockResolvedValue([])

    const result = await getTrace(mockDb, 'nonexistent')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND')
      expect(result.error.traceId).toBe('nonexistent')
    }
  })
})
