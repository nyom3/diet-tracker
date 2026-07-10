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
