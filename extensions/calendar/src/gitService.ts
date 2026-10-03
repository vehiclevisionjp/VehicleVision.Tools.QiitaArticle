import { execFile } from 'child_process';

export interface GitResult {
  success: boolean;
  output: string;
}

const DEFAULT_TIMEOUT = 15_000;
const NETWORK_TIMEOUT = 120_000;

export class GitService {
  private defaultBranchCache: string | undefined;
  private prefixCache: string | undefined;

  /** @param workspaceRoot ワークスペースフォルダ（git リポジトリのサブディレクトリでも可） */
  constructor(private workspaceRoot: string) {}

  /**
   * git コマンド実行ヘルパー。シェルを経由せず引数配列で実行するため、
   * ブランチ名やコミットメッセージに特殊文字が含まれていても安全。
   */
  runGit(args: string[], timeout: number = DEFAULT_TIMEOUT): Promise<GitResult> {
    return new Promise((resolve) => {
      execFile(
        'git',
        ['-c', 'core.quotepath=false', ...args],
        {
          cwd: this.workspaceRoot,
          encoding: 'utf-8',
          timeout,
          windowsHide: true,
          maxBuffer: 16 * 1024 * 1024,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        },
        (err, stdout, stderr) => {
          if (err) {
            const text = String(stderr || '').trim();
            resolve({ success: false, output: text || err.message || '' });
            return;
          }
          resolve({ success: true, output: String(stdout).trim() });
        },
      );
    });
  }

  /** ワークスペースが git 管理下か */
  async isRepository(): Promise<boolean> {
    const r = await this.runGit(['rev-parse', '--is-inside-work-tree']);
    return r.success && r.output === 'true';
  }

  /** git 管理下のルートからワークスペースまでの相対パス（例: "sub/dir/"）。ルートなら空文字 */
  private async getPrefix(): Promise<string> {
    if (this.prefixCache === undefined) {
      const r = await this.runGit(['rev-parse', '--show-prefix']);
      this.prefixCache = r.success ? r.output : '';
    }
    return this.prefixCache;
  }

  /** HEAD ファイルの絶対パス（worktree / submodule 対応） */
  async getHeadPath(): Promise<string | null> {
    const r = await this.runGit(['rev-parse', '--absolute-git-dir']);
    return r.success && r.output ? r.output.replace(/\\/g, '/') + '/HEAD' : null;
  }

  /** デフォルトブランチ名（origin/HEAD → main → master の順に判定） */
  async getDefaultBranch(): Promise<string> {
    if (this.defaultBranchCache) {
      return this.defaultBranchCache;
    }

    let name = '';
    const originHead = await this.runGit(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
    if (originHead.success && originHead.output) {
      name = originHead.output.replace(/^origin\//, '');
    }

    if (!name) {
      for (const candidate of ['main', 'master']) {
        const r = await this.runGit(['show-ref', '--verify', '--quiet', `refs/heads/${candidate}`]);
        if (r.success) {
          name = candidate;
          break;
        }
      }
    }

    this.defaultBranchCache = name || 'main';
    return this.defaultBranchCache;
  }

  /** 現在のブランチ名を取得 */
  async getCurrentBranch(): Promise<{
    success: boolean;
    branch: string;
    defaultBranch: string;
    isDefault: boolean;
  }> {
    const result = await this.runGit(['branch', '--show-current']);
    const defaultBranch = await this.getDefaultBranch();
    return {
      success: result.success,
      branch: result.output,
      defaultBranch,
      isDefault: result.success && result.output === defaultBranch,
    };
  }

  /** Git ステータス（public/ 配下の未コミット変更一覧） */
  async getStatus(): Promise<{
    success: boolean;
    hasChanges: boolean;
    files: Array<{ status: string; path: string }>;
  }> {
    const result = await this.runGit(['status', '--porcelain', '--untracked-files=all', '--', 'public/']);
    if (!result.success) {
      return { success: false, hasChanges: false, files: [] };
    }

    const prefix = await this.getPrefix();
    const files = result.output
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => {
        // "XY path" / "XY old -> new"
        let p = l.substring(3).trim();
        const arrow = p.indexOf(' -> ');
        if (arrow >= 0) {
          p = p.substring(arrow + 4);
        }
        p = p.replace(/^"|"$/g, '');
        if (prefix && p.startsWith(prefix)) {
          p = p.substring(prefix.length);
        }
        return { status: l.substring(0, 2).trim(), path: p };
      });

    return { success: true, hasChanges: files.length > 0, files };
  }

  /** Git コミット（public/ 配下の変更をステージング＆コミット、オプションでプッシュ） */
  async commit(
    message: string,
    push: boolean = false,
  ): Promise<{ success: boolean; error?: string; message?: string }> {
    if (!message?.trim()) {
      return { success: false, error: 'コミットメッセージは必須です' };
    }

    const statusResult = await this.runGit(['status', '--porcelain', '--', 'public/']);
    if (statusResult.success && !statusResult.output.trim()) {
      return { success: false, error: 'コミットする変更がありません（public/ 配下）' };
    }

    const addResult = await this.runGit(['add', '-A', '--', 'public/']);
    if (!addResult.success) {
      return { success: false, error: `ステージングに失敗しました: ${addResult.output}` };
    }

    // public/ 以外のステージ済み変更を巻き込まないようパスを限定する
    const commitResult = await this.runGit(['commit', '-m', message, '--', 'public/']);
    if (!commitResult.success) {
      return { success: false, error: `コミットに失敗しました: ${commitResult.output}` };
    }

    if (push) {
      const pushResult = await this.push();
      if (!pushResult.success) {
        return {
          success: false,
          error: `コミットは成功しましたがプッシュに失敗しました: ${pushResult.output}`,
        };
      }
      return { success: true, message: `コミット＆プッシュしました: ${message}` };
    }

    return { success: true, message: `コミットしました: ${message}` };
  }

  /** プッシュ（upstream 未設定なら origin に設定してプッシュ） */
  private async push(): Promise<GitResult> {
    const upstream = await this.runGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
    if (upstream.success) {
      return this.runGit(['push'], NETWORK_TIMEOUT);
    }
    return this.runGit(['push', '-u', 'origin', 'HEAD'], NETWORK_TIMEOUT);
  }

  /** デフォルトブランチへ切り替えて最新化する（作業ツリーに変更があれば失敗） */
  async checkoutDefaultAndPull(): Promise<GitResult> {
    const defaultBranch = await this.getDefaultBranch();
    const checkout = await this.runGit(['checkout', defaultBranch]);
    if (!checkout.success) {
      return {
        success: false,
        output: `${defaultBranch} への切り替えに失敗しました: ${checkout.output}`,
      };
    }
    // リモート未設定などで失敗しても続行する
    await this.runGit(['pull', '--ff-only'], NETWORK_TIMEOUT);
    return { success: true, output: defaultBranch };
  }

  /** 新規ブランチを作成して切り替える */
  createBranch(name: string): Promise<GitResult> {
    return this.runGit(['checkout', '-b', name]);
  }

  /** 現在のブランチで追加・変更された public/ 配下のファイル一覧を取得 */
  async getBranchFiles(): Promise<{ success: boolean; files: string[] }> {
    const normalize = (output: string) =>
      output
        .split('\n')
        .filter((l) => l.trim())
        .map((f) => f.replace(/^public\//, '').replace(/\.md$/, ''));

    const filesSet = new Set<string>();
    const defaultBranch = await this.getDefaultBranch();

    // 1) デフォルトブランチとの分岐点からのコミット済み差分（追加・変更）
    const diffResult = await this.runGit([
      'diff',
      '--relative',
      '--name-only',
      '--diff-filter=AMR',
      `${defaultBranch}...HEAD`,
      '--',
      'public/',
    ]);
    if (diffResult.success) {
      normalize(diffResult.output).forEach((f) => filesSet.add(f));
    }

    // 2) 未コミットの差分（ステージ済み・未ステージ）
    const workResult = await this.runGit([
      'diff',
      '--relative',
      '--name-only',
      '--diff-filter=AMR',
      'HEAD',
      '--',
      'public/',
    ]);
    if (workResult.success) {
      normalize(workResult.output).forEach((f) => filesSet.add(f));
    }

    // 3) 未追跡（untracked）の新規ファイル
    const untrackedResult = await this.runGit(['ls-files', '--others', '--exclude-standard', '--', 'public/']);
    if (untrackedResult.success) {
      normalize(untrackedResult.output).forEach((f) => filesSet.add(f));
    }

    return { success: true, files: Array.from(filesSet) };
  }

  /** 現在のブランチをデフォルトブランチにマージしてプッシュ */
  async mergeAndPush(): Promise<{
    success: boolean;
    error?: string;
    mergedBranch?: string;
    message?: string;
  }> {
    const branchResult = await this.runGit(['branch', '--show-current']);
    if (!branchResult.success || !branchResult.output) {
      return { success: false, error: '現在のブランチを取得できませんでした' };
    }

    const currentBranch = branchResult.output;
    const defaultBranch = await this.getDefaultBranch();
    if (currentBranch === defaultBranch) {
      return { success: false, error: `既に ${defaultBranch} ブランチです` };
    }

    const statusResult = await this.runGit(['status', '--porcelain']);
    if (statusResult.success && statusResult.output.trim()) {
      return { success: false, error: '未コミットの変更があります。先にコミットしてください。' };
    }

    const checkout = await this.checkoutDefaultAndPull();
    if (!checkout.success) {
      return { success: false, error: checkout.output };
    }

    const mergeResult = await this.runGit(['merge', '--no-edit', currentBranch], NETWORK_TIMEOUT);
    if (!mergeResult.success) {
      await this.runGit(['merge', '--abort']);
      await this.runGit(['checkout', currentBranch]);
      return { success: false, error: `マージに失敗しました: ${mergeResult.output}` };
    }

    const pushResult = await this.push();
    if (!pushResult.success) {
      return { success: false, error: `プッシュに失敗しました: ${pushResult.output}` };
    }

    return {
      success: true,
      mergedBranch: currentBranch,
      message: `${currentBranch} を ${defaultBranch} にマージしてプッシュしました`,
    };
  }
}
