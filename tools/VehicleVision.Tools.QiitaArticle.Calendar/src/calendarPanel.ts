import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ArticleParser, UNDATED_PREFIX } from './articleParser';
import { HolidayService } from './holidayService';
import { GitService } from './gitService';

export class CalendarPanel {
  public static currentPanel: CalendarPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  private _articleParser: ArticleParser;
  private _holidayService: HolidayService;
  private _gitService: GitService;
  private _publicDir: string;
  private _workspaceRoot: string;

  public static createOrShow(context: vscode.ExtensionContext) {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      vscode.window.showErrorMessage('ワークスペースが開かれていません');
      return;
    }

    // 既存パネルがあればフォーカス
    if (CalendarPanel.currentPanel) {
      CalendarPanel.currentPanel._panel.reveal(vscode.ViewColumn.One);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'articleCalendar',
      'Qiita 記事カレンダー',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
        retainContextWhenHidden: true,
      }
    );

    CalendarPanel.currentPanel = new CalendarPanel(panel, context.extensionUri, workspaceRoot);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, workspaceRoot: string) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._workspaceRoot = workspaceRoot;
    this._publicDir = path.join(workspaceRoot, 'public');

    this._articleParser = new ArticleParser(this._publicDir);
    this._holidayService = new HolidayService();
    this._gitService = new GitService(workspaceRoot);

    this._panel.webview.html = this._getHtmlForWebview();

    this._panel.webview.onDidReceiveMessage(
      message => this._handleMessage(message),
      null,
      this._disposables
    );

    // public/ 配下のファイル変更を監視して自動リロード通知
    const publicPattern = new vscode.RelativePattern(workspaceRoot, 'public/**/*.md');
    const watcher = vscode.workspace.createFileSystemWatcher(publicPattern);
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    const notifyReload = () => {
      if (debounceTimer) { clearTimeout(debounceTimer); }
      debounceTimer = setTimeout(() => {
        this._panel.webview.postMessage({ type: 'fileChanged' });
      }, 500);
    };
    watcher.onDidChange(notifyReload);
    watcher.onDidCreate(notifyReload);
    watcher.onDidDelete(notifyReload);
    this._disposables.push(watcher);

    // .git/HEAD の変更を監視してブランチ切替を検知
    const gitHeadPattern = new vscode.RelativePattern(workspaceRoot, '.git/HEAD');
    const gitHeadWatcher = vscode.workspace.createFileSystemWatcher(gitHeadPattern);
    const notifyBranchChange = () => {
      if (debounceTimer) { clearTimeout(debounceTimer); }
      debounceTimer = setTimeout(() => {
        this._panel.webview.postMessage({ type: 'fileChanged' });
      }, 300);
    };
    gitHeadWatcher.onDidChange(notifyBranchChange);
    this._disposables.push(gitHeadWatcher);

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
  }

  public dispose() {
    CalendarPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const d = this._disposables.pop();
      if (d) { d.dispose(); }
    }
  }

  // === メッセージハンドラ ===

  private async _handleMessage(message: any) {
    if (message.type !== 'request') { return; }
    const { id, command } = message;

    try {
      let data: any;

      switch (command) {
        case 'getArticles':
          data = this._articleParser.parseAll();
          break;

        case 'getArticlesByMonth': {
          const all = this._articleParser.parseAll();
          data = all.filter(a => {
            const [y, m] = a.displayDate.split('-').map(Number);
            return y === message.year && m === message.month;
          });
          break;
        }

        case 'getHolidays':
          data = await this._holidayService.getHolidays(message.year);
          break;

        case 'getGitBranch':
          data = this._gitService.getCurrentBranch();
          break;

        case 'getGitStatus':
          data = this._gitService.getStatus();
          break;

        case 'getBranchFiles':
          data = this._gitService.getBranchFiles();
          break;

        case 'gitCommit':
          data = this._gitService.commit(message.message, message.push);
          break;

        case 'gitMergeAndPush':
          data = this._gitService.mergeAndPush();
          break;

        case 'createArticle':
          data = this._createArticle(message);
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
          const filePath = path.join(this._workspaceRoot, message.path);
          const doc = await vscode.workspace.openTextDocument(filePath);
          await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
          data = { success: true };
          break;
        }

        case 'openExternal':
          await vscode.env.openExternal(vscode.Uri.parse(message.url));
          data = { success: true };
          break;

        default:
          throw new Error(`Unknown command: ${command}`);
      }

      this._panel.webview.postMessage({ type: 'response', id, data });
    } catch (err: any) {
      this._panel.webview.postMessage({ type: 'response', id, error: err.message });
    }
  }

  // === 記事作成 ===

  private _createArticle(req: any): any {
    const title = req.title;
    if (!title?.trim()) {
      return { success: false, error: 'スラッグは必須です' };
    }

    const validModes = ['public', 'private', 'scheduled'];
    const mode = (req.mode || 'public').toLowerCase();
    if (!validModes.includes(mode)) {
      return { success: false, error: '記事種別が不正です（public / private / scheduled）' };
    }

    // 日付の決定
    let articleDate: Date;
    if (mode === 'scheduled') {
      if (!req.date) { return { success: false, error: '予約投稿には日付が必須です' }; }
      articleDate = new Date(req.date + 'T00:00:00');
      if (isNaN(articleDate.getTime())) { return { success: false, error: '日付の形式が不正です（YYYY-MM-DD）' }; }
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (articleDate <= today) { return { success: false, error: '予約投稿日は明日以降を指定してください' }; }
    } else {
      articleDate = new Date();
    }

    const y = articleDate.getFullYear();
    const m = String(articleDate.getMonth() + 1).padStart(2, '0');
    const d = String(articleDate.getDate()).padStart(2, '0');
    const dateForFile = `${y}${m}${d}`;
    const sanitizedTitle = this._sanitizeFileName(title);
    const slug = `${dateForFile}-${sanitizedTitle}`;
    const subDir = path.join(this._publicDir, `${y}`, m);
    const filePath = path.join(subDir, `${slug}.md`);

    if (fs.existsSync(filePath)) {
      return { success: false, error: `同名の記事ファイルが既に存在します: ${slug}.md` };
    }

    // ブランチ操作
    let branch: string | null = null;
    if (req.createBranch) {
      const r1 = this._gitService.runGit('checkout main');
      if (!r1.success) {
        return { success: false, error: `main への切り替えに失敗しました: ${r1.output}` };
      }

      this._gitService.runGit('pull');

      const safeBranchSlug = this._sanitizeBranchName(slug);
      branch = `add-${safeBranchSlug}`;
      const r2 = this._gitService.runGit(`checkout -b ${branch}`);
      if (!r2.success) {
        return { success: false, error: `ブランチの作成に失敗しました: ${r2.output}` };
      }
    }

    // Front Matter 生成
    const isPrivate = mode === 'private' ? 'true' : 'false';
    const isScheduled = mode === 'scheduled';
    const scheduledLine = isScheduled ? `\nscheduled_publish: "${req.date}"` : '';

    const content =
      `---\ntitle: ''\ntags:\n  - ''\nprivate: ${isPrivate}\nupdated_at: ''\nid: null\norganization_url_name: null\nslide: false\nignorePublish: true${scheduledLine}\n---\n\n`;

    if (!fs.existsSync(subDir)) {
      fs.mkdirSync(subDir, { recursive: true });
    }
    fs.writeFileSync(filePath, content, 'utf-8');

    const modeLabel = mode === 'private' ? '限定共有' : mode === 'scheduled' ? '予約投稿' : '公開';
    const dateStr = `${y}-${m}-${d}`;

    return { success: true, slug, filePath: `public/${y}/${m}/${slug}.md`, date: dateStr, branch, mode, modeLabel };
  }

  // === 記事リスケジュール ===

  private _rescheduleArticle(slug: string, newDate: string): any {
    if (!slug?.trim()) { return { success: false, error: 'スラッグが指定されていません' }; }
    if (!newDate?.trim()) { return { success: false, error: '移動先の日付が指定されていません' }; }

    const dateMatch = newDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!dateMatch) { return { success: false, error: '日付の形式が不正です（YYYY-MM-DD）' }; }

    const oldPath = this._resolveArticlePath(slug);
    if (!fs.existsSync(oldPath)) {
      return { success: false, error: `記事ファイルが見つかりません: ${slug}.md` };
    }

    const article = this._articleParser.parseAll().find(a => a.slug === slug);
    if (!article) { return { success: false, error: '記事の解析に失敗しました' }; }

    if (article.status === 'Published') {
      return { success: false, error: '投稿済みの記事は移動できません' };
    }

    const nd = new Date(newDate + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const isToday = nd.getTime() === today.getTime();
    if (nd < today) {
      return { success: false, error: '移動先は今日以降を指定してください' };
    }

    // 新スラッグ生成: 日付部分のみ差し替え（日付なしスラッグにも対応）
    const slugDateMatch = slug.match(/^(\d{8})-(.+)$/);
    const titlePart = slugDateMatch ? slugDateMatch[2] : slug;
    const newDateForFile = newDate.replace(/-/g, '');
    const newSlug = `${newDateForFile}-${titlePart}`;
    const newDir = path.join(this._publicDir, newDate.substring(0, 4), newDate.substring(5, 7));
    const newPath = path.join(newDir, `${newSlug}.md`);

    if (oldPath !== newPath && fs.existsSync(newPath)) {
      return { success: false, error: `移動先に同名のファイルが既に存在します: ${newSlug}.md` };
    }

    // Front Matter の scheduled_publish を更新（存在しない場合は追加）
    // 今日に移動した場合は scheduled_publish を除去し、ignorePublish を false に設定
    let content = fs.readFileSync(oldPath, 'utf-8');
    let readyForPublish = false;

    if (isToday) {
      // scheduled_publish を除去
      content = content.replace(/\nscheduled_publish:\s*"[^"]*"/, '');
      // ignorePublish を false に変更（投稿準備状態にする）
      if (/ignorePublish:\s*true/i.test(content)) {
        content = content.replace(/ignorePublish:\s*true/i, 'ignorePublish: false');
        readyForPublish = true;
      }
    } else if (/scheduled_publish:\s*"[^"]*"/.test(content)) {
      content = content.replace(
        /scheduled_publish:\s*"[^"]*"/,
        `scheduled_publish: "${newDate}"`
      );
    } else {
      // scheduled_publish が存在しない場合、Front Matter の末尾（閉じ --- の前）に追加
      content = content.replace(
        /^(---\n[\s\S]*?\n)(---)/m,
        `$1scheduled_publish: "${newDate}"\n$2`
      );
    }

    if (oldPath !== newPath) {
      if (!fs.existsSync(newDir)) {
        fs.mkdirSync(newDir, { recursive: true });
      }
      fs.writeFileSync(newPath, content, 'utf-8');
      fs.unlinkSync(oldPath);
    } else {
      fs.writeFileSync(oldPath, content, 'utf-8');
    }

    return { success: true, oldSlug: slug, newSlug, newDate, readyForPublish };
  }

  // === 記事の日付除去 ===

  private _removeArticleDate(slug: string): any {
    if (!slug?.trim()) { return { success: false, error: 'スラッグが指定されていません' }; }

    const oldPath = this._resolveArticlePath(slug);
    if (!fs.existsSync(oldPath)) {
      return { success: false, error: `記事ファイルが見つかりません: ${slug}.md` };
    }

    const article = this._articleParser.parseAll().find(a => a.slug === slug);
    if (!article) { return { success: false, error: '記事の解析に失敗しました' }; }

    if (article.status === 'Published') {
      return { success: false, error: '投稿済みの記事は移動できません' };
    }

    const match = slug.match(/^(\d{8})-(.+)$/);
    if (!match) {
      return { success: false, error: 'この記事には日付プレフィックスがありません' };
    }

    const titlePart = match[2];
    const newSlug = `${UNDATED_PREFIX}-${titlePart}`;

    // 既に日付未定の場合は何もしない
    if (match[1] === UNDATED_PREFIX) {
      return { success: false, error: 'この記事は既に日付未定です' };
    }

    const newPath = path.join(this._publicDir, `${newSlug}.md`);

    if (fs.existsSync(newPath)) {
      return { success: false, error: `同名のファイルが既に存在します: ${newSlug}.md` };
    }

    // scheduled_publish を削除
    let content = fs.readFileSync(oldPath, 'utf-8');
    content = content.replace(/scheduled_publish:\s*"[^"]*"\n?/, '');

    fs.writeFileSync(newPath, content, 'utf-8');
    fs.unlinkSync(oldPath);

    return { success: true, oldSlug: slug, newSlug: newSlug };
  }

  // === フィールドトグル ===

  private _togglePrivate(slug: string): any {
    if (!slug?.trim()) { return { success: false, error: 'スラッグが指定されていません' }; }

    const filePath = this._resolveArticlePath(slug);
    if (!fs.existsSync(filePath)) {
      return { success: false, error: `記事ファイルが見つかりません: ${slug}.md` };
    }

    const article = this._articleParser.parseAll().find(a => a.slug === slug);
    if (!article) { return { success: false, error: '記事の解析に失敗しました' }; }

    if (article.status === 'Published') {
      return { success: false, error: '投稿済みの記事の公開設定は Qiita Web 上で変更してください' };
    }

    let content = fs.readFileSync(filePath, 'utf-8');
    const newValue = !article.isPrivate;
    content = content.replace(
      /private:\s*(true|false)/,
      `private: ${newValue}`
    );
    fs.writeFileSync(filePath, content, 'utf-8');

    return {
      success: true, slug, newValue,
      label: newValue ? '限定共有' : '公開',
    };
  }

  private _toggleIgnorePublish(slug: string): any {
    if (!slug?.trim()) { return { success: false, error: 'スラッグが指定されていません' }; }

    const filePath = this._resolveArticlePath(slug);
    if (!fs.existsSync(filePath)) {
      return { success: false, error: `記事ファイルが見つかりません: ${slug}.md` };
    }

    const article = this._articleParser.parseAll().find(a => a.slug === slug);
    if (!article) { return { success: false, error: '記事の解析に失敗しました' }; }

    if (article.status === 'Published') {
      return { success: false, error: '投稿済みの記事は変更できません' };
    }

    if (article.status === 'Scheduled' || article.status === 'ScheduledPast') {
      return { success: false, error: '予約投稿記事の投稿準備状態は変更できません' };
    }

    let content = fs.readFileSync(filePath, 'utf-8');
    // Draft → Ready: ignorePublish true → false
    // Ready → Draft: ignorePublish false → true
    const newIgnorePublish = article.status === 'Ready';
    content = content.replace(
      /ignorePublish:\s*(true|false)/i,
      `ignorePublish: ${newIgnorePublish}`
    );
    fs.writeFileSync(filePath, content, 'utf-8');

    const newStatus = newIgnorePublish ? 'Draft' : 'Ready';
    return {
      success: true, slug, newIgnorePublish, newStatus,
      label: newStatus === 'Ready' ? '投稿準備完了' : '下書き',
    };
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

  // === HTML 生成 ===

  private _getHtmlForWebview(): string {
    const webview = this._panel.webview;
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'style.css')
    );
    const codiconUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'codicon.css')
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'app.js')
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
  <title>Qiita 記事カレンダー</title>
</head>
<body>
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
          <div class="form-hint">main から <code>add-{slug}</code> ブランチを作成します</div>
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
