# Traceforge MCP Server — Design Spec

**Date:** 2026-03-14
**Scope:** Phase 2 — Claude Code MCP サーバー

---

## Goal

Claude Code から `claude mcp add traceforge -- npx traceforge-mcp` の1コマンドで登録でき、
会話の中からトレースを検索・取得・監視できる MCP サーバーを構築する。

---

## Architecture

```
[Claude Code]
    │  stdio (MCP protocol)
    ▼
[packages/mcp-server — Bun + @modelcontextprotocol/sdk]
    │  HTTP fetch
    ▼
[apps/api — Hono tRPC]
    │  SQL
    ▼
[PostgreSQL + TimescaleDB]
```

### Transport

stdio（ローカルプロセス）。`claude mcp add traceforge -- npx traceforge-mcp` で起動。
環境変数 `TRACEFORGE_API_URL`（default: `http://localhost:3001`）と `TRACEFORGE_API_KEY` で設定。

---

## Tools

### `list_traces`
```typescript
input: {
  limit?: number      // 1-100, default 20
  cursor?: string     // keyset cursor for pagination
  agentId?: string    // filter by agent
  status?: 'running' | 'success' | 'error'
  since?: string      // ISO 8601 datetime
}
output: text — formatted trace list with nextCursor hint
```

### `get_trace`
```typescript
input: { traceId: string }
output: text — trace detail + span tree
error: NOT_FOUND → MCP ToolError
```

### `search_traces`
```typescript
input: {
  query: string       // text search on trace name
  agentId?: string
  status?: 'running' | 'success' | 'error'
  since?: string      // ISO 8601
  until?: string      // ISO 8601
  limit?: number      // 1-100, default 20
}
output: text — formatted search results
```

---

## Notifications (Real-time)

### 移行設計（Polling → SSE）

```typescript
// notifications/event-source.ts
interface EventSource {
  start(onNewTrace: (traceId: string, name: string, agentId: string) => void): void
  stop(): void
}
```

**今回:** `PollingEventSource` — 30秒ごとに `list_traces?since=<lastCheck>` をポーリング。
新トレースが存在すれば `notifications/message` (level: info) を MCP クライアントへ送信。

**将来:** `SseEventSource` — API に SSE エンドポイント (`GET /v1/traces/events`) を追加後、
同一インターフェースの別実装として差し替えるだけで移行完了。

### Notification フォーマット

```
[Traceforge] 新しいトレース: "generate_code" (agent: claude-code) — ID: 01KKN5H...
```

---

## API への追加

`listTraces` に `since` フィルタを追加（既存のcursorベースページネーションに追加）。
`searchTraces` に `since` / `until` フィルタを追加。

これにより MCP のポーリングが「前回チェック以降の新トレース」だけを効率的に取得できる。

---

## File Map

```
packages/mcp-server/
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── src/
    ├── index.ts                       MCP サーバーエントリ（stdio）
    ├── client.ts                      fetch ベース tRPC HTTP クライアント
    ├── types.ts                       Trace / Span 型定義（API から複製）
    ├── tools/
    │   ├── list-traces.ts             list_traces ハンドラ
    │   ├── list-traces.test.ts
    │   ├── get-trace.ts               get_trace ハンドラ
    │   ├── get-trace.test.ts
    │   ├── search-traces.ts           search_traces ハンドラ
    │   └── search-traces.test.ts
    └── notifications/
        ├── event-source.ts            EventSource インターフェース
        ├── polling.ts                 PollingEventSource（今回実装）
        ├── polling.test.ts
        └── sse.ts                     SseEventSource（スタブ — 将来実装）

apps/api/src/services/trace.ts        MODIFY — since/until フィルタ追加
apps/api/src/trpc/routers/traces.ts   MODIFY — since/until を zod スキーマに追加
```

---

## Testing

- ツール: `client.ts` をモックして入出力を検証（Vitest）
- ポーリング: `EventSource` モック実装でコールバックの発火を検証
- 統合: MCPサーバー起動 + `curl` でスモークテスト

---

## Success Criteria

- [ ] `bun run packages/mcp-server/src/index.ts` が起動してツールを公開する
- [ ] `list_traces` がトレース一覧を返す
- [ ] `get_trace` がスパンツリー付きで詳細を返す
- [ ] `search_traces` がテキスト・agentId・since/until フィルタで絞り込む
- [ ] 新トレース到着時に MCP 通知が飛ぶ（ポーリング）
- [ ] `SseEventSource` に差し替えても動く設計になっている

---

*設計者推薦: 案1（ポーリング）で実装し、案3（SSE）への移行パスを EventSource インターフェースで確保*
