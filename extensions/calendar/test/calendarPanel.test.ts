import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { CalendarPanel } from '../src/calendarPanel';
import { FakePanel, resetState, state, Uri } from './vscodeStub';

const context = { extensionUri: Uri.file('/ext') } as any;

let tmp: string;
let seq = 0;

function folder(root: string, name = path.basename(root)) {
  return { uri: Uri.file(root), name, index: 0 } as vscode.WorkspaceFolder;
}

function setFolders(folders: vscode.WorkspaceFolder[]) {
  (vscode.workspace as any).workspaceFolders = folders;
}

function makeQiita(root: string) {
  fs.mkdirSync(path.join(root, 'public'), { recursive: true });
  fs.writeFileSync(path.join(root, 'qiita.config.json'), '{}');
}

function article(
  root: string,
  rel: string,
  fields: Record<string, string> = {},
): string {
  const file = path.join(root, 'public', rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const body = Object.entries({
    title: "'t'",
    private: 'false',
    id: 'null',
    ignorePublish: 'true',
    ...fields,
  })
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  fs.writeFileSync(file, `---\n${body}\n---\n\nbody\n`);
  return file;
}

/** webview からリクエストを送り、対応するレスポンスを待つ */
async function request(panel: FakePanel, command: string, params = {}) {
  const id = String(++seq);
  panel.receive({ type: 'request', id, command, ...params });
  await vi.waitFor(() =>
    expect(panel.posted.some((m) => m.id === id)).toBe(true),
  );
  return panel.posted.find((m) => m.id === id);
}

function open(root: string) {
  setFolders([folder(root)]);
  CalendarPanel.openAll(context);
  return state.panels[state.panels.length - 1];
}

beforeEach(() => {
  resetState();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cal-panel-'));
});

afterEach(async () => {
  for (const p of [...state.panels]) p.dispose();
  // 起動直後の git 子プロセスが cwd を掴んでいる間は Windows で削除できないため再試行する
  fs.rmSync(tmp, {
    recursive: true,
    force: true,
    maxRetries: 20,
    retryDelay: 100,
  });
});

describe('CalendarPanel: 起動条件', () => {
  it('Qiita フォルダがなければ候補が空でエラーを出す', async () => {
    setFolders([folder(tmp)]);
    expect(CalendarPanel.getCandidateFolders()).toEqual([]);
    await CalendarPanel.openFromCommand(context);
    expect(state.errors[0]).toContain('Qiita 記事フォルダが見つかりません');
    expect(state.panels).toHaveLength(0);
  });

  it('ワークスペースが開かれていなければエラーを出す', async () => {
    await CalendarPanel.openFromCommand(context);
    expect(state.errors).toEqual(['ワークスペースが開かれていません']);
  });

  it('親フォルダでも子の Qiita フォルダを候補にする', () => {
    makeQiita(path.join(tmp, 'a'));
    setFolders([folder(tmp)]);
    expect(CalendarPanel.getCandidateFolders()).toHaveLength(1);
    CalendarPanel.openAll(context);
    expect(state.panels).toHaveLength(1);
  });

  it('同じフォルダを再度開くと既存パネルを前面に出す', async () => {
    makeQiita(tmp);
    setFolders([folder(tmp)]);
    await CalendarPanel.openFromCommand(context);
    await CalendarPanel.openFromCommand(context);
    expect(state.panels).toHaveLength(1);
    expect(state.panels[0].revealed).toBe(1);
  });

  it('候補が複数ならクイックピックで選ばせ、選択がなければ開かない', async () => {
    const a = path.join(tmp, 'a');
    const b = path.join(tmp, 'b');
    makeQiita(a);
    makeQiita(b);
    setFolders([folder(a), folder(b)]);

    await CalendarPanel.openFromCommand(context);
    expect(state.quickPickItems).toHaveLength(2);
    expect(state.panels).toHaveLength(0);

    state.quickPickResult = { folder: folder(b) };
    await CalendarPanel.openFromCommand(context);
    expect(state.panels).toHaveLength(1);
    expect(state.panels[0].title).toBe('Qiita 記事カレンダー (b)');
  });

  it('単一ワークスペースではタイトルにフォルダ名を付けない', () => {
    makeQiita(tmp);
    const panel = open(tmp);
    expect(panel.title).toBe('Qiita 記事カレンダー');
    expect(panel.webview.html).toContain('data-theme="auto"');
    expect(panel.webview.html).toContain('id="projectSelect"');
  });

  it('不正なテーマ設定は auto に落とす', () => {
    makeQiita(tmp);
    state.configuration.theme = 'bogus';
    expect(open(tmp).webview.html).toContain('data-theme="auto"');
    state.panels.pop()!.dispose();
    state.configuration.theme = 'dark';
    expect(open(tmp).webview.html).toContain('data-theme="dark"');
  });

  it('ワークスペースから外れたフォルダのパネルを閉じる', () => {
    makeQiita(tmp);
    const panel = open(tmp);
    CalendarPanel.closeRemoved([folder(tmp)]);
    expect(panel.disposed).toBe(true);
  });
});

describe('CalendarPanel: 記事フォルダの切り替え', () => {
  function setup() {
    const a = path.join(tmp, 'a');
    const b = path.join(tmp, 'b');
    makeQiita(a);
    makeQiita(b);
    article(a, '2099/01/20990101-from-a.md');
    article(b, '2099/01/20990102-from-b.md');
    return { a, b, panel: open(tmp) };
  }

  it('候補一覧と現在のフォルダを返す', async () => {
    const { a, panel } = setup();
    const res = await request(panel, 'getProjects');
    expect(res.data.current).toBe(a);
    expect(res.data.projects.map((p: any) => p.name)).toEqual(['a', 'b']);
  });

  it('切り替えると記事一覧と監視対象が新しいフォルダに替わる', async () => {
    const { b, panel } = setup();
    expect(
      (await request(panel, 'getArticles')).data.map((x: any) => x.slug),
    ).toEqual(['20990101-from-a']);
    const oldWatcher = state.watchers[0];

    const res = await request(panel, 'switchProject', { path: b });
    expect(res.data).toEqual({ success: true });
    expect(
      (await request(panel, 'getArticles')).data.map((x: any) => x.slug),
    ).toEqual(['20990102-from-b']);
    expect((await request(panel, 'getProjects')).data.current).toBe(b);
    expect(oldWatcher.disposed).toBe(true);
    expect(
      (state.watchers[state.watchers.length - 1].pattern.base as any).fsPath,
    ).toBe(b);
  });

  it('候補にないパスへの切り替えは拒否する', async () => {
    const { a, panel } = setup();
    const outside = path.join(tmp, 'other');
    fs.mkdirSync(outside);
    const res = await request(panel, 'switchProject', { path: outside });
    expect(res.data.success).toBe(false);
    expect((await request(panel, 'getProjects')).data.current).toBe(a);
  });

  it('ファイル変更は debounce して webview に通知し、破棄後は通知しない', async () => {
    vi.useFakeTimers();
    try {
      const { panel } = setup();
      const watcher = state.watchers[0];
      watcher.fire('change');
      watcher.fire('create');
      vi.advanceTimersByTime(499);
      expect(panel.posted).toHaveLength(0);
      vi.advanceTimersByTime(1);
      expect(panel.posted).toEqual([{ type: 'fileChanged' }]);

      watcher.fire('delete');
      panel.dispose();
      vi.advanceTimersByTime(1000);
      expect(panel.posted).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('パネルを閉じると監視を破棄する', () => {
    const { panel } = setup();
    panel.dispose();
    expect(state.watchers.every((w) => w.disposed)).toBe(true);
  });
});

describe('CalendarPanel: 記事操作', () => {
  let root: string;
  let panel: FakePanel;

  beforeEach(() => {
    root = path.join(tmp, 'repo');
    makeQiita(root);
  });

  const start = () => {
    panel = open(root);
  };

  it('getArticles / getArticlesByMonth', async () => {
    article(root, '2099/01/20990105-x.md', {
      ignorePublish: 'false',
    });
    article(root, '2099/02/20990201-y.md', { ignorePublish: 'false' });
    start();
    expect((await request(panel, 'getArticles')).data).toHaveLength(2);
    const res = await request(panel, 'getArticlesByMonth', {
      year: 2099,
      month: 2,
    });
    expect(res.data.map((a: any) => a.slug)).toEqual(['20990201-y']);
  });

  it('不明なコマンドと不正なメッセージ', async () => {
    start();
    expect((await request(panel, 'nope')).error).toContain('Unknown command');
    panel.receive({ type: 'other' });
    panel.receive(undefined);
    expect(panel.posted).toHaveLength(1);
  });

  it('createArticle: 公開 / 予約 / 入力検証', async () => {
    start();
    const today = new Date();
    const y = String(today.getFullYear());
    const m = String(today.getMonth() + 1).padStart(2, '0');

    const created = (await request(panel, 'createArticle', { title: 'hello' }))
      .data;
    expect(created.success).toBe(true);
    expect(created.slug).toMatch(/^\d{8}-hello$/);
    expect(created.filePath).toBe(`public/${y}/${m}/${created.slug}.md`);
    expect(
      fs.existsSync(path.join(root, 'public', y, m, `${created.slug}.md`)),
    ).toBe(true);

    const dup = (await request(panel, 'createArticle', { title: 'hello' }))
      .data;
    expect(dup.success).toBe(false);
    expect(dup.error).toContain('既に存在');

    const scheduled = (
      await request(panel, 'createArticle', {
        title: 'later',
        mode: 'scheduled',
        date: '2099-03-04',
      })
    ).data;
    expect(scheduled.success).toBe(true);
    expect(scheduled.slug).toBe('20990304-later');
    expect(
      fs.readFileSync(
        path.join(root, 'public/2099/03/20990304-later.md'),
        'utf-8',
      ),
    ).toContain('scheduled_publish: "2099-03-04"');

    for (const [params, message] of [
      [{ title: '  ' }, 'スラッグは必須'],
      [{ title: 'a', mode: 'bogus' }, '記事種別が不正'],
      [{ title: 'a', mode: 'scheduled' }, '日付が必須'],
      [{ title: 'a', mode: 'scheduled', date: '2099/01/01' }, '形式が不正'],
      [{ title: 'a', mode: 'scheduled', date: '2099-13-45' }, '形式が不正'],
      [{ title: 'a', mode: 'scheduled', date: '2000-01-01' }, '明日以降'],
      [{ title: '***' }, '使用できる文字がありません'],
    ] as const) {
      const r = (await request(panel, 'createArticle', params)).data;
      expect(r.success, JSON.stringify(params)).toBe(false);
      expect(r.error).toContain(message);
    }
  });

  it('rescheduleArticle: 日付変更・検証・投稿済みの拒否', async () => {
    article(root, '2099/01/20990101-move.md', { ignorePublish: 'false' });
    article(root, '2099/01/20990102-pub.md', { id: 'abc123' });
    start();

    const ok = (
      await request(panel, 'rescheduleArticle', {
        slug: '20990101-move',
        newDate: '2099-05-06',
      })
    ).data;
    expect(ok).toMatchObject({ success: true, newSlug: '20990506-move' });
    const moved = path.join(root, 'public/2099/05/20990506-move.md');
    expect(fs.readFileSync(moved, 'utf-8')).toContain(
      'scheduled_publish: "2099-05-06"',
    );
    expect(
      fs.existsSync(path.join(root, 'public/2099/01/20990101-move.md')),
    ).toBe(false);

    const cases: Array<[object, string]> = [
      [{ slug: '20990102-pub', newDate: '2099-05-06' }, '投稿済み'],
      [{ slug: '20990506-move', newDate: '' }, '指定されていません'],
      [{ slug: '20990506-move', newDate: '2099-5-6' }, '形式が不正'],
      [{ slug: '20990506-move', newDate: '2099-02-31x' }, '形式が不正'],
      [{ slug: '20990506-move', newDate: '2000-01-01' }, '今日以降'],
      [{ slug: 'missing', newDate: '2099-05-06' }, '見つかりません'],
      [{ newDate: '2099-05-06' }, 'スラッグが指定されていません'],
    ];
    for (const [params, message] of cases) {
      const r = (await request(panel, 'rescheduleArticle', params)).data;
      expect(r.success, JSON.stringify(params)).toBe(false);
      expect(r.error).toContain(message);
    }
  });

  it('rescheduleArticle: 今日に移動すると予約を外して投稿準備にする', async () => {
    article(root, '2099/01/20990101-now.md', {
      scheduled_publish: '"2099-01-01"',
    });
    start();
    const t = new Date();
    const date = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    const r = (
      await request(panel, 'rescheduleArticle', {
        slug: '20990101-now',
        newDate: date,
      })
    ).data;
    expect(r).toMatchObject({ success: true, readyForPublish: true });
    const content = fs.readFileSync(
      path.join(
        root,
        'public',
        date.slice(0, 4),
        date.slice(5, 7),
        r.newSlug + '.md',
      ),
      'utf-8',
    );
    expect(content).not.toContain('scheduled_publish');
    expect(content).toContain('ignorePublish: false');
  });

  it('rescheduleArticle: 移動先に同名があれば拒否', async () => {
    article(root, '2099/01/20990101-dup.md');
    article(root, '2099/05/20990506-dup.md');
    start();
    const r = (
      await request(panel, 'rescheduleArticle', {
        slug: '20990101-dup',
        newDate: '2099-05-06',
      })
    ).data;
    expect(r.success).toBe(false);
    expect(r.error).toContain('同名');
  });

  it('removeArticleDate: 日付未定にする / 既に未定 / 重複 / 日付なしスラッグ', async () => {
    article(root, '2099/01/20990101-undate.md', {
      scheduled_publish: '"2099-01-01"',
    });
    article(root, '99999999-already.md');
    article(root, 'nodate.md');
    article(root, '2099/02/20990201-clash.md');
    article(root, '99999999-clash.md');
    start();

    const ok = (
      await request(panel, 'removeArticleDate', { slug: '20990101-undate' })
    ).data;
    expect(ok).toMatchObject({ success: true, newSlug: '99999999-undate' });
    const content = fs.readFileSync(
      path.join(root, 'public/99999999-undate.md'),
      'utf-8',
    );
    expect(content).not.toContain('scheduled_publish');

    const cases: Array<[string, string]> = [
      ['99999999-already', '既に日付未定'],
      ['nodate', '日付プレフィックスがありません'],
      ['20990201-clash', '同名'],
    ];
    for (const [slug, message] of cases) {
      const r = (await request(panel, 'removeArticleDate', { slug })).data;
      expect(r.success, slug).toBe(false);
      expect(r.error).toContain(message);
    }
  });

  it('togglePrivate と toggleIgnorePublish', async () => {
    const file = article(root, '2099/01/20990101-t.md');
    article(root, '2099/01/20990102-s.md', {
      scheduled_publish: '"2099-01-02"',
    });
    article(root, '2099/01/20990103-p.md', { id: 'x1' });
    start();

    expect(
      (await request(panel, 'togglePrivate', { slug: '20990101-t' })).data,
    ).toMatchObject({ success: true, newValue: true, label: '限定共有' });
    expect(fs.readFileSync(file, 'utf-8')).toContain('private: true');
    expect(
      (await request(panel, 'togglePrivate', { slug: '20990101-t' })).data,
    ).toMatchObject({ newValue: false, label: '公開' });

    expect(
      (await request(panel, 'toggleIgnorePublish', { slug: '20990101-t' }))
        .data,
    ).toMatchObject({ newStatus: 'Ready', label: '投稿準備完了' });
    expect(
      (await request(panel, 'toggleIgnorePublish', { slug: '20990101-t' }))
        .data,
    ).toMatchObject({ newStatus: 'Draft', label: '下書き' });

    const sched = (
      await request(panel, 'toggleIgnorePublish', { slug: '20990102-s' })
    ).data;
    expect(sched.success).toBe(false);
    expect(sched.error).toContain('予約投稿');
    for (const command of ['togglePrivate', 'toggleIgnorePublish']) {
      const r = (await request(panel, command, { slug: '20990103-p' })).data;
      expect(r.success).toBe(false);
    }
  });

  it('openFile: 記事は slug で開き、public 外のパスは拒否する', async () => {
    const file = article(root, '2099/01/20990101-o.md');
    fs.writeFileSync(path.join(root, 'README.md'), '#');
    start();
    expect(
      (await request(panel, 'openFile', { slug: '20990101-o' })).data,
    ).toEqual({ success: true });
    expect(state.openedDocuments).toEqual([file]);

    expect(
      (await request(panel, 'openFile', { slug: 'none', path: 'README.md' }))
        .data,
    ).toEqual({ success: true });
    for (const bad of ['../outside.md', undefined, '']) {
      const r = (await request(panel, 'openFile', { slug: 'none', path: bad }))
        .data;
      expect(r.success, String(bad)).toBe(false);
    }
  });

  it('openExternal は http(s) のみ許可する', async () => {
    start();
    expect(
      (await request(panel, 'openExternal', { url: 'https://qiita.com/' }))
        .data,
    ).toEqual({ success: true });
    expect(state.openedExternal).toHaveLength(1);
    const res = await request(panel, 'openExternal', {
      url: 'file:///etc/passwd',
    });
    expect(res.error).toContain('http / https');
    expect(state.openedExternal).toHaveLength(1);
  });

  it('Git 系コマンドはリポジトリ外でも例外にせず応答する', async () => {
    start();
    for (const command of ['getGitBranch', 'getGitStatus']) {
      const res = await request(panel, command);
      expect(res.error, command).toBeUndefined();
      expect(res.data.success, command).toBe(false);
    }
    const files = await request(panel, 'getBranchFiles');
    expect(files.error).toBeUndefined();
    expect(files.data.files).toEqual([]);
  });

  it('getHolidays は設定の祝日カレンダー ID を参照する', async () => {
    start();
    state.configuration.holidayCalendarId = '';
    const res = await request(panel, 'getHolidays', { year: 2099 });
    expect(res.id).toBeDefined();
  });
});
