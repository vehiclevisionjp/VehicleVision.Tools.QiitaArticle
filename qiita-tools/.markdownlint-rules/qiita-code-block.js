'use strict';

// Retained for compatibility with existing QFM003 configuration.
// Upstream CodeBlock::Metadata accepts language-only, filename-only,
// empty sections and filenames containing colons. These are not syntax errors.
module.exports = {
  names: ['qiita-code-block', 'QFM003'],
  description: 'コードブロックのメタデータ（上流互換のため制限なし）',
  tags: ['qiita', 'code-block'],
  function() {},
};
