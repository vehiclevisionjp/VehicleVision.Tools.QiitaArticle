import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as https from 'https';
import { EventEmitter } from 'events';
import { HolidayService } from '../holidayService';

vi.mock('https');

const mockedGet = vi.mocked(https.get);

/** Creates a fake IncomingMessage-like response object */
function fakeResponse(statusCode: number, body: string): EventEmitter & { statusCode: number; headers: Record<string, string> } {
  const emitter = new EventEmitter() as any;
  emitter.statusCode = statusCode;
  emitter.headers = {};

  // Emit data and end on the next tick so the mock has time to return
  setImmediate(() => {
    emitter.emit('data', body);
    emitter.emit('end');
  });

  return emitter;
}

/** Creates a fake ClientRequest-like object with a chainable .on() */
function fakeRequest(): EventEmitter {
  const req = new EventEmitter();
  return req;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('HolidayService', () => {
  it('returns holidays from API on success', async () => {
    const holidayData = JSON.stringify({
      '2023-01-01': '元日',
      '2023-01-02': '振替休日',
    });

    mockedGet.mockImplementation((_url: any, callback: any) => {
      const res = fakeResponse(200, holidayData);
      callback(res);
      return fakeRequest() as any;
    });

    const service = new HolidayService();
    const result = await service.getHolidays(2023);

    expect(result.success).toBe(true);
    expect(result.error).toBeNull();
    expect(result.holidays).toHaveLength(2);
    expect(result.holidays[0]).toEqual({ date: '2023-01-01', name: '元日' });
    expect(result.holidays[1]).toEqual({ date: '2023-01-02', name: '振替休日' });
  });

  it('sorts holidays by date', async () => {
    const holidayData = JSON.stringify({
      '2023-05-03': 'みどりの日',
      '2023-01-01': '元日',
      '2023-02-11': '建国記念の日',
    });

    mockedGet.mockImplementation((_url: any, callback: any) => {
      callback(fakeResponse(200, holidayData));
      return fakeRequest() as any;
    });

    const service = new HolidayService();
    const result = await service.getHolidays(2023);

    expect(result.holidays.map(h => h.date)).toEqual([
      '2023-01-01',
      '2023-02-11',
      '2023-05-03',
    ]);
  });

  it('returns cached result on second call (no second HTTP request)', async () => {
    const holidayData = JSON.stringify({ '2023-01-01': '元日' });

    mockedGet.mockImplementation((_url: any, callback: any) => {
      callback(fakeResponse(200, holidayData));
      return fakeRequest() as any;
    });

    const service = new HolidayService();
    await service.getHolidays(2023);
    await service.getHolidays(2023);

    expect(mockedGet).toHaveBeenCalledTimes(1);
  });

  it('different years each make their own HTTP request', async () => {
    const makeData = (year: number) => JSON.stringify({ [`${year}-01-01`]: '元日' });

    mockedGet.mockImplementation((_url: any, callback: any) => {
      const url = String(_url);
      const year = parseInt(url.match(/\/(\d{4})\//)?.[1] ?? '2023');
      callback(fakeResponse(200, makeData(year)));
      return fakeRequest() as any;
    });

    const service = new HolidayService();
    await service.getHolidays(2023);
    await service.getHolidays(2024);

    expect(mockedGet).toHaveBeenCalledTimes(2);
  });

  it('returns error result on network error', async () => {
    mockedGet.mockImplementation((_url: any, _callback: any) => {
      const req = fakeRequest();
      setImmediate(() => {
        req.emit('error', new Error('ECONNREFUSED'));
      });
      return req as any;
    });

    const service = new HolidayService();
    const result = await service.getHolidays(2023);

    expect(result.success).toBe(false);
    expect(result.error).toContain('取得に失敗');
    expect(result.holidays).toHaveLength(0);
  });

  it('returns error result on HTTP non-2xx status', async () => {
    mockedGet.mockImplementation((_url: any, callback: any) => {
      callback(fakeResponse(404, 'Not Found'));
      return fakeRequest() as any;
    });

    const service = new HolidayService();
    const result = await service.getHolidays(2023);

    expect(result.success).toBe(false);
    expect(result.error).toContain('取得に失敗');
    expect(result.holidays).toHaveLength(0);
  });

  it('handles HTTP 500 error', async () => {
    mockedGet.mockImplementation((_url: any, callback: any) => {
      callback(fakeResponse(500, 'Internal Server Error'));
      return fakeRequest() as any;
    });

    const service = new HolidayService();
    const result = await service.getHolidays(2023);

    expect(result.success).toBe(false);
    expect(result.holidays).toHaveLength(0);
  });

  it('error result is not cached (retries on next call)', async () => {
    mockedGet.mockImplementationOnce((_url: any, _callback: any) => {
      const req = fakeRequest();
      setImmediate(() => req.emit('error', new Error('network fail')));
      return req as any;
    });

    const holidayData = JSON.stringify({ '2023-01-01': '元日' });
    mockedGet.mockImplementationOnce((_url: any, callback: any) => {
      callback(fakeResponse(200, holidayData));
      return fakeRequest() as any;
    });

    const service = new HolidayService();
    const first = await service.getHolidays(2023);
    const second = await service.getHolidays(2023);

    expect(first.success).toBe(false);
    expect(second.success).toBe(true);
    expect(second.holidays).toHaveLength(1);
    // Two HTTP requests since errors are not cached
    expect(mockedGet).toHaveBeenCalledTimes(2);
  });
});
