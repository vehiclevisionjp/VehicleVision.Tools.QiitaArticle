import { describe, expect, it, vi } from 'vitest';
import { buildIcsUrl, isObservance, parseIcsEvents } from '../src/icsParser';
import {
  DEFAULT_HOLIDAY_CALENDAR_ID,
  HolidayService,
} from '../src/holidayService';

const ICS = [
  'BEGIN:VCALENDAR',
  'X-WR-CALNAME:日本の祝日',
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20261012',
  'DTEND;VALUE=DATE:20261013',
  'DESCRIPTION:祝日',
  'SUMMARY:スポーツの日',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20260203',
  'DTEND;VALUE=DATE:20260204',
  'DESCRIPTION:祭日\\n祭日を非表示にするには、設定 \\, へ',
  'SUMMARY:節分',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20270101',
  'DTEND;VALUE=DATE:20270104',
  'DESCRIPTION:祝日',
  'SUMMARY:年末年始\\, 連休',
  'END:VEVENT',
  'END:VCALENDAR',
  '',
].join('\r\n');

describe('icsParser', () => {
  it('終日イベントを日付ごとに取り出し、日付順に並べる', () => {
    const ev = parseIcsEvents(ICS);
    expect(ev.map((e) => e.date)).toEqual([
      '2026-02-03',
      '2026-10-12',
      '2027-01-01',
      '2027-01-02',
      '2027-01-03',
    ]);
    expect(ev.find((e) => e.date === '2026-10-12')!.name).toBe('スポーツの日');
  });

  it('DTEND は排他的、エスケープと行の折り返しを解釈する', () => {
    const ev = parseIcsEvents(ICS);
    expect(ev.filter((e) => e.name === '年末年始, 連休')).toHaveLength(3);
    const folded = parseIcsEvents(
      'BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20260101\r\nSUMMARY:長い\r\n  名前\r\nEND:VEVENT\r\n',
    );
    expect(folded[0].name).toBe('長い 名前');
    expect(folded).toHaveLength(1);
  });

  it('祭日・行事・Observance を除外判定する', () => {
    const ev = parseIcsEvents(ICS);
    expect(ev.filter(isObservance).map((e) => e.name)).toEqual(['節分']);
  });

  it('カレンダー ID / URL から取得 URL を作る', () => {
    expect(buildIcsUrl('ja.japanese#holiday@group.v.calendar.google.com')).toBe(
      'https://calendar.google.com/calendar/ical/ja.japanese%23holiday%40group.v.calendar.google.com/public/basic.ics',
    );
    expect(buildIcsUrl(' https://example.com/a.ics ')).toBe(
      'https://example.com/a.ics',
    );
    expect(buildIcsUrl('webcal://example.com/a.ics')).toBe(
      'https://example.com/a.ics',
    );
  });
});

describe('HolidayService', () => {
  it('引数なしの既定は日本の祝日の Google カレンダー', async () => {
    const fetcher = vi.fn().mockResolvedValue(ICS);
    await new HolidayService(undefined, fetcher).getHolidays(2026);
    expect(DEFAULT_HOLIDAY_CALENDAR_ID).toBe(
      'ja.japanese.official#holiday@group.v.calendar.google.com',
    );
    expect(fetcher).toHaveBeenCalledWith(
      'https://calendar.google.com/calendar/ical/ja.japanese.official%23holiday%40group.v.calendar.google.com/public/basic.ics',
    );
  });

  it('設定が空なら holidays-jp から取得する', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        JSON.stringify({ '2026-01-01': '元日', '2026-01-12': '成人の日' }),
      );
    const svc = new HolidayService(() => '', fetcher);
    const r = await svc.getHolidays(2026);
    expect(fetcher).toHaveBeenCalledWith(
      'https://holidays-jp.github.io/api/v1/2026/date.json',
    );
    expect(r.holidays.map((h) => h.name)).toEqual(['元日', '成人の日']);
  });

  it('Google カレンダー ID なら ICS から年で絞り、行事を除外する', async () => {
    const fetcher = vi.fn().mockResolvedValue(ICS);
    const svc = new HolidayService(
      () => 'ja.japanese#holiday@group.v.calendar.google.com',
      fetcher,
    );

    const r26 = await svc.getHolidays(2026);
    expect(r26.success).toBe(true);
    expect(r26.holidays).toEqual([
      { date: '2026-10-12', name: 'スポーツの日' },
    ]);

    const r27 = await svc.getHolidays(2027);
    expect(r27.holidays.map((h) => h.date)).toEqual([
      '2027-01-01',
      '2027-01-02',
      '2027-01-03',
    ]);
    // 同じ ICS は再取得しない
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('取得元の設定変更が次回の取得に反映される', async () => {
    let source = '';
    const fetcher = vi.fn(async (url: string) =>
      url.includes('holidays-jp') ? '{"2026-01-01":"元日"}' : ICS,
    );
    const svc = new HolidayService(() => source, fetcher);
    expect((await svc.getHolidays(2026)).holidays[0].name).toBe('元日');
    source = 'ja.japanese#holiday@group.v.calendar.google.com';
    expect((await svc.getHolidays(2026)).holidays[0].name).toBe('スポーツの日');
  });

  it('ICS でないレスポンス・通信失敗はエラー結果にする', async () => {
    const bad = new HolidayService(
      () => 'x@example.com',
      async () => '<html>404</html>',
    );
    const r1 = await bad.getHolidays(2026);
    expect(r1.success).toBe(false);
    expect(r1.error).toContain('Google カレンダー');

    const down = new HolidayService(
      () => 'x@example.com',
      async () => {
        throw new Error('HTTP 404');
      },
    );
    const r2 = await down.getHolidays(2026);
    expect(r2.success).toBe(false);
    expect(r2.error).toContain('HTTP 404');
  });
});
