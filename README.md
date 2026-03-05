# VehicleVision.Tools.QiitaArticle

VS Code で Qiita 記事を楽に管理するための**追加ツールキット**です。  
既存の Qiita CLI 環境に追加するだけで、記事のプレビュー・Lint・作成自動化が整います。

## 特徴

- **記事カレンダー** — VS Code 内のカレンダー UI で記事の一覧表示・新規作成・日付変更・Git 操作まで完結
- **Qiita Markdown プレビュー** — `:::note` / `lang:filename` / 数式など Qiita 固有構文をそのままプレビュー
- **Qiita 固有 Lint** — 7 つのカスタムルールで Qiita 記法を保存時にリアルタイム検証
- **記事作成スクリプト** — ブランチ作成・ファイル配置・Front Matter 設定を 1 コマンドで完了
- **予約投稿** — `scheduled_publish` による日時指定の自動公開
- **GitHub Actions 連携** — `main` への push で自動公開

---

## 導入手順

### 前提条件

- **Node.js** 20.0.0 以上
- **PowerShell** 7.0 以上（スクリプト実行用）
- **VS Code** 1.85.0 以上
- **Qiita CLI** がインストール済みであること（[Qiita CLI の導入](https://github.com/increments/qiita-cli)）

### 1. VS Code 拡張機能のインストール

[Releases ページ](../../releases/latest) から最新の `.vsix` ファイルをダウンロードし、VS Code にインストールします。

```bash
# 最新リリースから VSIX をダウンロード
gh release download --repo vehiclevisionjp/VehicleVision.Tools.QiitaArticle --pattern "*.vsix"

# カレンダー拡張
code --install-extension VehicleVision.Tools.QiitaArticle.Calendar.vsix

# Qiita Markdown プレビュー拡張
code --install-extension VehicleVision.Tools.QiitaArticle.MarkdownPreview.vsix
```

または VS Code の拡張機能ビュー（`Ctrl+Shift+X`）→ `...` → `VSIX からインストール` でインストールできます。

### 2. lint/ツールファイルのセットアップ

[Releases ページ](../../releases/latest) から `qiita-tools.zip` をダウンロードし、  
**Qiita 記事リポジトリのルートに展開**します。

```bash
# 最新リリースから qiita-tools.zip をダウンロード
gh release download --repo vehiclevisionjp/VehicleVision.Tools.QiitaArticle --pattern "qiita-tools.zip"

# 記事リポジトリのルートで展開
unzip qiita-tools.zip -d .
```

ZIP に含まれるファイル:

| ファイル / ディレクトリ | 用途 |
|------------------------|------|
| `.markdownlint-cli2.jsonc` | markdownlint 設定 |
| `.markdownlint-rules/` | Qiita 固有 Lint ルール（7 ルール） |
| `.prettierrc` | Prettier フォーマット設定 |
| `package.json` | Lint / Format 依存パッケージ定義 |
| `.vscode/extensions.json` | 推奨拡張の自動提案設定 |
| `.vscode/tasks.json` | VS Code タスク定義 |
| `scripts/` | 記事管理 PowerShell スクリプト |
| `.github/workflows/push-publish.yml.sample` | push 時自動公開ワークフロー（サンプル） |
| `.github/workflows/scheduled-publish.yml.sample` | 予約投稿ワークフロー（サンプル） |

### 3. 依存パッケージのインストール

```bash
npm install
```

### 4. GitHub Actions の有効化（自動公開を使う場合）

サンプルワークフローをリネームして有効化します:

```bash
mv .github/workflows/push-publish.yml.sample .github/workflows/push-publish.yml
mv .github/workflows/scheduled-publish.yml.sample .github/workflows/scheduled-publish.yml
```

次に、リポジトリの **Settings → Secrets and variables → Actions** で以下の Secrets を設定します:

| Secret 名 | 用途 | 必須 |
|-----------|------|------|
| `QIITA_TOKEN` | Qiita API アクセストークン | ✅ |

> Qiita トークンは [Qiita の設定画面](https://qiita.com/settings/tokens/new) から `read_qiita` / `write_qiita` スコープで発行してください。

> 通知機能を利用する場合は、使用するサービスに応じた Secret を追加してください。詳しくは[通知のカスタマイズ（任意）](#通知のカスタマイズ任意)を参照してください。

### 5. VS Code 拡張の追加インストール（推奨）

ワークスペースを開くと `.vscode/extensions.json` に基づいて以下の拡張機能のインストールが提案されます:

| 拡張 ID | 用途 |
|---------|------|
| `DavidAnson.vscode-markdownlint` | Markdown Lint の VS Code 統合（カスタムルール連動） |
| `esbenp.prettier-vscode` | Prettier フォーマッタ（保存時自動フォーマット） |

---

## VS Code で記事を管理する

### 記事カレンダー拡張

![calendar-overview](images/calendar-overview-top.png)
![calendar-overview](images/calendar-overview-bottom.png)

VS Code 内にカレンダー UI を表示し、記事の管理・作成・Git 操作をすべて GUI で行えます。  
ワークスペースに `qiita.config.json` または `public/` ディレクトリが存在すると自動的にアクティブになります。

#### カレンダー表示・ステータス色分け

![calendar-status-colors](images/calendar-status-colors.png)

| 機能 | 説明 |
|------|------|
| 14 週カレンダー | 今日の 2 週間前〜12 週間先を一覧表示（週単位でスクロール） |
| ステータス色分け | 公開 / 限定共有 / 予約投稿 / 予約超過 / 投稿準備 / 下書きを色分け |
| 祝日表示 | 日本の祝日を自動取得して表示 |
| ファイル監視 | `public/` 配下の変更・ブランチ切替を検知して自動リロード |
| キーボード操作 | ← → で週移動、Escape でモーダルを閉じる |

#### 投稿推移グラフ

![calendar-monthly-graph](images/calendar-monthly-graph.png)

直近 12 ヶ月の積み上げ棒グラフ（前年同期比付き）。

#### 新規記事作成

![calendar-new-article](images/calendar-new-article.png)

公開 / 限定共有 / 予約投稿を GUI で作成（ブランチ自動作成対応）。

#### ドラッグ＆ドロップ

![calendar-drag-and-drop](images/calendar-drag-and-drop.png)

予約投稿・下書き記事の日付を D&D で変更。

#### Git 操作

![calendar-git-operations](images/calendar-git-operations.png)

コミット / コミット＆プッシュ / マージ＆プッシュを GUI で実行。

**VS Code 設定:**

| 設定キー | デフォルト | 説明 |
|---------|-----------|------|
| `articleCalendar.autoOpen` | `true` | ワークスペースを開いたときにカレンダーを自動表示 |

### Qiita Markdown プレビュー拡張

![markdown-preview](images/markdown-preview.png)

VS Code 標準の Markdown プレビューに Qiita 固有構文のサポートを追加します。  
ワークスペースに `qiita.config.json` または `public/` ディレクトリが存在すると自動的にアクティブになります。  
`Ctrl+Shift+V` でプレビューを開くと、Qiita と同じ見た目で記事を確認できます。

| 構文 | 説明 |
|------|------|
| `:::note info\|warn\|alert` | ノートブロック（3 種類のスタイル） |
| `` ```lang:filename `` | コードブロックのファイル名ヘッダー表示 |
| `` ```math `` | 数式ブロック（VS Code の KaTeX と連携） |
| `` `#FF0000` `` | インラインカラーコード（色プレビュー付き） |
| 改行 | 自動 `<br>` 変換（Qiita と同じ挙動） |

> **⚠️ `npx qiita preview` は使用しないでください。** Qiita CLI のプレビューサーバーは記事ファイルの Front Matter を上書きし、`scheduled_publish` や `created_at` 等のカスタムフィールドが削除されます。プレビューには必ず VS Code の Markdown プレビュー + Qiita Markdown プレビュー拡張を使用してください。

---

## VS Code タスク

![vscode-tasks](images/vscode-tasks.png)

VS Code の「タスクの実行」（`Ctrl+Shift+P` → `Tasks: Run Task`）から操作できます:

| カテゴリ | タスク名 | 説明 |
|---------|---------|------|
| **セットアップ** | npm: install | 依存パッケージのインストール |
| **セットアップ** | Qiita: ログイン | Qiita CLI にログイン |
| **記事管理** | Qiita: 新規記事作成 | スラッグを指定して記事ファイルを作成 |
| **記事管理** | Qiita: 新規記事作成（ブランチ付き） | ブランチ作成 + ファイル配置を自動化 |
| **記事管理** | Qiita: 予約投稿記事作成（ブランチ付き） | 予約投稿記事をブランチ付きで作成 |
| **投稿** | Qiita: 記事を投稿（指定） | 指定した記事を Qiita に投稿 |
| **投稿** | Qiita: 記事を全件投稿 | 公開対象の記事を一括投稿 |
| **投稿** | Qiita: 記事を全件強制投稿 | 全記事を強制的に再投稿 |
| **同期** | Qiita: 記事を同期（pull） | Qiita から記事をローカルに同期 |
| **同期** | Qiita: 記事を強制同期（pull --force） | ローカルの変更を破棄して同期 |
| **品質チェック** | Lint: Markdownチェック | markdownlint-cli2 で構文チェック |
| **品質チェック** | Lint: Markdown自動修正（一括） | 全記事の Lint エラーを自動修正 |
| **品質チェック** | Lint: Markdown自動修正（個別ファイル） | 開いているファイルのみ自動修正 |
| **品質チェック** | Format: Prettierチェック | Prettier でフォーマットチェック |
| **品質チェック** | Format: Prettier実行 | Prettier で自動フォーマット |
| **メンテナンス** | 記事ファイル名の日付同期（DryRun） | ファイル名の日付ズレを確認 |
| **メンテナンス** | 記事ファイル名の日付同期（実行） | ファイル名の日付を実際にリネーム |
| **メンテナンス** | 記事に created_at を追加（DryRun） | API から取得する created_at を確認 |
| **メンテナンス** | 記事に created_at を追加（実行） | Front Matter に created_at を追加 |
| **その他** | Qiita: バージョン確認 | Qiita CLI のバージョンを表示 |

---

## ディレクトリ構成（このリポジトリ）

```text
├── extensions/
│   ├── calendar/          # 記事カレンダー VS Code 拡張（TypeScript ソース）
│   └── markdown-preview/  # Qiita Markdown プレビュー VS Code 拡張（TypeScript ソース）
├── scripts/               # 記事管理 PowerShell スクリプト
│   ├── New-Article.ps1
│   ├── New-ScheduledArticle.ps1
│   ├── Sync-ArticleDates.ps1
│   ├── Add-CreatedAt.ps1
│   ├── Build-CalendarExtension.ps1    # ローカルビルド用
│   └── Build-MarkdownPreview.ps1      # ローカルビルド用
├── .markdownlint-rules/   # Qiita 固有 Lint ルール
├── .github/workflows/
│   ├── release.yml                    # VSIX + ZIP のビルド＆リリース
│   ├── push-publish.yml.sample        # 記事自動公開（ユーザー向けサンプル）
│   └── scheduled-publish.yml.sample   # 予約投稿（ユーザー向けサンプル）
├── .markdownlint-cli2.jsonc
├── .prettierrc
└── package.json
```

---

## GitHub Actions ワークフロー（ユーザーリポジトリ向け）

`qiita-tools.zip` に含まれるサンプルワークフローを記事リポジトリに配置して使います。

### push-publish.yml — push 時の自動公開

`main` ブランチへの push 時に `public/` 配下の変更を検知し、自動的に Qiita に公開します。

**トリガー:**

| トリガー | 条件 |
|---------|------|
| `push` | `main` / `master` ブランチで `public/**` に変更があった場合 |
| `workflow_dispatch` | GitHub Actions の UI から手動実行 |

**処理ステップ:**

```
checkout → publish → created_at 追加
```

### scheduled-publish.yml — 予約投稿の定期チェック

毎日定時に実行され、`scheduled_publish` の日付が到来した記事を自動公開します。

**スケジュール:**

| cron | 日本時間 |
|------|---------|
| `0 0 * * *` | JST 9:00 |
| `0 9 * * *` | JST 18:00 |

### 通知のカスタマイズ（任意）

サンプルワークフローには通知ステップがコメントアウトされた状態で含まれています。
使用したいサービスのコメントを外し、対応する Secret を設定するだけで通知が有効になります。

| サービス | 必要な Secret |
|---------|-------------|
| Chatwork | `CHATWORK_API_TOKEN`, `CHATWORK_ROOM_ID` |
| Slack | `SLACK_WEBHOOK_URL` |
| Discord | `DISCORD_WEBHOOK_URL` |
| Microsoft Teams | `TEAMS_WEBHOOK_URL` |

**Slack の例:**

```yaml
- name: Notify Slack
  if: steps.articles.outputs.message != ''
  env:
    SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
  run: |
    curl -X POST "$SLACK_WEBHOOK_URL" \
      -H "Content-Type: application/json" \
      -d "{\"text\": \"${{ steps.articles.outputs.message }}\"}"
```

> 各サービスの設定例はサンプルワークフローファイル内のコメントを参照してください。

---

## スクリプト詳細

### New-Article.ps1 — 新規記事作成

```powershell
# 公開記事を作成
.\scripts\New-Article.ps1 -Title "github-actions-intro"

# 限定共有記事を作成
.\scripts\New-Article.ps1 -Title "internal-guide" -Visibility private
```

1. `main` ブランチに切り替え & `git pull`
2. `add-YYYYMMDD-タイトル` ブランチを作成
3. `npx qiita new` で記事テンプレートを生成
4. `public/YYYY/MM/` サブディレクトリに移動
5. `ignorePublish: true` に設定

### New-ScheduledArticle.ps1 — 予約投稿記事作成

```powershell
.\scripts\New-ScheduledArticle.ps1 -Date "2026-04-01" -Title "spring-release-notes"
```

Front Matter に `ignorePublish: true` と `scheduled_publish: "YYYY-MM-DD"` を設定します。  
予約日が到来すると `scheduled-publish.yml` ワークフローが自動公開します。

### Sync-ArticleDates.ps1 — ファイル名の日付同期

```powershell
.\scripts\Sync-ArticleDates.ps1 -DryRun   # 確認のみ
.\scripts\Sync-ArticleDates.ps1 -Force    # 実行
```

| 条件 | 日付の取得元 |
|------|-------------|
| 予約投稿記事 | `scheduled_publish` の日付 |
| 投稿済み記事 | `created_at`（なければ `updated_at`） |

### Add-CreatedAt.ps1 — created_at の自動追加

```powershell
.\scripts\Add-CreatedAt.ps1 -DryRun   # 確認のみ
.\scripts\Add-CreatedAt.ps1           # 実行
```

Qiita API から投稿日時を取得し、Front Matter に `created_at` を追加します。  
認証情報は `~/.config/qiita-cli/credentials.json` から自動読み込みします。

---

## カスタム Lint ルール

| ルール ID | 名前 | 検証内容 |
|----------|------|---------|
| QFM001 | `qiita-front-matter` | 必須 Front Matter フィールドの存在チェック |
| QFM002 | `qiita-note-block` | `:::note` ブロックの構文・サブタイプ検証 |
| QFM003 | `qiita-code-block` | コードブロック `lang:filename` 記法の検証 |
| QFM004 | `qiita-math-block` | `$$` / `` ```math `` ブロックの開閉対応検証 |
| QFM005 | `qiita-details-summary` | `<details>` / `<summary>` の対応検証 |
| QFM006 | `qiita-embed` | 埋め込み iframe/script のホワイトリスト検証 |
| QFM007 | `qiita-inline-math` | インライン数式 `$`\``...\``$` の構文検証 |

---

## `qiita pull` / `qiita preview` の注意事項

### ⚠️ `qiita pull` / `qiita preview` で Front Matter が壊れる問題

> **`npx qiita pull` および `npx qiita preview` は通常運用では使用しないでください。** Front Matter が破壊されます。

| 問題 | 詳細 |
|------|------|
| **カスタムフィールドの消失** | `scheduled_publish`、`created_at` など Qiita が認識しないフィールドが削除される |
| **ディレクトリ構造の破壊** | `public/YYYY/MM/` のサブディレクトリ配置が無視され、`public/` 直下にフラットに展開される |
| **`ignorePublish` のリセット** | ローカルで `true` に設定していた下書き記事が `false` に書き換わる |

**実行してしまった場合の復旧:**

```bash
git diff            # 変更を確認
git checkout -- public/   # Front Matter が壊れていたら元に戻す
```

---

## ライセンス

[AGPL-3.0](LICENSE)
