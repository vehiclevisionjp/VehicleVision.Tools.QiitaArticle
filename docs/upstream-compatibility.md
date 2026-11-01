# Qiita 互換性の基準

確認日: 2026-11-01

- [qiita-markdown](https://github.com/increments/qiita-markdown/tree/d7d3908333b3f12f5cf32d57f9baa55d8f673f25): 1.8.0、commit `d7d3908333b3f12f5cf32d57f9baa55d8f673f25`
- [qiita-cli](https://github.com/increments/qiita-cli/tree/5d77d0fe91b871dab99a9fe72d2d7dd300319fb6): npm 公開版 1.12.0、commit `5d77d0fe91b871dab99a9fe72d2d7dd300319fb6`
- CLI の必要環境: Node.js >= 22.22.1。ローカル配布設定と公開用 GitHub Actions で CLI 1.12.0 を固定。
- Lint 本体: markdownlint-cli2 0.24.0。Markdown-It の開発依存は 14.3.3 以上。

## ワークスペースとプレビュー

各ワークスペースフォルダの `qiita.config.json`、または `package.json` の `dependencies` / `devDependencies` にある `@qiita/qiita-cli` の宣言で判定する。一般的な Web プロジェクトにもある `public/` 単独では判定しない。

プレビューは該当フォルダの `public/` 配下だけを対象とする。入れ子のワークスペースフォルダは最も近いフォルダを優先し、文書情報が不明なら通常の Markdown として扱う。基本スタイルは `.qiita-markdown` に限定する。

VS Code は解析時に文書パスを渡さず、描画時にだけ `currentDocument` を渡すことがある。その場合は保存したソースを描画対象の文書情報で解析し直す。通常の Markdown の改行設定は維持する。

`workspaceContains:package.json` は VS Code に判定処理を読み込ませる条件であり、全 Node.js プロジェクトでカレンダーを表示する条件ではない。

## Lint と上流の対応

| ルール | 確認した上流ファイル                                              | 対応                                                                                           |
| ------ | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| QFM001 | CLI `src/lib/check-frontmatter-type.ts`, `file-system-repo.ts`    | YAML を解析し、記事メタデータの必須キー・型とキャンペーン用の任意キーを確認                    |
| QFM002 | `filters/custom_block.rb`                                         | note の未知の種別は info にフォールバック。3語目以降は無視                                     |
| QFM003 | `filters/code_block.rb`                                           | ファイル名のみ、空の言語、末尾コロン、ファイル名中のコロンを許容。旧設定互換のため ID のみ維持 |
| QFM004 | `filters/qiita_marker.rb`, `filters/code_block.rb`                | コード例を除外して数式ブロックを確認                                                           |
| QFM005 | `filters/final_sanitizer.rb`                                      | summary は必須にしない。HTML トークンから details の開閉を確認                                 |
| QFM006 | `transformers/filter_iframe.rb`, `filter_script.rb`, `embed/*.rb` | ホスト・完全一致 URL・スキームの条件を反映。複数タグ、複数行、引用符なし属性にも対応           |
| QFM007 | `filters/inline_math.rb`                                          | コードスパントークンから旧形式の閉じ忘れを確認。通常のコード例や新形式 `$...$` には警告しない  |

コードフェンス・インデントコード・HTML コメント・通常のインラインコードを本文と誤認しないよう、Markdown の解析結果を使用する。`public/.remote/` のコピーと、CLI が `marp: true` で識別するスライドは記事固有の Lint の対象外。

開閉忘れや空の数式ブロックの検査は執筆支援であり、Qiita が入力を拒否することを意味しない。

## プレビューの範囲

note のフォールバック、コードブロックのファイル名のみの指定・言語エイリアス、複数バッククォートを使った旧インライン数式を反映。既存の埋め込みカード表示も維持する。

プレビューは VS Code の Markdown-It / KaTeX と、この拡張のスタイルによる近似表示。上流の Ruby / Rouge / Qiita Marker 全体を移植したものではなく、ファイル名からの言語推測や外部サービスの表示が完全に一致する保証はない。新形式 `$...$` は VS Code 標準の数式サポートに任せる。

CLI の `--root` / `--config` による任意配置の自動探索や、Marp のスライド専用プレビューはこの拡張では提供しない。

## 更新時の確認

1. npm の `@qiita/qiita-cli` 最新版・engines と公式ソースを確認する。
2. 配布用 `package.json`、両公開ワークフロー、README の対応バージョンを揃える。
3. 上記フィルターとテストの変更を照合し、互換ケースを追加する。
4. `qiita-tools` の `npm test`、両拡張の `npm test` / `npm run typecheck` / `npm run build` を実行する。

CLI の記事保存処理は既知のキーで Front Matter を書き出すため、`scheduled_publish` / `created_at` など独自キーの保存には引き続き注意が必要。

確認時点の `npm audit` では、最新 markdownlint-cli2 の推移依存に5件（high 3、low 2）の警告が残る。提案される自動修正は旧版へのダウングレードを含むため適用していない。
