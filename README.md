# diet-tracker

Google Apps Script で動く、スマホ向けの食事カロリー記録ツールです。

食事内容をテキストまたは写真で入力し、Gemini API でカロリーと PFC を推定して、Google スプレッドシートに保存します。体重・歩数などのヘルスデータは Health Connect と Health Data Export 経由で同じスプレッドシートへ連携する想定です。

## 構成

- `src/`: Vite + React + TypeScript の入力フォーム
- `gas/Code.gs`: GAS バックエンド
- `gas/index.html`: Vite build で生成する GAS Web App の単一 HTML
- `gas/appsscript.json`: Apps Script manifest
- `docs/setup.md`: セットアップ手順
- `docs/health-connect-verification.md`: Health Connect 連携の確認手順

## 開発

```sh
npm install
npm run dev
npm run build
```

`npm run build` で `gas/index.html` が生成されます。

## セットアップ

GAS プロジェクト作成、スクリプトプロパティ、clasp による push / deploy の手順は [docs/setup.md](docs/setup.md) を参照してください。
