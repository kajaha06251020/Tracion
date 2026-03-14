import { describe, it, expect, vi } from 'vitest'
import type { ApiClient } from '../client'
import { handleListTraces } from './list-traces'

const mockClient: ApiClient = {
  listTraces: vi.fn(),
  getTrace: vi.fn(),
  searchTraces: vi.fn(),
}

describe('handleListTraces', () => {
  it('トレースを整形したテキストで返す', async () => {
    vi.mocked(mockClient.listTraces).mockResolvedValue({
      items: [{
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
      }],
      nextCursor: null,
    })

    const result = await handleListTraces(mockClient, {})
    expect(result).toContain('generate_code')
    expect(result).toContain('claude-code')
    expect(result).toContain('success')
    expect(result).toContain('500 tokens')
  })

  it('nextCursor がある場合はページング情報を表示する', async () => {
    vi.mocked(mockClient.listTraces).mockResolvedValue({
      items: [],
      nextCursor: 'eyJz...',
    })

    const result = await handleListTraces(mockClient, {})
    expect(result).toContain('cursor: eyJz...')
  })

  it('トレースが0件の場合はその旨を返す', async () => {
    vi.mocked(mockClient.listTraces).mockResolvedValue({ items: [], nextCursor: null })

    const result = await handleListTraces(mockClient, {})
    expect(result).toContain('0件')
  })
})
