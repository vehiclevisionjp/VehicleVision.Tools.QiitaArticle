// @ts-check

'use strict';
const matter = require('gray-matter');

/**
 * Qiita カスタム Lint ルール共通ユーティリティ
 *
 * Qiita 固有の Markdown 構文チェックは public/ 配下の記事ファイルのみに適用する。
 */

/**
 * ファイルが public/ ディレクトリ配下の記事ファイルかどうかを判定する
 *
 * @param {string} name - ファイルパス（markdownlint の params.name）
 * @returns {boolean}
 */
function isPublicArticle(name, frontMatterLines = []) {
  const normalized = name.replace(/\\/g, '/');
  // CLI 1.12.0 also manages Marp slides; article-specific rules do not apply.
  try {
    if (matter(frontMatterLines.join('\n')).data.marp === true) return false;
  } catch {
    // QFM001 reports invalid YAML.
  }
  return (
    /(?:^|\/)public\//.test(normalized) &&
    !/(?:^|\/)public\/\.remote(?:\/|$)/.test(normalized) &&
    /\.md$/i.test(normalized)
  );
}

function getTokens(params) {
  return params.parsers?.markdownit?.tokens || params.tokens || [];
}

/** Preserve line positions while excluding literal examples and HTML comments. */
function proseLines(params) {
  const lines = params.lines.slice();
  for (const token of getTokens(params)) {
    if (['fence', 'code_block'].includes(token.type) && token.map) {
      for (let i = token.map[0]; i < token.map[1]; i++) lines[i] = '';
    }
  }
  return lines
    .join('\n')
    .replace(/<!--[^]*?(?:-->|$)/g, (match) => match.replace(/[^\n]/g, ' '))
    .replace(/(`+)([^]*?)\1(?!`)/g, (match) => match.replace(/[^\n]/g, ' '))
    .split('\n');
}

function htmlFragments(params) {
  const fragments = [];
  for (const token of getTokens(params)) {
    if (token.type === 'html_block')
      fragments.push({
        content: token.content,
        lineNumber: token.lineNumber || token.map[0] + 1,
      });
    if (token.type === 'inline') {
      let lineNumber = token.lineNumber || token.map[0] + 1;
      for (const child of token.children || []) {
        if (child.type === 'html_inline')
          fragments.push({ content: child.content, lineNumber });
        lineNumber += (child.content.match(/\n/g) || []).length;
        if (['softbreak', 'hardbreak'].includes(child.type)) lineNumber++;
      }
    }
  }
  return fragments;
}

module.exports = { isPublicArticle, getTokens, proseLines, htmlFragments };
