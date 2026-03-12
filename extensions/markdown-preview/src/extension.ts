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
 * - 脚注 [^1] (footnotes)
 * - 埋め込みコンテンツ (YouTube, Twitter/X, CodePen, Gist 等)
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

      // 脚注
      footnotePlugin(md);

      // 埋め込みコンテンツ
      embedPlugin(md);

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
// 脚注 [^1] (footnotes)
// =====================================================================

function footnotePlugin(md: MarkdownIt) {
  // 脚注定義: [^label]: 本文 を収集
  // 脚注参照: [^label] をインラインリンクに変換

  // --- ブロックルール: 脚注定義を収集 ---
  md.block.ruler.before('reference', 'qiita_footnote_def', (state, startLine, endLine, silent) => {
    const pos = state.bMarks[startLine] + state.tShift[startLine];
    const max = state.eMarks[startLine];
    const lineText = state.src.slice(pos, max);

    // [^label]: で始まる行を検出
    const match = lineText.match(/^\[\^([^\]]+)\]:\s+(.*)/);
    if (!match) return false;
    if (silent) return true;

    const label = match[1];
    const firstLineContent = match[2];

    // 複数行の脚注定義を収集（次行がインデントされている場合）
    let content = firstLineContent;
    let nextLine = startLine + 1;
    while (nextLine < endLine) {
      const nextPos = state.bMarks[nextLine] + state.tShift[nextLine];
      const nextMax = state.eMarks[nextLine];
      const nextText = state.src.slice(nextPos, nextMax);

      // インデントが2スペース以上 or タブなら継続行
      const rawLineStart = state.bMarks[nextLine];
      const rawPrefix = state.src.slice(rawLineStart, nextPos);
      if (rawPrefix.length < 2 && rawPrefix.indexOf('\t') === -1 && nextText.length > 0) break;
      if (nextText.length === 0) {
        // 空行は許容するが、次の行もチェック
        content += '\n';
        nextLine++;
        continue;
      }

      content += '\n' + nextText;
      nextLine++;
    }

    // 脚注定義を env に保存（レンダリング時に参照）
    if (!state.env.footnotes) state.env.footnotes = {};
    if (!state.env.footnoteOrder) state.env.footnoteOrder = [];
    state.env.footnotes[label] = content.trim();
    if (state.env.footnoteOrder.indexOf(label) === -1) {
      state.env.footnoteOrder.push(label);
    }

    // 空のトークンを生成（脚注定義自体は表示しない）
    const token = state.push('footnote_def', '', 0);
    token.meta = { label };
    token.map = [startLine, nextLine];
    token.hidden = true;

    state.line = nextLine;
    return true;
  });

  // --- インラインルール: [^label] を脚注参照に変換 ---
  md.inline.ruler.after('image', 'qiita_footnote_ref', (state, silent) => {
    const src = state.src;
    const pos = state.pos;
    const max = state.posMax;

    if (pos + 2 >= max) return false;
    if (src.charCodeAt(pos) !== 0x5B /* [ */) return false;
    if (src.charCodeAt(pos + 1) !== 0x5E /* ^ */) return false;

    // ラベルの終端 ] を探す
    let labelEnd = pos + 2;
    while (labelEnd < max && src.charCodeAt(labelEnd) !== 0x5D /* ] */) {
      labelEnd++;
    }
    if (labelEnd >= max) return false;
    if (labelEnd === pos + 2) return false; // 空ラベル

    const label = src.slice(pos + 2, labelEnd);

    if (silent) {
      state.pos = labelEnd + 1;
      return true;
    }

    // 脚注参照トークンを生成
    const token = state.push('footnote_ref', '', 0);
    token.meta = { label };

    // 参照順序を記録
    if (!state.env.footnoteOrder) state.env.footnoteOrder = [];
    if (state.env.footnoteOrder.indexOf(label) === -1) {
      state.env.footnoteOrder.push(label);
    }

    state.pos = labelEnd + 1;
    return true;
  });

  // --- コアルール: 脚注セクションをドキュメント末尾に追加 ---
  md.core.ruler.after('inline', 'qiita_footnote_tail', (state) => {
    const footnotes = state.env.footnotes;
    const order = state.env.footnoteOrder;
    if (!footnotes || !order || order.length === 0) return;

    // 脚注定義トークン（hidden）を除去
    state.tokens = state.tokens.filter((t) => t.type !== 'footnote_def');

    // ドキュメント末尾に脚注セクションを追加
    const openToken = new state.Token('html_block', '', 0);
    openToken.content = '<section class="qiita-footnotes"><hr class="qiita-footnotes-sep">\n<ol class="qiita-footnotes-list">\n';
    state.tokens.push(openToken);

    for (let i = 0; i < order.length; i++) {
      const label = order[i];
      const content = footnotes[label] || label;

      const itemToken = new state.Token('html_block', '', 0);
      const renderedContent = md.renderInline(content, state.env);
      itemToken.content =
        `<li id="fn-${escapeHtml(label)}" class="qiita-footnote-item">` +
        `<p>${renderedContent} ` +
        `<a href="#fnref-${escapeHtml(label)}" class="qiita-footnote-backref" title="戻る">↩</a></p></li>\n`;
      state.tokens.push(itemToken);
    }

    const closeToken = new state.Token('html_block', '', 0);
    closeToken.content = '</ol>\n</section>\n';
    state.tokens.push(closeToken);
  });

  // --- レンダラー: 脚注参照をリンクとして描画 ---
  md.renderer.rules.footnote_ref = (tokens, idx) => {
    const label = tokens[idx].meta.label;
    const order: string[] = tokens[idx].meta.order || [];
    let num = order.indexOf(label) + 1;
    if (num === 0) num = parseInt(label, 10) || 1;

    return (
      `<sup class="qiita-footnote-ref">` +
      `<a href="#fn-${escapeHtml(label)}" id="fnref-${escapeHtml(label)}">${num}</a></sup>`
    );
  };

  // コアルールで footnoteOrder を参照トークンに渡す
  md.core.ruler.after('qiita_footnote_tail', 'qiita_footnote_env', (state) => {
    const order = state.env.footnoteOrder;
    if (!order) return;
    for (const token of state.tokens) {
      if (token.type === 'inline' && token.children) {
        for (const child of token.children) {
          if (child.type === 'footnote_ref') {
            child.meta.order = order;
          }
        }
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
    pattern: /^https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([A-Za-z0-9_-]+)/,
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
  if (service.name === 'YouTube' && info?.id && /^[A-Za-z0-9_-]+$/.test(info.id)) {
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
