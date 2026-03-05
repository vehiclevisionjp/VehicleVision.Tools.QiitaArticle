// @ts-check

"use strict";

/**
 * Qiita 記事の Front Matter 必須フィールドを検証するカスタムルール
 *
 * 必須フィールド: title, tags, private, organization_url_name
 * Front Matter が存在しない場合もエラーとする
 */

const { isPublicArticle } = require("./_helpers");

const REQUIRED_FIELDS = ["title", "tags", "private", "organization_url_name"];

/** @type {import("markdownlint").Rule} */
module.exports = {
  names: ["qiita-front-matter", "QFM001"],
  description: "Qiita 記事に必須の Front Matter フィールドが存在すること",
  tags: ["front-matter", "qiita"],
  function: function rule(params, onError) {
    if (!isPublicArticle(params.name)) return;

    const lines = params.frontMatterLines;

    // Front Matter が存在しない
    if (!lines || lines.length === 0) {
      onError({
        lineNumber: 1,
        detail: "Front Matter が見つかりません（--- で囲まれた YAML ブロックが必要です）",
      });
      return;
    }

    // Front Matter の内容を解析（簡易パース: "key:" の存在チェック）
    const content = lines.join("\n");

    for (const field of REQUIRED_FIELDS) {
      const pattern = new RegExp(`^${field}\\s*:`, "m");
      if (!pattern.test(content)) {
        onError({
          lineNumber: 1,
          detail: `必須フィールド "${field}" が Front Matter に定義されていません`,
        });
      }
    }

    // title が空でないことを確認
    const titleMatch = content.match(/^title\s*:\s*(.*)$/m);
    if (titleMatch && titleMatch[1].trim() === "") {
      onError({
        lineNumber: 1,
        detail: '"title" が空です。記事タイトルを設定してください',
      });
    }
  },
};
