import type MarkdownIt from 'markdown-it';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Qiita Markdown Preview - VS Code 拡張機能
 *
 * VS Code 標準の Markdown プレビューに Qiita 固有構文のサポートを追加する。
 *
 * 対応構文:
 * - :::note info/warn/alert ブロック
 * - コードブロックの lang:filename 記法 / diff_言語 記法
 * - ```math 数式ブロック・$`...`$ インライン数式（KaTeX 連携）
 * - インラインカラーコード (#FFF, rgb(), hsl())
 * - 改行の自動 <br> 変換 (HARDBREAKS)
 * - 脚注 [^1] (footnotes)
 * - タスクリスト / 絵文字ショートコード (:smile:)
 * - 埋め込みコンテンツ (YouTube, Twitter/X, CodePen, Gist, GitHub 等)
 *
 * マルチルートワークスペースでは、Qiita 記事フォルダ（qiita.config.json を含む、
 * または public/ 配下）のドキュメントにのみ適用し、他フォルダの Markdown には影響しない。
 */
export function activate() {
  return {
    extendMarkdownIt(md: MarkdownIt) {
      // VS Code 側で設定された改行の扱い（Qiita 以外のドキュメントではこれに戻す）
      const originalBreaks = !!md.options.breaks;

      // レンダリングごとに対象ドキュメントかを判定する
      qiitaGatePlugin(md, originalBreaks);

      // :::note ブロック
      noteBlockPlugin(md);

      // ```math 数式ブロック → math_block トークンに変換
      mathFencePlugin(md);

      // $`...`$ インライン数式
      inlineMathPlugin(md);

      // コードブロック lang:filename / diff_lang
      codeFilenamePlugin(md);

      // インラインカラーコード
      inlineColorPlugin(md);

      // 脚注
      footnotePlugin(md);

      // タスクリスト・絵文字
      taskListPlugin(md);
      emojiPlugin(md);

      // 埋め込みコンテンツ
      embedPlugin(md);

      return md;
    },
  };
}

// =====================================================================
// 対象ドキュメントの判定（マルチルートワークスペース対応）
// =====================================================================

function normalizePath(p: string): string {
  const n = path.resolve(p);
  return process.platform === 'win32' ? n.toLowerCase() : n;
}

/**
 * ドキュメントが Qiita 記事かどうか。
 * - いずれかのワークスペースフォルダの public/ 配下
 * - qiita.config.json を持つワークスペースフォルダ配下
 * ドキュメント不明（env に currentDocument なし）の場合は対象とみなす。
 */
function isQiitaDocument(currentDocument: unknown): boolean {
  let fsPath: string | undefined;
  if (typeof currentDocument === 'string') {
    fsPath = currentDocument;
  } else if (
    currentDocument &&
    typeof (currentDocument as vscode.Uri).fsPath === 'string'
  ) {
    fsPath = (currentDocument as vscode.Uri).fsPath;
  }
  if (!fsPath) {
    return true;
  }

  const doc = normalizePath(fsPath);
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const root = normalizePath(folder.uri.fsPath);
    if (doc !== root && !doc.startsWith(root + path.sep)) {
      continue;
    }
    if (doc.startsWith(path.join(root, 'public') + path.sep)) {
      return true;
    }
    if (fs.existsSync(path.join(folder.uri.fsPath, 'qiita.config.json'))) {
      return true;
    }
  }
  return false;
}

function qiitaGatePlugin(md: MarkdownIt, originalBreaks: boolean) {
  md.core.ruler.before('normalize', 'qiita_gate', (state) => {
    const enabled = isQiitaDocument(state.env?.currentDocument);
    state.env.qiitaEnabled = enabled;
    // Qiita は改行をそのまま <br> に変換する
    state.md.options.breaks = enabled ? true : originalBreaks;
  });
}

function isQiita(env: any): boolean {
  return !!env && env.qiitaEnabled !== false;
}

// =====================================================================
// :::note info/warn/alert ブロック
// =====================================================================

function noteBlockPlugin(md: MarkdownIt) {
  // ブロックルールとして :::note を処理する。
  // コアルール（トークン後処理）では、:::note と内容が空行なしで
  // 1つの段落にまとめられてしまい検出できないため、
  // ブロックパース段階でソース行を直接走査する。

  md.block.ruler.before(
    'fence',
    'qiita_note',
    (state, startLine, endLine, silent) => {
      if (!isQiita(state.env)) return false;
      // インデントされたコードブロックは対象外
      if (state.sCount[startLine] - state.blkIndent >= 4) return false;

      const pos = state.bMarks[startLine] + state.tShift[startLine];
      const max = state.eMarks[startLine];
      const lineText = state.src.slice(pos, max).trim();

      // :::note [info|warn|alert]
      const openMatch = lineText.match(/^:::note\s*(info|warn|alert)?$/);
      if (!openMatch) return false;

      // 閉じ ::: を探す（コードフェンス内の ::: は無視）
      let nextLine = startLine + 1;
      let found = false;
      let fenceMarker = '';

      for (; nextLine < endLine; nextLine++) {
        const linePos = state.bMarks[nextLine] + state.tShift[nextLine];
        const lineMax = state.eMarks[nextLine];
        const line = state.src.slice(linePos, lineMax).trim();

        // コードフェンスの開閉を追跡
        const fenceMatch = line.match(/^(`{3,}|~{3,})/);
        if (fenceMatch) {
          if (!fenceMarker) {
            fenceMarker = fenceMatch[1];
          } else if (
            fenceMatch[1][0] === fenceMarker[0] &&
            fenceMatch[1].length >= fenceMarker.length &&
            line.replace(/[`~]/g, '').trim() === ''
          ) {
            fenceMarker = '';
          }
          continue;
        }

        if (!fenceMarker && line === ':::') {
          found = true;
          break;
        }
      }

      if (!found) return false;
      if (silent) return true;

      const subtype = openMatch[1] || 'info';
      const iconClass =
        subtype === 'warn'
          ? 'qiita-note-icon-warn'
          : subtype === 'alert'
            ? 'qiita-note-icon-alert'
            : 'qiita-note-icon-info';

      // 開始 HTML トークン
      let token = state.push('html_block', '', 0);
      token.content = `<div class="qiita-note qiita-note-${subtype}"><span class="${iconClass}"></span><div class="qiita-note-content">\n`;
      token.map = [startLine, startLine + 1];

      // 内部コンテンツを再帰的にパース
      const oldParent = state.parentType;
      const oldLineMax = state.lineMax;
      state.parentType = 'blockquote' as any;
      state.lineMax = nextLine;

      state.md.block.tokenize(state, startLine + 1, nextLine);

      state.parentType = oldParent;
      state.lineMax = oldLineMax;

      // 終了 HTML トークン
      token = state.push('html_block', '', 0);
      token.content = '</div></div>\n';
      token.map = [nextLine, nextLine + 1];

      state.line = nextLine + 1;
      return true;
    },
  );
}

// =====================================================================
// ```math 数式ブロック → KaTeX 連携
// =====================================================================

function mathFencePlugin(md: MarkdownIt) {
  // ```math フェンスを math_block トークンに変換する。
  // VS Code 内蔵の KaTeX レンダラー（markdown.math.enabled）が
  // math_block トークンをレンダリングしてくれる。
  // KaTeX が無効の場合は、フォールバックとして数式テキストを表示する。

  md.core.ruler.after('block', 'qiita_math_fence', (state) => {
    if (!isQiita(state.env)) return;
    for (const token of state.tokens) {
      if (token.type === 'fence' && token.info.trim() === 'math') {
        token.type = 'math_block';
        token.tag = 'math';
        token.markup = '$$';
      }
    }
  });

  // math_block レンダラーが未登録の場合のフォールバック
  // （VS Code で math が無効化されている場合。KaTeX があれば後から上書きされる）
  if (!md.renderer.rules.math_block) {
    md.renderer.rules.math_block = (tokens, idx) => {
      const content = tokens[idx].content.trim();
      return `<div class="qiita-math-block"><pre class="qiita-math-fallback">${escapeHtml(content)}</pre></div>\n`;
    };
  }
}

// =====================================================================
// インライン数式 $`...`$
// =====================================================================

function inlineMathPlugin(md: MarkdownIt) {
  // KaTeX の `$...$` ルールより先に評価されるよう、先頭に挿入する
  md.inline.ruler.before('text', 'qiita_math_inline', (state, silent) => {
    const src = state.src;
    const pos = state.pos;
    if (
      src.charCodeAt(pos) !== 0x24 /* $ */ ||
      src.charCodeAt(pos + 1) !== 0x60 /* ` */
    ) {
      return false;
    }
    if (!isQiita(state.env)) return false;

    const end = src.indexOf('`$', pos + 2);
    if (end < 0 || end >= state.posMax) return false;

    const content = src.slice(pos + 2, end);
    if (!content.trim()) return false;

    if (!silent) {
      const token = state.push('math_inline', 'math', 0);
      token.markup = '$';
      token.content = content;
    }
    state.pos = end + 2;
    return true;
  });

  // KaTeX が無効な場合のフォールバック
  if (!md.renderer.rules.math_inline) {
    md.renderer.rules.math_inline = (tokens, idx) =>
      `<code class="qiita-math-inline">${escapeHtml(tokens[idx].content)}</code>`;
  }
}

// =====================================================================
// コードブロック lang:filename / diff_lang 記法
// =====================================================================

function codeFilenamePlugin(md: MarkdownIt) {
  const defaultFence = md.renderer.rules.fence;

  const renderDefault: NonNullable<typeof defaultFence> = (
    tokens,
    idx,
    options,
    env,
    self,
  ) => {
    if (defaultFence) {
      return defaultFence(tokens, idx, options, env, self);
    }
    return self.renderToken(tokens, idx, options);
  };

  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const info = token.info ? token.info.trim() : '';

    if (!isQiita(env) || !info) {
      return renderDefault(tokens, idx, options, env, self);
    }

    // lang:filename 形式をチェック
    const colonIndex = info.indexOf(':');
    const lang = colonIndex > 0 ? info.substring(0, colonIndex) : info;
    const filename = colonIndex > 0 ? info.substring(colonIndex + 1) : '';
    const isDiff = /^diff_/.test(lang);

    if (!filename && !isDiff) {
      return renderDefault(tokens, idx, options, env, self);
    }

    let rendered: string;
    if (isDiff) {
      // diff_言語: 先頭の +/- で行を色分けする
      const lines = token.content.replace(/\n$/, '').split('\n');
      const body = lines
        .map((line) => {
          const cls = line.startsWith('+')
            ? 'add'
            : line.startsWith('-')
              ? 'del'
              : 'ctx';
          return `<span class="qiita-diff-line qiita-diff-${cls}">${escapeHtml(line) || ' '}</span>`;
        })
        .join('\n');
      rendered = `<pre class="qiita-diff"><code class="language-${escapeHtml(lang)}">${body}\n</code></pre>\n`;
    } else {
      // token.info を一時的に lang 部分のみにしてシンタックスハイライトを適用（描画後に戻す）
      token.info = lang;
      try {
        rendered = renderDefault(tokens, idx, options, env, self);
      } finally {
        token.info = info;
      }
    }

    if (!filename) {
      return rendered;
    }

    const filenameHtml = `<div class="qiita-code-filename"><span>${escapeHtml(filename)}</span></div>`;
    return `<div class="qiita-code-frame" data-lang="${escapeHtml(lang)}">${filenameHtml}${rendered}</div>\n`;
  };
}

// =====================================================================
// インラインカラーコード
// =====================================================================

function inlineColorPlugin(md: MarkdownIt) {
  const defaultCodeInline = md.renderer.rules.code_inline;

  md.renderer.rules.code_inline = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const content = token.content.trim();

    let rendered = '';
    if (defaultCodeInline) {
      rendered = defaultCodeInline(tokens, idx, options, env, self);
    } else {
      rendered = `<code>${escapeHtml(token.content)}</code>`;
    }

    if (!isQiita(env)) {
      return rendered;
    }

    // カラーコードパターン
    const colorPatterns = [
      // HEX: #FFF, #FF0000
      /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/,
      // rgb/rgba
      /^rgba?\s*\([\d\s%,./]+\)$/i,
      // hsl/hsla
      /^hsla?\s*\([\d\s%,./a-z]+\)$/i,
    ];

    if (colorPatterns.some((pattern) => pattern.test(content))) {
      const colorSpan = `<span class="qiita-inline-color" style="background-color: ${escapeHtml(content)};"></span>`;
      // 末尾の </code> の前にカラースパンを挿入
      const closeIdx = rendered.lastIndexOf('</code>');
      if (closeIdx >= 0) {
        rendered =
          rendered.slice(0, closeIdx) + colorSpan + rendered.slice(closeIdx);
      }
    }

    return rendered;
  };
}

// =====================================================================
// 脚注 [^1] (footnotes)
// =====================================================================

interface FootnoteEnv {
  /** ラベル → 定義本文 */
  footnotes: Record<string, string>;
  /** 参照された順のラベル（番号は 1 始まりの位置） */
  footnoteOrder: string[];
  /** ラベルごとの参照回数 */
  footnoteRefCount: Record<string, number>;
}

function footnotePlugin(md: MarkdownIt) {
  // --- ブロックルール: 脚注定義を収集（表示はドキュメント末尾にまとめる） ---
  md.block.ruler.before(
    'reference',
    'qiita_footnote_def',
    (state, startLine, endLine, silent) => {
      if (!isQiita(state.env)) return false;
      if (state.sCount[startLine] - state.blkIndent >= 4) return false;

      const pos = state.bMarks[startLine] + state.tShift[startLine];
      const max = state.eMarks[startLine];
      const lineText = state.src.slice(pos, max);

      // [^label]: で始まる行を検出
      const match = lineText.match(/^\[\^([^\]\s]+)\]:\s*(.*)/);
      if (!match) return false;
      if (silent) return true;

      const label = match[1];
      let content = match[2];
      let nextLine = startLine + 1;

      const isBlank = (line: number) =>
        state.src.slice(
          state.bMarks[line] + state.tShift[line],
          state.eMarks[line],
        ).length === 0;

      // 複数行の脚注定義を収集（インデントされた継続行、または空行を挟んだインデント行）
      while (nextLine < endLine) {
        if (isBlank(nextLine)) {
          // 空行: 次の非空行がインデントされていれば脚注に含める
          let peek = nextLine + 1;
          while (peek < endLine && isBlank(peek)) {
            peek++;
          }
          if (peek < endLine && state.sCount[peek] - state.blkIndent >= 2) {
            content += '\n';
            nextLine++;
            continue;
          }
          break;
        }

        if (state.sCount[nextLine] - state.blkIndent < 2) break;
        content +=
          '\n' +
          state.src.slice(
            state.bMarks[nextLine] + state.tShift[nextLine],
            state.eMarks[nextLine],
          );
        nextLine++;
      }

      const env = state.env as Partial<FootnoteEnv>;
      if (!env.footnotes) env.footnotes = {};
      if (!(label in env.footnotes)) {
        env.footnotes[label] = content.trim();
      }

      state.line = nextLine;
      return true;
    },
  );

  // --- インラインルール: [^label] を脚注参照に変換 ---
  md.inline.ruler.after('image', 'qiita_footnote_ref', (state, silent) => {
    const src = state.src;
    const pos = state.pos;
    const max = state.posMax;

    if (pos + 3 >= max) return false;
    if (src.charCodeAt(pos) !== 0x5b /* [ */) return false;
    if (src.charCodeAt(pos + 1) !== 0x5e /* ^ */) return false;
    if (!isQiita(state.env)) return false;

    // ラベルの終端 ] を探す
    const labelEnd = src.indexOf(']', pos + 2);
    if (labelEnd < 0 || labelEnd >= max || labelEnd === pos + 2) return false;

    const label = src.slice(pos + 2, labelEnd);
    if (/\s/.test(label)) return false;

    // 定義のない参照は通常のテキストとして扱う
    const env = state.env as Partial<FootnoteEnv>;
    if (!env.footnotes || !(label in env.footnotes)) return false;

    if (!silent) {
      if (!env.footnoteOrder) env.footnoteOrder = [];
      if (!env.footnoteRefCount) env.footnoteRefCount = {};

      let order = env.footnoteOrder.indexOf(label);
      if (order === -1) {
        env.footnoteOrder.push(label);
        order = env.footnoteOrder.length - 1;
      }
      const refIndex = (env.footnoteRefCount[label] =
        (env.footnoteRefCount[label] || 0) + 1);

      const token = state.push('footnote_ref', '', 0);
      token.meta = { label, num: order + 1, refIndex };
    }

    state.pos = labelEnd + 1;
    return true;
  });

  // --- コアルール: 脚注セクションをドキュメント末尾に追加 ---
  md.core.ruler.after('inline', 'qiita_footnote_tail', (state) => {
    const env = state.env as Partial<FootnoteEnv>;
    const footnotes = env.footnotes;
    const order = env.footnoteOrder;
    if (!footnotes || !order || order.length === 0) return;

    const parts: string[] = [
      '<section class="qiita-footnotes"><hr class="qiita-footnotes-sep">\n<ol class="qiita-footnotes-list">\n',
    ];

    order.forEach((label, i) => {
      const num = i + 1;
      // 脚注本文の中の脚注参照は再帰させない（footnotes を空にした別 env で描画）
      const renderedContent = md.renderInline(footnotes[label] || label, {
        qiitaEnabled: true,
        footnotes: {},
      });
      const count = env.footnoteRefCount?.[label] ?? 1;
      let backrefs = '';
      for (let r = 1; r <= count; r++) {
        const refId = r === 1 ? `fnref-${num}` : `fnref-${num}-${r}`;
        backrefs += `<a href="#${refId}" class="qiita-footnote-backref" title="戻る">↩</a>`;
      }
      parts.push(
        `<li id="fn-${num}" class="qiita-footnote-item"><p>${renderedContent} ${backrefs}</p></li>\n`,
      );
    });

    parts.push('</ol>\n</section>\n');

    const token = new state.Token('html_block', '', 0);
    token.content = parts.join('');
    state.tokens.push(token);
  });

  // --- レンダラー: 脚注参照をリンクとして描画 ---
  md.renderer.rules.footnote_ref = (tokens, idx) => {
    const { num, refIndex } = tokens[idx].meta;
    const id = refIndex === 1 ? `fnref-${num}` : `fnref-${num}-${refIndex}`;
    return `<sup class="qiita-footnote-ref"><a href="#fn-${num}" id="${id}">${num}</a></sup>`;
  };
}

// =====================================================================
// タスクリスト - [ ] / - [x]
// =====================================================================

function taskListPlugin(md: MarkdownIt) {
  md.core.ruler.after('inline', 'qiita_task_list', (state) => {
    if (!isQiita(state.env)) return;
    const tokens = state.tokens;
    for (let i = 2; i < tokens.length; i++) {
      const t = tokens[i];
      if (
        t.type !== 'inline' ||
        tokens[i - 1].type !== 'paragraph_open' ||
        tokens[i - 2].type !== 'list_item_open' ||
        !t.children ||
        t.children.length === 0 ||
        t.children[0].type !== 'text'
      ) {
        continue;
      }
      const m = t.children[0].content.match(/^\[([ xX])\][ \t]+/);
      if (!m) continue;

      const checked = m[1] !== ' ';
      t.children[0].content = t.children[0].content.slice(m[0].length);
      const box = new state.Token('html_inline', '', 0);
      box.content = `<input class="qiita-task-checkbox" type="checkbox" disabled${checked ? ' checked' : ''}> `;
      t.children.unshift(box);

      tokens[i - 2].attrJoin('class', 'qiita-task-list-item');
      // 直近の親リストにもクラスを付与
      for (let j = i - 3; j >= 0; j--) {
        if (
          tokens[j].type === 'bullet_list_open' ||
          tokens[j].type === 'ordered_list_open'
        ) {
          if (!(tokens[j].attrGet('class') ?? '').includes('qiita-task-list')) {
            tokens[j].attrJoin('class', 'qiita-task-list');
          }
          break;
        }
      }
    }
  });
}

// =====================================================================
// 絵文字ショートコード :smile:
// =====================================================================

const EMOJI_MAP: Record<string, string> = {
  smile: '😄',
  smiley: '😃',
  grinning: '😀',
  grin: '😁',
  laughing: '😆',
  joy: '😂',
  rofl: '🤣',
  blush: '😊',
  wink: '😉',
  heart_eyes: '😍',
  sunglasses: '😎',
  thinking: '🤔',
  neutral_face: '😐',
  sweat_smile: '😅',
  sob: '😭',
  cry: '😢',
  scream: '😱',
  angry: '😠',
  rage: '😡',
  sleeping: '😴',
  relaxed: '☺️',
  innocent: '😇',
  slightly_smiling_face: '🙂',
  upside_down_face: '🙃',
  confused: '😕',
  disappointed: '😞',
  worried: '😟',
  flushed: '😳',
  sweat: '😓',
  tired_face: '😫',
  yum: '😋',
  thumbsup: '👍',
  '+1': '👍',
  thumbsdown: '👎',
  '-1': '👎',
  ok_hand: '👌',
  clap: '👏',
  pray: '🙏',
  muscle: '💪',
  wave: '👋',
  raised_hands: '🙌',
  point_up: '☝️',
  point_down: '👇',
  point_left: '👈',
  point_right: '👉',
  eyes: '👀',
  fist: '✊',
  v: '✌️',
  handshake: '🤝',
  heart: '❤️',
  blue_heart: '💙',
  green_heart: '💚',
  yellow_heart: '💛',
  purple_heart: '💜',
  broken_heart: '💔',
  sparkles: '✨',
  star: '⭐',
  star2: '🌟',
  fire: '🔥',
  boom: '💥',
  zap: '⚡',
  tada: '🎉',
  confetti_ball: '🎊',
  gift: '🎁',
  trophy: '🏆',
  medal_sports: '🏅',
  crown: '👑',
  rocket: '🚀',
  airplane: '✈️',
  car: '🚗',
  bulb: '💡',
  memo: '📝',
  pencil: '✏️',
  book: '📖',
  books: '📚',
  bookmark: '🔖',
  link: '🔗',
  paperclip: '📎',
  pushpin: '📌',
  calendar: '📆',
  date: '📅',
  clock: '🕐',
  hourglass: '⌛',
  bell: '🔔',
  mega: '📣',
  loudspeaker: '📢',
  mag: '🔍',
  lock: '🔒',
  unlock: '🔓',
  key: '🔑',
  wrench: '🔧',
  hammer: '🔨',
  gear: '⚙️',
  computer: '💻',
  desktop_computer: '🖥️',
  keyboard: '⌨️',
  iphone: '📱',
  email: '📧',
  envelope: '✉️',
  package: '📦',
  chart_with_upwards_trend: '📈',
  chart_with_downwards_trend: '📉',
  bar_chart: '📊',
  warning: '⚠️',
  no_entry: '⛔',
  no_entry_sign: '🚫',
  x: '❌',
  o: '⭕',
  white_check_mark: '✅',
  heavy_check_mark: '✔️',
  ballot_box_with_check: '☑️',
  question: '❓',
  exclamation: '❗',
  information_source: 'ℹ️',
  bangbang: '‼️',
  '100': '💯',
  recycle: '♻️',
  construction: '🚧',
  bug: '🐛',
  ant: '🐜',
  bee: '🐝',
  beetle: '🐞',
  snake: '🐍',
  whale: '🐳',
  dog: '🐶',
  cat: '🐱',
  penguin: '🐧',
  octopus: '🐙',
  tiger: '🐯',
  bird: '🐦',
  hatching_chick: '🐣',
  turtle: '🐢',
  sunny: '☀️',
  cloud: '☁️',
  umbrella: '☔',
  snowflake: '❄️',
  rainbow: '🌈',
  earth_asia: '🌏',
  coffee: '☕',
  beer: '🍺',
  pizza: '🍕',
  apple: '🍎',
  cake: '🍰',
  sushi: '🍣',
  ramen: '🍜',
  arrow_right: '➡️',
  arrow_left: '⬅️',
  arrow_up: '⬆️',
  arrow_down: '⬇️',
  arrows_counterclockwise: '🔄',
  zzz: '💤',
  speech_balloon: '💬',
  thought_balloon: '💭',
  see_no_evil: '🙈',
  hear_no_evil: '🙉',
  speak_no_evil: '🙊',
  skull: '💀',
  ghost: '👻',
  robot: '🤖',
  alien: '👽',
  poop: '💩',
};

function emojiPlugin(md: MarkdownIt) {
  md.core.ruler.after('inline', 'qiita_emoji', (state) => {
    if (!isQiita(state.env)) return;
    for (const blockToken of state.tokens) {
      if (blockToken.type !== 'inline' || !blockToken.children) continue;
      for (const child of blockToken.children) {
        // text トークンのみ置換（コードスパン・HTML は別トークンなので対象外）
        if (child.type !== 'text' || !child.content.includes(':')) continue;
        child.content = child.content.replace(
          /:([a-z0-9_+-]+):/g,
          (whole, name: string) => EMOJI_MAP[name] ?? whole,
        );
      }
    }
  });
}

// =====================================================================
// 埋め込みコンテンツ (URL → サービス別プレビューカード)
// =====================================================================

/**
 * 対応サービス一覧（Qiita 公式の埋め込み可能コンテンツに準拠）
 * @see https://qiita.com/Qiita/items/612e2e149b9f9451c144
 */
interface EmbedService {
  name: string;
  icon: string;
  pattern: RegExp;
  extract?: (url: string) => { id?: string } | null;
}

const EMBED_SERVICES: EmbedService[] = [
  {
    name: 'YouTube',
    icon: '▶',
    pattern:
      /^https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([A-Za-z0-9_-]+)/,
    extract: (url) => {
      const m = url.match(/(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]+)/);
      return m ? { id: m[1] } : null;
    },
  },
  {
    name: 'X (Twitter)',
    icon: '𝕏',
    pattern: /^https?:\/\/(?:twitter\.com|x\.com)\/[^/]+\/status\/\d+/,
  },
  {
    name: 'GitHub',
    icon: '🐙',
    pattern: /^https?:\/\/github\.com\/[^/]+\/[^/]+\/blob\//,
  },
  {
    name: 'GitHub Gist',
    icon: '📋',
    pattern: /^https?:\/\/gist\.github\.com\/[^/]+\/[0-9a-f]+/,
  },
  {
    name: 'CodeSandbox',
    icon: '📦',
    pattern: /^https?:\/\/codesandbox\.io\//,
  },
  {
    name: 'CodePen',
    icon: '✏️',
    pattern: /^https?:\/\/codepen\.io\//,
  },
  {
    name: 'Speaker Deck',
    icon: '🎤',
    pattern: /^https?:\/\/speakerdeck\.com\//,
  },
  {
    name: 'SlideShare',
    icon: '📊',
    pattern: /^https?:\/\/www\.slideshare\.net\//,
  },
  {
    name: 'Google Slides',
    icon: '📊',
    pattern: /^https?:\/\/docs\.google\.com\/presentation\//,
  },
  {
    name: 'Docswell',
    icon: '📑',
    pattern: /^https?:\/\/(?:www\.)?docswell\.com\//,
  },
  {
    name: 'Figma',
    icon: '🎨',
    pattern: /^https?:\/\/(?:www\.|embed\.)?figma\.com\//,
  },
  {
    name: 'StackBlitz',
    icon: '⚡',
    pattern: /^https?:\/\/stackblitz\.com\//,
  },
  {
    name: 'Asciinema',
    icon: '🖥️',
    pattern: /^https?:\/\/asciinema\.org\//,
  },
  {
    name: 'blueprintUE',
    icon: '🔵',
    pattern: /^https?:\/\/blueprintue\.com\//,
  },
  {
    name: 'Claude Artifacts',
    icon: '🤖',
    pattern: /^https?:\/\/claude\.site\//,
  },
  {
    name: 'Google Drive',
    icon: '📁',
    pattern: /^https?:\/\/drive\.google\.com\//,
  },
];

function embedPlugin(md: MarkdownIt) {
  // コアルール: 段落内がURLのみの場合、埋め込みカードに変換する
  md.core.ruler.after('inline', 'qiita_embed', (state) => {
    if (!isQiita(state.env)) return;
    const tokens = state.tokens;
    const newTokens: typeof tokens = [];

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];

      // paragraph_open + inline + paragraph_close のパターンを検出
      if (
        token.type === 'paragraph_open' &&
        i + 2 < tokens.length &&
        tokens[i + 1].type === 'inline' &&
        tokens[i + 2].type === 'paragraph_close'
      ) {
        const inlineToken = tokens[i + 1];
        const content = inlineToken.content.trim();

        // URL のみの段落かチェック
        if (/^https?:\/\/\S+$/.test(content) && !content.includes(' ')) {
          const embedHtml = renderEmbedCard(content);
          if (embedHtml) {
            // 埋め込みカードに変換
            const htmlToken = new state.Token('html_block', '', 0);
            htmlToken.content = embedHtml;
            htmlToken.map = token.map;
            newTokens.push(htmlToken);
            i += 2; // paragraph_close をスキップ
            continue;
          }
        }
      }

      newTokens.push(token);
    }

    state.tokens = newTokens;
  });
}

function renderEmbedCard(url: string): string | null {
  // 既知サービスの判定
  for (const service of EMBED_SERVICES) {
    if (service.pattern.test(url)) {
      const info = service.extract ? service.extract(url) : null;
      return renderServiceCard(service, url, info);
    }
  }

  // 既知サービス以外の URL → リンクカード
  return renderLinkCard(url);
}

function renderServiceCard(
  service: EmbedService,
  url: string,
  info: { id?: string } | null,
): string {
  const escapedUrl = escapeHtml(url);

  // YouTube はサムネイルを表示
  if (
    service.name === 'YouTube' &&
    info?.id &&
    /^[A-Za-z0-9_-]+$/.test(info.id)
  ) {
    return (
      `<div class="qiita-embed qiita-embed-youtube">` +
      `<a href="${escapedUrl}" class="qiita-embed-link" title="${escapeHtml(service.name)}">` +
      `<div class="qiita-embed-thumbnail" style="background-image: url('https://img.youtube.com/vi/${escapeHtml(info.id)}/hqdefault.jpg')">` +
      `<span class="qiita-embed-play">▶</span>` +
      `</div>` +
      `<div class="qiita-embed-meta">` +
      `<span class="qiita-embed-icon">${service.icon}</span>` +
      `<span class="qiita-embed-service">${escapeHtml(service.name)}</span>` +
      `<span class="qiita-embed-url">${escapedUrl}</span>` +
      `</div>` +
      `</a></div>\n`
    );
  }

  return (
    `<div class="qiita-embed qiita-embed-service">` +
    `<a href="${escapedUrl}" class="qiita-embed-link" title="${escapeHtml(service.name)}">` +
    `<span class="qiita-embed-icon">${service.icon}</span>` +
    `<span class="qiita-embed-service">${escapeHtml(service.name)}</span>` +
    `<span class="qiita-embed-url">${escapedUrl}</span>` +
    `</a></div>\n`
  );
}

function renderLinkCard(url: string): string {
  const escapedUrl = escapeHtml(url);

  // ドメイン名を表示
  let domain = '';
  try {
    domain = new URL(url).hostname;
  } catch {
    domain = url;
  }

  return (
    `<div class="qiita-embed qiita-embed-linkcard">` +
    `<a href="${escapedUrl}" class="qiita-embed-link" title="${escapedUrl}">` +
    `<span class="qiita-embed-icon">🔗</span>` +
    `<span class="qiita-embed-service">${escapeHtml(domain)}</span>` +
    `<span class="qiita-embed-url">${escapedUrl}</span>` +
    `</a></div>\n`
  );
}

// =====================================================================
// ユーティリティ
// =====================================================================

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function deactivate() {}
