import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ApiClient } from '../client'
import { PollingEventSource } from './polling'

vi.useFakeTimers()

const mockClient: ApiClient = {
  listTraces: vi.fn(),
  getTrace: vi.fn(),
  searchTraces: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('PollingEventSource', () => {
  it('新しいトレースがある場合にコールバックを呼ぶ', async () => {
    const newTrace = {
      id: 'new-trace-1',
      name: 'new_operation',
      agentId: 'claude-code',
      status: 'success' as const,
      startTime: new Date().toISOString(),
      endTime: null,
      totalTokens: 0,
      totalCostUsd: '0',
      sessionId: 'default',
      input: null,
      output: null,
      metadata: {},
    }

    vi.mocked(mockClient.listTraces).mockResolvedValue({
      items: [newTrace],
      nextCursor: null,
    })

    const callback = vi.fn()
    const source = new PollingEventSource(mockClient, 30_000)
    source.start(callback)

    // 1インターバル分進める
    await vi.advanceTimersByTimeAsync(30_000)

    expect(callback).toHaveBeenCalledWith({
      traceId: 'new-trace-1',
      name: 'new_operation',
      agentId: 'claude-code',
    })

    source.stop()
  })

  it('新しいトレースがない場合はコールバックを呼ばない', async () => {
    vi.mocked(mockClient.listTraces).mockResolvedValue({
      items: [],
      nextCursor: null,
    })

    const callback = vi.fn()
    const source = new PollingEventSource(mockClient, 30_000)
    source.start(callback)

    await vi.advanceTimersByTimeAsync(30_000)

    expect(callback).not.toHaveBeenCalled()

    source.stop()
  })

  it('stop() 後はポーリングを停止する', async () => {
    vi.mocked(mockClient.listTraces).mockResolvedValue({ items: [], nextCursor: null })

    const source = new PollingEventSource(mockClient, 30_000)
    source.start(vi.fn())
    source.stop()

    // stop 後にタイマーを進めてもポーリングしない
    await vi.advanceTimersByTimeAsync(30_000)

    expect(mockClient.listTraces).toHaveBeenCalledTimes(0)
  })
})
