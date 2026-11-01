import { beforeEach, describe, expect, it } from 'vitest';
import MarkdownIt from 'markdown-it';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { workspace } from './vscodeStub';
import { activate } from '../src/extension';
import { ROOT } from './qiitaFixture';

const doc = (rel: string) => path.join(ROOT, rel);

function render(
  src: string,
  currentDocument: string | undefined = doc('public/a.md'),
) {
  const md = activate().extendMarkdownIt(new MarkdownIt({ html: true }));
  return md.render(src, currentDocument ? { currentDocument } : {});
}

beforeEach(() => {
  workspace.workspaceFolders = [{ uri: { fsPath: ROOT }, name: 'articles' }];
});

describe('対象ドキュメントの判定（マルチルート）', () => {
  it('VS Code の文書不明で解析→別 env で描画する経路にも対応する', () => {
    const md = activate().extendMarkdownIt(new MarkdownIt());
    const tokens = md.parse('one\ntwo\n\n:::note info\nx\n:::', {});
    const env = { currentDocument: { fsPath: doc('public/a.md') } };
    const article = md.renderer.render(
      tokens,
      { ...md.options, breaks: false },
      env,
    );
    expect(article).toContain('qiita-note-info');
    expect(article).toContain('<br>');
    const normal = md.renderer.render(tokens, md.options, {
      currentDocument: doc('README.md'),
    });
    expect(normal).not.toContain('qiita-note-info');
    expect(normal).not.toContain('qiita-markdown');
    expect(normal).not.toContain('<br>');
  });

  it('通常の Markdown の改行設定を維持する', () => {
    const md = activate().extendMarkdownIt(new MarkdownIt({ breaks: true }));
    expect(md.render('a\nb', { currentDocument: doc('README.md') })).toContain(
      '<br>',
    );
  });

  it('対象外文書は標準 Markdown-It と同じ HTML を返す', () => {
    const source =
      '# Heading\n\nfirst\nsecond\n\n:::note info\nx\n:::\n\n`#fff`\n\n```js:a.js\nlet a;\n```';
    const standard = new MarkdownIt({ html: true }).render(source);
    expect(render(source, doc('README.md'))).toBe(standard);
  });

  it('入れ子の別ワークスペースを親の Qiita public/ と誤認しない', () => {
    const nested = doc('public/website');
    workspace.workspaceFolders = [
      { uri: { fsPath: ROOT }, name: 'articles' },
      { uri: { fsPath: nested }, name: 'website' },
    ];
    expect(
      render(':::note\nx\n:::', path.join(nested, 'public/a.md')),
    ).not.toContain('qiita-note-info');
  });
  it('public/ 配下は Qiita 構文を適用し、改行を <br> にする', () => {
    const html = render('a\nb\n\n:::note info\nx\n:::');
    expect(html).toContain('<br>');
    expect(html).toContain('qiita-note');
  });

  it('他のワークスペースフォルダの Markdown には適用しない', () => {
    workspace.workspaceFolders = [
      { uri: { fsPath: ROOT }, name: 'articles' },
      { uri: { fsPath: path.resolve('/ws/other') }, name: 'other' },
    ];
    const html = render(
      'a\nb\n\n:::note info\nx\n:::\n\n- [x] t',
      path.resolve('/ws/other/README.md'),
    );
    expect(html).not.toContain('<br>');
    expect(html).not.toContain('qiita-note');
    expect(html).not.toContain('qiita-task');
  });

  it('同じインスタンスで Qiita → 非 Qiita → Qiita と切り替わる', () => {
    const md = activate().extendMarkdownIt(new MarkdownIt());
    const q = (d: string) => md.render('a\nb', { currentDocument: d });
    expect(q(doc('public/a.md'))).toContain('<br>');
    expect(q(path.resolve('/elsewhere/a.md'))).not.toContain('<br>');
    expect(q(doc('public/a.md'))).toContain('<br>');
  });

  it('qiita.config.json があっても public/ 外には適用しない', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qiita-preview-'));
    try {
      workspace.workspaceFolders = [{ uri: { fsPath: tmp }, name: 'tmp' }];
      expect(render('a\nb', path.join(tmp, 'docs.md'))).not.toContain('<br>');
      fs.writeFileSync(path.join(tmp, 'qiita.config.json'), '{}');
      expect(render('a\nb', path.join(tmp, 'docs.md'))).not.toContain('<br>');
      expect(render('a\nb', path.join(tmp, 'public/a.md'))).toContain('<br>');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('ドキュメントが不明なら適用しない', () => {
    const md = activate().extendMarkdownIt(new MarkdownIt());
    expect(md.render('a\nb', {})).not.toContain('<br>');
    expect(md.render('# title', {})).not.toContain('qiita-markdown');
  });

  it('CLI 依存宣言のあるフォルダと通常の public/ を区別する', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qiita-gate-'));
    try {
      workspace.workspaceFolders = [
        { uri: { fsPath: tmp }, name: 'cli' },
        { uri: { fsPath: ROOT }, name: 'articles' },
      ];
      const article = path.join(tmp, 'public/a.md');
      expect(render('a\nb', article)).not.toContain('qiita-markdown');
      fs.writeFileSync(
        path.join(tmp, 'package.json'),
        JSON.stringify({ devDependencies: { '@qiita/qiita-cli': '1.12.0' } }),
      );
      expect(render('a\nb', article)).toContain('qiita-markdown');
      expect(render('a\nb', path.join(tmp, 'README.md'))).not.toContain(
        'qiita-markdown',
      );
      expect(render('a\nb', path.join(tmp, 'public-other/a.md'))).not.toContain(
        'qiita-markdown',
      );
      expect(render('a\nb', doc('public/a.md'))).toContain('qiita-markdown');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe(':::note', () => {
  it('未知の種別は info、3語目以降は無視する（上流互換）', () => {
    expect(render(':::note unknown ignored\nx\n:::')).toContain(
      'qiita-note-info',
    );
    expect(render(':::note warn ignored\nx\n:::')).toContain('qiita-note-warn');
  });
  it.each(['info', 'warn', 'alert'])('%s を描画する', (type) => {
    const html = render(`:::note ${type}\n本文\n:::`);
    expect(html).toContain(`qiita-note-${type}`);
    expect(html).toContain('本文');
  });

  it('種別省略は info', () => {
    expect(render(':::note\nx\n:::')).toContain('qiita-note-info');
  });

  it('コードフェンス内の ::: では閉じない', () => {
    const html = render(':::note info\n```\n:::\n```\nafter\n:::\n');
    expect(html).toContain('after');
    expect(html.indexOf('after')).toBeLessThan(
      html.lastIndexOf('</div></div>'),
    );
  });

  it('閉じがなければ note にしない', () => {
    expect(render(':::note info\nx')).not.toContain('qiita-note');
  });
});

describe('コードブロック', () => {
  it('ファイル名のみ・言語省略・コロンを含むファイル名に対応する', () => {
    for (const info of ['example.rb', ':example.rb', 'ruby:example:part.rb']) {
      expect(render('```' + info + '\nputs 1\n```')).toContain(
        'qiita-code-filename',
      );
    }
  });
  it('lang:filename でファイル名ヘッダーを付け、info を壊さない', () => {
    const md = activate().extendMarkdownIt(new MarkdownIt());
    const env = { currentDocument: doc('public/a.md') };
    const tokens = md.parse('```ts:a.ts\nconst x = 1;\n```', env);
    const html = md.renderer.render(tokens, md.options, env);
    expect(html).toContain('qiita-code-filename');
    expect(html).toContain('a.ts');
    expect(tokens.find((t) => t.type === 'fence')!.info).toBe('ts:a.ts');
    // 2 回描画しても同じ
    expect(md.renderer.render(tokens, md.options, env)).toBe(html);
  });

  it('diff_言語 は +/- 行を色分けする', () => {
    const html = render('```diff_js\n+ add\n- del\n ctx\n```');
    expect(html).toContain('qiita-diff-add');
    expect(html).toContain('qiita-diff-del');
    expect(html).toContain('qiita-diff-ctx');
  });

  it('通常のコードブロックはそのまま', () => {
    const html = render('```js\nlet a;\n```');
    expect(html).not.toContain('qiita-code-frame');
  });
});

describe('インラインカラー', () => {
  it('HEX / rgb / hsl にスウォッチを付ける', () => {
    for (const c of [
      '#fff',
      '#FF00AA',
      'rgb(1, 2, 3)',
      'rgba(1,2,3,0.5)',
      'hsl(10, 20%, 30%)',
    ]) {
      expect(render('`' + c + '`'), c).toContain('qiita-inline-color');
    }
  });

  it('色でないコードや不正な値には付けない', () => {
    for (const c of ['#ff', '#ggg', 'rgb(a)', 'foo', 'rgb(1);x']) {
      expect(render('`' + c + '`'), c).not.toContain('qiita-inline-color');
    }
  });
});

describe('数式', () => {
  it('複数バッククォートを使う旧形式と二重ドルの除外に対応する', () => {
    expect(render('$``a`b``$')).toContain('qiita-math-inline');
    expect(render('$$`x`$$')).not.toContain('qiita-math-inline');
  });
  it('```math を math_block にする（フォールバック描画）', () => {
    expect(render('```math\ne^{i\\pi}+1=0\n```')).toContain('qiita-math-block');
  });

  it('$`...`$ をインライン数式にする', () => {
    const html = render('式は $`a^2+b^2`$ です');
    expect(html).toContain('qiita-math-inline');
    expect(html).toContain('a^2+b^2');
  });

  it('閉じがない $` は通常テキスト', () => {
    expect(render('$`abc')).not.toContain('qiita-math-inline');
  });
});

describe('脚注', () => {
  it('脚注内でも対象文書を引き継ぎ、本文の改行処理を維持する', () => {
    const html = render('one\ntwo[^a]\n\n[^a]: color `#fff`');
    expect(html).toContain('<br>');
    expect(html).toContain('qiita-inline-color');
  });
  it('参照順に番号を振り、定義順には依存しない', () => {
    const html = render('A[^b] B[^a]\n\n[^a]: first\n[^b]: second');
    expect(html.indexOf('href="#fn-1"')).toBeLessThan(
      html.indexOf('href="#fn-2"'),
    );
    expect(html).toMatch(/<li id="fn-1"[^>]*><p>second/);
    expect(html).toMatch(/<li id="fn-2"[^>]*><p>first/);
  });

  it('複数回参照すると backref が増える', () => {
    const html = render('A[^1] B[^1]\n\n[^1]: note');
    expect(html).toContain('id="fnref-1-2"');
    expect(html.match(/qiita-footnote-backref/g)).toHaveLength(2);
  });

  it('定義のない参照は通常テキスト、参照のない定義は出力しない', () => {
    const html = render('A[^x]\n\n[^y]: unused');
    expect(html).toContain('[^x]');
    expect(html).not.toContain('qiita-footnotes');
    expect(html).not.toContain('unused');
  });

  it('複数行の定義を継続行として結合する', () => {
    const html = render('A[^1]\n\n[^1]: line1\n    line2\n\nnext paragraph');
    expect(html).toContain('line1');
    expect(html).toContain('line2');
    expect(html).toContain('<p>next paragraph</p>');
  });
});

describe('タスクリスト・絵文字', () => {
  it('チェックボックスに変換する', () => {
    const html = render('- [x] done\n- [ ] todo');
    expect(html).toContain('qiita-task-list');
    expect(html.match(/qiita-task-list"/g)).toHaveLength(1);
    expect(html).toMatch(/<input[^>]*disabled checked>\s*done/);
    expect(html).toMatch(/<input[^>]*disabled>\s*todo/);
  });

  it('絵文字ショートコードを変換し、未知の名前・コード内は変換しない', () => {
    expect(render(':tada: :unknown_emoji:')).toContain('🎉 :unknown_emoji:');
    expect(render('`:tada:`')).toContain('<code>:tada:</code>');
  });
});

describe('埋め込み', () => {
  it.each([
    ['https://www.youtube.com/watch?v=abc_123', 'qiita-embed-youtube'],
    ['https://x.com/user/status/123', 'X (Twitter)'],
    ['https://github.com/o/r/blob/main/a.ts#L1-L5', 'GitHub'],
    ['https://gist.github.com/user/0123abcd', 'GitHub Gist'],
    ['https://example.com/page', 'qiita-embed-linkcard'],
  ])('%s', (url, expected) => {
    expect(render(url)).toContain(expected);
  });

  it('文章中の URL は埋め込みにしない', () => {
    expect(render('see https://example.com/page now')).not.toContain(
      'qiita-embed',
    );
  });

  it('URL の HTML をエスケープする', () => {
    const html = render('https://example.com/?a=1&b="x"');
    expect(html).not.toContain('b="x"');
  });
});
