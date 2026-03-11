# Qiita Markdown プレビュー（VS Code 拡張機能）

VS Code の Markdown プレビューを Qiita 固有の構文に対応させる拡張機能です。

## Features

- **:::note ブロック** — `:::note info` / `warn` / `alert` をアイコン付きで表示
- **lang:filename コードブロック** — ` ```lang:filename ` 形式でファイル名ヘッダーを表示
- **数式ブロック** — ` ```math ` フェンスを KaTeX 向けトークンに変換（KaTeX 無効時はフォールバック表示）
- **インラインカラー** — HEX (`#FFF`, `#FF0000`)・`rgb()`・`hsl()` をカラースウォッチ付きで表示
- **脚注** — `[^label]` 参照と `[^label]: 内容` 定義を自動リンク生成
- **埋め込みカード** — YouTube・Twitter/X・GitHub Gist・CodePen・Figma 等 15 以上のサービス URL を埋め込み表示
- **テーマ対応** — ライト・ダーク・ハイコントラストテーマに対応

## Supported Syntax

| 構文 | 記法例 |
|------|--------|
| Note ブロック | `:::note info` ～ `:::` |
| Code filename | ` ```ruby:app.rb ` |
| 数式 | ` ```math ` |
| インラインカラー | `` `#FF5733` `` |
| 脚注 | `[^1]` / `[^1]: テキスト` |
| 埋め込み | URL を単独行に記述 |

## Activation

以下のいずれかがワークスペースに存在するとき自動的にアクティブ化されます。

- `qiita.config.json`
- `public/` ディレクトリ

## Build & Install

```bash
cd extensions/markdown-preview
npm install
npm run build
npm run package   # VSIX ファイルを生成
```

## Directory Structure

```
extensions/markdown-preview/
├── src/
│   └── extension.ts       # markdown-it プラグイン実装（全機能）
├── media/
│   └── qiita-markdown.css # Qiita 固有スタイル（テーマ対応）
├── dist/                  # esbuild 出力
├── package.json
└── tsconfig.json
```

**Requirements:**

- VS Code 1.85.0+
- Node.js 20.0.0+
- ワークスペースに `qiita.config.json` または `public/` ディレクトリが必要
