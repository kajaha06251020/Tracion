# Traceforge TypeScript SDK — Design Specification

> *Status: Draft | Created: 2026-03-14*

---

## Overview

`@traceforge/sdk` は OpenTelemetry SDK の薄いラッパーとして実装する TypeScript SDK。AI エージェントコードに数行追加するだけでトレースが Traceforge API へ自動送信される。

**対象ユーザー:**
- Claude Code / MCP エージェント開発者
- LangChain.js / Vercel AI SDK ユーザー
- 生の fetch / Anthropic SDK / OpenAI SDK を直接呼び出す開発者

---

## Architecture

### データフロー

```
ユーザーコード
  → @traceforge/sdk (trace / startSpan)
    → OTel TracerProvider
      → BatchSpanProcessor
        → OtlpHttpExporter
          → Traceforge API POST /v1/traces (既存エンドポイント)
```

既存の API エンドポイント `/v1/traces` をそのまま利用。SDK 側で新規エンドポイントは不要。

### ファイル構成

```
packages/sdk-typescript/
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── src/
    ├── index.ts              — 公開 API（createTraceforge + global singleton）
    ├── sdk.ts                — TraceforgeSDK クラス（コア）
    ├── tracer.ts             — OTel TracerProvider のセットアップ（Resource 付与を含む）
    ├── exporter.ts           — OTLP/HTTP JSON エクスポーター設定
    ├── span.ts               — TraceforgeSpan ラッパー（属性キーのマッピングを担当）
    ├── types.ts              — SpanKind, TraceConfig 等の型
    └── instrumentation/
        ├── anthropic.ts      — Anthropic SDK トークン自動抽出
        ├── openai.ts         — OpenAI SDK トークン自動抽出
        └── http.ts           — fetch インターセプト（汎用 LLM 呼び出し検出）
```

---

## OTel 属性キーマッピング

SDK が送出する属性キーと、バックエンドパーサーが読み取るキーの対応表。
実装時はこのマッピングに**厳密に従うこと**（パーサーは別のキーを読まない）。

### Resource 属性（TracerProvider 初期化時に設定）

| Resource 属性キー | 設定値 | バックエンド DB カラム |
|-------------------|--------|----------------------|
| `traceforge.agent_id` | `config.agentId` | `traces.agentId` |
| `traceforge.session_id` | `config.sessionId` | `traces.sessionId` |
| `service.name` | `config.agentId`（フォールバック） | `traces.agentId` |

> **重要:** `agentId` と `sessionId` はスパン属性ではなく **OTel Resource 属性** として設定する。
> バックエンドの OTLP パーサーは `resourceSpans[].resource.attributes` から読み取るため、
> スパン属性に設定しても DB に反映されない。

### スパン属性

| スパン属性キー | 設定タイミング | バックエンド DB カラム |
|---------------|--------------|----------------------|
| `traceforge.input` | `span.setInput()` 呼び出し時 | `traces.input`（ルートスパンのみ） |
| `traceforge.output` | `span.setOutput()` 呼び出し時 | `traces.output`（ルートスパンのみ） |
| `traceforge.kind` | `startSpan({ kind })` 呼び出し時 | `spans.kind` |
| `llm.model` | 自動インストルメンテーション | `spans.model` |
| `llm.input_tokens` | 自動インストルメンテーション | `spans.inputTokens` |
| `llm.output_tokens` | 自動インストルメンテーション | `spans.outputTokens` |
| `llm.cost_usd` | 自動インストルメンテーション（省略可） | `spans.costUsd` |
| `llm.provider` | 自動インストルメンテーション | `spans.attributes` |

---

## Public API

### 初期化

```typescript
import { createTraceforge, traceforge } from '@traceforge/sdk'

// A. インスタンス生成（テスト・マルチエンドポイント向け）
const tf = createTraceforge({
  endpoint: 'http://localhost:3001',  // Traceforge API URL
  apiKey: 'optional-key',
  agentId: 'my-agent',               // OTel Resource 属性 traceforge.agent_id に設定
  sessionId: 'session-123',          // OTel Resource 属性 traceforge.session_id に設定
  enabled: true,                      // false でノーオペレーション（テスト用）
})

// B. グローバルシングルトン（アプリ全体で使い回す）
traceforge.init({ endpoint: 'http://localhost:3001', agentId: 'my-agent' })
```

### ラッパースタイル（推奨）

```typescript
const result = await traceforge.trace('generate_code', async (span) => {
  span.setInput(prompt)        // 内部で traceforge.input 属性に JSON.stringify して記録
  const output = await callLLM(prompt)
  span.setOutput(output)       // 内部で traceforge.output 属性に JSON.stringify して記録
  return output
  // 例外が throw されると span.status = 'error' に自動設定、例外を再 throw
})
```

### 手動スタイル

```typescript
const span = traceforge.startSpan('tool_call', { kind: 'tool' })
// 内部で traceforge.kind = 'tool' をスパン属性に設定
try {
  await runTool()
  span.end({ status: 'success' })
} catch (e) {
  span.end({ status: 'error', error: e })
}
```

### TraceforgeSpan API

```typescript
// setInput / setOutput は traceforge.input / traceforge.output 属性キーを使用
span.setInput(value: unknown): void       // → traceforge.input = JSON.stringify(value)
span.setOutput(value: unknown): void      // → traceforge.output = JSON.stringify(value)
span.setAttribute(key: string, value: unknown): void
span.addEvent(name: string, attributes?: Record<string, unknown>): void
span.end(options?: { status?: TraceStatus; error?: unknown }): void
```

### no-op モード（`enabled: false`）

`enabled: false` のとき、全 API はノーオペレーション。ただし `trace()` はコールバックを**必ず実行**し、その戻り値をそのまま返す。コールバックに渡される `span` は全メソッドが無害なスタブ。

```typescript
// enabled: false でもコールバックは実行される
const result = await tf.trace('x', async (span) => computeSomething())
// result は computeSomething() の戻り値
```

---

## Configuration

```typescript
type TraceforgeConfig = {
  endpoint: string            // 必須: Traceforge API の base URL
  apiKey?: string             // オプション: X-Traceforge-Api-Key ヘッダー
  agentId?: string            // OTel Resource 属性 traceforge.agent_id に設定（service.name にも同値を設定）
  sessionId?: string          // OTel Resource 属性 traceforge.session_id に設定
  enabled?: boolean           // デフォルト true。false でノーオペレーション
  batchSize?: number          // デフォルト 512: BatchSpanProcessor の maxExportBatchSize
  exportIntervalMs?: number   // デフォルト 5000: BatchSpanProcessor の scheduledDelayMillis
  _exporter?: SpanExporter    // テスト用: InMemorySpanExporter を注入可能（本番では使用しない）
}
```

> **`service.name` の扱い:** `agentId` が指定された場合、`traceforge.agent_id` と `service.name` の**両方**に同じ値を設定する。これにより OTel エコシステム（Jaeger、Grafana 等）との互換性を保ちつつ、Traceforge パーサーも正しく読み取れる。

---

## Auto-Instrumentation

### Anthropic SDK

`@anthropic-ai/sdk` の内部 HTTP クライアントを shimmer でパッチし、以下を自動取得:

| スパン属性キー | 取得元 |
|--------------|--------|
| `llm.model` | リクエスト `model` フィールド |
| `llm.input_tokens` | レスポンス `usage.input_tokens` |
| `llm.output_tokens` | レスポンス `usage.output_tokens` |
| `llm.cost_usd` | 省略（将来対応）— コスト情報が取得できない場合は属性自体を送出しない |
| `llm.provider` | `"anthropic"` (固定) |

### OpenAI SDK

同様に `openai` パッケージの fetch をパッチ:

| スパン属性キー | 取得元 |
|--------------|--------|
| `llm.model` | リクエスト `model` フィールド |
| `llm.input_tokens` | レスポンス `usage.prompt_tokens` |
| `llm.output_tokens` | レスポンス `usage.completion_tokens` |
| `llm.cost_usd` | 省略（将来対応）— 属性自体を送出しない |
| `llm.provider` | `"openai"` (固定) |

### 汎用 HTTP fetch インターセプト

グローバル `fetch` をラップし、既知の LLM エンドポイント（`api.anthropic.com`, `api.openai.com`）への呼び出しを検出してスパンを自動生成。`traceforge.kind = 'llm'` を付与。

### Node.js 環境情報

`TracerProvider` 初期化時に Resource として付与:

```
process.node_version, process.pid, host.name
```

---

## Error Handling

- `trace()` ラッパー内で例外が発生した場合: スパンの status を `error` に設定し、`error.message` 属性を付与後、例外を再 throw
- エクスポーター送信失敗: OTel の BatchSpanProcessor が自動リトライ（最大3回）。失敗はコンソール warn のみ、アプリをクラッシュさせない
- `enabled: false` のとき: OTel 処理を完全にスキップ。コールバックは実行して戻り値を返す

---

## Testing Strategy

### ユニットテスト（Vitest）

`InMemorySpanExporter` を使い、スパンの属性・ステータス・階層構造が正しく記録されるか確認:

```typescript
const exporter = new InMemorySpanExporter()
const tf = createTraceforge({ endpoint: '...', _exporter: exporter })

await tf.trace('test', async (span) => { span.setInput('hello') })

const spans = exporter.getFinishedSpans()
// traceforge.input キーを確認（llm.input ではない）
expect(spans[0].attributes['traceforge.input']).toBe('"hello"')
```

### 自動インストルメンテーションテスト

モック fetch でレスポンスを返し、トークン数・モデル名が正しくスパンに付与されるか確認。`traceforge.kind` が正しく設定されることも確認。

### カバレッジ目標

90%（CLAUDE.md の SDK 基準）

---

## Dependencies

```json
{
  "dependencies": {
    "@opentelemetry/api": "^1.9.0",
    "@opentelemetry/sdk-node": "^0.53.0",
    "@opentelemetry/sdk-trace-base": "^1.26.0",
    "@opentelemetry/exporter-trace-otlp-http": "^0.53.0",
    "@opentelemetry/resources": "^1.26.0",
    "@opentelemetry/semantic-conventions": "^1.27.0",
    "shimmer": "^1.2.1"
  },
  "devDependencies": {
    "vitest": "^2.1.0",
    "typescript": "^5.6.0"
  },
  "peerDependencies": {
    "@anthropic-ai/sdk": ">=0.24.0",
    "openai": ">=4.0.0"
  },
  "peerDependenciesMeta": {
    "@anthropic-ai/sdk": { "optional": true },
    "openai": { "optional": true }
  }
}
```

---

## Success Criteria

- [ ] `createTraceforge({ endpoint })` でインスタンス生成できる
- [ ] `tf.trace('name', async (span) => { ... })` でスパンが Traceforge API に送信される
- [ ] `tf.startSpan()` / `span.end()` の手動スタイルが動作する
- [ ] `traceforge.init()` グローバルシングルトンが動作する
- [ ] `agentId` が OTel Resource 属性 `traceforge.agent_id` として送信される
- [ ] `span.setInput()` が `traceforge.input` 属性キーで記録される
- [ ] `startSpan({ kind: 'tool' })` が `traceforge.kind = 'tool'` を付与する
- [ ] Anthropic SDK 呼び出しでトークン数が自動記録される
- [ ] OpenAI SDK 呼び出しでトークン数が自動記録される
- [ ] `enabled: false` でノーオペレーション（コールバックは実行される）
- [ ] 全ユニットテスト PASS（カバレッジ 90%以上）
- [ ] TypeScript strict mode PASS

---

*Next: `2026-03-14-python-sdk-design.md`*
