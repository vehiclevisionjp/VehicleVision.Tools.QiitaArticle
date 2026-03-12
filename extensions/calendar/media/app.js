// === VS Code Webview API ブリッジ ===
const vscode = acquireVsCodeApi();
const _pendingRequests = {};
let _requestId = 0;

function apiRequest(command, params) {
  return new Promise((resolve, reject) => {
    const id = String(++_requestId);
    _pendingRequests[id] = { resolve, reject };
    vscode.postMessage(Object.assign({ type: 'request', id, command }, params || {}));
  });
}

window.addEventListener('message', event => {
  const msg = event.data;
  if (msg.type === 'response' && _pendingRequests[msg.id]) {
    const { resolve, reject } = _pendingRequests[msg.id];
    delete _pendingRequests[msg.id];
    if (msg.error) { reject(new Error(msg.error)); }
    else { resolve(msg.data); }
  }
  // ファイル変更検知による自動リロード
  if (msg.type === 'fileChanged') {
    (async function() {
      await Promise.all([fetchArticles(), fetchCurrentBranch()]);
      render();
    })();
  }
});

// === 外部リンク・エディタ連携 ===
function openExternalUrl(url, event) {
  if (event) { event.preventDefault(); event.stopPropagation(); }
  apiRequest('openExternal', { url: url });
}

function getArticlePath(slug) {
  var match = slug.match(/^(\d{4})(\d{2})\d{2}-.+$/);
  if (match && slug.substring(0, 8) !== '99999999') {
    return 'public/' + match[1] + '/' + match[2] + '/' + slug + '.md';
  }
  return 'public/' + slug + '.md';
}

function openInEditor(slug) {
  apiRequest('openFile', { path: getArticlePath(slug) });
}

// === 状態 ===
let currentYear, currentMonth;
let calStartDate = null;
let allArticles = [];
let holidays = {};
let holidayErrors = [];
let currentBranch = null;
let isMainBranch = false;
let hasUncommitted = false;
let branchFiles = [];
let dragSlug = null;
let commitWithPush = false;

// === 初期化 ===
async function init() {
  const today = new Date();
  currentYear = today.getFullYear();
  currentMonth = today.getMonth() + 1;
  initCalStart();
  await Promise.all([fetchArticles(), fetchHolidaysForCalendar(), fetchCurrentBranch()]);
  render();
  document.body.classList.add('ready');
}

// === リロード ===
async function reloadCalendar() {
  const btn = document.querySelector('.btn-reload');
  if (btn) { btn.classList.add('spinning'); btn.disabled = true; }
  try {
    await Promise.all([fetchArticles(), fetchHolidaysForCalendar(), fetchCurrentBranch()]);
    render();
  } finally {
    if (btn) { btn.classList.remove('spinning'); btn.disabled = false; }
  }
}

// カレンダー開始日を初期化（今日の2週間前の月曜日を基点に14週間表示）
function initCalStart() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dow = (today.getDay() + 6) % 7; // 0=月, 6=日
  const thisMonday = new Date(today);
  thisMonday.setDate(thisMonday.getDate() - dow);
  calStartDate = new Date(thisMonday);
  calStartDate.setDate(calStartDate.getDate() - 14); // 2週間前
}

// カレンダー表示範囲の終了日を取得（calStartDate 基準で14週間分）
function getCalEndDate() {
  const endSunday = new Date(calStartDate);
  endSunday.setDate(endSunday.getDate() + 14 * 7 - 1); // 14週間の最終日（日曜）
  endSunday.setHours(23, 59, 59, 999);
  return endSunday;
}

// カレンダー表示範囲に必要な祝日を取得
async function fetchHolidaysForCalendar() {
  const endDate = getCalEndDate();
  const years = new Set();
  years.add(calStartDate.getFullYear());
  years.add(endDate.getFullYear());
  await Promise.all([...years].map(y => fetchHolidays(y)));
}

// === ブランチ取得 ===
async function fetchCurrentBranch() {
  try {
    const data = await apiRequest('getGitBranch');
    if (data.success) {
      currentBranch = data.branch;
      isMainBranch = data.branch === 'main' || data.branch === 'master';
    } else {
      currentBranch = null;
      isMainBranch = false;
    }
  } catch {
    currentBranch = null;
    isMainBranch = false;
  }
  // ブランチ差分ファイル取得（非 main ブランチの場合）
  if (!isMainBranch && currentBranch) {
    try {
      const bf = await apiRequest('getBranchFiles');
      branchFiles = (bf.success && bf.files) ? bf.files : [];
    } catch {
      branchFiles = [];
    }
  } else {
    branchFiles = [];
  }
  try {
    const statusData = await apiRequest('getGitStatus');
    hasUncommitted = statusData.success && statusData.hasChanges;
  } catch {
    hasUncommitted = false;
  }
  renderBranchBanner();
}

// ブランチ警告バナーの表示
function renderBranchBanner() {
  const banner = document.getElementById('branchBanner');
  const newArticleBtn = document.querySelector('.btn-new-article');
  const legendBranchItem = document.getElementById('legendBranchFile');
  if (!banner) return;

  // 凡例のブランチファイル表示制御
  if (legendBranchItem) {
    legendBranchItem.style.display = (!isMainBranch && branchFiles.length > 0) ? '' : 'none';
  }

  if (!isMainBranch && currentBranch) {
    const commitBtn = hasUncommitted
      ? '<button class="btn-commit" onclick="openCommitModal(false)"><i class="codicon codicon-git-commit"></i> コミット</button>'
      : '';
    const mergeBtn = !hasUncommitted
      ? '<button class="btn-merge-push" onclick="mergeAndPush()"><i class="codicon codicon-git-merge"></i> マージ＆プッシュ</button>'
      : '';
    banner.innerHTML = '現在のブランチは <strong>' + escapeHtml(currentBranch) + '</strong> です。記事の追加は main ブランチでのみ可能です。'
      + '<div class="branch-actions">'
      + commitBtn
      + mergeBtn
      + '</div>';
    banner.style.display = 'flex';
    if (newArticleBtn) {
      newArticleBtn.disabled = true;
      newArticleBtn.title = 'main ブランチ以外では記事を追加できません';
    }
  } else if (isMainBranch && hasUncommitted) {
    banner.innerHTML = '未コミットの変更があります。'
      + '<div class="branch-actions">'
      + '<button class="btn-commit-push" onclick="openCommitModal(true)"><i class="codicon codicon-git-commit"></i> コミット＆プッシュ</button>'
      + '</div>';
    banner.className = 'branch-banner main-uncommitted';
    banner.style.display = 'flex';
    if (newArticleBtn) {
      newArticleBtn.disabled = false;
      newArticleBtn.title = '新規記事を作成';
    }
  } else {
    banner.style.display = 'none';
    banner.className = 'branch-banner';
    if (newArticleBtn) {
      newArticleBtn.disabled = false;
      newArticleBtn.title = '新規記事を作成';
    }
  }
}

// === コミットモーダル ===
async function openCommitModal(withPush) {
  commitWithPush = !!withPush;
  const overlay = document.getElementById('commitOverlay');
  const error = document.getElementById('commitError');
  const fileList = document.getElementById('commitFileList');
  const msgInput = document.getElementById('commitMessage');
  const btn = document.getElementById('commitSubmitBtn');
  const title = document.querySelector('#commitCard h3');
  error.style.display = 'none';
  msgInput.value = '';
  btn.disabled = false;
  if (commitWithPush) {
    btn.textContent = 'コミット＆プッシュ';
    title.textContent = '📦 コミット＆プッシュ';
  } else {
    btn.textContent = 'コミット';
    title.textContent = '📦 コミット';
  }
  fileList.innerHTML = '読込中…';
  overlay.classList.add('active');

  try {
    const data = await apiRequest('getGitStatus');
    if (data.success && data.hasChanges) {
      fileList.innerHTML = data.files.map(function(f) {
        return '<div class="commit-file"><span class="commit-file-status">' + escapeHtml(f.status) + '</span>' + escapeHtml(f.path) + '</div>';
      }).join('');
    } else if (data.success) {
      fileList.innerHTML = '<div class="commit-file">変更なし</div>';
      btn.disabled = true;
    } else {
      fileList.innerHTML = '<div class="commit-file">取得に失敗しました</div>';
    }
  } catch {
    fileList.innerHTML = '<div class="commit-file">取得に失敗しました</div>';
  }
}

function closeCommitModal(e) {
  if (e && e.target !== e.currentTarget) return;
  document.getElementById('commitOverlay').classList.remove('active');
}

// コミット実行
async function submitCommit() {
  const msgInput = document.getElementById('commitMessage');
  const error = document.getElementById('commitError');
  const btn = document.getElementById('commitSubmitBtn');
  const message = msgInput.value.trim();

  if (!message) {
    error.textContent = 'コミットメッセージを入力してください';
    error.style.display = 'block';
    return;
  }

  error.style.display = 'none';
  btn.disabled = true;
  btn.textContent = '処理中…';

  try {
    const data = await apiRequest('gitCommit', { message: message, push: commitWithPush });
    if (data.success) {
      closeCommitModal();
      await fetchCurrentBranch();
      await fetchArticles();
      render();
      showNotification('✅ ' + data.message);
    } else {
      error.textContent = data.error;
      error.style.display = 'block';
      btn.disabled = false;
      btn.textContent = commitWithPush ? 'コミット＆プッシュ' : 'コミット';
    }
  } catch (e) {
    error.textContent = commitWithPush ? 'コミット＆プッシュに失敗しました' : 'コミットに失敗しました';
    error.style.display = 'block';
    btn.disabled = false;
    btn.textContent = commitWithPush ? 'コミット＆プッシュ' : 'コミット';
  }
}

// マージ＆プッシュ
async function mergeAndPush() {
  const btn = document.querySelector('.btn-merge-push');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '処理中…';
  }
  try {
    const data = await apiRequest('gitMergeAndPush');
    if (data.success) {
      await fetchCurrentBranch();
      await fetchArticles();
      render();
      showNotification('✅ ' + data.message);
    } else {
      showNotification('❌ ' + data.error);
      if (btn) { btn.disabled = false; btn.textContent = 'マージ＆プッシュ'; }
    }
  } catch (e) {
    showNotification('❌ マージ＆プッシュに失敗しました');
    if (btn) { btn.disabled = false; btn.textContent = 'マージ＆プッシュ'; }
  }
}

// === 記事取得 ===
async function fetchArticles() {
  try {
    allArticles = await apiRequest('getArticles');
  } catch (e) {
    console.error('記事取得エラー:', e);
    allArticles = [];
  }
}

// === 祝日取得 ===
async function fetchHolidays(year) {
  if (holidays['_loaded_' + year]) return;
  try {
    const data = await apiRequest('getHolidays', { year: year });
    if (data.success) {
      data.holidays.forEach(function(h) { holidays[h.date] = h.name; });
      holidays['_loaded_' + year] = true;
      holidayErrors = holidayErrors.filter(function(e) { return e.indexOf(String(year)) === -1; });
    } else {
      if (!holidayErrors.some(function(e) { return e.indexOf(String(year)) >= 0; })) {
        holidayErrors.push(data.error || year + '年の祝日を取得できませんでした');
      }
    }
  } catch (e) {
    console.error('祝日取得エラー:', e);
    if (!holidayErrors.some(function(err) { return err.indexOf(String(year)) >= 0; })) {
      holidayErrors.push(year + '年の祝日を取得できませんでした');
    }
  }
  renderErrorBanner();
}

// エラーバナー表示
function renderErrorBanner() {
  const banner = document.getElementById('errorBanner');
  if (holidayErrors.length > 0) {
    banner.textContent = holidayErrors.join(' / ');
    banner.style.display = 'flex';
  } else {
    banner.style.display = 'none';
  }
}

// === ナビゲーション ===
async function changeMonth(delta) {
  calStartDate.setDate(calStartDate.getDate() + delta * 7);
  // ビュー中央付近の月を現在月とする
  const center = new Date(calStartDate);
  center.setDate(center.getDate() + 49); // 7週目 = 中央付近
  currentYear = center.getFullYear();
  currentMonth = center.getMonth() + 1;
  await fetchHolidaysForCalendar();
  render();
}

async function goToday() {
  const today = new Date();
  currentYear = today.getFullYear();
  currentMonth = today.getMonth() + 1;
  initCalStart();
  await fetchHolidaysForCalendar();
  render();
}

// === 描画統合 ===
function render() {
  renderHeader();
  renderSummary();
  renderCalendar();
  renderSidebar();
  renderYearlyChart();
}

// ヘッダー
function renderHeader() {
  const endDate = getCalEndDate();
  const startY = calStartDate.getFullYear();
  const startM = calStartDate.getMonth() + 1;
  const endY = endDate.getFullYear();
  const endM = endDate.getMonth() + 1;
  if (startY === endY) {
    document.getElementById('monthLabel').textContent = startY + '年' + startM + '月〜' + endM + '月';
  } else {
    document.getElementById('monthLabel').textContent = startY + '年' + startM + '月〜' + endY + '年' + endM + '月';
  }
}

// サマリー
function renderSummary() {
  const monthArticles = getMonthArticles(currentYear, currentMonth);
  const pubArticles = monthArticles.filter(function(a) { return a.status === 'Published'; });
  const pubPublic = pubArticles.filter(function(a) { return !a.isPrivate; }).length;
  const pubPrivate = pubArticles.filter(function(a) { return a.isPrivate; }).length;
  const scheduled = allArticles.filter(function(a) { return a.status === 'Scheduled'; }).length;
  const scheduledPast = allArticles.filter(function(a) { return a.status === 'ScheduledPast'; }).length;
  const ready = allArticles.filter(function(a) { return a.status === 'Ready'; }).length;
  const draft = allArticles.filter(function(a) { return a.status === 'Draft'; }).length;

  const monthLabel = currentYear + '年' + currentMonth + '月';
  document.getElementById('summary').innerHTML =
    '<div class="summary-group">' +
    '<div class="summary-group-header">📅 ' + monthLabel + '</div>' +
    '<div class="summary-group-cards">' +
    '<div class="summary-card"><div class="number">' + monthArticles.length + '</div><div class="label">記事数</div></div>' +
    '<div class="summary-card published"><div class="number">' + pubPublic + '</div><div class="label">公開</div></div>' +
    '<div class="summary-card private"><div class="number">' + pubPrivate + '</div><div class="label">限定共有</div></div>' +
    '</div></div>' +
    '<div class="summary-group">' +
    '<div class="summary-group-header">📁 全件</div>' +
    '<div class="summary-group-cards">' +
    '<div class="summary-card"><div class="number">' + allArticles.length + '</div><div class="label">総記事数</div></div>' +
    '<div class="summary-card scheduled"><div class="number">' + scheduled + '</div><div class="label">予約投稿</div></div>' +
    '<div class="summary-card scheduledpast"><div class="number">' + scheduledPast + '</div><div class="label">予約超過</div></div>' +
    '<div class="summary-card ready"><div class="number">' + ready + '</div><div class="label">投稿準備</div></div>' +
    '<div class="summary-card draft"><div class="number">' + draft + '</div><div class="label">下書き</div></div>' +
    '</div></div>';
}

// 当月の記事を取得
function getMonthArticles(year, month) {
  return allArticles.filter(function(a) {
    var d = parseDisplayDate(a);
    return d.getFullYear() === year && d.getMonth() + 1 === month;
  });
}

function parseDisplayDate(article) {
  return new Date(article.displayDate);
}

// ISO 週番号
function getISOWeekNumber(date) {
  var d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  var yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

// === カレンダー描画（4ヶ月表示） ===
function renderCalendar() {
  var grid = document.getElementById('calendarGrid');
  var today = new Date();
  today.setHours(0, 0, 0, 0);

  // ヘッダー
  var dayNames = ['W', '月', '火', '水', '木', '金', '土', '日'];
  var html = dayNames.map(function(d, i) {
    var cls = 'day-header';
    if (i === 0) cls += ' week-num-header';
    if (i === 6) cls += ' day-header-sat';
    if (i === 7) cls += ' day-header-sun';
    return '<div class="' + cls + '">' + d + '</div>';
  }).join('');

  // 表示終了日
  var calEnd = getCalEndDate();

  var rangeArticles = allArticles.filter(function(a) {
    var d = parseDisplayDate(a);
    return d >= calStartDate && d <= calEnd;
  });

  // 週の総数
  var diffDays = Math.floor((calEnd - calStartDate) / 86400000) + 1;
  var totalWeeks = Math.ceil(diffDays / 7);

  var prevWeekMonth = -1;
  var labeledMonths = {};

  for (var w = 0; w < totalWeeks; w++) {
    var weekMonday = new Date(calStartDate);
    weekMonday.setDate(weekMonday.getDate() + w * 7);
    var weekMondayMonth = weekMonday.getMonth() + 1;
    var weekMondayYear = weekMonday.getFullYear();

    var isNewWeekMonth = weekMondayMonth !== prevWeekMonth;
    prevWeekMonth = weekMondayMonth;

    // 週番号セル
    var isoWeek = getISOWeekNumber(weekMonday);
    var weekNumExtra = (isNewWeekMonth && w > 0) ? ' month-start-week' : '';
    html += '<div class="week-num-cell' + weekNumExtra + '">W' + isoWeek + '</div>';

    // 7日分
    for (var d = 0; d < 7; d++) {
      var cellDate = new Date(weekMonday);
      cellDate.setDate(cellDate.getDate() + d);
      var dayNum = cellDate.getDate();
      var cellMonth = cellDate.getMonth() + 1;
      var cellYear = cellDate.getFullYear();
      var isToday = cellDate.getTime() === today.getTime();
      var isSaturday = d === 5;
      var isSunday = d === 6;

      var cellDateStr = formatDate(cellDate);
      var dayArticles = rangeArticles.filter(function(a) { return a.displayDate === cellDateStr; });
      var holidayName = holidays[cellDateStr];

      var classes = 'day-cell';
      if (isToday) classes += ' today';
      if (isSaturday) classes += ' saturday';
      if (isSunday) classes += ' sunday';
      if (isSunday) classes += ' week-end';
      if (holidayName) classes += ' holiday';
      if (dayNum === 1 && d > 0) classes += ' month-start';
      if (isNewWeekMonth && w > 0) classes += ' month-start-row';

      var holidayHtml = holidayName
        ? '<div class="holiday-label" title="' + escapeAttr(holidayName) + '">' + escapeHtml(holidayName) + '</div>'
        : '';

      var isPast = cellDate < today;
      var isTodayOrFuture = !isPast;
      var isFuture = cellDate > today;

      // ドロップターゲット属性（今日以降ドロップ可能、onDrop 内でブランチチェック）
      var dropAttrs = isTodayOrFuture
        ? 'ondragover="onDragOver(event)" ondragleave="onDragLeave(event)" ondrop="onDrop(event, \'' + cellDateStr + '\')"'
        : '';

      var articlesHtml = dayArticles.map(function(a) {
        var statusClass;
        if (a.status === 'Published' && a.isPrivate) statusClass = 'private';
        else if (a.status === 'ScheduledPast') statusClass = 'scheduledpast';
        else statusClass = a.status.toLowerCase();

        var isBranchFile = !isMainBranch && branchFiles.indexOf(a.slug) !== -1;
        var isDraggable = isMainBranch
          ? a.status !== 'Published'
          : (isBranchFile && a.status !== 'Published');
        var dragAttrs = isDraggable
          ? 'draggable="true" ondragstart="onDragStart(event, \'' + escapeAttr(a.slug) + '\')"'
          : '';

        var linkIcon = a.qiitaId
          ? '<a href="#" onclick="openExternalUrl(\'https://qiita.com/items/' + escapeAttr(a.qiitaId) + '\', event)" class="article-link" title="Qiita で開く"><i class="codicon codicon-link-external"></i></a>'
          : '';

        var branchFileClass = isBranchFile ? ' branch-file' : '';

        return '<div class="article-item ' + statusClass + (isDraggable ? ' draggable' : '') + branchFileClass + '"'
          + ' ' + dragAttrs
          + ' onclick="showDetail(\'' + escapeAttr(a.slug) + '\')"'
          + ' title="' + escapeAttr(a.title) + '">' + linkIcon + escapeHtml(a.title) + '</div>';
      }).join('');

      // +ボタン（明日以降 & main のみ）
      var addBtn = (isFuture && isMainBranch)
        ? '<button class="add-article-btn" onclick="event.stopPropagation(); openCreateModal(\'' + cellDateStr + '\')" title="予約投稿を作成"><i class="codicon codicon-add"></i></button>'
        : '';

      // 月ラベル
      var monthKey = cellYear + '-' + cellMonth;
      var showMonthLabel = (dayNum === 1 || (d === 0 && isNewWeekMonth)) && !labeledMonths[monthKey];
      if (showMonthLabel) labeledMonths[monthKey] = true;
      var monthLabel = showMonthLabel
        ? '<div class="month-label-cell">' + (cellYear !== currentYear ? cellYear + '年' : '') + cellMonth + '月</div>'
        : '';

      html += '<div class="' + classes + '" data-date="' + cellDateStr + '" ' + dropAttrs + '>'
        + '<div class="day-number">' + dayNum + addBtn + '</div>'
        + monthLabel
        + holidayHtml
        + articlesHtml
        + '</div>';
    }
  }

  grid.innerHTML = html;
}

// === ドラッグ＆ドロップ ===
function onDragStart(e, slug) {
  dragSlug = slug;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', slug);
  e.target.classList.add('dragging');

  document.querySelectorAll('.day-cell[ondrop]').forEach(function(el) { el.classList.add('drop-target'); });
  // サイドバーもドロップターゲットとしてハイライト（日付あり記事の場合）
  var article = allArticles.find(function(a) { return a.slug === slug; });
  if (article && article.hasDate) {
    var sidebar = document.getElementById('sidebarContent');
    if (sidebar) sidebar.classList.add('drop-target');
  }
}

function onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.classList.add('drag-over');
}

function onDragLeave(e) {
  e.currentTarget.classList.remove('drag-over');
}

async function onDrop(e, newDateStr) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  document.querySelectorAll('.drop-target').forEach(function(el) { el.classList.remove('drop-target'); });

  var slug = e.dataTransfer.getData('text/plain') || dragSlug;
  if (!slug) return;

  var article = allArticles.find(function(a) { return a.slug === slug; });
  if (!article) return;

  // main ブランチ以外では、そのブランチで追加されたファイルのみ移動可能
  if (!isMainBranch) {
    if (branchFiles.indexOf(article.slug) === -1) {
      showNotification('⚠️ この記事は現在のブランチ（' + (currentBranch || '不明') + '）で追加されたものではないため移動できません');
      dragSlug = null;
      return;
    }
  }

  if (article.displayDate === newDateStr) {
    dragSlug = null;
    return;
  }

  try {
    var data = await apiRequest('rescheduleArticle', { slug: slug, newDate: newDateStr });
    if (data.success) {
      await fetchArticles();
      render();
      var msg = '📅 記事を ' + newDateStr + ' に移動しました（' + data.newSlug + '.md）';
      if (data.readyForPublish) { msg += '\n✅ 投稿準備に変更しました（ignorePublish: false）'; }
      showNotification(msg);
    } else {
      showNotification('⚠️ ' + (data.error || '移動に失敗しました'));
    }
  } catch (err) {
    console.error('日付変更エラー:', err);
    showNotification('⚠️ エラー: ' + (err.message || '不明なエラーが発生しました'));
  }
  dragSlug = null;
}

// ドラッグ終了時のクリーンアップ
document.addEventListener('dragend', function() {
  dragSlug = null;
  document.querySelectorAll('.dragging').forEach(function(el) { el.classList.remove('dragging'); });
  document.querySelectorAll('.drag-over').forEach(function(el) { el.classList.remove('drag-over'); });
  document.querySelectorAll('.drop-target').forEach(function(el) { el.classList.remove('drop-target'); });
  var sidebar = document.getElementById('sidebarContent');
  if (sidebar) { sidebar.classList.remove('drop-target'); sidebar.classList.remove('drag-over'); }
});

// === サイドバー（日付未定記事）===
function renderSidebar() {
  var container = document.getElementById('sidebarContent');
  if (!container) return;

  var undatedArticles = allArticles.filter(function(a) { return !a.hasDate; });

  if (undatedArticles.length === 0) {
    container.innerHTML = '<div class="sidebar-empty">日付未定の記事はありません</div>';
    return;
  }

  var html = undatedArticles.map(function(a) {
    var statusClass;
    if (a.status === 'Published' && a.isPrivate) statusClass = 'private';
    else if (a.status === 'ScheduledPast') statusClass = 'scheduledpast';
    else statusClass = a.status.toLowerCase();

    var isBranchFile = !isMainBranch && branchFiles.indexOf(a.slug) !== -1;
    var isDraggable = isMainBranch
      ? a.status !== 'Published'
      : (isBranchFile && a.status !== 'Published');
    var dragAttrs = isDraggable
      ? 'draggable="true" ondragstart="onDragStart(event, \'' + escapeAttr(a.slug) + '\')"'
      : '';

    var linkIcon = a.qiitaId
      ? '<a href="#" onclick="openExternalUrl(\'https://qiita.com/items/' + escapeAttr(a.qiitaId) + '\', event)" class="article-link" title="Qiita で開く"><i class="codicon codicon-link-external"></i></a>'
      : '';

    var branchFileClass = isBranchFile ? ' branch-file' : '';

    return '<div class="article-item ' + statusClass + (isDraggable ? ' draggable' : '') + branchFileClass + '"'
      + ' ' + dragAttrs
      + ' onclick="showDetail(\'' + escapeAttr(a.slug) + '\')"'
      + ' title="' + escapeAttr(a.title) + '">'
      + linkIcon + escapeHtml(a.title) + '</div>';
  }).join('');

  container.innerHTML = html;
}

// サイドバーのドラッグ＆ドロップハンドラ
function onSidebarDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.classList.add('drag-over');
}

function onSidebarDragLeave(e) {
  e.currentTarget.classList.remove('drag-over');
}

async function onDropToSidebar(e) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  document.querySelectorAll('.drop-target').forEach(function(el) { el.classList.remove('drop-target'); });
  var sidebar = document.getElementById('sidebarContent');
  if (sidebar) { sidebar.classList.remove('drop-target'); }

  var slug = e.dataTransfer.getData('text/plain') || dragSlug;
  if (!slug) return;

  var article = allArticles.find(function(a) { return a.slug === slug; });
  if (!article) return;

  // 日付なし記事をサイドバーにドロップしても何もしない
  if (!article.hasDate) {
    dragSlug = null;
    return;
  }

  // main ブランチ以外では、そのブランチで追加されたファイルのみ移動可能
  if (!isMainBranch) {
    if (branchFiles.indexOf(article.slug) === -1) {
      showNotification('⚠️ この記事は現在のブランチ（' + (currentBranch || '不明') + '）で追加されたものではないため移動できません');
      dragSlug = null;
      return;
    }
  }

  try {
    var data = await apiRequest('removeArticleDate', { slug: slug });
    if (data.success) {
      await fetchArticles();
      render();
      showNotification('📁 記事を日付未定に移動しました（' + data.newSlug + '.md）');
    } else {
      showNotification('⚠️ ' + (data.error || '移動に失敗しました'));
    }
  } catch (err) {
    console.error('日付除去エラー:', err);
    showNotification('⚠️ エラー: ' + (err.message || '不明なエラーが発生しました'));
  }
  dragSlug = null;
}

// === 年間チャート（複合グラフ：今年＝積み上げ棒 / 前年同月＝折れ線） ===
function renderYearlyChart() {
  // 今月を左端にして12ヶ月分のウィンドウを構築
  var today = new Date();
  var baseYear = today.getFullYear();
  var baseMonth = today.getMonth() + 1;
  var windowMonths = [];
  for (var i = 0; i < 12; i++) {
    var m = baseMonth + i;
    var y = baseYear;
    while (m > 12) { m -= 12; y++; }
    windowMonths.push({ year: y, month: m, label: m + '月' });
  }

  var startLabel = windowMonths[0].year + '年' + windowMonths[0].month + '月';
  var endLabel = windowMonths[11].year + '年' + windowMonths[11].month + '月';
  document.getElementById('yearlyTitle').textContent = '投稿推移（' + startLabel + ' 〜 ' + endLabel + '）';

  // 凡例更新
  document.getElementById('yearlyLegend').innerHTML =
    '<div class="yearly-legend-item"><div class="yearly-legend-swatch bar published"></div>公開済み (今年)</div>' +
    '<div class="yearly-legend-item"><div class="yearly-legend-swatch bar scheduled"></div>予約 (今年)</div>' +
    '<div class="yearly-legend-item"><div class="yearly-legend-swatch line published-prev"></div>前年同月 (合計)</div>';

  // 公開済み + 予約のみ対象
  var targetArticles = allArticles.filter(function(a) {
    return a.status === 'Published' || a.status === 'Scheduled' || a.status === 'ScheduledPast';
  });

  var countByMonth = function(y, m, status) {
    return targetArticles.filter(function(a) {
      var d = parseDisplayDate(a);
      var match = status === 'Scheduled'
        ? (a.status === 'Scheduled' || a.status === 'ScheduledPast')
        : a.status === status;
      return d.getFullYear() === y && d.getMonth() + 1 === m && match;
    }).length;
  };

  var currPub = windowMonths.map(function(w) { return countByMonth(w.year, w.month, 'Published'); });
  var currSch = windowMonths.map(function(w) { return countByMonth(w.year, w.month, 'Scheduled'); });
  var prevPub = windowMonths.map(function(w) { return countByMonth(w.year - 1, w.month, 'Published'); });
  var prevSch = windowMonths.map(function(w) { return countByMonth(w.year - 1, w.month, 'Scheduled'); });

  var currTotal = currPub.map(function(v, i) { return v + currSch[i]; });
  var prevTotal = prevPub.map(function(v, i) { return v + prevSch[i]; });

  var maxCount = Math.max.apply(null, currTotal.concat(prevTotal).concat([1]));

  // SVG サイズ設定
  var W = 800, H = 200;
  var padL = 30, padR = 16, padT = 20, padB = 32;
  var chartW = W - padL - padR;
  var chartH = H - padT - padB;

  var xStep = chartW / 12; // 12等分（各月にセル幅を確保）
  var getXCenter = function(i) { return padL + (i + 0.5) * xStep; };
  var getY = function(v) { return padT + chartH - (v / maxCount) * chartH; };
  var barW = xStep * 0.5;
  var baselineY = padT + chartH;

  // Y軸グリッド
  var gridCount = Math.min(maxCount, 5);
  var gridStep = maxCount / gridCount;
  var gridLines = '';
  for (var g = 0; g <= gridCount; g++) {
    var val = Math.round(g * gridStep);
    var gy = getY(val);
    gridLines += '<line x1="' + padL + '" y1="' + gy + '" x2="' + (W - padR) + '" y2="' + gy + '" stroke="#c9cdd4" stroke-width="1"/>';
    gridLines += '<text x="' + (padL - 6) + '" y="' + (gy + 4) + '" text-anchor="end" fill="#555b6e" font-size="11">' + val + '</text>';
  }

  // X軸ラベル
  var xLabels = '';
  for (var xi = 0; xi < 12; xi++) {
    var wm = windowMonths[xi];
    var isCurrent = (wm.year === baseYear && wm.month === baseMonth);
    var weight = isCurrent ? 'font-weight:700' : '';
    var cx = getXCenter(xi);
    var showYear = (xi === 0 || wm.month === 1);
    if (showYear) {
      xLabels += '<text x="' + cx + '" y="' + (H - 14) + '" text-anchor="middle" fill="#555b6e" font-size="9" style="' + weight + '">' + wm.year + '</text>';
      xLabels += '<text x="' + cx + '" y="' + (H - 4) + '" text-anchor="middle" fill="#555b6e" font-size="11" style="' + weight + '">' + wm.label + '</text>';
    } else {
      xLabels += '<text x="' + cx + '" y="' + (H - 6) + '" text-anchor="middle" fill="#555b6e" font-size="11" style="' + weight + '">' + wm.label + '</text>';
    }
  }

  var pubColor = '#0f7b3f', schColor = '#0056d6', prevColor = '#e85d04';

  // 積み上げ棒グラフ（今年）
  var bars = '';
  var stackLabels = '';
  for (var bi = 0; bi < 12; bi++) {
    var cx = getXCenter(bi);
    var x = cx - barW / 2;
    // 公開済み（下段）
    if (currPub[bi] > 0) {
      var pubH = (currPub[bi] / maxCount) * chartH;
      bars += '<rect x="' + x + '" y="' + (baselineY - pubH) + '" width="' + barW + '" height="' + pubH + '" fill="' + pubColor + '" opacity="0.45" rx="2"/>';
    }
    // 予約（上段）
    if (currSch[bi] > 0) {
      var pubH2 = (currPub[bi] / maxCount) * chartH;
      var schH = (currSch[bi] / maxCount) * chartH;
      bars += '<rect x="' + x + '" y="' + (baselineY - pubH2 - schH) + '" width="' + barW + '" height="' + schH + '" fill="' + schColor + '" opacity="0.45" rx="2"/>';
    }
    // 合計ラベル
    if (currTotal[bi] > 0) {
      stackLabels += '<text x="' + cx + '" y="' + (getY(currTotal[bi]) - 5) + '" text-anchor="middle" fill="#333" font-size="10" font-weight="700">' + currTotal[bi] + '</text>';
    }
  }

  // 折れ線グラフ（前年同月）
  var linePath = '';
  var dots = '';
  var prevLabels = '';
  for (var li = 0; li < 12; li++) {
    var lx = getXCenter(li);
    var ly = getY(prevTotal[li]);
    linePath += (li === 0 ? 'M' : 'L') + lx + ',' + ly;
    dots += '<circle cx="' + lx + '" cy="' + ly + '" r="4.5" fill="' + prevColor + '" stroke="#fff" stroke-width="2"/>';
    if (prevTotal[li] > 0) {
      prevLabels += '<text x="' + lx + '" y="' + (ly - 9) + '" text-anchor="middle" fill="' + prevColor + '" font-size="9" font-weight="600">' + prevTotal[li] + '</text>';
    }
  }

  // 差分ラベル（前年同月比）
  var diffLabels = '';
  for (var di = 0; di < 12; di++) {
    var diff = currTotal[di] - prevTotal[di];
    if (currTotal[di] > 0 || prevTotal[di] > 0) {
      var color, label;
      if (diff > 0) { color = '#0f7b3f'; label = '+' + diff; }
      else if (diff < 0) { color = '#c9190b'; label = '' + diff; }
      else { color = '#555b6e'; label = '±0'; }
      diffLabels += '<text x="' + getXCenter(di) + '" y="' + (H - 18) + '" text-anchor="middle" fill="' + color + '" font-size="9">' + label + '</text>';
    }
  }

  // 今月強調線
  var currentLine = '<line x1="' + getXCenter(0) + '" y1="' + padT + '" x2="' + getXCenter(0) + '" y2="' + baselineY + '" stroke="#f5a623" stroke-width="1.5" stroke-dasharray="4 3" opacity="0.6"/>';

  var container = document.getElementById('yearlyChart');
  container.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet">'
    + gridLines
    + xLabels
    + diffLabels
    + bars
    + '<path d="' + linePath + '" fill="none" stroke="' + prevColor + '" stroke-width="2.5" stroke-linejoin="round" stroke-dasharray="6 3"/>'
    + dots
    + prevLabels
    + stackLabels
    + currentLine
    + '</svg>';
}

// === 記事詳細モーダル ===
function showDetail(slug) {
  var article = allArticles.find(function(a) { return a.slug === slug; });
  if (!article) return;

  var statusLabel = { Published: '投稿済み', Scheduled: '予約投稿', ScheduledPast: '予約超過', Ready: '投稿準備完了', Draft: '下書き' };
  var visibilityLabel = article.status === 'Published'
    ? (article.isPrivate ? '（限定共有）' : '（公開）')
    : '';
  var statusClass;
  if (article.status === 'Published' && article.isPrivate) statusClass = 'private';
  else if (article.status === 'ScheduledPast') statusClass = 'scheduledpast';
  else statusClass = article.status.toLowerCase();

  var tagsHtml = (article.tags || [])
    .map(function(t) { return '<span class="tag">' + escapeHtml(t) + '</span>'; }).join('');

  var qiitaLink = '';
  if (article.qiitaId) {
    qiitaLink = '<a href="#" onclick="event.preventDefault(); openExternalUrl(\'https://qiita.com/items/' + article.qiitaId + '\')" class="primary">Qiita で見る</a>';
  }

  var editLink = '<a href="#" onclick="event.preventDefault(); openInEditor(\'' + escapeAttr(article.slug) + '\')">エディタで開く</a>';

  // トグルボタン（投稿済み以外で表示）
  var toggleButtons = '';
  if (article.status !== 'Published') {
    // private トグル
    var privateIcon = article.isPrivate ? '<i class="codicon codicon-unlock"></i> 公開に切替' : '<i class="codicon codicon-lock"></i> 限定共有に切替';
    toggleButtons += '<button class="btn-toggle" onclick="togglePrivate(\'' + escapeAttr(article.slug) + '\')">' + privateIcon + '</button>';

    // ignorePublish トグル（Draft / Ready のみ）
    if (article.status === 'Draft' || article.status === 'Ready') {
      var readyIcon = article.status === 'Draft'
        ? '<i class="codicon codicon-check"></i> 投稿準備にする'
        : '<i class="codicon codicon-edit"></i> 下書きに戻す';
      toggleButtons += '<button class="btn-toggle" onclick="toggleIgnorePublish(\'' + escapeAttr(article.slug) + '\')">' + readyIcon + '</button>';
    }
  }
  var toggleSection = toggleButtons ? '<div class="toggle-actions">' + toggleButtons + '</div>' : '';

  document.getElementById('tooltipCard').innerHTML =
    '<h3>' + escapeHtml(article.title) + '</h3>' +
    '<div class="meta">' +
    '<div><strong>ステータス:</strong> <span class="badge ' + statusClass + '">' + statusLabel[article.status] + visibilityLabel + '</span></div>' +
    '<div><strong>ファイル日付:</strong> ' + (article.fileDate || '未定') + '</div>' +
    (article.scheduledDate ? '<div><strong>予約投稿日:</strong> ' + article.scheduledDate + '</div>' : '') +
    (article.updatedAt ? '<div><strong>最終更新:</strong> ' + new Date(article.updatedAt).toLocaleString('ja-JP') + '</div>' : '') +
    '<div><strong>スラッグ:</strong> ' + escapeHtml(article.slug) + '</div>' +
    (tagsHtml ? '<div style="margin-top:8px">' + tagsHtml + '</div>' : '') +
    '</div>' +
    toggleSection +
    '<div class="actions">' +
    qiitaLink +
    editLink +
    '<button onclick="closeTooltip()"><i class="codicon codicon-close"></i> 閉じる</button>' +
    '</div>';

  document.getElementById('tooltipOverlay').classList.add('active');
}

// === トグル操作 ===

async function togglePrivate(slug) {
  try {
    var data = await apiRequest('togglePrivate', { slug: slug });
    if (data.success) {
      closeTooltip();
      await fetchArticles();
      render();
      showNotification('🔄 公開設定を「' + data.label + '」に変更しました');
    } else {
      showNotification('⚠️ ' + (data.error || '変更に失敗しました'));
    }
  } catch (err) {
    console.error('private切替エラー:', err);
    showNotification('⚠️ 通信エラーが発生しました');
  }
}

async function toggleIgnorePublish(slug) {
  try {
    var data = await apiRequest('toggleIgnorePublish', { slug: slug });
    if (data.success) {
      closeTooltip();
      await fetchArticles();
      render();
      showNotification('🔄 ステータスを「' + data.label + '」に変更しました');
    } else {
      showNotification('⚠️ ' + (data.error || '変更に失敗しました'));
    }
  } catch (err) {
    console.error('ignorePublish切替エラー:', err);
    showNotification('⚠️ 通信エラーが発生しました');
  }
}

function closeTooltip(e) {
  if (!e || e.target === document.getElementById('tooltipOverlay')) {
    document.getElementById('tooltipOverlay').classList.remove('active');
  }
}

// === ユーティリティ ===
function formatDate(d) {
  var y = d.getFullYear();
  var m = String(d.getMonth() + 1).padStart(2, '0');
  var day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function escapeHtml(s) {
  var div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function escapeAttr(s) {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

function sanitizeFileName(name) {
  return name
    .replace(/\s+/g, '_')
    .replace(/[<>:"\/\\|?*]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/_{2,}/g, '_')
    .replace(/^[-._]+|[-._]+$/g, '');
}

function sanitizeBranchName(name) {
  return name
    .replace(/[\s~^:?*[\]\\@{}\.]{2,}/g, '-')
    .replace(/[\s~^:?*[\]\\@{}]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-./]+|[-./]+$/g, '');
}

// === キーボードナビゲーション ===
document.addEventListener('keydown', function(e) {
  if (document.getElementById('createOverlay').classList.contains('active')) {
    if (e.key === 'Escape') closeCreateModal();
    return;
  }
  if (document.getElementById('commitOverlay').classList.contains('active')) {
    if (e.key === 'Escape') closeCommitModal();
    return;
  }
  if (document.getElementById('tooltipOverlay').classList.contains('active')) {
    if (e.key === 'Escape') closeTooltip();
    return;
  }
  if (e.key === 'ArrowLeft') changeMonth(-1);
  if (e.key === 'ArrowRight') changeMonth(1);
});

// === 記事作成 ===
async function openCreateModal(dateStr) {
  if (!isMainBranch) {
    showNotification('⚠️ main ブランチ以外では記事を追加できません');
    return;
  }
  document.getElementById('createTitle').value = '';
  document.getElementById('createError').style.display = 'none';
  document.getElementById('createSubmitBtn').disabled = false;
  document.getElementById('createBranch').checked = true;

  if (dateStr) {
    document.querySelector('input[name="createMode"][value="scheduled"]').checked = true;
    document.getElementById('createDate').value = dateStr;
  } else {
    document.querySelector('input[name="createMode"][value="public"]').checked = true;
    document.getElementById('createDate').value = '';
  }
  onModeChange();
  updateCreatePreview();
  document.getElementById('createOverlay').classList.add('active');
  await updateBranchInfo();
  setTimeout(function() { document.getElementById('createTitle').focus(); }, 100);
}

function onModeChange() {
  var mode = document.querySelector('input[name="createMode"]:checked').value;
  var dateGroup = document.getElementById('scheduledDateGroup');
  dateGroup.style.display = mode === 'scheduled' ? '' : 'none';
  if (mode === 'scheduled') {
    var tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    var minDate = formatDate(tomorrow);
    document.getElementById('createDate').min = minDate;
    if (!document.getElementById('createDate').value || document.getElementById('createDate').value <= formatDate(new Date())) {
      document.getElementById('createDate').value = minDate;
    }
  }
  updateCreatePreview();
}

function closeCreateModal(e) {
  if (!e || e.target === document.getElementById('createOverlay')) {
    document.getElementById('createOverlay').classList.remove('active');
  }
}

function updateCreatePreview() {
  var mode = document.querySelector('input[name="createMode"]:checked').value;
  var title = document.getElementById('createTitle').value.trim();
  var preview = document.getElementById('createPreview');
  var createBranch = document.getElementById('createBranch').checked;

  var dateStr;
  if (mode === 'scheduled') {
    dateStr = document.getElementById('createDate').value;
  } else {
    dateStr = formatDate(new Date());
  }

  if (dateStr && title) {
    var dateForFile = dateStr.replace(/-/g, '');
    var safeTitle = sanitizeFileName(title);
    var slug = dateForFile + '-' + safeTitle;
    var branchSlug = sanitizeBranchName(slug);
    var modeLabel = { public: '公開', private: '限定共有', scheduled: '予約投稿' }[mode];
    var html = '<strong>種別:</strong> ' + modeLabel + '<br>';
    html += '<strong>ファイル名:</strong> ' + escapeHtml(getArticlePath(slug));
    if (createBranch) {
      html += '<br><strong>ブランチ:</strong> add-' + branchSlug;
    }
    preview.innerHTML = html;
  } else {
    preview.innerHTML = '<span class="form-hint">スラッグを入力するとファイル名がプレビューされます</span>';
  }
}

async function updateBranchInfo() {
  var infoEl = document.getElementById('branchInfo');
  try {
    var data = await apiRequest('getGitBranch');
    if (data.success) {
      var isMain = data.branch === 'main' || data.branch === 'master';
      var icon = isMain ? '<i class="codicon codicon-check"></i>' : '<i class="codicon codicon-warning"></i>';
      var warn = isMain ? '' : '（main 以外のブランチです。main に切り替えてから作成します）';
      infoEl.innerHTML = icon + ' 現在のブランチ: <strong>' + escapeHtml(data.branch) + '</strong> ' + warn;
      infoEl.className = 'branch-info ' + (isMain ? '' : 'branch-warn');
    } else {
      infoEl.innerHTML = '<i class="codicon codicon-warning"></i> ブランチ情報を取得できませんでした';
      infoEl.className = 'branch-info branch-warn';
    }
  } catch {
    infoEl.innerHTML = '';
  }
}

// 入力イベント
document.getElementById('createTitle').addEventListener('input', updateCreatePreview);
document.getElementById('createBranch').addEventListener('change', updateCreatePreview);
document.getElementById('createDate').addEventListener('change', updateCreatePreview);
document.querySelectorAll('input[name="createMode"]').forEach(function(r) {
  r.addEventListener('change', onModeChange);
});

// 記事を作成
async function submitCreateArticle() {
  var mode = document.querySelector('input[name="createMode"]:checked').value;
  var title = document.getElementById('createTitle').value.trim();
  var errorEl = document.getElementById('createError');
  var submitBtn = document.getElementById('createSubmitBtn');

  if (!title) {
    errorEl.textContent = 'スラッグを入力してください';
    errorEl.style.display = 'block';
    return;
  }

  var date = mode === 'scheduled' ? document.getElementById('createDate').value : null;
  if (mode === 'scheduled' && !date) {
    errorEl.textContent = '予約投稿日を指定してください';
    errorEl.style.display = 'block';
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = '作成中...';
  errorEl.style.display = 'none';

  try {
    var result = await apiRequest('createArticle', {
      title: title,
      mode: mode,
      date: date,
      createBranch: document.getElementById('createBranch').checked
    });

    if (result.success) {
      closeCreateModal();
      await fetchCurrentBranch();
      await fetchArticles();
      render();
      var branchMsg = result.branch ? ' (ブランチ: ' + result.branch + ')' : '';
      showNotification('✅ ' + result.modeLabel + '記事を作成しました: ' + result.slug + '.md' + branchMsg);
    } else {
      errorEl.textContent = result.error || '作成に失敗しました';
      errorEl.style.display = 'block';
    }
  } catch (e) {
    console.error('記事作成エラー:', e);
    errorEl.textContent = '通信エラーが発生しました';
    errorEl.style.display = 'block';
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = '作成';
  }
}

// === 通知 ===
function showNotification(message) {
  var existing = document.querySelector('.notification');
  if (existing) existing.remove();

  var el = document.createElement('div');
  el.className = 'notification';
  if (message.indexOf('❌') >= 0 || message.indexOf('⚠️') >= 0) {
    el.classList.add('error');
  }
  el.textContent = message;
  document.body.appendChild(el);
  requestAnimationFrame(function() { el.classList.add('show'); });
  setTimeout(function() {
    el.classList.remove('show');
    setTimeout(function() { el.remove(); }, 300);
  }, 3000);
}

// === 起動 ===
init();
