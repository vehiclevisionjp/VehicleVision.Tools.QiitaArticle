/**
 * Front Matter 操作ユーティリティ
 *
 * 記事本文に同名の文字列があっても誤って書き換えないよう、
 * 先頭の `---` ～ `---` ブロックだけを対象にする。
 * 改行コード (LF / CRLF) は元のまま維持する。
 */

export interface FrontMatterParts {
  /** 先頭の `---` を含む開始部分（改行込み） */
  open: string;
  /** Front Matter 内の行（開始・終了の `---` は含まない） */
  lines: string[];
  /** 終了 `---` 以降（`---` 自体を含む） */
  rest: string;
  eol: string;
}

export function splitFrontMatter(content: string): FrontMatterParts | null {
  const m = content.match(/^(---[ \t]*)(\r?\n)/);
  if (!m) {
    return null;
  }
  const eol = m[2];
  const afterOpen = content.slice(m[0].length);
  const lines: string[] = [];
  let pos = 0;
  while (pos <= afterOpen.length) {
    const nl = afterOpen.indexOf('\n', pos);
    const end = nl === -1 ? afterOpen.length : nl;
    const raw = afterOpen.slice(pos, end).replace(/\r$/, '');
    if (raw.trim() === '---') {
      return {
        open: m[0],
        lines,
        rest: afterOpen.slice(pos),
        eol,
      };
    }
    if (nl === -1) {
      return null;
    }
    lines.push(raw);
    pos = nl + 1;
  }
  return null;
}

export function joinFrontMatter(parts: FrontMatterParts): string {
  const body = parts.lines.map((l) => l + parts.eol).join('');
  return parts.open + body + parts.rest;
}

function fieldRegex(key: string): RegExp {
  return new RegExp(`^${key}\\s*:`, 'i');
}

/** フィールドの値を設定する（存在しなければ末尾に追加）。戻り値は更新後の内容 */
export function setField(content: string, key: string, value: string): string {
  const parts = splitFrontMatter(content);
  if (!parts) {
    return content;
  }
  const re = fieldRegex(key);
  const idx = parts.lines.findIndex((l) => re.test(l));
  const line = `${key}: ${value}`;
  if (idx >= 0) {
    parts.lines[idx] = line;
  } else {
    parts.lines.push(line);
  }
  return joinFrontMatter(parts);
}

/** フィールドを削除する */
export function removeField(content: string, key: string): string {
  const parts = splitFrontMatter(content);
  if (!parts) {
    return content;
  }
  const re = fieldRegex(key);
  parts.lines = parts.lines.filter((l) => !re.test(l));
  return joinFrontMatter(parts);
}

export function hasField(content: string, key: string): boolean {
  const parts = splitFrontMatter(content);
  if (!parts) {
    return false;
  }
  const re = fieldRegex(key);
  return parts.lines.some((l) => re.test(l));
}
