# AGENTS.md

## Project Overview

diet-tracker は、食事カロリーを記録し続けられる状態を作るためのツールです。
入力摩擦の最小化が設計の第一原則です。

- 食事: GAS Web App フォームから写真またはテキストで入力 → Gemini API でカロリー推定 → スプレッドシートへ書き込み
- 体重・運動: オムロン / Garmin → Health Connect → Health Data Export → スプレッドシートへ自動書き込み
- ダッシュボード: Looker Studio でスプレッドシートを可視化

## Tech Stack

- Google Apps Script (GAS): バックエンド + Web App ホスティング
- Google スプレッドシート: データストア
- Gemini Flash API（無料枠）: カロリー推定
- Looker Studio: ダッシュボード（設定作業のみ、コード不要）

外部ホスティング、npm、ビルドツールは不要です。

## Directory Responsibilities

- `gas/Code.gs`: GAS バックエンドロジック（フォーム受信、Gemini API 呼び出し、Sheets 書き込み）
- `gas/index.html`: 食事入力フォーム（HTML + インライン CSS/JS）
- `docs/`: 設計判断・スキーマ定義
- `docs/task-briefs/`: TASK-BRIEF 系メモのローカル置き場（git 管理しない）

## Spreadsheet Schema

### `food_log` シート

| 列 | 名前 | 型 |
|---|---|---|
| A | timestamp | ISO 8601 文字列（フォーム指定、デフォルトは現在時刻） |
| B | meal_type | 朝 / 昼 / 夜 / 間食 |
| C | description | ユーザー入力テキスト |
| D | calories_kcal | 数値 |
| E | protein_g | 数値 |
| F | fat_g | 数値 |
| G | carbs_g | 数値 |
| H | source | api / manual |
| I | breakdown_json | JSON 文字列（品ごとの items 配列） |

### `health_data` シート

| 列 | 名前 | 型 |
|---|---|---|
| A | date | YYYY-MM-DD |
| B | weight_kg | 数値 |
| C | body_fat_pct | 数値 |
| D | steps | 数値 |
| E | active_calories_kcal | 数値 |

## Implementation Rules

- API キーは `PropertiesService.getScriptProperties()` で取得する。コードに直書きしない。
- Gemini API 呼び出しは `estimateCalories()` 関数に集約する。外部 API 依存はこの関数のみ。
- `processInput()` はクライアントから `google.script.run` で呼ばれる。バリデーションはここで行う。
- フォームは縦長スマホ（Android Chrome）で快適に動くレイアウトにする。
- タップターゲットは最小 44px。
- `TASK-BRIEF*.md` は repo 直下に置かず、必要な場合は `docs/task-briefs/` に置く。
- `docs/task-briefs/` は `.gitignore` 対象のローカル作業メモ置き場とし、PR や remote に含めない。

## Repo-specific Risks or Forbidden Patterns

- API キーをコードやログに含めない。
- Gemini API の呼び出しはユーザーアクション起点のみ（バックグラウンド定期実行しない）。
- 食事データは Sheets のみに保存する。外部サービスに送信しない。

## PR Review Monitoring

PR 作成後と push 更新後に Claude review の監視を行う。

- PR 作成直後にワークスペースの `.review-inbox`（`E:/apps/.review-inbox`）へ PR URL を書き込む
- GitHub コメントを 5 分おき・最大 8 回確認する（このポーリング中は `.review-inbox` を更新しない）
- `claude-review-lgtm` を検知 → 完了として終了
- `claude-review-pending` を検知 → 指摘に対応して動作確認 → commit → push → `E:/apps/.review-inbox` へ PR URL を再度書き込む → ポーリングを再開
- 最大回数に達した場合は、未完了として状況を報告する

`.review-inbox` はローカル連携用ファイルであり、git 管理に含めない。
