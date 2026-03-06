// @ts-check

"use strict";

/**
 * Qiita 数式ブロックの構文を検証するカスタムルール
 *
 * 検証対象:
 * - $$ ブロックの開閉対応
 * - ```math ブロック内が空でないこと
 *
 * 参照: resources/qiita-markdown - lib/qiita/markdown/filters/inline_math.rb
 *        resources/qiita-markdown - lib/qiita/markdown/filters/qiita_marker.rb
 */

const { isPublicArticle } = require("./_helpers");

/** @type {import("markdownlint").Rule} */
module.exports = {
  names: ["qiita-math-block", "QFM004"],
  description: "数式ブロック（$$ / ```math）の構文が正しいこと",
  tags: ["qiita", "math"],
  function: function rule(params, onError) {
    if (!isPublicArticle(params.name)) return;

    const lines = params.lines;
    let inMathDollar = false;
    let mathDollarStart = 0;
    let inCodeFence = false;
    let codeFenceLang = "";
    let codeFenceStart = 0;
    let codeFenceContent = "";

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNumber = i + 1;

      // コードフェンスの開閉を追跡
      const fenceMatch = line.match(/^(`{3,}|~{3,})(.*)$/);
      if (fenceMatch) {
        if (!inCodeFence) {
          inCodeFence = true;
          codeFenceLang = fenceMatch[2].trim();
          codeFenceStart = lineNumber;
          codeFenceContent = "";
        } else {
          // コードフェンスの閉じ
          if (codeFenceLang === "math" && codeFenceContent.trim() === "") {
            onError({
              lineNumber: codeFenceStart,
              detail: "```math ブロックの中身が空です",
            });
          }
          inCodeFence = false;
          codeFenceLang = "";
        }
        continue;
      }

      // コードフェンス内の内容を蓄積
      if (inCodeFence) {
        codeFenceContent += line + "\n";
        continue;
      }

      // $$ ブロックの開閉を追跡（コードフェンス外のみ）
      if (/^\$\$\s*$/.test(line)) {
        if (!inMathDollar) {
          inMathDollar = true;
          mathDollarStart = lineNumber;
        } else {
          inMathDollar = false;
        }
      }
    }

    // 閉じられていない $$ を報告
    if (inMathDollar) {
      onError({
        lineNumber: mathDollarStart,
        detail: "$$ ブロックが閉じられていません。$$ で閉じてください",
      });
    }
  },
};
