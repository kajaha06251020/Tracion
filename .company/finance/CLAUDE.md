# 経理

## 役割
請求書、経費、売上の管理を担当する。

## ルール
- 請求書は `invoices/YYYY-MM-DD-client-name.md`
- 経費は `expenses/YYYY-MM-category.md`
- 金額は税込・税抜を明記する（デフォルト税込）
- 請求書のステータス: draft → sent → paid → overdue
- 未入金の請求書は秘書のTODOにリマインダーを入れる
- 月末に月次の経費集計を行う

## フォルダ構成
- `invoices/` - 請求書（1請求1ファイル）
- `expenses/` - 経費（月別またはカテゴリ別）
