# AGENTS.md

## Project Overview

diet-tracker は、食事カロリーを記録し続けられる状態を作るためのツールです。
入力摩擦の最小化が設計の第一原則です。

- 食事: GAS Web App フォームから写真またはテキストで入力 → OpenAI/Gemini でカロリー推定 → スプレッドシートへ書き込み
- 体重・運動: オムロン / Garmin → Health Connect → Health Data Export → スプレッドシートへ自動書き込み
- ダッシュボード: Looker Studio でスプレッドシートを可視化

## Tech Stack

- Google Apps Script (GAS): バックエンド + Web App ホスティング
- Vite + React + TypeScript: 食事入力フォーム
- vite-plugin-singlefile: GAS Web App 用の単一 HTML 生成
- clasp: 既存 Apps Script project への push / deploy
- Google スプレッドシート: データストア
- Gemini Flash API（無料枠）/ OpenAI API（無料デイリートークン、安全ガード付き）: カロリー推定・フィードバック生成
- Looker Studio: ダッシュボード（設定作業のみ、コード不要）

外部ホスティングは使わない。フロントエンドは Vite build で `gas/index.html` に単一 HTML として出力し、GAS Web App として配信する。

## Directory Responsibilities

- `gas/Code.gs`: GAS バックエンドロジック（フォーム受信、Sheets 書き込み、Gemini 呼び出し）
- `gas/OpenAiProvider.gs`: AIプロバイダー選択(自動/OpenAI/Gemini)・token予約・LockService排他・OpenAI呼び出し・公開ルール監視
- `gas/OpenAiBudget.gs`: 日次使用量ロールオーバー・token予約上限・資格/ルール鮮度判定の純粋関数(`tests/openaiBudget.test.mjs` で単体テスト)
- `gas/index.html`: Vite build で生成される GAS Web App の単一 HTML
- `gas/appsscript.json`: clasp で push する Apps Script manifest
- `src/`: React 食事入力フォーム
- `scripts/`: build / deploy 補助スクリプト
- `docs/`: 設計判断・スキーマ定義
- `local/`: ローカル固有の作業メモやレビュー連携手順の置き場（git 管理しない）

## Spreadsheet Schema

### `food_log` シート

| 列 | 名前 | 型 |
|---|---|---|
| A | id | `meal_` + UUID 文字列 |
| B | timestamp | ISO 8601 文字列（フォーム指定、デフォルトは現在時刻） |
| C | meal_type | 朝 / 昼 / 夜 / 間食 |
| D | description | ユーザー入力テキスト |
| E | calories_kcal | 数値 |
| F | protein_g | 数値 |
| G | fat_g | 数値 |
| H | carbs_g | 数値 |
| I | source | api / manual |
| J | breakdown_json | JSON 文字列（品ごとの items 配列） |

既存の `id` 未導入シートは、`ensureFoodLogHeaders()` が A 列を挿入し、既存行へ id を後埋めする。

### `health_data` シート

列定義の正本は `docs/setup.md` の `health_data` セットアップ数式。

| 列 | 名前 | 型 |
|---|---|---|
| A | date | YYYY-MM-DD |
| B | steps | 数値 |
| C | total_calories_kcal | 数値 |
| D | weight_kg | 数値 |
| E | body_fat_pct | 数値 |
| F | calories_kcal | 数値 |
| G | protein_g | 数値 |
| H | fat_g | 数値 |
| I | carbs_g | 数値 |

## Implementation Rules

- API キーは `PropertiesService.getScriptProperties()` で取得する。コードに直書きしない。
- Gemini/OpenAI 呼び出しは `gas/Code.gs`(estimateCalories 等)と `gas/OpenAiProvider.gs` に集約する。外部 API 依存はこの2ファイルのみ。
- OpenAI は無料枠の安全ガード(資格確認・公開ルール鮮度・token予約+日次上限)を全て通過した場合のみ呼び出す。モード選択でこのガードを迂回できない。→ `OPENAI_BUDGET_GATE_NOT_BYPASSABLE`
- `processInput()` はクライアントから `google.script.run` で呼ばれる。バリデーションはここで行う。
- React 側の GAS 呼び出しは `src/gasClient.ts` に集約する。
- Vite テンプレートの `<head>` には GAS Web App 用の `<base target="_top">` を必ず入れる。
- `.clasp.json` は scriptId / deploymentId を含むため git 管理しない。公開用には `.clasp.example.json` と docs を使う。
- フォームは縦長スマホ（Android Chrome）で快適に動くレイアウトにする。
- タップターゲットは最小 44px。
- 公開不要の作業メモ、レビュー連携手順、ローカル設定は `local/` に置き、PR や remote に含めない。

## Build / Deploy Commands

- `npm run dev`: React フォームのローカル確認
- `npm run build`: `gas/index.html` を生成
- `npm run gas:push`: build 後に `clasp push`
- `npm run gas:deploy:new`: 初回 deployment 作成
- `npm run gas:deploy`: `.clasp.json` の `deploymentId` を使って既存 deployment を更新
- `npm test`: `gas/OpenAiBudget.gs` の token予約・日次ロールオーバー等の純粋ロジックを Node の組み込みテストランナーで検証

## 不変条件（正本: docs/invariants.yml）

硬い不変条件は `docs/invariants.yml` を正本とする。実装前は invariant-preflight、変更後は invariant-review がこのファイルを読む。本文を AGENTS.md に複製せず、ここでは ID のみ参照する。

- 秘密の扱い: `SECRET_IN_SCRIPT_PROPERTIES`
- 外部送信境界: `DATA_SHEETS_ONLY`, `IMAGE_NOT_PERSISTED`
- AI起点・境界: `GEMINI_USER_INITIATED_ONLY`, `GEMINI_API_BOUNDARY`(Gemini/OpenAI共通)
- OpenAI無料枠の安全ガード: `OPENAI_BUDGET_GATE_NOT_BYPASSABLE`, `OPENAI_USAGE_LOCK_SAFE`
- 書き込み検証: `SERVER_SIDE_WRITE_VALIDATION`
- 配信範囲: `WEBAPP_ACCESS_SCOPE`
- スキーマ/構成: `SCHEMA_CONTRACT`, `SECRETS_NOT_COMMITTED`, `GAS_WEBAPP_TOP_TARGET`

## Repo-specific Risks or Forbidden Patterns

- API キーをコードやログに含めない。→ `SECRET_IN_SCRIPT_PROPERTIES`
- Gemini/OpenAI の呼び出し、および OpenAI 公開ルールページの確認はユーザーアクション起点のみ（バックグラウンド定期実行しない）。→ `GEMINI_USER_INITIATED_ONLY`
- OpenAI は資格確認・公開ルール鮮度・token予約+日次安全上限の全ガードを通過した場合のみ呼び出す。→ `OPENAI_BUDGET_GATE_NOT_BYPASSABLE`, `OPENAI_USAGE_LOCK_SAFE`
- 食事データの永続化は本人の Sheets のみ。外部送信は原則行わず、非センシティブな食事データ（食事名・集計数値）をユーザー操作起点のAI機能に必要な範囲で Gemini/OpenAI へ送ることのみ許可する。新しい送信先・データ種別の追加は所有者の都度承認が必要。→ `DATA_SHEETS_ONLY`
- 食事画像は永続化しない（Sheets セル・Drive・外部ストレージに保存しない）。推定の一時入力に限定する。→ `IMAGE_NOT_PERSISTED`
- Web App のアクセス範囲は本人のみ（`access: MYSELF` / `executeAs: USER_DEPLOYING`）を維持する。→ `WEBAPP_ACCESS_SCOPE`
