# Health Connect 動作確認手順

## ゴール

オムロン / Garmin のデータが Health Connect を経由してスプレッドシートの `health_data` シートまで届くことを確認する。

---

## 前提確認

- [ ] Android 14 以上（Garmin 連携の必須条件）
- [ ] オムロンコネクト アプリがインストール済みで、体重計と同期できている
- [ ] Garmin Connect アプリがインストール済みで、デバイスと同期できている
- [ ] Google スプレッドシートが作成済み（GAS セットアップ済みのもの）

---

## Step 1: Health Connect アプリを用意する

Android 14 には Health Connect が標準搭載されているが、古いビルドでは別途インストールが必要な場合がある。

1. 設定 → 「Health Connect」で検索して開けるか確認
2. 開けない場合は Play ストアで「Health Connect」を検索してインストール

---

## Step 2: オムロンコネクト → Health Connect 連携

1. オムロンコネクト アプリを開く
2. 設定（右下または左上のメニュー）→「連携サービス」または「Health Connect」
3. Health Connect との連携をオンにする
4. 許可を求められたら「体重」「体脂肪率」「基礎代謝量」を許可

### 確認方法

1. 体重計で測定してオムロンコネクトに同期する（または過去データを確認）
2. Health Connect アプリ → 「参照」タブ → 「体重」に数値が表示されるか確認

---

## Step 3: Garmin Connect → Health Connect 連携

1. Garmin Connect アプリを開く
2. 右上のアカウントアイコン → 設定 → 「Health Connect との連携」または「接続済みアプリ」
3. Health Connect との連携をオンにする
4. 許可を求められたら「アクティブカロリー」「歩数」を許可（他は任意）

### 確認方法

1. Garmin デバイスを Garmin Connect に同期する
2. Health Connect アプリ → 「参照」タブ → 「歩数」「消費カロリー」にデータがあるか確認

---

## Step 4: Health Data Export のセットアップ

Play ストアで「Health Data Export」をインストール（無料）。

### 書き出し先の設定

1. アプリを開く
2. 「Connect to Google Sheets」または「Export Destination」→ Google アカウントでログイン
3. 書き出し先のスプレッドシートを選択（GAS がある既存のファイル）

### エクスポート項目の設定

以下のデータ種別を選択する:

| Health Connect の項目名 | `health_data` シートの対応列 |
|---|---|
| Weight（体重） | B: weight_kg |
| Body Fat（体脂肪率） | C: body_fat_pct |
| Steps（歩数） | D: steps |
| Active Calories / Total Calories Burned | E: active_calories_kcal |

> **注意**: Health Data Export が書き出す列名は、アプリのバージョンや設定によって異なる。
> 実際に書き出されたヘッダー行を確認し、`health_data` シートのヘッダー（A: date, B: weight_kg, C: body_fat_pct, D: steps, E: active_calories_kcal）と一致していなければヘッダー行を手動で修正する。

### 書き出し頻度の設定

- 頻度: **毎日（Daily）**
- タイミング: 早朝（充電中の時間帯を推奨）
- 書き出し範囲: 直近 1 日分（差分のみ追記する設定があれば優先）

---

## Step 5: 初回動作確認

1. Health Data Export で「今すぐエクスポート（Export Now）」を実行
2. スプレッドシートを開いて `health_data` シートを確認
3. 行が追加されていれば連携成功

### チェックリスト

- [ ] `date` 列に今日の日付が入っている
- [ ] `weight_kg` に体重の数値が入っている
- [ ] `body_fat_pct` に体脂肪率が入っている（オムロンが未測定なら空欄）
- [ ] `steps` に歩数が入っている
- [ ] `active_calories_kcal` に消費カロリーが入っている

---

## トラブルシューティング

| 症状 | 確認箇所 |
|---|---|
| Health Connect にオムロンのデータが来ない | オムロンコネクト → 設定 → Health Connect 連携がオンになっているか |
| Health Connect に Garmin のデータが来ない | Garmin Connect → 設定 → Health Connect 連携がオンか。Android 14 以上か |
| スプレッドシートに書き出されない | Health Data Export のログイン状態・書き出し先スプレッドシートの権限を確認 |
| 列名がずれている | スプレッドシートの `health_data` シートのヘッダー行を手動で修正 |
| 毎日自動書き出しがされない | Health Data Export のバックグラウンド実行が Android のバッテリー最適化で止められていないか確認。設定 → アプリ → Health Data Export → バッテリー → 「制限なし」に変更 |
