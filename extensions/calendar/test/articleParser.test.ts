import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ArticleParser } from '../src/articleParser';

let dir: string;

function write(rel: string, content: string) {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf-8');
  return p;
}

const fm = (lines: string[]) => `---\n${lines.join('\n')}\n---\n\n本文\n`;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiita-parser-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('ArticleParser', () => {
  it('public ディレクトリがなければ空配列', () => {
    expect(new ArticleParser(path.join(dir, 'none')).parseAll()).toEqual([]);
  });

  it('ステータスを判定する', () => {
    write(
      '2025/01/20250101-pub.md',
      fm(["title: 'P'", 'id: abc123', 'ignorePublish: true']),
    );
    write(
      '2025/01/20250102-draft.md',
      fm(["title: 'D'", 'id: null', 'ignorePublish: true']),
    );
    write(
      '2025/01/20250103-ready.md',
      fm(["title: 'R'", 'id: null', 'ignorePublish: false']),
    );
    write(
      '2099/01/20990101-sched.md',
      fm(["title: 'S'", 'id: null', 'scheduled_publish: "2099-01-01"']),
    );
    write(
      '2020/01/20200101-past.md',
      fm(["title: 'X'", 'id: null', 'scheduled_publish: "2020-01-01"']),
    );

    const bySlug = Object.fromEntries(
      new ArticleParser(dir).parseAll().map((a) => [a.slug, a]),
    );
    expect(bySlug['20250101-pub'].status).toBe('Published');
    expect(bySlug['20250101-pub'].qiitaId).toBe('abc123');
    expect(bySlug['20250102-draft'].status).toBe('Draft');
    expect(bySlug['20250103-ready'].status).toBe('Ready');
    expect(bySlug['20990101-sched'].status).toBe('Scheduled');
    expect(bySlug['20990101-sched'].scheduledDate).toBe('2099-01-01');
    expect(bySlug['20200101-past'].status).toBe('ScheduledPast');
  });

  it('filePath にサブディレクトリを含む絶対パスを持つ', () => {
    const p = write('2025/01/20250101-a.md', fm(["title: 'A'"]));
    expect(new ArticleParser(dir).parseAll()[0].filePath).toBe(p);
  });

  it('日付未定 (99999999) は displayDate が空', () => {
    write('99999999-undated.md', fm(["title: 'U'", 'id: null']));
    const [a] = new ArticleParser(dir).parseAll();
    expect(a.displayDate).toBe('');
    expect(a.hasDate).toBe(false);
  });

  it('タイトル空は（名称未入力）', () => {
    write('20250101-x.md', fm(["title: ''"]));
    expect(new ArticleParser(dir).parseAll()[0].title).toBe('（名称未入力）');
  });

  it('タグ: ブロック形式 / インライン / フロー形式 / 空要素', () => {
    write(
      '20250101-a.md',
      fm(['title: a', 'tags:', '  - TypeScript', "  - 'VS Code'", "  - ''"]),
    );
    write('20250102-b.md', fm(['title: b', 'tags: x, y']));
    write('20250103-c.md', fm(['title: c', 'tags: [p, q]']));
    const by = Object.fromEntries(
      new ArticleParser(dir).parseAll().map((a) => [a.slug, a.tags]),
    );
    expect(by['20250101-a']).toEqual(['TypeScript', 'VS Code']);
    expect(by['20250102-b']).toEqual(['x', 'y']);
    expect(by['20250103-c']).toEqual(['p', 'q']);
  });

  it('ドットディレクトリはスキップし、CRLF も読める', () => {
    write('.remote/20250101-remote.md', fm(["title: 'R'"]));
    write(
      '20250102-crlf.md',
      fm(["title: 'C'", 'private: true']).replace(/\n/g, '\r\n'),
    );
    const list = new ArticleParser(dir).parseAll();
    expect(list.map((a) => a.slug)).toEqual(['20250102-crlf']);
    expect(list[0].isPrivate).toBe(true);
    expect(list[0].title).toBe('C');
  });

  it('displayDate は scheduled_publish / created_at から決まる', () => {
    write('20250101-a.md', fm(['title: a', 'scheduled_publish: "2099-05-06"']));
    write('20250101-b.md', fm(['title: b', 'created_at: 2025-03-04']));
    const by = Object.fromEntries(
      new ArticleParser(dir).parseAll().map((a) => [a.slug, a.displayDate]),
    );
    expect(by['20250101-a']).toBe('2099-05-06');
    expect(by['20250101-b']).toBe('2025-03-04');
  });
});
