// @ts-check

"use strict";

/**
 * Qiita 埋め込みコード（iframe / script）の構文を検証するカスタムルール
 *
 * Qiita Markdown で許可されている埋め込みサービスのホワイトリストに基づき検証する。
 * 不正なホストの iframe/script は Qiita 上でサニタイズされるため、事前に警告する。
 *
 * 参照: resources/qiita-markdown - lib/qiita/markdown/transformers/filter_iframe.rb
 *       resources/qiita-markdown - lib/qiita/markdown/transformers/filter_script.rb
 *       resources/qiita-markdown - lib/qiita/markdown/embed/
 */

// iframe の src に許可されるホスト
const IFRAME_HOST_WHITE_LIST = [
  "www.youtube.com",
  "www.youtube-nocookie.com",
  "www.slideshare.net",
  "docs.google.com",
  "drive.google.com",
  "speakerdeck.com",
  "www.figma.com",
  "embed.figma.com",
  "docswell.com",
  "www.docswell.com",
  "stackblitz.com",
  "blueprintue.com",
  "claude.site",
];

// script の src に許可される完全一致 URL
const SCRIPT_URL_WHITE_LIST = [
  "https://production-assets.codepen.io/assets/embed/ei.js",
  "https://static.codepen.io/assets/embed/ei.js",
  "https://cpwebassets.codepen.io/assets/embed/ei.js",
  "https://public.codepenassets.com/embed/index.js",
  "https://platform.twitter.com/widgets.js",
  "https://platform.x.com/widgets.js",
  "//speakerdeck.com/assets/embed.js",
  "https://www.docswell.com/assets/libs/docswell-embed/docswell-embed.min.js",
  "//www.docswell.com/assets/libs/docswell-embed/docswell-embed.min.js",
];

// script の src に許可されるホスト
const SCRIPT_HOST_WHITE_LIST = [
  "asciinema.org",
];

/**
 * URL からホスト名を抽出する
 * @param {string} url
 * @returns {string | null}
 */
function extractHost(url) {
  try {
    // protocol-relative URL の対応
    const normalized = url.startsWith("//") ? "https:" + url : url;
    const urlObj = new URL(normalized);
    return urlObj.hostname;
  } catch {
    return null;
  }
}

const { isPublicArticle } = require("./_helpers");

/** @type {import("markdownlint").Rule} */
module.exports = {
  names: ["qiita-embed", "QFM006"],
  description: "Qiita で許可されている埋め込みサービスのみ使用していること",
  tags: ["qiita", "embed", "iframe", "script"],
  function: function rule(params, onError) {
    if (!isPublicArticle(params.name)) return;

    const lines = params.lines;
    let inCodeFence = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNumber = i + 1;

      // コードフェンス内はスキップ
      if (/^(`{3,}|~{3,})/.test(line)) {
        inCodeFence = !inCodeFence;
        continue;
      }
      if (inCodeFence) continue;

      // iframe の src を検証
      const iframeMatch = line.match(/<iframe\s[^>]*src\s*=\s*["']([^"']+)["']/i);
      if (iframeMatch) {
        const src = iframeMatch[1];

        // javascript: スキームをブロック
        if (/^javascript:/i.test(src)) {
          onError({
            lineNumber,
            detail: "iframe の src に javascript: スキームは使用できません",
          });
          continue;
        }

        const host = extractHost(src);
        if (host && !IFRAME_HOST_WHITE_LIST.includes(host)) {
          onError({
            lineNumber,
            detail: `iframe のホスト "${host}" は Qiita で許可されていません。許可ホスト: ${IFRAME_HOST_WHITE_LIST.join(", ")}`,
          });
        }
      }

      // script の src を検証
      const scriptMatch = line.match(/<script\s[^>]*src\s*=\s*["']([^"']+)["']/i);
      if (scriptMatch) {
        const src = scriptMatch[1];
        const host = extractHost(src);

        const isAllowedUrl = SCRIPT_URL_WHITE_LIST.includes(src);
        const isAllowedHost = host && SCRIPT_HOST_WHITE_LIST.includes(host);

        if (!isAllowedUrl && !isAllowedHost) {
          onError({
            lineNumber,
            detail: `script の src "${src}" は Qiita で許可されていません`,
          });
        }
      }
    }
  },
};
