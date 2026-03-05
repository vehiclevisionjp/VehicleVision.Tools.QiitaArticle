// @ts-check

"use strict";

/**
 * Qiita 固有 Markdown 記法の構文を検証するカスタムルール
 *
 * 検証対象:
 * - :::note ブロックの構文（開閉の対応、サブタイプの正当性）
 * - コードブロックのファイル名記法（```lang:filename）
 * - ブロック数式の構文（$$...$$、```math）
 *
 * 参照: resources/qiita-markdown - lib/qiita/markdown/filters/custom_block.rb
 */

const { isPublicArticle } = require("./_helpers");

/** @type {import("markdownlint").Rule} */
module.exports = {
  names: ["qiita-note-block", "QFM002"],
  description: ":::note ブロックの構文が正しいこと",
  tags: ["qiita", "custom-block"],
  function: function rule(params, onError) {
    if (!isPublicArticle(params.name)) return;

    const lines = params.lines;
    const noteStack = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNumber = i + 1;

      // :::note の開始を検出
      const noteOpenMatch = line.match(/^:::note\b(.*)$/);
      if (noteOpenMatch) {
        const rest = noteOpenMatch[1].trim();
        const validSubTypes = ["", "info", "warn", "alert"];

        if (!validSubTypes.includes(rest)) {
          onError({
            lineNumber,
            detail: `:::note のサブタイプ "${rest}" は無効です。info, warn, alert のいずれかを指定してください`,
          });
        }

        noteStack.push({ lineNumber, type: "note" });
        continue;
      }

      // ::: の閉じを検出（開始行以外）
      if (/^:::\s*$/.test(line)) {
        if (noteStack.length === 0) {
          onError({
            lineNumber,
            detail:
              "対応する :::note がない閉じ ::: が見つかりました",
          });
        } else {
          noteStack.pop();
        }
        continue;
      }

      // :::xxx（note 以外のカスタムブロック）を検出
      const customBlockMatch = line.match(/^:::(\w+)/);
      if (customBlockMatch && customBlockMatch[1] !== "note") {
        onError({
          lineNumber,
          detail: `Qiita では ":::${customBlockMatch[1]}" はサポートされていません。:::note のみ使用可能です`,
        });
        // 閉じ ::: との対応のためスタックに積む
        noteStack.push({ lineNumber, type: customBlockMatch[1] });
      }
    }

    // 閉じられていない :::note を報告
    for (const open of noteStack) {
      onError({
        lineNumber: open.lineNumber,
        detail: `:::${open.type} が閉じられていません。::: で閉じてください`,
      });
    }
  },
};
