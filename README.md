# diet-tracker

Google Apps Script で動く、スマホ向けの食事カロリー記録ツールです。

食事内容をテキストまたは写真で入力し、Gemini API でカロリーと PFC を推定して、Google スプレッドシートに保存します。体重・歩数などのヘルスデータは Health Connect と Health Data Export 経由で同じスプレッドシートへ連携する想定です。

## 構成

- `gas/Code.gs`: GAS バックエンド
- `gas/index.html`: GAS Web App の入力フォーム
- `docs/setup.md`: セットアップ手順
- `docs/health-connect-verification.md`: Health Connect 連携の確認手順

## セットアップ

GAS プロジェクト作成、スクリプトプロパティ、Web App デプロイの手順は [docs/setup.md](docs/setup.md) を参照してください。
