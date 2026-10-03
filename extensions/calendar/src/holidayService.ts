import * as https from 'https';
import {
  buildIcsUrl,
  isObservance,
  parseIcsEvents,
  IcsEvent,
} from './icsParser';

export interface HolidayInfo {
  date: string;
  name: string;
}

export interface HolidayResult {
  success: boolean;
  error: string | null;
  holidays: HolidayInfo[];
}

/** 祝日の既定の取得元（Google カレンダー「日本の祝日」） */
export const DEFAULT_HOLIDAY_CALENDAR_ID =
  'ja.japanese.official#holiday@group.v.calendar.google.com';

/** Google カレンダーの ICS は全期間を含むため、取得結果は一定時間キャッシュする */
const ICS_TTL_MS = 6 * 60 * 60 * 1000;

export type Fetcher = (url: string) => Promise<string>;

/**
 * 祝日の取得元:
 * - 設定 `articleCalendar.holidayCalendarId`（既定: DEFAULT_HOLIDAY_CALENDAR_ID）に
 *   Google カレンダー ID または ICS の URL を指定: 公開カレンダーの ICS から取得
 * - 空文字を指定: holidays-jp API（日本の祝日）
 */
export class HolidayService {
  private cache = new Map<string, HolidayResult>();
  private icsCache = new Map<string, { at: number; events: IcsEvent[] }>();

  /**
   * @param getSource 取得元（Google カレンダー ID / ICS URL）。空文字なら holidays-jp
   *   （既定値は DEFAULT_HOLIDAY_CALENDAR_ID）
   * @param fetcher テスト用に差し替え可能な HTTP 取得関数
   */
  constructor(
    private getSource: () => string = () => DEFAULT_HOLIDAY_CALENDAR_ID,
    private fetcher: Fetcher = (url) => fetchText(url, 5),
  ) {}

  async getHolidays(year: number): Promise<HolidayResult> {
    const source = (this.getSource() || '').trim();
    const key = `${source}|${year}`;
    const cached = this.cache.get(key);
    if (cached) {
      return cached;
    }

    try {
      const result = source
        ? await this.fromCalendar(source, year)
        : await this.fromHolidaysJp(year);
      this.cache.set(key, result);
      console.log(
        `📅 ${year}年の祝日を取得しました (${result.holidays.length}件)`,
      );
      return result;
    } catch (err: any) {
      const label = source ? 'Google カレンダー' : '祝日API';
      const result: HolidayResult = {
        success: false,
        error: `${label}の取得に失敗しました (${year}年): ${err.message}`,
        holidays: [],
      };
      console.warn(`⚠️ ${result.error}`);
      return result;
    }
  }

  private async fromHolidaysJp(year: number): Promise<HolidayResult> {
    const json = await this.fetcher(
      `https://holidays-jp.github.io/api/v1/${year}/date.json`,
    );
    const dict = JSON.parse(json) as Record<string, string>;
    const holidays = Object.entries(dict)
      .map(([date, name]) => ({ date, name }))
      .sort((a, b) => a.date.localeCompare(b.date));
    return { success: true, error: null, holidays };
  }

  private async fromCalendar(
    source: string,
    year: number,
  ): Promise<HolidayResult> {
    const url = buildIcsUrl(source);
    let entry = this.icsCache.get(url);
    if (!entry || Date.now() - entry.at > ICS_TTL_MS) {
      const text = await this.fetcher(url);
      if (!text.includes('BEGIN:VCALENDAR')) {
        throw new Error(
          'カレンダーを取得できませんでした（ID が正しいか、カレンダーが公開されているか確認してください）',
        );
      }
      entry = { at: Date.now(), events: parseIcsEvents(text) };
      this.icsCache.set(url, entry);
    }

    const prefix = `${year}-`;
    const holidays = entry.events
      .filter((e) => e.date.startsWith(prefix) && !isObservance(e))
      .map((e) => ({ date: e.date, name: e.name }));
    return { success: true, error: null, holidays };
  }
}

function fetchText(url: string, redirectsLeft: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 10_000 }, (res) => {
      // リダイレクト対応
      if (
        res.statusCode &&
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        res.headers.location
      ) {
        res.resume();
        if (redirectsLeft <= 0) {
          reject(new Error('リダイレクトが多すぎます'));
          return;
        }
        fetchText(
          new URL(res.headers.location, url).toString(),
          redirectsLeft - 1,
        ).then(resolve, reject);
        return;
      }

      res.setEncoding('utf8');
      let data = '';
      res.on('data', (chunk: string) => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('タイムアウトしました')));
    req.on('error', reject);
  });
}
