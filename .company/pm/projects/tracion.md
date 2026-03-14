---
created: "2026-03-14"
project: "Tracion"
status: in-progress
tags: [saas, observability, ai-agent, opentelemetry]
---

# プロジェクト: Tracion

## 概要
AIエージェント向けのオープンソース・オブザーバビリティ基盤。
「AIエージェントが何をして、なぜその判断をしたか」を完全に可視化する。
Claude Code / MCP ネイティブで動く唯一のOSSトレーサー。

## ゴール
- マルチエージェントの因果グラフを可視化（React Flow）
- `docker compose up` 1コマンドで全機能が立ち上がる
- セルフホスト完全対応・データは手元に残る
- `v0.1.0-alpha` リリースをPhase 0 MVPとして達成

## ターゲットユーザー
- Claude Code / Cursor / Aider などを使うAI-firstな開発者
- n8n / Dify / LangGraph でマルチエージェントを構築するチーム
- Langfuseの代替を探しているチーム

## 技術スタック
- **Backend**: Bun + Hono + PostgreSQL(TimescaleDB) + Redis
- **Frontend**: Next.js 15 + shadcn/ui + React Flow + tRPC
- **SDK**: TypeScript / Python (OTel準拠) + MCPサーバー
- **Infra**: Docker Compose + GitHub Actions

## マイルストーン
| # | マイルストーン | 期限 | 状態 |
|---|-------------|------|------|
| 0 | ディレクトリ構造・初期設定 | 2026-03-14 | ✅ 完了 |
| 1 | OTelコレクターエンドポイント実装 | - | 未着手 |
| 2 | Trace / Span CRUD API | - | 未着手 |
| 3 | トレース一覧ページ (Web) | - | 未着手 |
| 4 | React Flow エージェントグラフビュー | - | 未着手 |
| 5 | MCPサーバー Claude Code接続 | - | 未着手 |
| 6 | v0.1.0-alpha リリース | - | 未着手 |

## 関連部署
- 開発（engineering）: 実装・設計書
- リサーチ（research）: 競合調査（Langfuse, Langsmith等）
- マーケティング（marketing）: OSS公開・README・SNS

## メモ
- プロジェクト名はユーザーが「Tracion」と命名（要件ドキュメント内表記は Traceforge）
- OTel準拠を最優先。独自SDKはOTelの薄いラッパーとして実装
- Raspberry Pi 4（4GB RAM）でも動作する軽量設計が目標
