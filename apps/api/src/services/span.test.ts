import { describe, it, expect, vi } from 'vitest'
import type { DB } from '../db/index'

const mockDb = {
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  returning: vi.fn(),
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
} as unknown as DB

describe('getSpan', () => {
  it('returns NOT_FOUND for missing span', async () => {
    const { getSpan } = await import('./span')
    ;(mockDb as unknown as { limit: ReturnType<typeof vi.fn> }).limit = vi
      .fn()
      .mockResolvedValue([])

    const result = await getSpan(mockDb, 'nonexistent')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND')
  })
})

describe('listSpansByTrace', () => {
  it('returns empty array when no spans exist', async () => {
    const { listSpansByTrace } = await import('./span')
    ;(mockDb as unknown as { orderBy: ReturnType<typeof vi.fn> }).orderBy = vi
      .fn()
      .mockResolvedValue([])

    const result = await listSpansByTrace(mockDb, 'trace-001')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data).toEqual([])
  })
})
