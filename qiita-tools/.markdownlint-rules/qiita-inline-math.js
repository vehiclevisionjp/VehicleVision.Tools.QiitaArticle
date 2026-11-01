'use strict';
const { isPublicArticle, getTokens } = require('./_helpers');

module.exports = {
  names: ['qiita-inline-math', 'QFM007'],
  description: '旧形式のインライン数式（$`...`$）の閉じを確認する',
  tags: ['qiita', 'math', 'inline'],
  function(params, onError) {
    if (!isPublicArticle(params.name, params.frontMatterLines)) return;
    for (const token of getTokens(params)) {
      if (token.type !== 'inline') continue;
      const children = token.children || [];
      let lineNumber = token.lineNumber || token.map[0] + 1;
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        const before = children[i - 1];
        const after = children[i + 1];
        if (
          child.type === 'code_inline' &&
          before?.type === 'text' &&
          /(?<!\$)\$$/.test(before.content)
        ) {
          if (after?.type !== 'text' || !/^\$(?!\$)/.test(after.content)) {
            onError({
              lineNumber,
              detail:
                'インライン数式の閉じ "$" がありません。$`...`$ の形式にしてください',
            });
          }
        }
        lineNumber += (child.content.match(/\n/g) || []).length;
        if (['softbreak', 'hardbreak'].includes(child.type)) lineNumber++;
      }
    }
  },
};
