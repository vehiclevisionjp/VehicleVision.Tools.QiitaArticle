/**
 * iCalendar (.ics) から終日イベントを日付ごとに取り出す最小限のパーサー。
 * Google カレンダーの祝日カレンダー（繰り返しなしの終日イベント）を対象とする。
 */

export interface IcsEvent {
  /** YYYY-MM-DD */
  date: string;
  name: string;
  /** DESCRIPTION（Google の祝日カレンダーでは「祝日」「祭日」などの区分が入る） */
  description: string;
}

function unfold(text: string): string[] {
  // 行の折り返し（CRLF + 空白/タブ）を結合する
  return text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
}

function unescapeText(s: string): string {
  return s.replace(/\\([nN,;\\])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c));
}

function parseDateValue(v: string): Date | null {
  const m = v.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m) {
    return null;
  }
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function fmt(d: Date): string {
  return d.toISOString().substring(0, 10);
}

/** 複数日にまたがるイベントは各日に展開する（DTEND は排他的）。 */
export function parseIcsEvents(ics: string): IcsEvent[] {
  const events: IcsEvent[] = [];
  let inEvent = false;
  let start: Date | null = null;
  let end: Date | null = null;
  let summary = '';
  let description = '';

  for (const line of unfold(ics)) {
    if (line === 'BEGIN:VEVENT') {
      inEvent = true;
      start = null;
      end = null;
      summary = '';
      description = '';
      continue;
    }
    if (line === 'END:VEVENT') {
      if (inEvent && start) {
        const last = end && end > start ? new Date(end.getTime() - 86_400_000) : start;
        for (let t = start.getTime(); t <= last.getTime(); t += 86_400_000) {
          events.push({ date: fmt(new Date(t)), name: summary, description });
        }
      }
      inEvent = false;
      continue;
    }
    if (!inEvent) {
      continue;
    }

    const idx = line.indexOf(':');
    if (idx < 0) {
      continue;
    }
    const key = line.substring(0, idx);
    const value = line.substring(idx + 1);
    const name = key.split(';')[0].toUpperCase();

    if (name === 'DTSTART') {
      start = parseDateValue(value);
    } else if (name === 'DTEND') {
      end = parseDateValue(value);
    } else if (name === 'SUMMARY') {
      summary = unescapeText(value).trim();
    } else if (name === 'DESCRIPTION') {
      description = unescapeText(value).trim();
    }
  }

  return events.sort((a, b) => a.date.localeCompare(b.date));
}

/** Google カレンダー ID（または ICS の URL）から取得 URL を組み立てる。 */
export function buildIcsUrl(source: string): string {
  const s = source.trim().replace(/^webcal:\/\//i, 'https://');
  if (/^https:\/\//i.test(s)) {
    return s;
  }
  return `https://calendar.google.com/calendar/ical/${encodeURIComponent(s)}/public/basic.ics`;
}

/**
 * Google の祝日カレンダーには、祝日のほかに「祭日」「行事」などの記念日も含まれる。
 * 休日として扱わない区分を除外するための判定。
 */
export function isObservance(event: IcsEvent): boolean {
  return /^(祭日|行事|Observance)/i.test(event.description);
}
