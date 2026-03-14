import { describe, it, expect, vi } from 'vitest'
import type { ApiClient } from '../client'
import { handleSearchTraces } from './search-traces'

const mockClient: ApiClient = {
  listTraces: vi.fn(),
  getTrace: vi.fn(),
  searchTraces: vi.fn(),
}

describe('handleSearchTraces', () => {
  it('検索結果を整形したテキストで返す', async () => {
    vi.mocked(mockClient.searchTraces).mockResolvedValue([{
      id: '01KKN5H',
      name: 'generate_code',
      agentId: 'claude-code',
      status: 'success',
      startTime: '2023-11-14T22:13:20.000Z',
      endTime: '2023-11-14T22:13:21.000Z',
      totalTokens: 500,
      totalCostUsd: '0.001000',
      sessionId: 'default',
      input: null,
      output: null,
      metadata: {},
    }])

    const result = await handleSearchTraces(mockClient, { query: 'generate' })
    expect(result).toContain('generate_code')
    expect(result).toContain('claude-code')
    expect(result).toContain('1件')
  })

  it('0件の場合はその旨を返す', async () => {
    vi.mocked(mockClient.searchTraces).mockResolvedValue([])

    const result = await handleSearchTraces(mockClient, { query: 'nonexistent' })
    expect(result).toContain('見つかりませんでした')
  })
})
