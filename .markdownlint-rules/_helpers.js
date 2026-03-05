// @ts-check

"use strict";

/**
 * Qiita カスタム Lint ルール共通ユーティリティ
 *
 * Qiita 固有の Markdown 構文チェックは public/ 配下の記事ファイルのみに適用する。
 */

const path = require("path");

/**
 * ファイルが public/ ディレクトリ配下の記事ファイルかどうかを判定する
 *
 * @param {string} name - ファイルパス（markdownlint の params.name）
 * @returns {boolean}
 */
function isPublicArticle(name) {
  const normalized = name.replace(/\\/g, "/");
  return /(?:^|\/|\\)public\//.test(normalized);
}

module.exports = { isPublicArticle };
