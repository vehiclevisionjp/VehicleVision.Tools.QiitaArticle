'use strict';
const { isPublicArticle, htmlFragments } = require('./_helpers');

module.exports = {
  names: ['qiita-details-summary', 'QFM005'],
  description: '<details> の開閉が対応していること（summary は任意）',
  tags: ['qiita', 'html', 'details'],
  function(params, onError) {
    if (!isPublicArticle(params.name, params.frontMatterLines)) return;
    const stack = [];
    for (const fragment of htmlFragments(params)) {
      const content = fragment.content.replace(/<!--[^]*?(?:-->|$)/g, (s) =>
        s.replace(/[^\n]/g, ' '),
      );
      for (const match of content.matchAll(/<\/?details\b[^>]*>/gi)) {
        const lineNumber =
          fragment.lineNumber +
          (content.slice(0, match.index).match(/\n/g) || []).length;
        if (/^<\//.test(match[0])) {
          if (!stack.length)
            onError({
              lineNumber,
              detail: '対応する <details> がない </details> が見つかりました',
            });
          else stack.pop();
        } else stack.push(lineNumber);
      }
    }
    for (const lineNumber of stack)
      onError({
        lineNumber,
        detail: '<details> が閉じられていません。</details> で閉じてください',
      });
  },
};
