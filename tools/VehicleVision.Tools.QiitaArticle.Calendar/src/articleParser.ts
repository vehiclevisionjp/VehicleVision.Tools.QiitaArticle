import * as fs from 'fs';
import * as path from 'path';

export type ArticleStatus = 'Published' | 'Scheduled' | 'ScheduledPast' | 'Ready' | 'Draft';

export interface ArticleInfo {
  slug: string;
  title: string;
  fileDate: string;
  hasDate: boolean;
  status: ArticleStatus;
  scheduledDate: string | null;
  updatedAt: string | null;
  qiitaId: string | null;
  isPrivate: boolean;
  tags: string[];
  displayDate: string;
}

export const UNDATED_PREFIX = '99999999';

export class ArticleParser {
  constructor(private publicDir: string) {}

  parseAll(): ArticleInfo[] {
    if (!fs.existsSync(this.publicDir)) {
      return [];
    }

    const articles: ArticleInfo[] = [];
    this._walkDir(this.publicDir, articles);

    articles.sort((a, b) => a.displayDate.localeCompare(b.displayDate));
    return articles;
  }

  /**
   * ディレクトリを再帰的に走査し、.md ファイルを解析する
   * ドットディレクトリ (.remote 等) はスキップ
   */
  private _walkDir(dir: string, articles: ArticleInfo[]): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.')) { continue; }
        this._walkDir(path.join(dir, entry.name), articles);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        const article = this.parseFile(path.join(dir, entry.name));
        if (article) {
          articles.push(article);
        }
      }
    }
  }

  private parseFile(filePath: string): ArticleInfo | null {
    const fileName = path.basename(filePath, '.md');
    const match = fileName.match(/^(\d{8})-(.+)$/);

    let fileDateStr = '';
    let hasDate = false;

    if (match) {
      const dateStr = match[1];

      // 99999999 は日付未定のセンチネル値
      if (dateStr === UNDATED_PREFIX) {
        fileDateStr = '';
        hasDate = false;
      } else {
        const year = parseInt(dateStr.substring(0, 4));
        const month = parseInt(dateStr.substring(4, 6));
        const day = parseInt(dateStr.substring(6, 8));

        const fileDate = new Date(year, month - 1, day);
        if (isNaN(fileDate.getTime())) { return null; }

        fileDateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        hasDate = true;
      }
    }

    const { fields: frontMatter, tags } = this.extractFrontMatter(filePath);

    const rawTitle = frontMatter['title'];
    const cleanedTitle = rawTitle?.replace(/^['"]|['"]$/g, '').trim();
    const title = !cleanedTitle ? '（名称未入力）' : cleanedTitle;

    const id = frontMatter['id'];
    const updatedAtStr = frontMatter['updated_at'];
    const scheduledStr = frontMatter['scheduled_publish'];
    const createdAtStr = frontMatter['created_at'];
    const isPrivate = (frontMatter['private'] || '').toLowerCase() === 'true';
    const ignorePublish = (frontMatter['ignorepublish'] || 'true').toLowerCase() !== 'false';

    // ステータス判定
    // Phase 3: Published（id あり）
    // Phase 2-2: Scheduled / ScheduledPast（scheduled_publish あり）
    // Phase 2-1: Ready（ignorePublish: false、id なし、scheduled_publish なし）
    // Phase 1: Draft（ignorePublish: true、id なし、scheduled_publish なし）
    let status: ArticleStatus;
    let scheduledDate: string | null = null;

    if (id && id !== 'null') {
      status = 'Published';
    } else if (scheduledStr && scheduledStr !== 'null') {
      const sd = this.parseDate(scheduledStr);
      if (sd) {
        scheduledDate = sd;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const sdDate = new Date(sd + 'T00:00:00');
        status = sdDate < today ? 'ScheduledPast' : 'Scheduled';
      } else {
        status = 'Draft';
      }
    } else if (!ignorePublish) {
      status = 'Ready';
    } else {
      status = 'Draft';
    }

    // updated_at
    let updatedAt: string | null = null;
    if (updatedAtStr && updatedAtStr !== "''" && updatedAtStr !== '""') {
      const cleaned = updatedAtStr.replace(/^['"]|['"]$/g, '');
      if (cleaned) {
        updatedAt = cleaned;
      }
    }

    const displayDate = scheduledDate || (!ignorePublish ? fileDateStr : '') || this.parseDateFromTimestamp(createdAtStr) || this.parseDateFromTimestamp(updatedAtStr) || '';

    return {
      slug: fileName,
      title,
      fileDate: fileDateStr,
      hasDate: displayDate !== '',
      status,
      scheduledDate,
      updatedAt,
      qiitaId: (id && id !== 'null') ? id : null,
      isPrivate,
      tags,
      displayDate,
    };
  }

  /**
   * Front Matter (---...---) を解析しフィールドとタグを返す
   * ブロックスタイルの YAML 配列タグにも対応
   */
  private extractFrontMatter(filePath: string): { fields: Record<string, string>; tags: string[] } {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split(/\r?\n/);
    const fields: Record<string, string> = {};
    const tags: string[] = [];

    if (lines.length === 0 || lines[0].trim() !== '---') {
      return { fields, tags };
    }

    let inTags = false;
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() === '---') { break; }

      // タグのブロックスタイル配列を読み取り
      if (inTags) {
        const tagMatch = line.match(/^\s+-\s+(.+)$/);
        if (tagMatch) {
          tags.push(tagMatch[1].trim().replace(/^['"]|['"]$/g, ''));
          continue;
        }
        inTags = false;
      }

      const kvMatch = line.match(/^(\w[\w_]*)\s*:\s*(.*)$/);
      if (kvMatch) {
        const key = kvMatch[1].toLowerCase();
        const value = kvMatch[2].trim();

        if (key === 'tags') {
          if (value) {
            // インラインカンマ区切りタグ
            value.split(',').forEach(t => {
              const trimmed = t.trim().replace(/^['"]|['"]$/g, '');
              if (trimmed) { tags.push(trimmed); }
            });
          } else {
            // 次行以降のブロックスタイルタグ
            inTags = true;
          }
        } else {
          fields[key] = value.replace(/^['"]|['"]$/g, '');
        }
      }
    }

    return { fields, tags };
  }

  private parseDate(str: string): string | null {
    const cleaned = str.replace(/^['"]|['"]$/g, '').trim();
    const match = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) { return null; }
    return cleaned;
  }

  /**
   * ISO 8601 タイムスタンプ (例: 2025-01-14T18:17:00+09:00) から YYYY-MM-DD を抽出
   */
  private parseDateFromTimestamp(str: string | undefined): string | null {
    if (!str || str === 'null' || str === "''" || str === '""') { return null; }
    const cleaned = str.replace(/^['"]|['"]$/g, '').trim();
    if (!cleaned) { return null; }

    // YYYY-MM-DD 形式のみの場合
    const simpleMatch = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (simpleMatch) { return cleaned; }

    // ISO 8601 形式（タイムゾーン付き）からローカル日付を抽出
    try {
      const dt = new Date(cleaned);
      if (isNaN(dt.getTime())) { return null; }
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, '0');
      const d = String(dt.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    } catch {
      return null;
    }
  }
}
