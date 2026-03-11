# Qiita Markdown プレビュー

VS Code の Markdown プレビューを Qiita 固有の構文に対応させる拡張機能です。  
記事を Qiita に投稿する前に、VS Code 上で Qiita と同等の表示を確認できます。

## 対応構文

### :::note ブロック

`:::note info` / `:::note warn` / `:::note alert` をアイコン・色付きのブロックとして表示します。

```markdown
:::note info
ここに補足情報を書きます。
:::
```

### コードブロックのファイル名表示

コードフェンスに `` `lang:filename` `` 形式で言語とファイル名を指定すると、ファイル名ヘッダーを表示します。

````markdown
```ruby:app.rb
puts "Hello"
```
````

### 数式ブロック

`` ```math `` フェンスを KaTeX 向けトークンに変換します。  
VS Code の KaTeX 拡張機能と組み合わせて数式をプレビューできます。

````markdown
```math
e^{i\pi} + 1 = 0
```
````

### インラインカラー

バッククォート内の HEX・`rgb()`・`hsl()` カラーコードにカラースウォッチを表示します。

```markdown
`#FF5733` `rgb(255, 87, 51)` `hsl(11, 100%, 60%)`
```

### 脚注

`[^label]` 形式の脚注参照と定義を自動的にリンク生成します。

```markdown
本文中の参照[^1]です。

[^1]: 脚注の内容
```

### 埋め込みカード

URL を単独行に記述すると、対応サービスの埋め込みカードとして表示します。

対応サービス: YouTube・X (Twitter)・GitHub Gist・CodeSandbox・CodePen・Speaker Deck・SlideShare・Google Slides・Docswell・Figma・StackBlitz・Asciinema・blueprintUE・Claude Artifacts・Google Drive

## 使い方

Qiita 記事の Markdown ファイルを開き、通常どおり Markdown プレビュー（`Ctrl+Shift+V` または `Ctrl+K V`）を表示するだけで、Qiita 固有の構文が自動的に反映されます。

## テーマ対応

VS Code のライト・ダーク・ハイコントラストテーマに対応しています。

## 動作要件

- VS Code 1.85.0 以上
- ワークスペースに `qiita.config.json` または `public/` ディレクトリが存在すること
