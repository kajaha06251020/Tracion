import { describe, it, expect, vi } from 'vitest'
import type { ApiClient } from '../client'
import { handleGetTrace } from './get-trace'

const mockClient: ApiClient = {
  listTraces: vi.fn(),
  getTrace: vi.fn(),
  searchTraces: vi.fn(),
}

const mockTrace = {
  id: '01KKN5H',
  name: 'generate_code',
  agentId: 'claude-code',
  sessionId: 'sess-1',
  status: 'success' as const,
  startTime: '2023-11-14T22:13:20.000Z',
  endTime: '2023-11-14T22:13:21.000Z',
  totalTokens: 500,
  totalCostUsd: '0.001000',
  input: null,
  output: null,
  metadata: {},
  spans: [
    {
      id: 'span-1',
      traceId: '01KKN5H',
      parentSpanId: null,
      kind: 'llm' as const,
      name: 'claude-opus',
      model: 'claude-opus-4-6',
      inputTokens: 300,
      outputTokens: 200,
      costUsd: '0.001000',
      startTime: '2023-11-14T22:13:20.000Z',
      endTime: '2023-11-14T22:13:21.000Z',
      status: 'success' as const,
      attributes: {},
      events: [],
    },
    {
      id: 'span-2',
      traceId: '01KKN5H',
      parentSpanId: 'span-1',
      kind: 'tool' as const,
      name: 'bash',
      model: null,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: '0.000000',
      startTime: '2023-11-14T22:13:20.500Z',
      endTime: '2023-11-14T22:13:20.800Z',
      status: 'success' as const,
      attributes: {},
      events: [],
    },
  ],
}

describe('handleGetTrace', () => {
  it('トレース詳細とスパンツリーを表示する', async () => {
    vi.mocked(mockClient.getTrace).mockResolvedValue(mockTrace)

    const result = await handleGetTrace(mockClient, '01KKN5H')
    expect(result).toContain('generate_code')
    expect(result).toContain('claude-code')
    expect(result).toContain('500 tokens')
    expect(result).toContain('claude-opus')
    expect(result).toContain('bash')
  })

  it('子スパンはインデントして表示する', async () => {
    vi.mocked(mockClient.getTrace).mockResolvedValue(mockTrace)

    const result = await handleGetTrace(mockClient, '01KKN5H')
    // 子スパン (span-2) はインデントされる
    expect(result).toContain('  └─')
  })

  it('NOT_FOUND の場合はエラーメッセージを返す', async () => {
    vi.mocked(mockClient.getTrace).mockRejectedValue(new Error('NOT_FOUND'))

    const result = await handleGetTrace(mockClient, 'nonexistent')
    expect(result).toContain('見つかりません')
  })
})
