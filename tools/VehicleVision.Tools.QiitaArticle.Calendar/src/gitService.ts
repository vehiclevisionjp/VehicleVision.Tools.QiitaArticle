import { execSync } from 'child_process';

export class GitService {
  constructor(private workspaceRoot: string) {}

  /** git コマンド実行ヘルパー */
  runGit(args: string): { success: boolean; output: string } {
    try {
      const output = execSync(`git -c core.quotepath=false ${args}`, {
        cwd: this.workspaceRoot,
        encoding: 'utf-8',
        timeout: 10_000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return { success: true, output: output.trim() };
    } catch (err: any) {
      const stderr = err.stderr ? String(err.stderr).trim() : '';
      return { success: false, output: stderr || err.message || '' };
    }
  }

  /** 現在のブランチ名を取得 */
  getCurrentBranch(): { success: boolean; branch: string } {
    const result = this.runGit('branch --show-current');
    return { success: result.success, branch: result.output };
  }

  /** Git ステータス（public/ 配下の未コミット変更一覧） */
  getStatus(): { success: boolean; hasChanges: boolean; files: Array<{ status: string; path: string }> } {
    const result = this.runGit('status --porcelain -- public/');
    if (!result.success) {
      return { success: false, hasChanges: false, files: [] };
    }

    const files = result.output
      .split('\n')
      .filter(l => l.trim())
      .map(l => ({
        status: l.substring(0, 2).trim(),
        path: l.substring(3).trim(),
      }));

    return { success: true, hasChanges: files.length > 0, files };
  }

  /** Git コミット（public/ 配下の変更をステージング＆コミット、オプションでプッシュ） */
  commit(message: string, push: boolean = false): { success: boolean; error?: string; message?: string } {
    if (!message?.trim()) {
      return { success: false, error: 'コミットメッセージは必須です' };
    }

    // public/ 配下の未コミットの変更があるか確認
    const statusResult = this.runGit('status --porcelain -- public/');
    if (statusResult.success && !statusResult.output.trim()) {
      return { success: false, error: 'コミットする変更がありません（public/ 配下）' };
    }

    // public/ 配下の変更をステージング
    const addResult = this.runGit('add public/');
    if (!addResult.success) {
      return { success: false, error: `ステージングに失敗しました: ${addResult.output}` };
    }

    // コミット
    const escapedMessage = message.replace(/"/g, '\\"');
    const commitResult = this.runGit(`commit -m "${escapedMessage}"`);
    if (!commitResult.success) {
      return { success: false, error: `コミットに失敗しました: ${commitResult.output}` };
    }

    // プッシュ（オプション）
    if (push) {
      const pushResult = this.runGit('push');
      if (!pushResult.success) {
        return { success: false, error: `コミットは成功しましたがプッシュに失敗しました: ${pushResult.output}` };
      }
      return { success: true, message: `コミット＆プッシュしました: ${message}` };
    }

    return { success: true, message: `コミットしました: ${message}` };
  }

  /** 現在のブランチで追加・変更された public/ 配下のファイル一覧を取得 */
  getBranchFiles(): { success: boolean; files: string[] } {
    const normalize = (output: string) =>
      output.split('\n').filter(l => l.trim()).map(f => f.replace(/^public\//, '').replace(/\.md$/, ''));

    const filesSet = new Set<string>();

    // 1) main とのコミット済み差分（追加・変更）
    let diffResult = this.runGit('diff --name-only --diff-filter=AM main -- public/');
    if (!diffResult.success) {
      diffResult = this.runGit('diff --name-only --diff-filter=AM master -- public/');
    }
    if (diffResult.success) {
      normalize(diffResult.output).forEach(f => filesSet.add(f));
    }

    // 2) ステージング済みだが未コミットの差分（追加・変更）
    const stagedResult = this.runGit('diff --cached --name-only --diff-filter=AM -- public/');
    if (stagedResult.success) {
      normalize(stagedResult.output).forEach(f => filesSet.add(f));
    }

    // 3) 未追跡（untracked）の新規ファイル
    const untrackedResult = this.runGit('ls-files --others --exclude-standard -- public/');
    if (untrackedResult.success) {
      normalize(untrackedResult.output).forEach(f => filesSet.add(f));
    }

    return { success: true, files: Array.from(filesSet) };
  }

  /** 現在のブランチを main にマージしてプッシュ */
  mergeAndPush(): { success: boolean; error?: string; mergedBranch?: string; message?: string } {
    // 現在のブランチを取得
    const branchResult = this.runGit('branch --show-current');
    if (!branchResult.success) {
      return { success: false, error: '現在のブランチを取得できませんでした' };
    }

    const currentBranch = branchResult.output;
    if (currentBranch === 'main' || currentBranch === 'master') {
      return { success: false, error: '既に main ブランチです' };
    }

    // 未コミットの変更がないか確認
    const statusResult = this.runGit('status --porcelain');
    if (statusResult.success && statusResult.output.trim()) {
      return { success: false, error: '未コミットの変更があります。先にコミットしてください。' };
    }

    // main に切り替え
    const checkoutResult = this.runGit('checkout main');
    if (!checkoutResult.success) {
      return { success: false, error: `main への切り替えに失敗しました: ${checkoutResult.output}` };
    }

    // main を最新に更新
    this.runGit('pull');

    // マージ
    const mergeResult = this.runGit(`merge ${currentBranch}`);
    if (!mergeResult.success) {
      // マージ失敗時は元のブランチに戻す
      this.runGit('merge --abort');
      this.runGit(`checkout ${currentBranch}`);
      return { success: false, error: `マージに失敗しました: ${mergeResult.output}` };
    }

    // プッシュ
    const pushResult = this.runGit('push');
    if (!pushResult.success) {
      return { success: false, error: `プッシュに失敗しました: ${pushResult.output}` };
    }

    return {
      success: true,
      mergedBranch: currentBranch,
      message: `${currentBranch} を main にマージしてプッシュしました`,
    };
  }
}
