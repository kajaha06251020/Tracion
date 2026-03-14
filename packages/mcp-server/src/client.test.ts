import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createApiClient } from './client'

// グローバル fetch をモック
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createApiClient', () => {
  const config = { baseUrl: 'http://localhost:3001' }

  it('listTraces: 正常なレスポンスを返す', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        result: { data: { items: [{ id: 'trace-1', name: 'test' }], nextCursor: null } },
      }),
    })

    const client = createApiClient(config)
    const result = await client.listTraces({ limit: 10 })

    expect(result.items).toHaveLength(1)
    expect(result.items[0]!.id).toBe('trace-1')
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/trpc/traces.list'),
      expect.any(Object)
    )
  })

  it('getTrace: NOT_FOUND エラーを throws する', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: async () => ({
        error: { message: 'NOT_FOUND', data: { code: 'NOT_FOUND' } },
      }),
    })

    const client = createApiClient(config)
    await expect(client.getTrace('nonexistent')).rejects.toThrow('NOT_FOUND')
  })

  it('apiKey が設定されている場合はヘッダーに付与する', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        result: { data: { items: [], nextCursor: null } },
      }),
    })

    const client = createApiClient({ baseUrl: 'http://localhost:3001', apiKey: 'secret' })
    await client.listTraces({})

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-Traceforge-Api-Key': 'secret' }),
      })
    )
  })
})
