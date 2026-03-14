import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { createApiClient } from './client'
import { handleListTraces } from './tools/list-traces'
import { handleGetTrace } from './tools/get-trace'
import { handleSearchTraces } from './tools/search-traces'
import { PollingEventSource } from './notifications/polling'

// 環境変数から設定を読み込む
const apiBaseUrl = process.env['TRACEFORGE_API_URL'] ?? 'http://localhost:3001'
const apiKey = process.env['TRACEFORGE_API_KEY'] ?? undefined
const pollingInterval = parseInt(process.env['TRACEFORGE_POLL_INTERVAL'] ?? '30000', 10)

const apiClient = createApiClient({ baseUrl: apiBaseUrl, apiKey })

const server = new Server(
  { name: 'traceforge', version: '0.1.0' },
  { capabilities: { tools: {}, logging: {} } }
)

// ── ツール定義 ──────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'list_traces',
      description: 'Traceforge に記録されたトレースの一覧を取得します。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          limit: { type: 'number', description: '取得件数 (1-100, default 20)' },
          cursor: { type: 'string', description: 'ページングカーソル' },
          agentId: { type: 'string', description: 'エージェント ID でフィルタ' },
          status: { type: 'string', enum: ['running', 'success', 'error'], description: 'ステータスでフィルタ' },
          since: { type: 'string', description: 'ISO 8601 日時以降のトレースのみ' },
        },
      },
    },
    {
      name: 'get_trace',
      description: '指定したトレースの詳細とスパンツリーを取得します。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          traceId: { type: 'string', description: 'トレース ID' },
        },
        required: ['traceId'],
      },
    },
    {
      name: 'search_traces',
      description: 'トレース名のテキスト検索 + agentId/status/時間範囲フィルタ。',
      inputSchema: {
        type: 'object' as const,
        properties: {
          query: { type: 'string', description: '検索キーワード（トレース名）' },
          limit: { type: 'number', description: '取得件数 (1-100, default 20)' },
          agentId: { type: 'string', description: 'エージェント ID でフィルタ' },
          status: { type: 'string', enum: ['running', 'success', 'error'] },
          since: { type: 'string', description: 'ISO 8601 開始日時' },
          until: { type: 'string', description: 'ISO 8601 終了日時' },
        },
        required: ['query'],
      },
    },
  ],
}))

// ── ツール呼び出しハンドラ ────────────────────────────────

const listTracesInputSchema = z.object({
  limit: z.number().optional(),
  cursor: z.string().optional(),
  agentId: z.string().optional(),
  status: z.enum(['running', 'success', 'error']).optional(),
  since: z.string().optional(),
})

const searchTracesInputSchema = z.object({
  query: z.string(),
  limit: z.number().optional(),
  agentId: z.string().optional(),
  status: z.enum(['running', 'success', 'error']).optional(),
  since: z.string().optional(),
  until: z.string().optional(),
})

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  try {
    let text: string

    if (name === 'list_traces') {
      const input = listTracesInputSchema.parse(args ?? {})
      text = await handleListTraces(apiClient, input)
    } else if (name === 'get_trace') {
      const { traceId } = z.object({ traceId: z.string() }).parse(args)
      text = await handleGetTrace(apiClient, traceId)
    } else if (name === 'search_traces') {
      const input = searchTracesInputSchema.parse(args)
      text = await handleSearchTraces(apiClient, input)
    } else {
      text = `未知のツール: ${name}`
    }

    return { content: [{ type: 'text' as const, text }] }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return {
      content: [{ type: 'text' as const, text: `エラー: ${message}` }],
      isError: true,
    }
  }
})

// ── 通知（新着トレースのポーリング）────────────────────────

const eventSource = new PollingEventSource(apiClient, pollingInterval)
eventSource.start(async (event) => {
  await server.notification({
    method: 'notifications/message',
    params: {
      level: 'info',
      data: `[Traceforge] 新しいトレース: "${event.name}" (agent: ${event.agentId}) — ID: ${event.traceId}`,
    },
  })
})

// ── 起動 ────────────────────────────────────────────────────

const transport = new StdioServerTransport()
await server.connect(transport)

// 終了時にポーリングを停止
process.on('SIGINT', () => {
  eventSource.stop()
  process.exit(0)
})
