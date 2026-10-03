import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GitService } from '../src/gitService';

let repo: string;

const git = (...args: string[]) =>
  execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

function write(rel: string, content = 'x\n') {
  const p = path.join(repo, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf-8');
}

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'qiita-git-'));
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');
  write('public/2025/01/20250101-base.md', 'base\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
});
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe('GitService', () => {
  it('デフォルトブランチと現在のブランチを判定する', async () => {
    const svc = new GitService(repo);
    expect(await svc.getDefaultBranch()).toBe('main');
    expect(await svc.getCurrentBranch()).toMatchObject({
      success: true,
      branch: 'main',
      isDefault: true,
    });

    git('checkout', '-q', '-b', 'feature');
    const cur = await new GitService(repo).getCurrentBranch();
    expect(cur).toMatchObject({
      branch: 'feature',
      defaultBranch: 'main',
      isDefault: false,
    });
  });

  it('master がデフォルトのリポジトリも判定できる', async () => {
    git('branch', '-q', '-m', 'master');
    expect(await new GitService(repo).getDefaultBranch()).toBe('master');
  });

  it('getStatus は public/ の未コミット変更だけを返す', async () => {
    write('public/2025/01/20250102-new.md');
    write('other.txt');
    const st = await new GitService(repo).getStatus();
    expect(st.hasChanges).toBe(true);
    expect(st.files.map((f) => f.path)).toEqual([
      'public/2025/01/20250102-new.md',
    ]);
  });

  it('サブディレクトリをワークスペースにしても相対パスで返る', async () => {
    write('sub/public/20250102-new.md');
    const st = await new GitService(path.join(repo, 'sub')).getStatus();
    expect(st.files.map((f) => f.path)).toEqual(['public/20250102-new.md']);
  });

  it('特殊文字を含むコミットメッセージを安全にコミットでき、public/ 以外は巻き込まない', async () => {
    write('public/2025/01/20250102-new.md');
    write('staged-other.txt');
    git('add', 'staged-other.txt');

    const message = 'fix: "quote" $(echo hi) `bt` & 日本語';
    const res = await new GitService(repo).commit(message, false);
    expect(res.success).toBe(true);
    expect(git('log', '-1', '--format=%s')).toBe(message);
    expect(git('show', '--name-only', '--format=', 'HEAD')).toBe(
      'public/2025/01/20250102-new.md',
    );
    expect(git('status', '--porcelain')).toContain('staged-other.txt');
  });

  it('メッセージ空・変更なしはエラー', async () => {
    const svc = new GitService(repo);
    expect((await svc.commit('  ')).success).toBe(false);
    expect((await svc.commit('msg')).error).toContain('変更がありません');
  });

  it('getBranchFiles はブランチ上の追加・変更と未追跡を拾う', async () => {
    git('checkout', '-q', '-b', 'feature');
    write('public/2025/02/20250201-committed.md');
    git('add', '-A');
    git('commit', '-q', '-m', 'add');
    write('public/2025/02/20250202-untracked.md');
    write('public/2025/01/20250101-base.md', 'changed\n');

    const { files } = await new GitService(repo).getBranchFiles();
    expect(files.sort()).toEqual(
      [
        '2025/01/20250101-base',
        '2025/02/20250201-committed',
        '2025/02/20250202-untracked',
      ].sort(),
    );
  });

  it('デフォルトブランチへ戻り、特殊文字を含むブランチ名も作成できる', async () => {
    git('checkout', '-q', '-b', 'other');
    const svc = new GitService(repo);
    expect((await svc.checkoutDefaultAndPull()).success).toBe(true);
    expect(git('branch', '--show-current')).toBe('main');
    expect((await svc.createBranch('add-20250101-日本語&x')).success).toBe(
      true,
    );
    expect(git('branch', '--show-current')).toBe('add-20250101-日本語&x');
  });

  it('mergeAndPush: デフォルトブランチ上・未コミット変更ありでは拒否する', async () => {
    const svc = new GitService(repo);
    expect((await svc.mergeAndPush()).error).toContain('既に main');

    git('checkout', '-q', '-b', 'feature');
    write('public/2025/01/20250102-wip.md');
    expect((await svc.mergeAndPush()).error).toContain('未コミット');
  });
});
