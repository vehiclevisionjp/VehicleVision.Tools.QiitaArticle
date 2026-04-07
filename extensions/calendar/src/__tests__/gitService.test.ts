import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execSync } from 'child_process';
import { GitService } from '../gitService';

vi.mock('child_process');

const mockedExecSync = vi.mocked(execSync);

let git: GitService;

beforeEach(() => {
  vi.clearAllMocks();
  git = new GitService('/fake/workspace');
});

// ─── runGit() ────────────────────────────────────────────────────────────────

describe('runGit()', () => {
  it('success: returns trimmed output', () => {
    mockedExecSync.mockReturnValue('  main  \n' as any);
    const result = git.runGit('branch --show-current');
    expect(result.success).toBe(true);
    expect(result.output).toBe('main');
  });

  it('error: returns stderr when available', () => {
    mockedExecSync.mockImplementation(() => {
      const err: any = new Error('git failed');
      err.stderr = 'fatal: not a git repository';
      throw err;
    });
    const result = git.runGit('status');
    expect(result.success).toBe(false);
    expect(result.output).toBe('fatal: not a git repository');
  });

  it('error: falls back to err.message when no stderr', () => {
    mockedExecSync.mockImplementation(() => {
      throw new Error('spawn error');
    });
    const result = git.runGit('status');
    expect(result.success).toBe(false);
    expect(result.output).toBe('spawn error');
  });
});

// ─── getCurrentBranch() ──────────────────────────────────────────────────────

describe('getCurrentBranch()', () => {
  it('returns branch name on success', () => {
    mockedExecSync.mockReturnValue('feature-branch\n' as any);
    const result = git.getCurrentBranch();
    expect(result.success).toBe(true);
    expect(result.branch).toBe('feature-branch');
  });

  it('returns success=false on git error', () => {
    mockedExecSync.mockImplementation(() => {
      const err: any = new Error();
      err.stderr = 'error';
      throw err;
    });
    const result = git.getCurrentBranch();
    expect(result.success).toBe(false);
  });
});

// ─── getStatus() ─────────────────────────────────────────────────────────────

describe('getStatus()', () => {
  it('returns hasChanges=false when output is empty', () => {
    mockedExecSync.mockReturnValue('' as any);
    const result = git.getStatus();
    expect(result.success).toBe(true);
    expect(result.hasChanges).toBe(false);
    expect(result.files).toHaveLength(0);
  });

  it('returns files when there are changes', () => {
    // Use non-space first character to avoid output.trim() stripping the XY status prefix
    mockedExecSync.mockReturnValue('M  public/article.md\nA  public/new.md\n' as any);
    const result = git.getStatus();
    expect(result.success).toBe(true);
    expect(result.hasChanges).toBe(true);
    expect(result.files).toHaveLength(2);
    expect(result.files[0]).toMatchObject({ status: 'M', path: 'public/article.md' });
    expect(result.files[1]).toMatchObject({ status: 'A', path: 'public/new.md' });
  });

  it('returns success=false on git failure', () => {
    mockedExecSync.mockImplementation(() => {
      const err: any = new Error();
      err.stderr = 'fatal error';
      throw err;
    });
    const result = git.getStatus();
    expect(result.success).toBe(false);
    expect(result.hasChanges).toBe(false);
    expect(result.files).toHaveLength(0);
  });
});

// ─── commit() ────────────────────────────────────────────────────────────────

describe('commit()', () => {
  it('returns error when message is empty', () => {
    const result = git.commit('');
    expect(result.success).toBe(false);
    expect(result.error).toContain('必須');
    expect(mockedExecSync).not.toHaveBeenCalled();
  });

  it('returns error when message is only whitespace', () => {
    const result = git.commit('   ');
    expect(result.success).toBe(false);
    expect(mockedExecSync).not.toHaveBeenCalled();
  });

  it('returns error when there are no changes to commit', () => {
    // status returns empty → no changes
    mockedExecSync.mockReturnValue('' as any);
    const result = git.commit('my commit');
    expect(result.success).toBe(false);
    expect(result.error).toContain('変更がありません');
  });

  it('returns error when staging fails', () => {
    mockedExecSync
      .mockReturnValueOnce('M public/file.md' as any)  // status --porcelain
      .mockImplementationOnce(() => {                   // add public/
        const err: any = new Error();
        err.stderr = 'add failed';
        throw err;
      });
    const result = git.commit('my commit');
    expect(result.success).toBe(false);
    expect(result.error).toContain('ステージング');
  });

  it('returns error when commit command fails', () => {
    mockedExecSync
      .mockReturnValueOnce('M public/file.md' as any)  // status --porcelain
      .mockReturnValueOnce('' as any)                   // add public/
      .mockImplementationOnce(() => {                   // commit
        const err: any = new Error();
        err.stderr = 'commit failed';
        throw err;
      });
    const result = git.commit('my commit');
    expect(result.success).toBe(false);
    expect(result.error).toContain('コミットに失敗');
  });

  it('success without push', () => {
    mockedExecSync
      .mockReturnValueOnce('M public/file.md' as any)  // status --porcelain
      .mockReturnValueOnce('' as any)                   // add public/
      .mockReturnValueOnce('[main abc123] my commit' as any); // commit
    const result = git.commit('my commit');
    expect(result.success).toBe(true);
    expect(result.message).toContain('my commit');
  });

  it('success with push', () => {
    mockedExecSync
      .mockReturnValueOnce('M public/file.md' as any)  // status --porcelain
      .mockReturnValueOnce('' as any)                   // add public/
      .mockReturnValueOnce('[main abc123] my commit' as any) // commit
      .mockReturnValueOnce('Everything up-to-date' as any);  // push
    const result = git.commit('my commit', true);
    expect(result.success).toBe(true);
    expect(result.message).toContain('プッシュ');
  });

  it('returns error when push fails after successful commit', () => {
    mockedExecSync
      .mockReturnValueOnce('M public/file.md' as any)  // status --porcelain
      .mockReturnValueOnce('' as any)                   // add public/
      .mockReturnValueOnce('[main abc123] my commit' as any) // commit
      .mockImplementationOnce(() => {                   // push
        const err: any = new Error();
        err.stderr = 'push rejected';
        throw err;
      });
    const result = git.commit('my commit', true);
    expect(result.success).toBe(false);
    expect(result.error).toContain('プッシュ');
  });
});

// ─── getBranchFiles() ────────────────────────────────────────────────────────

describe('getBranchFiles()', () => {
  it('normalizes paths: strips public/ prefix and .md extension', () => {
    mockedExecSync
      .mockReturnValueOnce('public/20230101-article.md' as any)  // diff main
      .mockReturnValueOnce('' as any)                             // diff --cached
      .mockReturnValueOnce('' as any);                            // ls-files
    const result = git.getBranchFiles();
    expect(result.success).toBe(true);
    expect(result.files).toContain('20230101-article');
  });

  it('deduplicates files across diff/staged/untracked', () => {
    mockedExecSync
      .mockReturnValueOnce('public/20230101-dup.md' as any)   // diff main
      .mockReturnValueOnce('public/20230101-dup.md' as any)   // diff --cached
      .mockReturnValueOnce('public/20230101-dup.md' as any);  // ls-files
    const result = git.getBranchFiles();
    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toBe('20230101-dup');
  });

  it('merges files from all three sources', () => {
    mockedExecSync
      .mockReturnValueOnce('public/20230101-a.md' as any)     // diff main
      .mockReturnValueOnce('public/20230201-b.md' as any)     // diff --cached
      .mockReturnValueOnce('public/20230301-c.md' as any);    // ls-files
    const result = git.getBranchFiles();
    expect(result.files).toHaveLength(3);
  });

  it('falls back to master when diff against main fails', () => {
    mockedExecSync
      .mockImplementationOnce(() => { const e: any = new Error(); e.stderr = 'unknown revision main'; throw e; }) // diff main
      .mockReturnValueOnce('public/20230101-master.md' as any) // diff master
      .mockReturnValueOnce('' as any)                           // diff --cached
      .mockReturnValueOnce('' as any);                          // ls-files
    const result = git.getBranchFiles();
    expect(result.files).toContain('20230101-master');
  });
});

// ─── mergeAndPush() ──────────────────────────────────────────────────────────

describe('mergeAndPush()', () => {
  it('returns error when already on main', () => {
    mockedExecSync.mockReturnValueOnce('main' as any);
    const result = git.mergeAndPush();
    expect(result.success).toBe(false);
    expect(result.error).toContain('main');
  });

  it('returns error when already on master', () => {
    mockedExecSync.mockReturnValueOnce('master' as any);
    const result = git.mergeAndPush();
    expect(result.success).toBe(false);
  });

  it('returns error when there are uncommitted changes', () => {
    mockedExecSync
      .mockReturnValueOnce('feature-branch' as any)  // branch
      .mockReturnValueOnce('M file.ts' as any);      // status --porcelain (has changes)
    const result = git.mergeAndPush();
    expect(result.success).toBe(false);
    expect(result.error).toContain('未コミット');
  });

  it('returns error when checkout main fails', () => {
    mockedExecSync
      .mockReturnValueOnce('feature-branch' as any)  // branch
      .mockReturnValueOnce('' as any)                 // status --porcelain (clean)
      .mockImplementationOnce(() => {                 // checkout main
        const err: any = new Error();
        err.stderr = 'error: pathspec main did not match';
        throw err;
      });
    const result = git.mergeAndPush();
    expect(result.success).toBe(false);
    expect(result.error).toContain('切り替え');
  });

  it('returns error when merge fails', () => {
    mockedExecSync
      .mockReturnValueOnce('feature-branch' as any)  // branch
      .mockReturnValueOnce('' as any)                 // status --porcelain
      .mockReturnValueOnce('' as any)                 // checkout main
      .mockReturnValueOnce('' as any)                 // pull (ignored)
      .mockImplementationOnce(() => {                 // merge
        const err: any = new Error();
        err.stderr = 'CONFLICT';
        throw err;
      })
      .mockReturnValueOnce('' as any)                 // merge --abort
      .mockReturnValueOnce('' as any);                // checkout feature-branch
    const result = git.mergeAndPush();
    expect(result.success).toBe(false);
    expect(result.error).toContain('マージ');
  });

  it('success path: merges and pushes', () => {
    mockedExecSync
      .mockReturnValueOnce('feature-branch' as any)  // branch
      .mockReturnValueOnce('' as any)                 // status --porcelain
      .mockReturnValueOnce('' as any)                 // checkout main
      .mockReturnValueOnce('' as any)                 // pull
      .mockReturnValueOnce('' as any)                 // merge
      .mockReturnValueOnce('' as any);                // push
    const result = git.mergeAndPush();
    expect(result.success).toBe(true);
    expect(result.mergedBranch).toBe('feature-branch');
    expect(result.message).toContain('feature-branch');
  });

  it('returns error when push fails after merge', () => {
    mockedExecSync
      .mockReturnValueOnce('feature-branch' as any)  // branch
      .mockReturnValueOnce('' as any)                 // status --porcelain
      .mockReturnValueOnce('' as any)                 // checkout main
      .mockReturnValueOnce('' as any)                 // pull
      .mockReturnValueOnce('' as any)                 // merge
      .mockImplementationOnce(() => {                 // push
        const err: any = new Error();
        err.stderr = 'push rejected';
        throw err;
      });
    const result = git.mergeAndPush();
    expect(result.success).toBe(false);
    expect(result.error).toContain('プッシュ');
  });
});
