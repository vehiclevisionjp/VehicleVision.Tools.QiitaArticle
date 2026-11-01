'use strict';
const matter = require('gray-matter');
const { isPublicArticle } = require('./_helpers');

// Qiita CLI 1.12.0 check-frontmatter-type.ts (article metadata only).
const nullableString = (value) => value === null || typeof value === 'string';
const fields = {
  title: nullableString,
  tags: Array.isArray,
  private: (value) => typeof value === 'boolean',
  updated_at: nullableString,
  id: nullableString,
  organization_url_name: nullableString,
  slide: (value) => typeof value === 'boolean',
};
const optionalFields = {
  ignorePublish: (value) => typeof value === 'boolean',
  posting_campaign_uuid: nullableString,
  agreed_posting_campaign_term: (value) => typeof value === 'boolean',
};

module.exports = {
  names: ['qiita-front-matter', 'QFM001'],
  description: 'Qiita CLI の記事 Front Matter の存在と型が正しいこと',
  tags: ['front-matter', 'qiita'],
  function(params, onError) {
    if (!isPublicArticle(params.name, params.frontMatterLines)) return;
    const lines = params.frontMatterLines;
    if (!lines?.length) {
      onError({
        lineNumber: 1,
        detail:
          'Front Matter が見つかりません（--- で囲まれた YAML が必要です）',
      });
      return;
    }
    let data;
    try {
      data = matter(lines.join('\n')).data;
    } catch {
      onError({ lineNumber: 1, detail: 'Front Matter の YAML が不正です' });
      return;
    }
    for (const [field, validate] of Object.entries(fields)) {
      if (!Object.prototype.hasOwnProperty.call(data, field)) {
        onError({
          lineNumber: 1,
          detail: `必須フィールド "${field}" が Front Matter に定義されていません`,
        });
      } else if (!validate(data[field])) {
        onError({
          lineNumber: 1,
          detail: `"${field}" の型が Qiita CLI の仕様と一致しません`,
        });
      }
    }
    for (const [field, validate] of Object.entries(optionalFields)) {
      if (data[field] !== undefined && !validate(data[field])) {
        onError({
          lineNumber: 1,
          detail: `"${field}" の型が Qiita CLI の仕様と一致しません`,
        });
      }
    }
  },
};
