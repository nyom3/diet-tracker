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
- `gas/OpenAiProvider.gs`: AIプロバイダー選択(自動/OpenAI/Gemini)・token予約・LockService排他・OpenAI呼び出し
- `gas/OpenAiBudget.gs`: 日次使用量ロールオーバー・token予約上限・30日以内の手動資格確認を判定する純粋関数(`tests/openaiBudget.test.mjs` で単体テスト)
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
| I | source | api / manual / api_edited |
| J | breakdown_json | JSON 文字列（品ごとの items 配列。各要素は `name` / `quantity_text` / `basis` / PFC） |

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
- OpenAI は無料枠の安全ガード(30日以内の手動資格確認・token予約+日次上限)を全て通過した場合のみ呼び出す。モード選択でこのガードを迂回できない。→ `OPENAI_BUDGET_GATE_NOT_BYPASSABLE`
- `processInput()` はクライアントから `google.script.run` で呼ばれる。バリデーションはここで行う。
- React 側の GAS 呼び出しは `src/gasClient.ts` に集約する。
- Vite テンプレートの `<head>` には GAS Web App 用の `<base target="_top">` を必ず入れる。
- `.clasp.json` は scriptId / deploymentId を含むため git 管理しない。公開用には `.clasp.example.json` と docs を使う。
- フォームは縦長スマホ（Android Chrome）で快適に動くレイアウトにする。
- タップターゲットは最小 44px。
- 公開不要の作業メモ、レビュー連携手順、ローカル設定は `local/` に置き、PR や remote に含めない。

## GitHub / PR 運用

- PR のタイトルと本文は日本語で記述する。コード識別子、コマンド、issue/PR番号などの固有表記は原文のままでよい。
- PR 本文には、変更内容、背景、利用者への影響、確認したコマンド、レビュー結果、`Closes #<issue>` を含める。

## Build / Deploy Commands

- `npm run dev`: React フォームのローカル確認
- `npm run build`: `gas/index.html` を生成
- `npm run gas:push`: build 後に `clasp push`
- `npm run gas:deploy:new`: 初回 deployment 作成
- `npm run gas:deploy`: build、clasp push 後、`.clasp.json` の `deploymentId` を使って既存 deployment を更新
- `npm test`: `tests/**/*.test.mjs` を Node の組み込みテストランナーで逐次実行。予算・集計・画像処理・UI補助ロジック・GAS境界等を検証

### 検証の選び方

- 文書のみの変更: 記載したパス・コマンド・仕様を実物と照合し、`git diff --check` と差分確認を行う。動作に影響しない文書編集のために build やテストを追加実行する必要はない。
- ロジック・GAS境界の変更: 関連する `tests/*.test.mjs` を選び、`node --test --test-concurrency=1 tests/<対象>.test.mjs` で確認する。共通境界への影響が広い場合は `npm test` を使う。
- フロント・型・ビルド構成の変更: `npm run build` を実行する。UI変更では利用可能なブラウザで主要操作とスマホ幅を確認し、GAS実環境でのみ確認できる部分を区別する。
- PRの必須チェックは `.github/workflows/pr.yml` の `npm ci` → `npm test` → `npm run build`。ローカルの確認範囲を絞ってもCIのゲートは変更しない。
- ローカル検証と本番反映を分ける。`gas:push` と `gas:deploy*` は外部への書き込みを伴うため、委任された範囲でのみ実行する。合意済みの修正・検証は結果を見て続け、変更も新しい懸念もない成功済み確認を繰り返さない。

## タスクに応じた資料・スキルの参照

資料は必要になった時点で関連箇所を読む。過去の計画・調査メモを現在の要件として扱わない。

| 場面 | 参照先・使い方 |
|---|---|
| 接続設定、Sheets構成、デプロイ、CIを扱う | `docs/setup.md` と対象の設定・スクリプトを照合する |
| repo内を変更する前 | `invariant-preflight` で `docs/invariants.yml` の該当条件を確認する |
| repo内を変更した後 | `invariant-review` で実際の差分と不変条件を照合する。一般的なバグレビューの代用にはしない |
| コード差分のレビューを依頼された、または独立レビューが必要 | `repo-code-review` を使い、範囲・要件・対象差分・検証結果を渡す |
| OpenAIのAPI仕様、モデル、Codexの使い方を調査・変更する | `openai-docs` で現行の公式情報を確認する。通常のフォーム修正だけでは起動しない |
| Claude連携を明示された | workspaceの `.review-flow/codex-collaboration.md` を読む。通知不達・引き継ぎ停止の診断時に `process-check` を使う |

スキルが必要な場面でその `SKILL.md` を読み、複数手順を含む場合は今回に必要な参照先だけを開く。利用できない場合は制約と代替確認を明記する。共通スキルの本文をこのrepoへ複製しない。

## Documentation Rules / 完了条件

- タスク依頼の補助には [依頼テンプレート](docs/task-template.md) を使う。単純な依頼への全項目記入や、毎回の計画書作成は要求しない。
- 着手時に目的、対象範囲、受け入れ条件、委任範囲を既存の依頼・Issueから把握する。通常の実装方法は既存構造に合わせて判断し、合意済みの作業について再承認を求めない。
- 完了は、受け入れ条件ごとに実装・差分・検証結果等の証拠が揃い、必要な修正と関連文書の更新が済んだ状態とする。初稿作成や一部テストの成功だけを完了としない。
- 仕様・セットアップ・運用が変わった場合は該当する既存文書を更新する。公開不要の調査経緯・個別タスクの補足は `local/` に置き、Issueの要件全文を複製しない。
- 実機・外部接続・本番反映など未確認事項が残る場合は、その理由と影響を報告する。必須の受け入れ条件が未確認なら未完了とする。
- 完了報告は変更点、確認結果、残る未確認事項を簡潔に示す。commit・push・PR・merge・本番反映は明示された委任範囲に限る。

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
- Gemini/OpenAI の呼び出しはユーザーアクション起点のみ（バックグラウンド定期実行しない）。→ `GEMINI_USER_INITIATED_ONLY`
- OpenAI は30日以内の手動資格確認・token予約+日次安全上限の全ガードを通過した場合のみ呼び出す。→ `OPENAI_BUDGET_GATE_NOT_BYPASSABLE`, `OPENAI_USAGE_LOCK_SAFE`
- 食事データの永続化は本人の Sheets のみ。外部送信は原則行わず、非センシティブな食事データ（食事名・集計数値）をユーザー操作起点のAI機能に必要な範囲で Gemini/OpenAI へ送ることのみ許可する。新しい送信先・データ種別の追加は所有者の都度承認が必要。→ `DATA_SHEETS_ONLY`
- 食事画像は永続化しない（Sheets セル・Drive・外部ストレージに保存しない）。推定の一時入力に限定する。→ `IMAGE_NOT_PERSISTED`
- Web App のアクセス範囲は本人のみ（`access: MYSELF` / `executeAs: USER_DEPLOYING`）を維持する。→ `WEBAPP_ACCESS_SCOPE`
