import type MarkdownIt from 'markdown-it';

/**
 * Qiita Markdown Preview - VS Code 拡張機能
 *
 * VS Code 標準の Markdown プレビューに Qiita 固有構文のサポートを追加する。
 *
 * 対応構文:
 * - :::note info/warn/alert ブロック
 * - コードブロックの lang:filename 記法
 * - ```math 数式ブロック（KaTeX 連携）
 * - インラインカラーコード (#FFF, rgb(), hsl())
 * - 改行の自動 <br> 変換 (HARDBREAKS)
 */
export function activate() {
  return {
    extendMarkdownIt(md: MarkdownIt) {
      // Qiita は改行をそのまま <br> に変換する
      md.set({ breaks: true });

      // :::note ブロック
      noteBlockPlugin(md);

      // ```math 数式ブロック → math_block トークンに変換
      mathFencePlugin(md);

      // コードブロック lang:filename
      codeFilenamePlugin(md);

      // インラインカラーコード
      inlineColorPlugin(md);

      return md;
    },
  };
}

// =====================================================================
// :::note info/warn/alert ブロック
// =====================================================================

function noteBlockPlugin(md: MarkdownIt) {
  // ブロックルールとして :::note を処理する。
  // コアルール（トークン後処理）では、:::note と内容が空行なしで
  // 1つの段落にまとめられてしまい検出できないため、
  // ブロックパース段階でソース行を直接走査する。

  md.block.ruler.before('fence', 'qiita_note', (state, startLine, endLine, silent) => {
    const pos = state.bMarks[startLine] + state.tShift[startLine];
    const max = state.eMarks[startLine];
    const lineText = state.src.slice(pos, max).trim();

    // :::note [info|warn|alert]
    const openMatch = lineText.match(/^:::note\s*(info|warn|alert)?$/);
    if (!openMatch) return false;

    // 閉じ ::: を探す（コードフェンス内の ::: は無視）
    let nextLine = startLine + 1;
    let found = false;
    let inFence = false;

    for (; nextLine < endLine; nextLine++) {
      const linePos = state.bMarks[nextLine] + state.tShift[nextLine];
      const lineMax = state.eMarks[nextLine];
      const line = state.src.slice(linePos, lineMax).trim();

      // コードフェンスの開閉を追跡
      if (line.startsWith('```') || line.startsWith('~~~')) {
        inFence = !inFence;
        continue;
      }

      if (!inFence && line === ':::') {
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
  });
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
    for (const token of state.tokens) {
      if (token.type === 'fence' && token.info.trim() === 'math') {
        token.type = 'math_block';
        token.tag = 'math';
        token.markup = '$$';
      }
    }
  });

  // math_block レンダラーが未登録の場合のフォールバック
  // （VS Code で math が無効化されている場合）
  const existingMathRenderer = md.renderer.rules.math_block;
  if (!existingMathRenderer) {
    md.renderer.rules.math_block = (tokens, idx) => {
      const content = tokens[idx].content.trim();
      return `<div class="qiita-math-block"><pre class="qiita-math-fallback">${escapeHtml(content)}</pre></div>\n`;
    };
  }
}

// =====================================================================
// コードブロック lang:filename 記法
// =====================================================================

function codeFilenamePlugin(md: MarkdownIt) {
  const defaultFence = md.renderer.rules.fence;

  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const info = token.info ? token.info.trim() : '';

    // lang:filename 形式をチェック
    const colonIndex = info.indexOf(':');

    if (colonIndex > 0) {
      const lang = info.substring(0, colonIndex);
      const filename = info.substring(colonIndex + 1);

      // token.info を lang 部分のみに更新してシンタックスハイライトを適用
      token.info = lang;

      // デフォルトのフェンスレンダリング
      let rendered = '';
      if (defaultFence) {
        rendered = defaultFence(tokens, idx, options, env, self);
      } else {
        rendered = self.renderToken(tokens, idx, options);
      }

      // ファイル名ヘッダーを追加
      const filenameHtml = `<div class="qiita-code-filename"><span>${escapeHtml(filename)}</span></div>`;
      return `<div class="qiita-code-frame" data-lang="${escapeHtml(lang)}">${filenameHtml}${rendered}</div>`;
    }

    // lang:filename 形式でない場合はそのままレンダリング
    if (defaultFence) {
      return defaultFence(tokens, idx, options, env, self);
    }
    return self.renderToken(tokens, idx, options);
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

    // カラーコードパターン
    const colorPatterns = [
      // HEX: #FFF, #FF0000
      /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/,
      // rgb/rgba
      /^rgba?\s*\([\d\s%,./]+\)$/,
      // hsl/hsla
      /^hsla?\s*\([\d\s%,./deg rad grad turn]+\)$/i,
    ];

    const isColor = colorPatterns.some((pattern) => pattern.test(content));

    let rendered = '';
    if (defaultCodeInline) {
      rendered = defaultCodeInline(tokens, idx, options, env, self);
    } else {
      rendered = `<code>${escapeHtml(content)}</code>`;
    }

    if (isColor) {
      const colorSpan = `<span class="qiita-inline-color" style="background-color: ${escapeHtml(content)};"></span>`;
      // </code> の前にカラースパンを挿入
      rendered = rendered.replace('</code>', `${colorSpan}</code>`);
    }

    return rendered;
  };
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
