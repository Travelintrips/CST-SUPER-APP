/**
 * Business-day calculations for settlement expectations.
 *
 * Dates in this module are calendar dates, not instants. Timestamps are first
 * converted to Asia/Jakarta so a late-night UTC payment cannot move to the
 * wrong settlement day.
 */

export const JAKARTA_TIMEZONE = "Asia/Jakarta";

function assertDateOnly(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid calendar date: ${value}`);
  }
  const parsed = new Date(`${value}T12:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`Invalid calendar date: ${value}`);
  }
  return value;
}

export function addCalendarDays(date: string, days: number): string {
  const parsed = new Date(`${assertDateOnly(date)}T12:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export function jakartaDateFromTimestamp(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: JAKARTA_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return `${byType.get("year")}-${byType.get("month")}-${byType.get("day")}`;
}

export function dayOfWeek(date: string): number {
  return new Date(`${assertDateOnly(date)}T12:00:00.000Z`).getUTCDay();
}

export function isWeekend(date: string): boolean {
  const day = dayOfWeek(date);
  return day === 0 || day === 6;
}

export function isBusinessDay(date: string, holidays: Iterable<string> = []): boolean {
  return !isWeekend(date) && !new Set(holidays).has(assertDateOnly(date));
}

/**
 * Add business days. A delay of one means "the next business day", not the
 * same day. This makes Friday/Saturday/Sunday all resolve to Monday.
 */
export function addBusinessDays(
  startDate: string,
  delay: number,
  holidays: Iterable<string> = [],
): string {
  const holidaySet = new Set(Array.from(holidays, assertDateOnly));
  let result = assertDateOnly(startDate);
  let remaining = Math.max(0, Math.trunc(delay));

  while (remaining > 0) {
    result = addCalendarDays(result, 1);
    if (isBusinessDay(result, holidaySet)) remaining -= 1;
  }

  // A zero-delay settlement still cannot land on a weekend/holiday.
  while (!isBusinessDay(result, holidaySet)) {
    result = addCalendarDays(result, 1);
  }
  return result;
}

export function businessDayDistance(
  left: string,
  right: string,
  holidays: Iterable<string> = [],
): number {
  const leftDate = assertDateOnly(left);
  const rightDate = assertDateOnly(right);
  if (leftDate === rightDate) return 0;

  let current = leftDate;
  let distance = 0;
  const direction = leftDate < rightDate ? 1 : -1;
  const holidaySet = new Set(Array.from(holidays, assertDateOnly));
  while (current !== rightDate) {
    current = addCalendarDays(current, direction);
    if (isBusinessDay(current, holidaySet)) distance += direction;
  }
  return Math.abs(distance);
}