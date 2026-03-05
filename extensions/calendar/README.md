# Qiita 記事カレンダー（VS Code 拡張機能）

Qiita 記事の投稿スケジュールをカレンダー形式で管理する VS Code Webview 拡張機能です。

## 機能

- **14 週カレンダー表示** — 今日の 2 週間前〜12 週間先を一覧表示（週単位でスクロール可能）
- **記事ステータス表示** — 公開 / 限定共有 / 予約投稿 / 予約超過 / 下書きを色分け表示
- **投稿推移グラフ** — 直近 12 ヶ月の積み上げ面グラフ（前年同期比付き）
- **新規記事作成** — カレンダー上から公開 / 限定共有 / 予約投稿を作成（ブランチ自動作成対応）
- **ドラッグ＆ドロップ** — 予約投稿・下書き記事の日付を D&D で変更
- **Git 操作** — コミット / コミット＆プッシュ / マージ＆プッシュをカレンダー内で実行
- **祝日表示** — 日本の祝日を自動取得して表示
- **キーボードナビゲーション** — ← → キーで週移動、Escape でモーダルを閉じる

## 表示方法

### 自動表示（デフォルト）

ワークスペースに `public/` ディレクトリが存在する場合、ワークスペースを開いた時点で自動的にカレンダーが表示されます。

### 手動表示

コマンドパレット（`Ctrl+Shift+P`）から以下を実行します:

```
Qiita: 記事カレンダーを開く
```

### 自動表示を無効にする

設定（`Ctrl+,`）で以下を変更します:

```json
{
  "articleCalendar.autoOpen": false
}
```

## ナビゲーション

| 操作 | 説明 |
| --- | --- |
| `‹` / `›` ボタン | 1 週間ずつ前後に移動 |
| `≪` / `≫` ボタン | 4 週間ずつ前後に移動 |
| `今日` ボタン | 今日を含む表示範囲にリセット |
| `←` / `→` キー | 1 週間ずつ前後に移動 |
| `Escape` キー | 開いているモーダルを閉じる |

## ビルド・インストール

```bash
cd tools/VehicleVision.Tools.QiitaArticle.Calendar

# 依存関係のインストール
npm install

# ビルド → パッケージ → インストール（一括）
npm run install-ext
```

個別に実行する場合:

```bash
# TypeScript ビルド
npm run build

# VSIX パッケージ作成
npx @vscode/vsce package --no-dependencies --allow-missing-repository

# 拡張機能インストール
code --install-extension article-calendar-0.0.1.vsix --force
```

インストール後、VS Code を再読み込み（`Ctrl+Shift+P` → `Reload Window`）してください。

## ディレクトリ構成

```
VehicleVision.Tools.QiitaArticle.Calendar/
├── src/
│   ├── extension.ts       # 拡張機能エントリポイント（コマンド登録・自動起動）
│   ├── calendarPanel.ts   # Webview パネル管理（HTML テンプレート・メッセージルーティング）
│   ├── articleParser.ts   # 記事ファイルパーサー（Front Matter 解析）
│   ├── gitService.ts      # Git 操作（commit / merge / push / branch / status）
│   └── holidayService.ts  # 祝日取得（holidays-jp.github.io からキャッシュ付き取得）
├── media/
│   ├── app.js             # Webview フロントエンド（カレンダー・グラフ・モーダル）
│   └── style.css          # Webview スタイルシート
├── dist/                  # ビルド出力（esbuild）
├── package.json           # 拡張機能マニフェスト
└── tsconfig.json          # TypeScript 設定
```

## 動作要件

- VS Code 1.85.0 以上
- Node.js 20.0.0 以上（ビルド時）
- ワークスペースに `public/` ディレクトリが存在すること
