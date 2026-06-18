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
- `local/`: ローカル固有の作業メモやレビュー連携手順の置き場（git 管理しない）

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
- 公開不要の作業メモ、レビュー連携手順、ローカル設定は `local/` に置き、PR や remote に含めない。

## Repo-specific Risks or Forbidden Patterns

- API キーをコードやログに含めない。
- Gemini API の呼び出しはユーザーアクション起点のみ（バックグラウンド定期実行しない）。
- 食事データは Sheets のみに保存する。外部サービスに送信しない。
