// @ts-check

"use strict";

/**
 * Qiita インライン数式の構文を検証するカスタムルール
 *
 * 検証対象:
 * - $`code`$ 形式のインライン数式が正しく閉じられていること
 * - $$ で囲まれたインライン数式はブロック数式として扱われるため警告
 *
 * 参照: resources/qiita-markdown - lib/qiita/markdown/filters/inline_math.rb
 */

const { isPublicArticle } = require("./_helpers");

/** @type {import("markdownlint").Rule} */
module.exports = {
  names: ["qiita-inline-math", "QFM007"],
  description: "インライン数式（$...$）の構文が正しいこと",
  tags: ["qiita", "math", "inline"],
  function: function rule(params, onError) {
    if (!isPublicArticle(params.name)) return;

    const lines = params.lines;
    let inCodeFence = false;
    let inMathDollarBlock = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNumber = i + 1;

      // コードフェンス内はスキップ
      if (/^(`{3,}|~{3,})/.test(line)) {
        inCodeFence = !inCodeFence;
        continue;
      }
      if (inCodeFence) continue;

      // $$ ブロック内はスキップ
      if (/^\$\$\s*$/.test(line)) {
        inMathDollarBlock = !inMathDollarBlock;
        continue;
      }
      if (inMathDollarBlock) continue;

      // 行内の $`...`$ パターンを検証
      // まず、数式でないインラインコード（`...`）を除去してから検証する
      // $`...`$ 形式のインライン数式は残し、通常のインラインコードのみ除去
      const lineWithoutInlineCode = line
        .replace(/\$`[^`]*`\$/g, "QIITA_INLINE_MATH_PLACEHOLDER")
        .replace(/`[^`]*`/g, "");

      // プレースホルダーで置換した $`...`$ は正しい形式なのでスキップ
      // 残った片方のドルサインだけでバッククォートがある場合を検出
      const singleDollarBacktick = line.match(/(?<!\$)\$`[^`]*`(?!\$)/g);
      if (singleDollarBacktick) {
        for (const match of singleDollarBacktick) {
          // 末尾に $ がない
          onError({
            lineNumber,
            detail: `インライン数式の閉じ "$" がありません: "${match}" → "$\`...\`$" の形式にしてください`,
          });
        }
      }

      // インラインコード除去後のテキストで `...`$ パターンを検出
      // （通常のインラインコードが除去されているため、誤検出しない）
      const backtickDollarOnly = lineWithoutInlineCode.match(
        /(?<!\$)`[^`]*`\$(?!\$)/g,
      );
      if (backtickDollarOnly) {
        for (const match of backtickDollarOnly) {
          if (!lineWithoutInlineCode.includes("$" + match.slice(0, -1))) {
            onError({
              lineNumber,
              detail: `インライン数式の開き "$" がありません: "${match}" → "$\`...\`$" の形式にしてください`,
            });
          }
        }
      }
    }
  },
};
