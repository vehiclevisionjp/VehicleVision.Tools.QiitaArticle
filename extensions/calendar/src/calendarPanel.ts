import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ArticleParser, ArticleInfo, UNDATED_PREFIX } from './articleParser';
import { DEFAULT_HOLIDAY_CALENDAR_ID, HolidayService } from './holidayService';
import { GitService } from './gitService';
import { removeField, setField } from './frontMatter';

/** Qiita 記事リポジトリとみなす条件: qiita.config.json または public/ がある */
function isQiitaFolder(folder: vscode.WorkspaceFolder): boolean {
  const root = folder.uri.fsPath;
  return (
    fs.existsSync(path.join(root, 'qiita.config.json')) ||
    fs.existsSync(path.join(root, 'public'))
  );
}

export class CalendarPanel {
  /** ワークスペースフォルダごとのパネル（マルチルートワークスペース対応） */
  private static readonly panels = new Map<string, CalendarPanel>();

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  private _disposed = false;
  private _articleParser: ArticleParser;
  private _holidayService: HolidayService;
  private _gitService: GitService;
  private _publicDir: string;
  private _workspaceRoot: string;

  private static key(root: string): string {
    return process.platform === 'win32' ? root.toLowerCase() : root;
  }

  /** 対象となるワークスペースフォルダ一覧 */
  public static getCandidateFolders(): vscode.WorkspaceFolder[] {
    return (vscode.workspace.workspaceFolders ?? []).filter(isQiitaFolder);
  }

  /** コマンドから開く。候補が複数ある場合はフォルダを選択させる */
  public static async openFromCommand(context: vscode.ExtensionContext) {
    if ((vscode.workspace.workspaceFolders ?? []).length === 0) {
      vscode.window.showErrorMessage('ワークスペースが開かれていません');
      return;
    }

    const candidates = CalendarPanel.getCandidateFolders();
    if (candidates.length === 0) {
      vscode.window.showErrorMessage(
        'Qiita 記事フォルダが見つかりません（qiita.config.json または public/ を含むフォルダが必要です）',
      );
      return;
    }

    if (candidates.length === 1) {
      CalendarPanel.createOrShow(context, candidates[0]);
      return;
    }

    const picked = await vscode.window.showQuickPick(
      candidates.map((f) => ({
        label: f.name,
        description: f.uri.fsPath,
        folder: f,
      })),
      { placeHolder: 'カレンダーを開くワークスペースフォルダを選択' },
    );
    if (picked) {
      CalendarPanel.createOrShow(context, picked.folder);
    }
  }

  /** 起動時の自動オープン（対象フォルダすべて） */
  public static openAll(context: vscode.ExtensionContext) {
    for (const folder of CalendarPanel.getCandidateFolders()) {
      CalendarPanel.createOrShow(context, folder);
    }
  }

  /** ワークスペースから外れたフォルダのパネルを閉じる */
  public static closeRemoved(removed: readonly vscode.WorkspaceFolder[]) {
    for (const folder of removed) {
      CalendarPanel.panels.get(CalendarPanel.key(folder.uri.fsPath))?.dispose();
    }
  }

  public static createOrShow(
    context: vscode.ExtensionContext,
    folder: vscode.WorkspaceFolder,
  ) {
    const workspaceRoot = folder.uri.fsPath;
    const existing = CalendarPanel.panels.get(CalendarPanel.key(workspaceRoot));
    if (existing) {
      existing._panel.reveal(vscode.ViewColumn.One);
      return;
    }

    const multi = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
    const title = multi
      ? `Qiita 記事カレンダー (${folder.name})`
      : 'Qiita 記事カレンダー';

    const panel = vscode.window.createWebviewPanel(
      'articleCalendar',
      title,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, 'media'),
        ],
        retainContextWhenHidden: true,
      },
    );

    const instance = new CalendarPanel(
      panel,
      context.extensionUri,
      folder,
      title,
    );
    CalendarPanel.panels.set(CalendarPanel.key(workspaceRoot), instance);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    folder: vscode.WorkspaceFolder,
    title: string,
  ) {
    const workspaceRoot = folder.uri.fsPath;
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._workspaceRoot = workspaceRoot;
    this._publicDir = path.join(workspaceRoot, 'public');

    this._articleParser = new ArticleParser(this._publicDir);
    this._holidayService = new HolidayService(() =>
      vscode.workspace
        .getConfiguration('articleCalendar', folder.uri)
        .get<string>('holidayCalendarId', DEFAULT_HOLIDAY_CALENDAR_ID),
    );
    this._gitService = new GitService(workspaceRoot);

    this._panel.webview.html = this._getHtmlForWebview(title);

    this._panel.webview.onDidReceiveMessage(
      (message) => this._handleMessage(message),
      null,
      this._disposables,
    );

    // public/ 配下のファイル変更を監視して自動リロード通知
    // （このパネルのワークスペースフォルダに限定する）
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    const notify = (delay: number) => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = setTimeout(() => {
        if (!this._disposed) {
          this._panel.webview.postMessage({ type: 'fileChanged' });
        }
      }, delay);
    };
    this._disposables.push({
      dispose: () => {
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }
      },
    });

    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(folder, 'public/**/*.md'),
    );
    watcher.onDidChange(() => notify(500));
    watcher.onDidCreate(() => notify(500));
    watcher.onDidDelete(() => notify(500));
    this._disposables.push(watcher);

    // HEAD の変更を監視してブランチ切替を検知（worktree / サブディレクトリ / submodule 対応）
    this._gitService.getHeadPath().then((headPath) => {
      if (!headPath || this._disposed) {
        return;
      }
      const gitHeadWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(
          vscode.Uri.file(path.dirname(headPath)),
          'HEAD',
        ),
      );
      gitHeadWatcher.onDidChange(() => notify(300));
      gitHeadWatcher.onDidCreate(() => notify(300));
      this._disposables.push(gitHeadWatcher);
    });

    // 設定変更（祝日の取得元・表示テーマ）を反映する
    this._disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (
          e.affectsConfiguration('articleCalendar.theme', folder.uri) &&
          !this._disposed
        ) {
          this._panel.webview.postMessage({
            type: 'themeChanged',
            theme: this._getTheme(),
          });
        }
        if (
          e.affectsConfiguration(
            'articleCalendar.holidayCalendarId',
            folder.uri,
          ) &&
          !this._disposed
        ) {
          this._panel.webview.postMessage({ type: 'holidaysChanged' });
        }
      }),
    );

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
  }

  public dispose() {
    if (this._disposed) {
      return;
    }
    this._disposed = true;
    CalendarPanel.panels.delete(CalendarPanel.key(this._workspaceRoot));
    this._panel.dispose();
    while (this._disposables.length) {
      const d = this._disposables.pop();
      if (d) {
        d.dispose();
      }
    }
  }

  // === メッセージハンドラ ===

  private async _handleMessage(message: any) {
    if (message?.type !== 'request') {
      return;
    }
    const { id, command } = message;

    try {
      let data: any;

      switch (command) {
        case 'getArticles':
          data = this._articleParser.parseAll();
          break;

        case 'getArticlesByMonth': {
          const all = this._articleParser.parseAll();
          data = all.filter((a) => {
            const [y, m] = a.displayDate.split('-').map(Number);
            return y === message.year && m === message.month;
          });
          break;
        }

        case 'getHolidays':
          data = await this._holidayService.getHolidays(Number(message.year));
          break;

        case 'getGitBranch':
          data = await this._gitService.getCurrentBranch();
          break;

        case 'getGitStatus':
          data = await this._gitService.getStatus();
          break;

        case 'getBranchFiles':
          data = await this._gitService.getBranchFiles();
          break;

        case 'gitCommit':
          data = await this._gitService.commit(message.message, !!message.push);
          break;

        case 'gitMergeAndPush':
          data = await this._gitService.mergeAndPush();
          break;

        case 'createArticle':
          data = await this._createArticle(message);
          break;

        case 'rescheduleArticle':
          data = this._rescheduleArticle(message.slug, message.newDate);
          break;

        case 'removeArticleDate':
          data = this._removeArticleDate(message.slug);
          break;

        case 'togglePrivate':
          data = this._togglePrivate(message.slug);
          break;

        case 'toggleIgnorePublish':
          data = this._toggleIgnorePublish(message.slug);
          break;

        case 'openFile': {
          const filePath =
            this._findArticle(message.slug)?.filePath ??
            this._resolveWorkspacePath(message.path);
          if (!filePath) {
            data = { success: false, error: '記事ファイルが見つかりません' };
            break;
          }
          const doc = await vscode.workspace.openTextDocument(filePath);
          await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
          data = { success: true };
          break;
        }

        case 'openExternal': {
          const uri = vscode.Uri.parse(String(message.url));
          if (uri.scheme !== 'https' && uri.scheme !== 'http') {
            throw new Error('http / https 以外の URL は開けません');
          }
          await vscode.env.openExternal(uri);
          data = { success: true };
          break;
        }

        default:
          throw new Error(`Unknown command: ${command}`);
      }

      if (!this._disposed) {
        this._panel.webview.postMessage({ type: 'response', id, data });
      }
    } catch (err: any) {
      if (!this._disposed) {
        this._panel.webview.postMessage({
          type: 'response',
          id,
          error: err.message,
        });
      }
    }
  }

  // === 記事作成 ===

  private async _createArticle(req: any): Promise<any> {
    const title = req.title;
    if (!title?.trim()) {
      return { success: false, error: 'スラッグは必須です' };
    }

    const validModes = ['public', 'private', 'scheduled'];
    const mode = (req.mode || 'public').toLowerCase();
    if (!validModes.includes(mode)) {
      return {
        success: false,
        error: '記事種別が不正です（public / private / scheduled）',
      };
    }

    // 日付の決定
    let articleDate: Date;
    if (mode === 'scheduled') {
      if (!req.date) {
        return { success: false, error: '予約投稿には日付が必須です' };
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(req.date)) {
        return { success: false, error: '日付の形式が不正です（YYYY-MM-DD）' };
      }
      articleDate = new Date(req.date + 'T00:00:00');
      if (isNaN(articleDate.getTime())) {
        return { success: false, error: '日付の形式が不正です（YYYY-MM-DD）' };
      }
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (articleDate <= today) {
        return {
          success: false,
          error: '予約投稿日は明日以降を指定してください',
        };
      }
    } else {
      articleDate = new Date();
    }

    const y = articleDate.getFullYear();
    const m = String(articleDate.getMonth() + 1).padStart(2, '0');
    const d = String(articleDate.getDate()).padStart(2, '0');
    const dateForFile = `${y}${m}${d}`;
    const sanitizedTitle = this._sanitizeFileName(title);
    if (!sanitizedTitle) {
      return { success: false, error: 'スラッグに使用できる文字がありません' };
    }
    const slug = `${dateForFile}-${sanitizedTitle}`;
    const subDir = path.join(this._publicDir, `${y}`, m);
    const filePath = path.join(subDir, `${slug}.md`);

    if (fs.existsSync(filePath) || this._findArticle(slug)) {
      return {
        success: false,
        error: `同名の記事ファイルが既に存在します: ${slug}.md`,
      };
    }

    // ブランチ操作
    let branch: string | null = null;
    if (req.createBranch) {
      const base = await this._gitService.checkoutDefaultAndPull();
      if (!base.success) {
        return { success: false, error: base.output };
      }

      branch = `add-${this._sanitizeBranchName(slug)}`;
      const r2 = await this._gitService.createBranch(branch);
      if (!r2.success) {
        return {
          success: false,
          error: `ブランチの作成に失敗しました: ${r2.output}`,
        };
      }
    }

    // Front Matter 生成
    const isPrivate = mode === 'private' ? 'true' : 'false';
    const scheduledLine =
      mode === 'scheduled' ? `\nscheduled_publish: "${req.date}"` : '';

    const content = `---\ntitle: ''\ntags:\n  - ''\nprivate: ${isPrivate}\nupdated_at: ''\nid: null\norganization_url_name: null\nslide: false\nignorePublish: true${scheduledLine}\n---\n\n`;

    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');

    const modeLabel =
      mode === 'private'
        ? '限定共有'
        : mode === 'scheduled'
          ? '予約投稿'
          : '公開';
    const dateStr = `${y}-${m}-${d}`;

    return {
      success: true,
      slug,
      filePath: `public/${y}/${m}/${slug}.md`,
      date: dateStr,
      branch,
      mode,
      modeLabel,
    };
  }

  // === 記事リスケジュール ===

  private _rescheduleArticle(slug: string, newDate: string): any {
    const found = this._requireEditableArticle(
      slug,
      '投稿済みの記事は移動できません',
    );
    if ('error' in found) {
      return found.error;
    }
    const { article } = found;
    const oldPath = article.filePath;

    if (!newDate?.trim()) {
      return { success: false, error: '移動先の日付が指定されていません' };
    }
    if (!/^(\d{4})-(\d{2})-(\d{2})$/.test(newDate)) {
      return { success: false, error: '日付の形式が不正です（YYYY-MM-DD）' };
    }

    const nd = new Date(newDate + 'T00:00:00');
    if (isNaN(nd.getTime())) {
      return { success: false, error: '日付が不正です' };
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const isToday = nd.getTime() === today.getTime();
    if (nd < today) {
      return { success: false, error: '移動先は今日以降を指定してください' };
    }

    // 新スラッグ生成: 日付部分のみ差し替え（日付なしスラッグにも対応）
    const slugDateMatch = slug.match(/^(\d{8})-(.+)$/);
    const titlePart = slugDateMatch ? slugDateMatch[2] : slug;
    const newSlug = `${newDate.replace(/-/g, '')}-${titlePart}`;
    const newDir = path.join(
      this._publicDir,
      newDate.substring(0, 4),
      newDate.substring(5, 7),
    );
    const newPath = path.join(newDir, `${newSlug}.md`);
    const samePath = this._samePath(oldPath, newPath);

    if (!samePath && (fs.existsSync(newPath) || this._findArticle(newSlug))) {
      return {
        success: false,
        error: `移動先に同名のファイルが既に存在します: ${newSlug}.md`,
      };
    }

    // Front Matter の scheduled_publish を更新（存在しない場合は追加）
    // 今日に移動した場合は scheduled_publish を除去し、ignorePublish を false に設定
    let content = fs.readFileSync(oldPath, 'utf-8');
    let readyForPublish = false;

    if (isToday) {
      content = removeField(content, 'scheduled_publish');
      if (article.status !== 'Ready') {
        content = setField(content, 'ignorePublish', 'false');
        readyForPublish = true;
      }
    } else {
      content = setField(content, 'scheduled_publish', `"${newDate}"`);
    }

    if (!samePath) {
      fs.mkdirSync(newDir, { recursive: true });
      fs.writeFileSync(newPath, content, 'utf-8');
      fs.unlinkSync(oldPath);
    } else {
      fs.writeFileSync(oldPath, content, 'utf-8');
    }

    return { success: true, oldSlug: slug, newSlug, newDate, readyForPublish };
  }

  // === 記事の日付除去 ===

  private _removeArticleDate(slug: string): any {
    const found = this._requireEditableArticle(
      slug,
      '投稿済みの記事は移動できません',
    );
    if ('error' in found) {
      return found.error;
    }
    const oldPath = found.article.filePath;

    const match = slug.match(/^(\d{8})-(.+)$/);
    if (!match) {
      return {
        success: false,
        error: 'この記事には日付プレフィックスがありません',
      };
    }

    // 既に日付未定の場合は何もしない
    if (match[1] === UNDATED_PREFIX) {
      return { success: false, error: 'この記事は既に日付未定です' };
    }

    const newSlug = `${UNDATED_PREFIX}-${match[2]}`;
    const newPath = path.join(this._publicDir, `${newSlug}.md`);

    if (fs.existsSync(newPath) || this._findArticle(newSlug)) {
      return {
        success: false,
        error: `同名のファイルが既に存在します: ${newSlug}.md`,
      };
    }

    const content = removeField(
      fs.readFileSync(oldPath, 'utf-8'),
      'scheduled_publish',
    );

    fs.writeFileSync(newPath, content, 'utf-8');
    fs.unlinkSync(oldPath);

    return { success: true, oldSlug: slug, newSlug };
  }

  // === フィールドトグル ===

  private _togglePrivate(slug: string): any {
    const found = this._requireEditableArticle(
      slug,
      '投稿済みの記事の公開設定は Qiita Web 上で変更してください',
    );
    if ('error' in found) {
      return found.error;
    }
    const { article } = found;

    const newValue = !article.isPrivate;
    const content = setField(
      fs.readFileSync(article.filePath, 'utf-8'),
      'private',
      String(newValue),
    );
    fs.writeFileSync(article.filePath, content, 'utf-8');

    return {
      success: true,
      slug,
      newValue,
      label: newValue ? '限定共有' : '公開',
    };
  }

  private _toggleIgnorePublish(slug: string): any {
    const found = this._requireEditableArticle(
      slug,
      '投稿済みの記事は変更できません',
    );
    if ('error' in found) {
      return found.error;
    }
    const { article } = found;

    if (article.status === 'Scheduled' || article.status === 'ScheduledPast') {
      return {
        success: false,
        error: '予約投稿記事の投稿準備状態は変更できません',
      };
    }

    // Draft → Ready: ignorePublish true → false
    // Ready → Draft: ignorePublish false → true
    const newIgnorePublish = article.status === 'Ready';
    const content = setField(
      fs.readFileSync(article.filePath, 'utf-8'),
      'ignorePublish',
      String(newIgnorePublish),
    );
    fs.writeFileSync(article.filePath, content, 'utf-8');

    const newStatus = newIgnorePublish ? 'Draft' : 'Ready';
    return {
      success: true,
      slug,
      newIgnorePublish,
      newStatus,
      label: newStatus === 'Ready' ? '投稿準備完了' : '下書き',
    };
  }

  // === 記事検索 ===

  private _findArticle(slug: unknown): ArticleInfo | undefined {
    if (typeof slug !== 'string' || !slug.trim()) {
      return undefined;
    }
    return this._articleParser.parseAll().find((a) => a.slug === slug);
  }

  /** 編集可能（投稿済みでない）記事を取得。失敗時は error を返す */
  private _requireEditableArticle(
    slug: unknown,
    publishedMessage: string,
  ): { article: ArticleInfo } | { error: { success: false; error: string } } {
    if (typeof slug !== 'string' || !slug.trim()) {
      return {
        error: { success: false, error: 'スラッグが指定されていません' },
      };
    }
    const article = this._findArticle(slug);
    if (!article) {
      return {
        error: {
          success: false,
          error: `記事ファイルが見つかりません: ${slug}.md`,
        },
      };
    }
    if (article.status === 'Published') {
      return { error: { success: false, error: publishedMessage } };
    }
    return { article };
  }

  private _samePath(a: string, b: string): boolean {
    const ra = path.resolve(a);
    const rb = path.resolve(b);
    return process.platform === 'win32'
      ? ra.toLowerCase() === rb.toLowerCase()
      : ra === rb;
  }

  /** ワークスペース配下に収まるパスのみ許可 */
  private _resolveWorkspacePath(rel: unknown): string | undefined {
    if (typeof rel !== 'string' || !rel) {
      return undefined;
    }
    const resolved = path.resolve(this._workspaceRoot, rel);
    const relative = path.relative(this._workspaceRoot, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      return undefined;
    }
    return resolved;
  }

  // === ユーティリティ ===

  private _sanitizeFileName(name: string): string {
    let sanitized = name.replace(/\s+/g, '_');
    sanitized = sanitized.replace(/[<>:"/\\|?*]+/g, '-');
    sanitized = sanitized.replace(/-{2,}/g, '-');
    sanitized = sanitized.replace(/_{2,}/g, '_');
    sanitized = sanitized.replace(/^[-._]+|[-._]+$/g, '');
    return sanitized;
  }

  private _sanitizeBranchName(name: string): string {
    let sanitized = name.replace(/[\s~^:?*[\]\\@{}.]{2,}/g, '-');
    sanitized = sanitized.replace(/[\s~^:?*[\]\\@{}]/g, '-');
    sanitized = sanitized.replace(/^[-./]+|[-./]+$/g, '');
    sanitized = sanitized.replace(/-{2,}/g, '-');
    return sanitized;
  }

  /**
   * スラッグの日付プレフィックスから YYYY/MM サブディレクトリを含むファイルパスを解決する
   * 99999999-* 等の日付未定記事は public/ 直下
   */
  private _resolveArticlePath(slug: string): string {
    const match = slug.match(/^(\d{8})-.+$/);
    if (match && match[1] !== UNDATED_PREFIX) {
      const year = match[1].substring(0, 4);
      const month = match[1].substring(4, 6);
      return path.join(this._publicDir, year, month, `${slug}.md`);
    }
    return path.join(this._publicDir, `${slug}.md`);
  }

  /** 設定 articleCalendar.theme（auto / light / dark）。不正な値は auto */
  private _getTheme(): 'auto' | 'light' | 'dark' {
    const v = vscode.workspace
      .getConfiguration('articleCalendar', vscode.Uri.file(this._workspaceRoot))
      .get<string>('theme', 'auto');
    return v === 'light' || v === 'dark' ? v : 'auto';
  }

  // === HTML 生成 ===

  private _getHtmlForWebview(title: string): string {
    const webview = this._panel.webview;
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'style.css'),
    );
    const codiconUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'codicon.css'),
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'app.js'),
    );

    return /*html*/ `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource};">
  <link rel="stylesheet" href="${codiconUri}">
  <link rel="stylesheet" href="${styleUri}">
  <title>${title}</title>
</head>
<body data-theme="${this._getTheme()}">
  <div class="container">
    <!-- ヘッダー -->
    <div class="header">
      <h1><span>Qiita</span> 記事カレンダー</h1>
      <div class="header-actions">
        <button class="btn-reload" onclick="reloadCalendar()" title="データを再読み込み"><i class="codicon codicon-refresh"></i></button>
        <button class="btn-upload" onclick="openExternalUrl('https://qiita.com/settings/uploading_images')" title="Qiita で画像をアップロード（下書きエディタを開く）"><i class="codicon codicon-cloud-upload"></i> 画像UP</button>
        <button class="btn-new-article" onclick="openCreateModal()" title="新規記事を作成"><i class="codicon codicon-add"></i> 新規記事</button>
      </div>
      <div class="nav">
        <button onclick="changeMonth(-4)" title="4週前"><i class="codicon codicon-chevron-left"></i><i class="codicon codicon-chevron-left"></i></button>
        <button onclick="changeMonth(-1)" title="前週"><i class="codicon codicon-chevron-left"></i></button>
        <button onclick="goToday()" title="今週">今日</button>
        <span class="month-label" id="monthLabel"></span>
        <button onclick="changeMonth(1)" title="翌週"><i class="codicon codicon-chevron-right"></i></button>
        <button onclick="changeMonth(4)" title="4週後"><i class="codicon codicon-chevron-right"></i><i class="codicon codicon-chevron-right"></i></button>
      </div>
    </div>

    <!-- ブランチ警告バナー -->
    <div class="branch-banner" id="branchBanner" style="display:none"></div>

    <!-- 凡例 -->
    <div class="legend">
      <div class="legend-item"><div class="legend-dot published"></div>公開</div>
      <div class="legend-item"><div class="legend-dot private"></div>限定共有</div>
      <div class="legend-item"><div class="legend-dot scheduled"></div>予約投稿</div>
      <div class="legend-item"><div class="legend-dot scheduledpast"></div>予約超過</div>
      <div class="legend-item"><div class="legend-dot ready"></div>投稿準備</div>
      <div class="legend-item"><div class="legend-dot draft"></div>下書き</div>
      <div class="legend-item" id="legendBranchFile" style="display:none"><div class="legend-dot branch-file"></div>ブランチ追加</div>
    </div>

    <!-- サマリー -->
    <div class="summary" id="summary"></div>

    <!-- エラーバナー -->
    <div class="error-banner" id="errorBanner" style="display:none"></div>

    <!-- カレンダー + サイドバー -->
    <div class="calendar-layout">
      <div class="calendar">
        <div class="calendar-grid" id="calendarGrid"></div>
      </div>
      <div class="sidebar-panel" id="sidebarPanel">
        <div class="sidebar-header">日付未定</div>
        <div class="sidebar-content" id="sidebarContent"
          ondragover="onSidebarDragOver(event)"
          ondragleave="onSidebarDragLeave(event)"
          ondrop="onDropToSidebar(event)">
        </div>
      </div>
    </div>

    <!-- 年間グラフ -->
    <div class="yearly-section">
      <h2 id="yearlyTitle"></h2>
      <div class="yearly-chart" id="yearlyChart"></div>
      <div class="yearly-legend" id="yearlyLegend"></div>
    </div>
  </div>

  <!-- 詳細モーダル -->
  <div class="tooltip-overlay" id="tooltipOverlay" onclick="closeTooltip(event)">
    <div class="tooltip-card" id="tooltipCard" onclick="event.stopPropagation()"></div>
  </div>

  <!-- 記事作成モーダル -->
  <div class="tooltip-overlay" id="createOverlay" onclick="closeCreateModal(event)">
    <div class="tooltip-card create-card" id="createCard" onclick="event.stopPropagation()">
      <h3>📝 新規記事を作成</h3>
      <div class="create-form">
        <div class="form-group">
          <label>記事の種別</label>
          <div class="mode-selector">
            <label class="mode-option">
              <input type="radio" name="createMode" value="public" checked />
              <span class="mode-label published">公開</span>
            </label>
            <label class="mode-option">
              <input type="radio" name="createMode" value="private" />
              <span class="mode-label private">限定共有</span>
            </label>
            <label class="mode-option">
              <input type="radio" name="createMode" value="scheduled" />
              <span class="mode-label scheduled">予約投稿</span>
            </label>
          </div>
        </div>
        <div class="form-group" id="scheduledDateGroup" style="display:none">
          <label for="createDate">投稿予定日</label>
          <input type="date" id="createDate" />
        </div>
        <div class="form-group">
          <label for="createTitle">スラッグ（ファイル名）</label>
          <input type="text" id="createTitle" placeholder="例: サーバスクリプト活用法" />
          <div class="form-hint">英数字・日本語・ハイフン可。ファイル名の一部になります。</div>
        </div>
        <div class="form-group-inline">
          <label class="checkbox-label">
            <input type="checkbox" id="createBranch" checked />
            <span>ブランチも作成する</span>
          </label>
          <div class="form-hint">デフォルトブランチから <code>add-{slug}</code> ブランチを作成します</div>
          <div class="branch-info" id="branchInfo"></div>
        </div>
        <div class="form-preview" id="createPreview"></div>
        <div class="form-error" id="createError" style="display:none"></div>
        <div class="actions">
          <button class="btn-create" onclick="submitCreateArticle()" id="createSubmitBtn">作成</button>
          <button onclick="closeCreateModal()">キャンセル</button>
        </div>
      </div>
    </div>
  </div>

  <!-- コミットモーダル -->
  <div class="tooltip-overlay" id="commitOverlay" onclick="closeCommitModal(event)">
    <div class="tooltip-card commit-card" id="commitCard" onclick="event.stopPropagation()">
      <h3>📦 コミット</h3>
      <div class="create-form">
        <div class="form-group">
          <label>変更ファイル</label>
          <div class="commit-file-list" id="commitFileList"></div>
        </div>
        <div class="form-group">
          <label for="commitMessage">コミットメッセージ</label>
          <input type="text" id="commitMessage" placeholder="例: 記事を追加" />
        </div>
        <div class="form-error" id="commitError" style="display:none"></div>
        <div class="actions">
          <button class="btn-create" onclick="submitCommit()" id="commitSubmitBtn">コミット</button>
          <button onclick="closeCommitModal()">キャンセル</button>
        </div>
      </div>
    </div>
  </div>

  <script src="${scriptUri}"></script>
</body>
</html>`;
  }
}
