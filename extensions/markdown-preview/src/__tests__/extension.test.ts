import { describe, it, expect, beforeEach } from 'vitest';
import MarkdownIt from 'markdown-it';
import { activate } from '../extension';

let md: MarkdownIt;

beforeEach(() => {
  md = activate().extendMarkdownIt(new MarkdownIt());
});

// ─── noteBlockPlugin ─────────────────────────────────────────────────────────

describe('noteBlockPlugin', () => {
  it(':::note renders info div by default', () => {
    const result = md.render(':::note\nSome info content\n:::');
    expect(result).toContain('class="qiita-note qiita-note-info"');
    expect(result).toContain('Some info content');
  });

  it(':::note info renders info div explicitly', () => {
    const result = md.render(':::note info\nInfo content\n:::');
    expect(result).toContain('qiita-note-info');
    expect(result).toContain('qiita-note-icon-info');
  });

  it(':::note warn renders warn div', () => {
    const result = md.render(':::note warn\nWarning content\n:::');
    expect(result).toContain('qiita-note-warn');
    expect(result).toContain('qiita-note-icon-warn');
    expect(result).toContain('Warning content');
  });

  it(':::note alert renders alert div', () => {
    const result = md.render(':::note alert\nAlert content\n:::');
    expect(result).toContain('qiita-note-alert');
    expect(result).toContain('qiita-note-icon-alert');
    expect(result).toContain('Alert content');
  });

  it('unclosed ::: is not transformed into a note block', () => {
    const result = md.render(':::note\nContent without closing');
    expect(result).not.toContain('qiita-note');
  });

  it('nested code block inside note does not close the note early', () => {
    const result = md.render(':::note\n```\n:::\n```\nEnd\n:::');
    expect(result).toContain('qiita-note-info');
    expect(result).toContain('End');
  });
});

// ─── mathFencePlugin ─────────────────────────────────────────────────────────

describe('mathFencePlugin', () => {
  it('```math block renders math content', () => {
    const result = md.render('```math\nE = mc^2\n```');
    expect(result).toContain('E = mc^2');
  });

  it('```math block uses qiita-math-block wrapper (fallback renderer)', () => {
    const result = md.render('```math\n\\sum_{i=0}^{n} i\n```');
    expect(result).toContain('qiita-math-block');
  });

  it('regular code blocks are not affected', () => {
    const result = md.render('```javascript\nconsole.log("hello")\n```');
    expect(result).not.toContain('qiita-math-block');
    expect(result).toContain('console.log');
  });
});

// ─── codeFilenamePlugin ───────────────────────────────────────────────────────

describe('codeFilenamePlugin', () => {
  it('lang:filename renders filename header', () => {
    const result = md.render('```typescript:myFile.ts\nconst x = 1;\n```');
    expect(result).toContain('qiita-code-filename');
    expect(result).toContain('myFile.ts');
  });

  it('wraps code in qiita-code-frame with data-lang', () => {
    const result = md.render('```python:script.py\nprint("hello")\n```');
    expect(result).toContain('class="qiita-code-frame"');
    expect(result).toContain('data-lang="python"');
  });

  it('escapes HTML in filename', () => {
    const result = md.render('```js:<script>.js\ncode\n```');
    expect(result).toContain('&lt;script&gt;');
    expect(result).not.toContain('<script>');
  });

  it('code block without colon is not affected', () => {
    const result = md.render('```typescript\nconst x = 1;\n```');
    expect(result).not.toContain('qiita-code-frame');
  });
});

// ─── footnotePlugin ───────────────────────────────────────────────────────────

describe('footnotePlugin', () => {
  it('renders footnote reference as superscript link', () => {
    const result = md.render('Text[^1]\n\n[^1]: Footnote content');
    expect(result).toContain('qiita-footnote-ref');
    expect(result).toContain('fnref-1');
  });

  it('renders footnote definition section', () => {
    const result = md.render('Text[^note]\n\n[^note]: My footnote');
    expect(result).toContain('class="qiita-footnotes"');
    expect(result).toContain('My footnote');
  });

  it('renders multiple footnotes in order', () => {
    const result = md.render(
      'First[^a] second[^b]\n\n[^a]: First note\n\n[^b]: Second note',
    );
    expect(result).toContain('fn-a');
    expect(result).toContain('fn-b');
    expect(result).toContain('First note');
    expect(result).toContain('Second note');
  });

  it('footnote section has separator', () => {
    const result = md.render('Ref[^1]\n\n[^1]: Content');
    expect(result).toContain('qiita-footnotes-sep');
  });

  it('text without footnotes has no footnote section', () => {
    const result = md.render('Just some text');
    expect(result).not.toContain('qiita-footnotes');
  });
});

// ─── embedPlugin ─────────────────────────────────────────────────────────────

describe('embedPlugin', () => {
  it('standalone YouTube URL renders embed card', () => {
    const result = md.render('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(result).toContain('qiita-embed-youtube');
    expect(result).toContain('dQw4w9WgXcQ');
  });

  it('YouTube short URL (youtu.be) renders embed card', () => {
    const result = md.render('https://youtu.be/dQw4w9WgXcQ');
    expect(result).toContain('qiita-embed');
    expect(result).toContain('YouTube');
  });

  it('standalone Twitter URL renders embed card', () => {
    const result = md.render('https://twitter.com/user/status/123456789');
    expect(result).toContain('qiita-embed-service');
    expect(result).toContain('X (Twitter)');
  });

  it('standalone X.com URL renders embed card', () => {
    const result = md.render('https://x.com/user/status/987654321');
    expect(result).toContain('qiita-embed');
  });

  it('standalone unknown URL renders link card', () => {
    const result = md.render('https://example.com/some-page');
    expect(result).toContain('qiita-embed-linkcard');
    expect(result).toContain('example.com');
  });

  it('non-URL paragraph is not changed to embed', () => {
    const result = md.render('This is just a sentence.');
    expect(result).not.toContain('qiita-embed');
    expect(result).toContain('This is just a sentence.');
  });

  it('URL with surrounding text is not converted to embed', () => {
    const result = md.render(
      'Check out https://www.youtube.com/watch?v=dQw4w9WgXcQ here',
    );
    expect(result).not.toContain('qiita-embed');
  });

  it('CodePen URL renders embed card', () => {
    const result = md.render('https://codepen.io/user/pen/abcdef');
    expect(result).toContain('qiita-embed');
    expect(result).toContain('CodePen');
  });

  it('GitHub Gist URL renders embed card', () => {
    const result = md.render('https://gist.github.com/user/abc123def456');
    expect(result).toContain('qiita-embed');
    expect(result).toContain('GitHub Gist');
  });
});

// ─── breaks: true ────────────────────────────────────────────────────────────

describe('breaks: true', () => {
  it('single newline in paragraph becomes <br>', () => {
    const result = md.render('line one\nline two');
    expect(result).toContain('<br>');
  });
});

// ─── escapeHtml (via embed card output) ──────────────────────────────────────

describe('escapeHtml (XSS prevention)', () => {
  it('escapes & in URL within embed card', () => {
    const result = md.render('https://example.com/?a=1&b=2');
    expect(result).toContain('&amp;');
    expect(result).not.toMatch(/href="[^"]*[^&]&[^a][^m][^p]/);
  });

  it('escapes < and > in code filename to prevent XSS', () => {
    const result = md.render('```js:<img onerror="bad">.js\ncode\n```');
    expect(result).not.toContain('<img');
    expect(result).toContain('&lt;img');
  });
});

// ─── inlineColorPlugin ───────────────────────────────────────────────────────

describe('inlineColorPlugin', () => {
  it('HEX color code gets color swatch', () => {
    const result = md.render('Color: `#FF0000`');
    expect(result).toContain('qiita-inline-color');
    expect(result).toContain('background-color: #FF0000');
  });

  it('3-digit HEX color code gets color swatch', () => {
    const result = md.render('Color: `#FFF`');
    expect(result).toContain('qiita-inline-color');
  });

  it('rgb() color gets color swatch', () => {
    const result = md.render('Color: `rgb(255, 0, 0)`');
    expect(result).toContain('qiita-inline-color');
  });

  it('hsl() color gets color swatch', () => {
    const result = md.render('Color: `hsl(0, 100%, 50%)`');
    expect(result).toContain('qiita-inline-color');
  });

  it('non-color inline code is not modified', () => {
    const result = md.render('Code: `someFunction()`');
    expect(result).not.toContain('qiita-inline-color');
  });
});
