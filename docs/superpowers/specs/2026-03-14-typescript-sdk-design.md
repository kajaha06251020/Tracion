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
    ├── tracer.ts             — OTel TracerProvider のセットアップ
    ├── exporter.ts           — OTLP/HTTP JSON エクスポーター設定
    ├── span.ts               — TraceforgeSpan ラッパー
    ├── types.ts              — SpanKind, TraceConfig 等の型
    └── instrumentation/
        ├── anthropic.ts      — Anthropic SDK トークン自動抽出
        ├── openai.ts         — OpenAI SDK トークン自動抽出
        └── http.ts           — fetch インターセプト（汎用 LLM 呼び出し検出）
```

---

## Public API

### 初期化

```typescript
import { createTraceforge, traceforge } from '@traceforge/sdk'

// A. インスタンス生成（テスト・マルチエンドポイント向け）
const tf = createTraceforge({
  endpoint: 'http://localhost:3001',  // Traceforge API URL
  apiKey: 'optional-key',
  agentId: 'my-agent',               // デフォルト agentId（スパンに付与）
  enabled: true,                      // false でノーオペレーション（テスト用）
})

// B. グローバルシングルトン（アプリ全体で使い回す）
traceforge.init({ endpoint: 'http://localhost:3001', agentId: 'my-agent' })
```

### ラッパースタイル（推奨）

```typescript
const result = await traceforge.trace('generate_code', async (span) => {
  span.setInput(prompt)
  const output = await callLLM(prompt)
  span.setOutput(output)
  return output
  // 例外が throw されると span.status = 'error' に自動設定
})
```

### 手動スタイル

```typescript
const span = traceforge.startSpan('tool_call', { kind: 'tool' })
try {
  await runTool()
  span.end({ status: 'success' })
} catch (e) {
  span.end({ status: 'error', error: e })
}
```

### TraceforgeSpan API

```typescript
span.setInput(value: unknown): void       // llm.input として記録
span.setOutput(value: unknown): void      // llm.output として記録
span.setAttribute(key: string, value: unknown): void
span.addEvent(name: string, attributes?: Record<string, unknown>): void
span.end(options?: { status?: TraceStatus; error?: unknown }): void
```

---

## Configuration

```typescript
type TraceforgeConfig = {
  endpoint: string            // 必須: Traceforge API の base URL
  apiKey?: string             // オプション: X-Traceforge-Api-Key ヘッダー
  agentId?: string            // オプション: デフォルト agentId
  enabled?: boolean           // デフォルト true。false でノーオペレーション
  batchSize?: number          // デフォルト 512: BatchSpanProcessor の maxExportBatchSize
  exportIntervalMs?: number   // デフォルト 5000: BatchSpanProcessor の scheduledDelayMillis
}
```

---

## Auto-Instrumentation

### Anthropic SDK

`@anthropic-ai/sdk` の内部 HTTP クライアントを shimmer でパッチし、以下を自動取得:

| OTel 属性 | 取得元 |
|-----------|--------|
| `llm.model` | リクエスト `model` フィールド |
| `llm.input_tokens` | レスポンス `usage.input_tokens` |
| `llm.output_tokens` | レスポンス `usage.output_tokens` |
| `llm.provider` | `"anthropic"` (固定) |

### OpenAI SDK

同様に `openai` パッケージの fetch をパッチ:

| OTel 属性 | 取得元 |
|-----------|--------|
| `llm.model` | リクエスト `model` フィールド |
| `llm.input_tokens` | レスポンス `usage.prompt_tokens` |
| `llm.output_tokens` | レスポンス `usage.completion_tokens` |
| `llm.provider` | `"openai"` (固定) |

### 汎用 HTTP fetch インターセプト

グローバル `fetch` をラップし、既知の LLM エンドポイント（`api.anthropic.com`, `api.openai.com`）への呼び出しを検出してスパンを自動生成。

### Node.js 環境情報

`TracerProvider` 初期化時に Resource として付与:

```
process.node_version, process.pid, host.name
```

---

## Error Handling

- `trace()` ラッパー内で例外が発生した場合: スパンの status を `error` に設定し、`error.message` 属性を付与後、例外を再 throw
- エクスポーター送信失敗: OTel の BatchSpanProcessor が自動リトライ（最大3回）。失敗はコンソール warn のみ、アプリをクラッシュさせない
- `enabled: false` のとき: 全 API がノーオペレーション（実際の OTel 処理なし）

---

## Testing Strategy

### ユニットテスト（Vitest）

`InMemorySpanExporter` を使い、スパンの属性・ステータス・階層構造が正しく記録されるか確認:

```typescript
const exporter = new InMemorySpanExporter()
const tf = createTraceforge({ endpoint: '...', _exporter: exporter })

await tf.trace('test', async (span) => { span.setInput('hello') })

const spans = exporter.getFinishedSpans()
expect(spans[0].attributes['llm.input']).toBe('"hello"')
```

### 自動インストルメンテーションテスト

モック fetch でレスポンスを返し、トークン数・モデル名が正しくスパンに付与されるか確認。

### カバレッジ目標

90%（CLAUDE.md の SDK 基準）

---

## Dependencies

```json
{
  "dependencies": {
    "@opentelemetry/api": "^1.9.0",
    "@opentelemetry/sdk-node": "^0.53.0",
    "@opentelemetry/exporter-trace-otlp-http": "^0.53.0",
    "@opentelemetry/resources": "^1.26.0",
    "@opentelemetry/semantic-conventions": "^1.27.0",
    "shimmer": "^1.2.1"
  },
  "devDependencies": {
    "@opentelemetry/sdk-trace-base": "^1.26.0",
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
- [ ] Anthropic SDK 呼び出しでトークン数が自動記録される
- [ ] OpenAI SDK 呼び出しでトークン数が自動記録される
- [ ] `enabled: false` でノーオペレーションになる
- [ ] 全ユニットテスト PASS（カバレッジ 90%以上）
- [ ] TypeScript strict mode PASS

---

*Next: `2026-03-14-python-sdk-design.md`*
