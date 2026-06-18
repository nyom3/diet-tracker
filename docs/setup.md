# GAS セットアップ手順

## 事前準備

### 1. Gemini API キーを取得する

1. [Google AI Studio](https://aistudio.google.com/) を開く
2. 右上「Get API key」→「Create API key」
3. キーをコピーしておく（後でスクリプトプロパティに貼る）

### 2. Google スプレッドシートを用意する

1. Google ドライブで新しいスプレッドシートを作成
2. URL から ID を取得する  
   例: `https://docs.google.com/spreadsheets/d/`**`1a2b3c4d5e6f`**`/edit`  
   太字部分が SPREADSHEET_ID
3. シート名は何でもよい（初回保存時に `food_log` シートを自動作成する）

---

## GAS プロジェクトの作成

### 3. スクリプトエディタを開く

1. 上記スプレッドシートのメニュー「拡張機能」→「Apps Script」を開く  
   （スプレッドシートにバインドすると `SPREADSHEET_ID` の設定が不要になる）

### 4. ファイルをコピーする

**Code.gs**
- デフォルトで `コード.gs`（または `Code.gs`）が開いている
- 中身を `gas/Code.gs` の内容で置き換える

**index.html**
- 左サイドバーの「+」→「HTML」→ファイル名を `index` にする
- 中身を `gas/index.html` の内容で貼り付ける

### 5. スクリプトプロパティを設定する

1. 左サイドバーの「プロジェクトの設定」（歯車アイコン）を開く
2. 「スクリプト プロパティ」セクションで「スクリプト プロパティを追加」

| プロパティ名 | 値 |
|---|---|
| `GEMINI_API_KEY` | 手順1で取得したAPIキー |
| `SPREADSHEET_ID` | 手順2で取得したシートID（バインド済みなら不要） |

### 6. Web App としてデプロイする

1. 右上「デプロイ」→「新しいデプロイ」
2. 種類: 「ウェブアプリ」を選択
3. 設定:
   - 説明: 任意（例: `食事記録 v1`）
   - 次のユーザーとして実行: **「自分」**
   - アクセスできるユーザー: **「自分のみ」**（スマホからアクセスするため、同じ Google アカウントが必要）
4. 「デプロイ」を押す
5. 表示される **Web App URL** をコピーしておく

> **再デプロイについて**: コードを変更したあとは「デプロイ」→「デプロイを管理」→「編集」→「バージョンを新しく作成」で反映する。

---

## スマホからのアクセス

### 7. Android のホーム画面に追加する

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
