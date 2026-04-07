import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ArticleParser, UNDATED_PREFIX } from '../articleParser';

let tmpDir: string;
let parser: ArticleParser;

function write(name: string, content: string, subDir?: string): void {
  const dir = subDir ? path.join(tmpDir, subDir) : tmpDir;
  if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
  fs.writeFileSync(path.join(dir, `${name}.md`), content, 'utf-8');
}

function frontMatter(fields: Record<string, string>, extra = ''): string {
  const lines = ['---'];
  for (const [k, v] of Object.entries(fields)) { lines.push(`${k}: ${v}`); }
  lines.push('---');
  if (extra) { lines.push('', extra); }
  return lines.join('\n');
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'article-test-'));
  parser = new ArticleParser(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── Group 1: parseAll() ────────────────────────────────────────────────────

describe('parseAll()', () => {
  it('returns [] when directory does not exist', () => {
    const p = new ArticleParser(path.join(tmpDir, 'nonexistent'));
    expect(p.parseAll()).toEqual([]);
  });

  it('returns single article for one .md file', () => {
    write('20230101-hello', frontMatter({ title: 'Hello' }));
    const articles = parser.parseAll();
    expect(articles).toHaveLength(1);
    expect(articles[0].slug).toBe('20230101-hello');
    expect(articles[0].title).toBe('Hello');
  });

  it('returns multiple articles', () => {
    write('20230101-first', frontMatter({ title: 'First' }));
    write('20230201-second', frontMatter({ title: 'Second' }));
    write('20230301-third', frontMatter({ title: 'Third' }));
    expect(parser.parseAll()).toHaveLength(3);
  });

  it('sorts articles by displayDate ascending', () => {
    write('20230301-c', frontMatter({ title: 'C' }));
    write('20230101-a', frontMatter({ title: 'A' }));
    write('20230201-b', frontMatter({ title: 'B' }));
    const articles = parser.parseAll();
    expect(articles.map(a => a.title)).toEqual(['A', 'B', 'C']);
  });

  it('skips dot directories', () => {
    write('article', frontMatter({ title: 'Visible' }));
    write('hidden', frontMatter({ title: 'Hidden' }), '.hidden');
    const articles = parser.parseAll();
    expect(articles).toHaveLength(1);
    expect(articles[0].title).toBe('Visible');
  });

  it('recurses into non-dot subdirectories', () => {
    write('20230101-sub', frontMatter({ title: 'Sub' }), 'subdir');
    const articles = parser.parseAll();
    expect(articles).toHaveLength(1);
    expect(articles[0].title).toBe('Sub');
  });
});

// ─── Group 2: Status determination ──────────────────────────────────────────

describe('status determination', () => {
  it('Published when id is present', () => {
    write('20230101-pub', frontMatter({ title: 'Pub', id: 'abc123' }));
    const [a] = parser.parseAll();
    expect(a.status).toBe('Published');
    expect(a.qiitaId).toBe('abc123');
  });

  it('Draft by default (ignorePublish: true)', () => {
    write('20230101-draft', frontMatter({ title: 'Draft' }));
    const [a] = parser.parseAll();
    expect(a.status).toBe('Draft');
  });

  it('Ready when ignorePublish is false', () => {
    write('20230101-ready', frontMatter({ title: 'Ready', ignorePublish: 'false' }));
    const [a] = parser.parseAll();
    expect(a.status).toBe('Ready');
  });

  it('Scheduled for future scheduled_publish', () => {
    write('20230101-sched', frontMatter({ title: 'Sched', scheduled_publish: '2099-12-31' }));
    const [a] = parser.parseAll();
    expect(a.status).toBe('Scheduled');
    expect(a.scheduledDate).toBe('2099-12-31');
  });

  it('ScheduledPast for past scheduled_publish', () => {
    write('20230101-past', frontMatter({ title: 'Past', scheduled_publish: '2020-01-01' }));
    const [a] = parser.parseAll();
    expect(a.status).toBe('ScheduledPast');
    expect(a.scheduledDate).toBe('2020-01-01');
  });

  it('Draft when scheduled_publish is invalid date string', () => {
    write('20230101-inv', frontMatter({ title: 'Inv', scheduled_publish: 'not-a-date' }));
    const [a] = parser.parseAll();
    expect(a.status).toBe('Draft');
    expect(a.scheduledDate).toBeNull();
  });

  it('ignores id: null (treats as no id)', () => {
    write('20230101-noid', frontMatter({ title: 'NoId', id: 'null' }));
    const [a] = parser.parseAll();
    expect(a.status).toBe('Draft');
    expect(a.qiitaId).toBeNull();
  });
});

// ─── Group 3: Front matter parsing ──────────────────────────────────────────

describe('front matter parsing', () => {
  it('parses inline comma-separated tags', () => {
    write('20230101-tags', frontMatter({ title: 'Tags', tags: 'TypeScript, JavaScript, Node.js' }));
    const [a] = parser.parseAll();
    expect(a.tags).toEqual(['TypeScript', 'JavaScript', 'Node.js']);
  });

  it('parses block-style tags', () => {
    const content = '---\ntitle: Tags\ntags:\n  - TypeScript\n  - JavaScript\n---';
    write('20230101-block', content);
    const [a] = parser.parseAll();
    expect(a.tags).toEqual(['TypeScript', 'JavaScript']);
  });

  it('strips quotes from title', () => {
    write('20230101-quoted', frontMatter({ title: '"My Article"' }));
    const [a] = parser.parseAll();
    expect(a.title).toBe('My Article');
  });

  it('uses default title when title is empty', () => {
    write('20230101-empty', frontMatter({ title: '' }));
    const [a] = parser.parseAll();
    expect(a.title).toBe('（名称未入力）');
  });

  it('uses default title when there is no front matter', () => {
    write('20230101-nofm', 'Just some content without front matter');
    const [a] = parser.parseAll();
    expect(a.title).toBe('（名称未入力）');
  });

  it('parses isPrivate: true', () => {
    write('20230101-priv', frontMatter({ title: 'Priv', private: 'true' }));
    const [a] = parser.parseAll();
    expect(a.isPrivate).toBe(true);
  });

  it('parses isPrivate: false by default', () => {
    write('20230101-pub', frontMatter({ title: 'Pub' }));
    const [a] = parser.parseAll();
    expect(a.isPrivate).toBe(false);
  });

  it('strips quotes from tag values in block style', () => {
    const content = '---\ntitle: Tags\ntags:\n  - "TypeScript"\n  - \'JavaScript\'\n---';
    write('20230101-qtagblock', content);
    const [a] = parser.parseAll();
    expect(a.tags).toEqual(['TypeScript', 'JavaScript']);
  });
});

// ─── Group 4: Date prefix ───────────────────────────────────────────────────

describe('date prefix', () => {
  it('parses dated slug (YYYYMMDD-slug)', () => {
    write('20230615-article', frontMatter({ title: 'Dated' }));
    const [a] = parser.parseAll();
    expect(a.fileDate).toBe('2023-06-15');
    expect(a.slug).toBe('20230615-article');
  });

  it('undated prefix (99999999-slug) sets hasDate=false and empty fileDate', () => {
    write(`${UNDATED_PREFIX}-undated`, frontMatter({ title: 'Undated' }));
    const [a] = parser.parseAll();
    expect(a.fileDate).toBe('');
  });

  it('no-prefix slug is still parsed', () => {
    write('no-prefix-article', frontMatter({ title: 'NoPrefix' }));
    const [a] = parser.parseAll();
    expect(a.title).toBe('NoPrefix');
    expect(a.fileDate).toBe('');
    expect(a.slug).toBe('no-prefix-article');
  });
});

// ─── Group 5: displayDate logic ─────────────────────────────────────────────

describe('displayDate logic', () => {
  it('uses scheduledDate first', () => {
    write('20230101-sched', frontMatter({ title: 'S', scheduled_publish: '2099-06-01' }));
    const [a] = parser.parseAll();
    expect(a.displayDate).toBe('2099-06-01');
  });

  it('uses fileDate when ignorePublish is false (Ready)', () => {
    write('20230615-ready', frontMatter({ title: 'R', ignorePublish: 'false' }));
    const [a] = parser.parseAll();
    expect(a.displayDate).toBe('2023-06-15');
  });

  it('uses created_at ISO 8601 timestamp when no other date', () => {
    write(`${UNDATED_PREFIX}-c`, frontMatter({ title: 'C', created_at: '2023-03-10T12:00:00+09:00' }));
    const [a] = parser.parseAll();
    expect(a.displayDate).toBe('2023-03-10');
  });

  it('uses updated_at timestamp as fallback after created_at', () => {
    write(`${UNDATED_PREFIX}-u`, frontMatter({ title: 'U', updated_at: '2023-07-20T00:00:00Z' }));
    const [a] = parser.parseAll();
    expect(a.displayDate).toBe('2023-07-20');
  });

  it('displayDate is empty string when no date info available', () => {
    write(`${UNDATED_PREFIX}-nd`, frontMatter({ title: 'ND' }));
    const [a] = parser.parseAll();
    expect(a.displayDate).toBe('');
  });

  it('hasDate is true when displayDate is non-empty', () => {
    write('20230101-has', frontMatter({ title: 'Has', ignorePublish: 'false' }));
    const [a] = parser.parseAll();
    expect(a.hasDate).toBe(true);
  });

  it('hasDate is false when displayDate is empty', () => {
    write(`${UNDATED_PREFIX}-nodate`, frontMatter({ title: 'NoDate' }));
    const [a] = parser.parseAll();
    expect(a.hasDate).toBe(false);
  });
});

// ─── Group 6: qiitaId and isPrivate ─────────────────────────────────────────

describe('qiitaId extraction', () => {
  it('qiitaId is the id field value when present', () => {
    write('20230101-id', frontMatter({ title: 'ID', id: 'myQiitaId' }));
    const [a] = parser.parseAll();
    expect(a.qiitaId).toBe('myQiitaId');
  });

  it('qiitaId is null when id is absent', () => {
    write('20230101-noid', frontMatter({ title: 'NoId' }));
    const [a] = parser.parseAll();
    expect(a.qiitaId).toBeNull();
  });

  it('qiitaId is null when id is "null"', () => {
    write('20230101-nullid', frontMatter({ title: 'NullId', id: 'null' }));
    const [a] = parser.parseAll();
    expect(a.qiitaId).toBeNull();
  });
});

// ─── Group 7: parseDateFromTimestamp (tested indirectly via displayDate) ────

describe('parseDateFromTimestamp', () => {
  it('parses ISO 8601 timestamp from created_at', () => {
    write(`${UNDATED_PREFIX}-iso`, frontMatter({ title: 'ISO', created_at: '2023-05-20T15:30:00+09:00' }));
    const [a] = parser.parseAll();
    expect(a.displayDate).toBe('2023-05-20');
  });

  it('parses plain YYYY-MM-DD from created_at', () => {
    write(`${UNDATED_PREFIX}-plain`, frontMatter({ title: 'Plain', created_at: '2023-08-15' }));
    const [a] = parser.parseAll();
    expect(a.displayDate).toBe('2023-08-15');
  });

  it('returns empty displayDate for null created_at', () => {
    write(`${UNDATED_PREFIX}-null`, frontMatter({ title: 'Null', created_at: 'null' }));
    const [a] = parser.parseAll();
    expect(a.displayDate).toBe('');
  });

  it('returns empty displayDate for empty-string created_at', () => {
    write(`${UNDATED_PREFIX}-empty`, frontMatter({ title: 'Empty', created_at: "''" }));
    const [a] = parser.parseAll();
    expect(a.displayDate).toBe('');
  });

  it('returns empty displayDate for invalid date string', () => {
    write(`${UNDATED_PREFIX}-inv`, frontMatter({ title: 'Inv', created_at: 'not-a-date' }));
    const [a] = parser.parseAll();
    expect(a.displayDate).toBe('');
  });
});

// ─── Group 8: CRLF support ───────────────────────────────────────────────────

describe('CRLF support in front matter', () => {
  it('parses front matter with CRLF line endings', () => {
    const content = '---\r\ntitle: CRLF Title\r\ntags: TypeScript, CRLF\r\n---\r\n';
    write('20230101-crlf', content);
    const [a] = parser.parseAll();
    expect(a.title).toBe('CRLF Title');
    expect(a.tags).toEqual(['TypeScript', 'CRLF']);
  });
});

// ─── Group 9: updatedAt parsing ──────────────────────────────────────────────

describe('updatedAt parsing', () => {
  it('captures updated_at value', () => {
    write('20230101-upd', frontMatter({ title: 'Upd', updated_at: '2023-09-01T00:00:00+09:00' }));
    const [a] = parser.parseAll();
    expect(a.updatedAt).toBe('2023-09-01T00:00:00+09:00');
  });

  it('updatedAt is null when updated_at is empty quotes', () => {
    write('20230101-noUpd', frontMatter({ title: 'NoUpd', updated_at: "''" }));
    const [a] = parser.parseAll();
    expect(a.updatedAt).toBeNull();
  });
});
