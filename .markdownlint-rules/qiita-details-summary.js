// @ts-check

"use strict";

/**
 * Qiita の Details/Summary（折りたたみ）構文を検証するカスタムルール
 *
 * 検証対象:
 * - <details> に対応する </details> があること
 * - <details> 内に <summary> が存在すること
 *
 * 参照: resources/qiita-markdown - lib/qiita/markdown/filters/final_sanitizer.rb
 */

const { isPublicArticle } = require("./_helpers");

/** @type {import("markdownlint").Rule} */
module.exports = {
  names: ["qiita-details-summary", "QFM005"],
  description: "<details> ブロックの構文が正しいこと",
  tags: ["qiita", "html", "details"],
  function: function rule(params, onError) {
    if (!isPublicArticle(params.name)) return;

    const lines = params.lines;
    let detailsStack = [];
    let hasSummaryInCurrentDetails = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNumber = i + 1;

      // <details> の開始を検出
      if (/<details(\s[^>]*)?>/.test(line)) {
        detailsStack.push({
          lineNumber,
          hasSummary: false,
        });
        hasSummaryInCurrentDetails = false;
      }

      // <summary> を検出
      if (/<summary[\s>]/.test(line) && detailsStack.length > 0) {
        detailsStack[detailsStack.length - 1].hasSummary = true;
      }

      // </details> の終了を検出
      if (/<\/details>/.test(line)) {
        if (detailsStack.length === 0) {
          onError({
            lineNumber,
            detail:
              "対応する <details> がない </details> が見つかりました",
          });
        } else {
          const open = detailsStack.pop();
          if (!open.hasSummary) {
            onError({
              lineNumber: open.lineNumber,
              detail:
                "<details> 内に <summary> がありません。折りたたみの見出しを追加してください",
            });
          }
        }
      }
    }

    // 閉じられていない <details> を報告
    for (const open of detailsStack) {
      onError({
        lineNumber: open.lineNumber,
        detail:
          "<details> が閉じられていません。</details> で閉じてください",
      });
    }
  },
};
