import * as https from 'https';

interface HolidayInfo {
  date: string;
  name: string;
}

interface HolidayResult {
  success: boolean;
  error: string | null;
  holidays: HolidayInfo[];
}

export class HolidayService {
  private cache = new Map<number, HolidayResult>();

  async getHolidays(year: number): Promise<HolidayResult> {
    if (this.cache.has(year)) {
      return this.cache.get(year)!;
    }

    try {
      const url = `https://holidays-jp.github.io/api/v1/${year}/date.json`;
      const json = await this.fetch(url);
      const dict = JSON.parse(json) as Record<string, string>;

      const holidays: HolidayInfo[] = Object.entries(dict)
        .map(([date, name]) => ({ date, name }))
        .sort((a, b) => a.date.localeCompare(b.date));

      const result: HolidayResult = {
        success: true,
        error: null,
        holidays,
      };

      this.cache.set(year, result);
      console.log(`📅 ${year}年の祝日を外部APIから取得しました (${holidays.length}件)`);
      return result;
    } catch (err: any) {
      const result: HolidayResult = {
        success: false,
        error: `祝日APIの取得に失敗しました (${year}年): ${err.message}`,
        holidays: [],
      };
      console.warn(`⚠️ ${result.error}`);
      return result;
    }
  }

  private fetch(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      https.get(url, (res) => {
        // リダイレクト対応
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          this.fetch(res.headers.location).then(resolve, reject);
          return;
        }

        let data = '';
        res.on('data', (chunk: string) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(data);
          } else {
            reject(new Error(`HTTP ${res.statusCode}`));
          }
        });
      }).on('error', reject);
    });
  }
}
