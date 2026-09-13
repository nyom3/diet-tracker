# GAS セットアップ手順

## 事前準備

### 1. Gemini API キーを取得する

1. [Google AI Studio](https://aistudio.google.com/) を開く
2. 右上「Get API key」→「Create API key」
3. キーをコピーしておく（後でスクリプトプロパティに貼る）

利用モデルは `gemini-3.5-flash`（無料枠）。無料枠の上限は変更されることがあるため、最新の値は AI Studio で確認する。

### 2. Google スプレッドシートを用意する

1. Google ドライブで新しいスプレッドシートを作成
2. URL から ID を取得する  
   例: `https://docs.google.com/spreadsheets/d/`**`1a2b3c4d5e6f`**`/edit`  
   太字部分が SPREADSHEET_ID
3. シート名は何でもよい（初回保存時に `food_log` シートを自動作成する）

### 2b. OpenAI API キーを取得する（任意）

OpenAI は設定しなくてもアプリは動作する（Gemini のみで推定・フィードバックを行う）。
無料デイリートークンを併用したい場合のみ設定する。

1. [OpenAI Platform](https://platform.openai.com/) でAPIキーを発行する
2. [Data controls](https://platform.openai.com/settings/organization/data-controls/sharing) でAPI入出力の共有を有効にし、「You're enrolled for complimentary daily tokens」の表示を確認する（無料デイリートークンはこの共有opt-inに紐づく）
3. [プリペイド残高](https://help.openai.com/en/articles/8264644-how-can-i-set-up-prepaid-billing)を設定する。無料枠を使い切っても、正のプリペイド残高がないと利用できない
4. 上記2の確認ができたら、アプリの「AI」パネルにある「確認して更新」ボタンを押す（この確認は30日ごとに必要）

アプリは外部ページを自動取得しない。30日ごとの手動確認が期限切れになるとOpenAIを停止してGeminiへ切り替えるため、AIパネルのリンクからData Controlsを確認して「確認して更新」を押す。

---

## ローカル開発環境

### 3. 依存関係をインストールする

```sh
npm install
```

### 4. React フォームをビルドする

```sh
npm run build
```

`src/` の React フォームが単一 HTML として `gas/index.html` に出力される。
Vite の HTML テンプレートには GAS Web App 用の `<base target="_top">` を入れている。

## CI とデプロイ時の検証

Pull request では `.github/workflows/pr.yml` が `npm ci`、`npm test`、`npm run build` を順に実行する。これらのジョブは GAS、AI、Sheets、本番 Secrets に接続しないため、PR検証に `.clasp.json` や認証情報は必要ない。いずれかのコマンドが失敗した場合は後続ステップへ進まず、無条件のリトライや失敗の握り潰しは行わない。

`main` への push では `.github/workflows/deploy.yml` が `npm ci` と `npm test` を先に実行する。テスト成功後にだけ clasp の認証情報を復元し、`npm run gas:deploy` を呼び出す。`scripts/deploy.mjs` 内で既存の固定 deployment を対象に build、push、deploy を各1回実行するため、workflow 側で build を重複実行しない。テストが失敗した場合は認証情報の復元とデプロイを実行しない。

検証失敗の切り分けは次のとおり記録する。

- 既知の失敗: 2026-07-12 の Actions run [29191239385](https://github.com/nyom3/diet-tracker/actions/runs/29191239385) は `npm ci` と認証情報復元に成功した後、`Build and deploy` で失敗した。当時の workflow にテスト工程はなく、テスト失敗とは分類しない。関連する #51 では GAS マニフェストの改行差分が記録されている。
- 今回再現: 初回PR [#106](https://github.com/nyom3/diet-tracker/pull/106) の Actions run [34733942174](https://github.com/nyom3/diet-tracker/actions/runs/34733942174) で `npm test` が119/120となり、`tests/dashboardMetrics.test.mjs:217` の「10,000 food + 5,000 health rowsを100ms未満で集計する」性能assertが `103.0ms` で失敗した。失敗を受けて build は実行されず、テスト失敗を握り潰さないworkflow動作も確認できた。食事行ごとに同じtimestampを日付と時刻のため二重解析していたため、`gas/DashboardMetrics.js` で一度の解析結果を共有した。
- 今回再現（追加）: 上記修正をmainへ反映した後の Deploy run [34734313928](https://github.com/nyom3/diet-tracker/actions/runs/34734313928) でも `npm test` が119/120となり、同じ性能assertが `127.8ms` で失敗した。credentials復元と `Build and deploy` はskipされ、本番へは反映されていない。Node 24.20.0 / ubuntu-24.04 image上の失敗であり、環境差だけとは断定しない。原因を追加測定した結果、同じ15個の日付文字列を10,000食事行・5,000 health行で繰り返し妥当性検証していたため、build呼び出し単位の文字列日付キャッシュを追加した。ローカルの同一15,000行入力20回では最小38.277ms、中央値39.819ms、最大49.932msとなり、100ms未満の要件は維持する。
- 再現できなかった事項: 既知のGASデプロイ失敗は、ローカルに本番の `.clasp.json` と認証情報を置かずに検証するため再現していない。CIの性能失敗はNode/OSや負荷で変動し、ローカルでは常に同じ値にならないため、修正後は `npm ci`、`npm test`、`npm run build` と実PR Actionsで確認する。PR検証からGAS実環境のE2E確認までは行わない。

---

## GAS プロジェクトと clasp

### 5. clasp にログインする

事前に [Google Apps Script API](https://script.google.com/home/usersettings) を有効にしておく。

```sh
npx clasp login
```

ブラウザで Google アカウント連携を完了する。

### 6. GAS プロジェクトを作成する

Google ドライブまたは対象スプレッドシートから Apps Script project を作成する。
既存 project を使う場合は、その script ID を控える。

script ID は Apps Script エディタの「プロジェクトの設定」→「スクリプト ID」で確認できる。

### 7. `.clasp.json` を作成する

`.clasp.example.json` を参考に、repo 直下へ `.clasp.json` を作成する。

```json
{
  "scriptId": "YOUR_APPS_SCRIPT_PROJECT_ID",
  "deploymentId": "",
  "rootDir": "gas"
}
```

`.clasp.json` は project ID と deployment ID を含むため git 管理しない。

### 8. GAS へ push する

```sh
npm run gas:push
```

`npm run gas:push` は build 後に `clasp push` を実行し、`gas/` 配下を Apps Script project へ反映する。

### 9. スクリプトプロパティを設定する

1. 左サイドバーの「プロジェクトの設定」（歯車アイコン）を開く
2. 「スクリプト プロパティ」セクションで「スクリプト プロパティを追加」

| プロパティ名 | 値 |
|---|---|
| `GEMINI_API_KEY` | 手順1で取得したAPIキー |
| `SPREADSHEET_ID` | 手順2で取得したシートID（バインド済みなら不要） |
| `OPENAI_API_KEY` | 手順2bで取得したAPIキー（任意。未設定でもGeminiのみで動作する） |

### 10. 初回 Web App deployment を作成する

初回だけ deployment ID がないため、新規 deployment を作る。

```sh
npm run gas:deploy:new
```

コマンド出力に表示される deployment ID と Web App URL を控える。

その後、`.clasp.json` の `deploymentId` に控えた ID を記入する。

```json
{
  "scriptId": "YOUR_APPS_SCRIPT_PROJECT_ID",
  "deploymentId": "YOUR_WEB_APP_DEPLOYMENT_ID",
  "rootDir": "gas"
}
```

### 11. 2回目以降は固定 deployment を更新する

```sh
npm run gas:deploy
```

`npm run gas:deploy` は `.clasp.json` の `deploymentId` を読み取り、既存 deployment を更新する。
この運用では Web App URL を毎回変えずに更新できる。

---

## スマホからのアクセス

### 12. Android のホーム画面に追加する

1. Android Chrome で Web App URL を開く
2. ログインを求められたら同じ Google アカウントでログイン
3. Chrome のメニュー（右上 ⋮）→「ホーム画面に追加」
4. 名前を「食事記録」などに変えて追加

以降はホーム画面のアイコンからアプリのように開ける。

---

## 動作確認

- テキストモード + 手動で `items` と `total` を含む JSON を貼り付けて保存 → スプレッドシートの `food_log` シートに行が追加され、I列 `breakdown_json` に内訳が入る
- API モードで食事名を入力して「推定する」→ 内訳リストと合計カロリー/PFCが自動入力される
- 写真モードで画像を選択して「推定する」→ 同上
- 食事日時を過去時刻に変更して保存 → A列 `timestamp` に指定した日時が記録される
- 保存後にフォームの食事日時が現在時刻へ戻る
- 画面最上部のAIパネルを開く → 現在のプロバイダー・安全上限までの残量・次回リセット時刻が表示される
- AIパネルで「Gemini」を選択 → 以降の推定・フィードバックがOpenAIを呼ばずGeminiのみで行われる

---

## Health Connect 連携（コード不要・アプリ設定のみ）

Health Data Export アプリが `Activity` / `Body Measurements` / `Sleep` / `Vitals` の4シートを自動書き込みする。
`health_data` シートはこれらを結合したビューとして、以下の数式で作成する。

### health_data シートのセットアップ

**A1:**
```
=QUERY(Activity!A:H,"SELECT A,D,H WHERE B='com.garmin.android.apps.connectmobile' AND A IS NOT NULL LABEL A 'date', D 'steps', H 'total_calories_kcal'",1)
```

**D1:**
```
={"weight_kg";ARRAYFORMULA(IFERROR(VLOOKUP(TEXT(A2:A,"yyyy-mm-dd"),{LEFT('Body Measurements'!A2:A,10),'Body Measurements'!D2:D},2,0),""))}
```

**E1:**
```
={"body_fat_pct";ARRAYFORMULA(IFERROR(VLOOKUP(TEXT(A2:A,"yyyy-mm-dd"),{LEFT('Body Measurements'!A2:A,10),'Body Measurements'!E2:E},2,0),""))}
```

`health_data` シートには手動で行を追加しないこと（数式が上書きされる）。
