const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ruleNames = [
  'front-matter',
  'note-block',
  'code-block',
  'math-block',
  'details-summary',
  'embed',
  'inline-math',
];
const customRules = ruleNames.map((name) =>
  require(`../.markdownlint-rules/qiita-${name}`),
);
const frontMatter = `---
title: test
tags: []
private: false
updated_at: ''
id: null
organization_url_name: null
slide: false
---
`;
async function lint(body, name = 'public/test.md', header = frontMatter) {
  const { lint } = await import('markdownlint/promise');
  const key = path.resolve(name);
  const result = await lint({
    markdownItFactory: () => require('markdown-it')({ html: true }),
    strings: { [key]: header + body },
    config: {
      default: false,
      ...Object.fromEntries(customRules.map((rule) => [rule.names[1], true])),
    },
    customRules,
  });
  return result[key];
}

for (const example of [
  '```markdown\n:::note invalid\n<details>\n$$\n<script src="https://example.com/a.js"></script>\n```',
  '````markdown\n```js:\n:::note\n````',
  '    <script src="https://example.com/a.js"></script>\n    :::note\n    <details>',
  '`<details>` and `<script src="https://example.com/a.js"></script>`',
  '``$`example` ``',
  '<!--\n:::note\n<details>\n<script src="https://example.com/a.js"></script>\n-->',
  ':::note unknown ignored words\ntext\n:::',
  '<details>default summary is allowed</details>',
  '<details><details></details></details>',
  '```example.rb\nputs 1\n```\n\n```:example.rb\nputs 1\n```\n\n```ruby:\nputs 1\n```',
  '$x^2$ and $`x^2`$ and $``a`b``$',
  '<iframe\n src="https://claude.site/a"></iframe>',
  '<iframe src=//embed.figma.com/a></iframe>',
  '<script src="https://public.codepenassets.com/embed/index.js"></script>',
  '<script src="//speakerdeck.com/assets/embed.js"></script>',
])
  test(`accepts valid or literal content: ${example.slice(0, 65)}`, async () => {
    assert.deepEqual(await lint(example), []);
  });

for (const [body, code] of [
  [':::note info\ntext', 'QFM002'],
  ['$$\nx', 'QFM004'],
  ['<details>text', 'QFM005'],
  ['</details>', 'QFM005'],
  ['<iframe src="https://speakerdeck.com/a"></iframe>', 'QFM006'],
  ['<script src="https://platform.x.com/widgets.js"></script>', 'QFM006'],
  ['<iframe src="ftp://www.youtube.com/a"></iframe>', 'QFM006'],
  ['<script src="//asciinema.org/a.js"></script>', 'QFM006'],
  ['<iframe></iframe>', 'QFM006'],
  ['$`x`', 'QFM007'],
])
  test(`reports ${code}: ${body}`, async () => {
    assert.ok(
      (await lint(body)).some((error) => error.ruleNames.includes(code)),
    );
  });

test('multiple embed tags on one line and correct source lines', async () => {
  const errors = await lint(
    'text\n\n<iframe src="https://www.youtube.com/a"></iframe><script\n src="https://example.com/a.js"></script>',
  );
  assert.equal(errors.length, 1);
  assert.equal(errors[0].lineNumber, frontMatter.split('\n').length + 2);
});
test('remote mirrors and non-article Markdown are excluded', async () => {
  assert.deepEqual(await lint(':::note', 'public/.remote/a.md', ''), []);
  assert.deepEqual(await lint(':::note', 'docs/a.md', ''), []);
  assert.deepEqual(
    await lint(
      ':::note',
      'public/slides/a.md',
      '---\nmarp: true\ntitle: slide\n---\n',
    ),
    [],
  );
});
test('Front Matter YAML is parsed with CLI types, including campaign metadata', async () => {
  assert.deepEqual(
    await lint(
      '',
      'public/test.md',
      frontMatter.replace(
        'slide: false',
        'slide: false\nposting_campaign_uuid: null\nagreed_posting_campaign_term: false',
      ),
    ),
    [],
  );
  const errors = await lint(
    '',
    'public/test.md',
    frontMatter.replace('private: false', 'private: "false"'),
  );
  assert.ok(errors.some((e) => e.ruleNames.includes('QFM001')));
  assert.deepEqual(
    await lint(
      '',
      'public/test.md',
      frontMatter.replace('title: test', 'title: |\n  multiline title'),
    ),
    [],
  );
});
