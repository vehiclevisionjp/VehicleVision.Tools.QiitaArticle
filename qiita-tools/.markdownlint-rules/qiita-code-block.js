// @ts-check

"use strict";

/**
 * Qiita コードブロックのファイル名記法を検証するカスタムルール
 *
 * Qiita では ```lang:filename の形式でコードブロックにファイル名を付与できる。
 * このルールは以下を検証する:
 * - lang:filename 記法のフォーマットが正しいこと
 * - lang 部分が空でないこと
 *
 * 参照: resources/qiita-markdown - lib/qiita/markdown/filters/code_block.rb
 */

const { isPublicArticle } = require("./_helpers");

/** @type {import("markdownlint").Rule} */
module.exports = {
  names: ["qiita-code-block", "QFM003"],
  description: "Qiita コードブロックの lang:filename 記法が正しいこと",
  tags: ["qiita", "code-block"],
  function: function rule(params, onError) {
    if (!isPublicArticle(params.name)) return;

    const lines = params.lines;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNumber = i + 1;

      // コードブロック開始行を検出（``` または ~~~）
      const fenceMatch = line.match(/^(`{3,}|~{3,})(.*)$/);
      if (!fenceMatch) continue;

      const info = fenceMatch[2].trim();
      if (!info) continue; // 言語指定なし（OK）

      // : を含む場合は lang:filename 記法
      const colonIndex = info.indexOf(":");
      if (colonIndex === -1) continue; // : がない場合はスキップ

      const lang = info.substring(0, colonIndex);
      const filename = info.substring(colonIndex + 1);

      if (lang === "") {
        onError({
          lineNumber,
          detail:
            "コードブロックの言語名が空です。`:filename` ではなく `lang:filename` の形式にしてください",
        });
      }

      if (filename === "") {
        onError({
          lineNumber,
          detail:
            "コードブロックのファイル名が空です。`lang:` ではなく `lang:filename` の形式にしてください",
        });
      }
    }
  },
};
