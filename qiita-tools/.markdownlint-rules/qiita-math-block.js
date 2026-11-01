// @ts-check

'use strict';

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

const { isPublicArticle, proseLines, getTokens } = require('./_helpers');

/** @type {import("markdownlint").Rule} */
module.exports = {
  names: ['qiita-math-block', 'QFM004'],
  description: '数式ブロック（$$ / ```math）の構文が正しいこと',
  tags: ['qiita', 'math'],
  function: function rule(params, onError) {
    if (!isPublicArticle(params.name, params.frontMatterLines)) return;

    const lines = proseLines(params);
    let inMathDollar = false;
    let mathDollarStart = 0;
    for (const token of getTokens(params)) {
      if (
        token.type === 'fence' &&
        token.info.trim() === 'math' &&
        !token.content.trim()
      ) {
        onError({
          lineNumber: token.lineNumber || token.map[0] + 1,
          detail: 'math ブロックの中身が空です',
        });
      }
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].replace(/^(?: {0,3}> ?)+/, '').trim();
      const lineNumber = i + 1;

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
        detail: '$$ ブロックが閉じられていません。$$ で閉じてください',
      });
    }
  },
};
