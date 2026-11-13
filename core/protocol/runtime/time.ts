/**
 * Temporal values and arithmetic. Dates keep their precision (`YYYY`, `YYYY-MM`, `YYYY-MM-DD`); instants carry an offset;
 * a local wall time needs its IANA zone. Duration arithmetic uses fixed units on instants; calendar arithmetic uses
 * calendar units, clamps month ends and, on an instant, the stated zone. Nothing here guesses a day, a zone or a DST fold:
 * such a time is unknown `unresolved_precision`, and an imprecise anchor gives a window.
 * Source: the resolved v1 contract, "Temporal precision" and the `elapsed` calculation.
 */
import { convert } from '../../logic/index.ts';
import type { JsonValue, Quantity, ResolvedInput, Time } from '../types.ts';

export type Precision = 'year' | 'month' | 'day' | 'instant';
export interface ParsedTime {
 precision: Precision;
 y: number; m: number; d: number;
 /** Instants only: epoch milliseconds and the written offset in minutes. */
 ms?: number; offset?: number;
}
type Day = { y: number; m: number; d: number };

const DAY = 86_400_000;
const FIXED = ['s', 'min', 'h', 'd', 'wk'];
const CALENDAR = ['d', 'wk', 'mo', 'a'];
const pad = (n: number, width = 2) => String(n).padStart(width, '0');
const daysIn = (y: number, m: number) => [31, y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
/** Date.UTC remaps years 0000–0099 to 1900–1999; setUTCFullYear preserves the written four-digit year. */
const utc = (y: number, m: number, d: number, h = 0, mi = 0, s = 0, ms = 0): number => {
 const date = new Date(0);
 date.setUTCFullYear(y, m - 1, d);
 date.setUTCHours(h, mi, s, ms);
 return date.getTime();
};
const dayNumber = ({ y, m, d }: Day) => utc(y, m, d) / DAY;
const fromDayNumber = (n: number): Day => { const t = new Date(n * DAY); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }; };
const known = (value: JsonValue): ResolvedInput => ({ state: 'known', value });
const unresolved = (detail: string): ResolvedInput => ({ state: 'unknown', reason: 'unresolved_precision', detail });

/** Read a time, or undefined when it is not a valid date of some precision or an instant with an explicit offset. */
export function parseTime(text: string): ParsedTime | undefined {
 const date = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(text);
 if (date) {
  const y = Number(date[1]), m = date[2] ? Number(date[2]) : 1, d = date[3] ? Number(date[3]) : 1;
  if (m < 1 || m > 12 || d < 1 || d > daysIn(y, m)) return undefined;
  return { precision: date[3] ? 'day' : date[2] ? 'month' : 'year', y, m, d };
 }
 const t = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.exec(text);
 if (!t) return undefined;
 const [y, m, d, h, mi, s] = [1, 2, 3, 4, 5, 6].map(i => Number(t[i] ?? 0));
 if (m < 1 || m > 12 || d < 1 || d > daysIn(y, m) || h > 23 || mi > 59 || s > 59) return undefined;
 if (t[8] !== 'Z' && (Number(t[8].slice(1, 3)) > 23 || Number(t[8].slice(4)) > 59)) return undefined;
 const offset = t[8] === 'Z' ? 0 : (t[8][0] === '-' ? -1 : 1) * (Number(t[8].slice(1, 3)) * 60 + Number(t[8].slice(4)));
 const ms = utc(y, m, d, h, mi, s, t[7] ? Math.round(Number(t[7]) * 1000) : 0) - offset * 60_000;
 return { precision: 'instant', y, m, d, ms, offset };
}

/** The first and last admissible day of a date. */
function days(p: ParsedTime): [Day, Day] {
 if (p.precision === 'year') return [{ y: p.y, m: 1, d: 1 }, { y: p.y, m: 12, d: 31 }];
 if (p.precision === 'month') return [{ y: p.y, m: p.m, d: 1 }, { y: p.y, m: p.m, d: daysIn(p.y, p.m) }];
 return [p, p];
}

/**
 * -1, 0 or 1 when `a` is certainly before, the same instant as, or certainly after `b`; undefined when their admissible
 * ranges overlap. Two dates compare by calendar day; a date against an instant allows every zone (UTC−12 to UTC+14).
 */
export function compareTimes(a: Time, b: Time): -1 | 0 | 1 | undefined {
 const p = parseTime(a), q = parseTime(b);
 if (!p || !q) return undefined;
 const range = (x: ParsedTime, wide: boolean): [number, number] => {
  if (x.precision === 'instant') return [x.ms!, x.ms!];
  const [first, last] = days(x);
  return wide ? [dayNumber(first) * DAY - 14 * 3_600_000, (dayNumber(last) + 1) * DAY + 12 * 3_600_000 - 1] : [dayNumber(first), dayNumber(last)];
 };
 const wide = (p.precision === 'instant') !== (q.precision === 'instant');
 const [a1, a2] = range(p, wide), [b1, b2] = range(q, wide);
 if (p.precision === 'instant' && q.precision === 'instant') return a1 < b1 ? -1 : a1 > b1 ? 1 : 0;
 return a2 < b1 ? -1 : a1 > b2 ? 1 : undefined;
}

const formats = new Map<string, Intl.DateTimeFormat>();
/** The zone's offset in minutes at an instant, or undefined for an unknown zone. */
function zoneOffset(ms: number, zone: string): number | undefined {
 let f = formats.get(zone);
 if (!f) {
  try { f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }); }
  catch { return undefined; }
  formats.set(zone, f);
 }
 const part = Object.fromEntries(f.formatToParts(new Date(ms)).map(x => [x.type, Number(x.value)]));
 const wall = utc(part.year, part.month, part.day, part.hour, part.minute, part.second);
 return Math.round((wall - Math.floor(ms / 1000) * 1000) / 60_000);
}

function formatInstant(ms: number, offset: number): string {
 const t = new Date(ms + offset * 60_000), sign = offset < 0 ? '-' : '+', abs = Math.abs(offset);
 const frac = t.getUTCMilliseconds() ? `.${pad(t.getUTCMilliseconds(), 3)}` : '';
 return `${pad(t.getUTCFullYear(), 4)}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}T${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())}${frac}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}
const formatDate = (day: Day, precision: Precision) =>
 precision === 'year' ? pad(day.y, 4) : precision === 'month' ? `${pad(day.y, 4)}-${pad(day.m)}` : `${pad(day.y, 4)}-${pad(day.m)}-${pad(day.d)}`;

/**
 * Resolve a local wall time (`2026-03-29T01:30`) in an IANA zone. A missing or unknown zone, a nonexistent wall time
 * and an unresolved DST fold are unknown `unresolved_precision`. A supplied offset must be one the zone has then.
 */
export function localInstant(local: string, zone?: string, offset?: string): ResolvedInput {
 const t = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(local);
 if (!t || !parseTime(`${local.slice(0, 16)}${t[6] ? local.slice(16) : ''}Z`)) return { state: 'unknown', reason: 'invalid_value', detail: `not a local date and time: ${JSON.stringify(local)}` };
 if (!zone) return unresolved('a local time needs its time zone');
 const wall = utc(Number(t[1]), Number(t[2]), Number(t[3]), Number(t[4]), Number(t[5]), Number(t[6] ?? 0));
 const around = [wall - DAY, wall, wall + DAY].map(ms => zoneOffset(ms, zone));
 if (around.some(o => o === undefined)) return unresolved(`unknown time zone ${zone}`);
 const valid = [...new Set(around as number[])].filter(o => zoneOffset(wall - o * 60_000, zone) === o);
 if (offset !== undefined) {
  const p = parseTime(`${local.slice(0, 16)}:00${offset}`);
  if (!p || !valid.includes(p.offset!)) return unresolved(`${offset} is not an offset of ${zone} at ${local}`);
  return known(formatInstant(wall - p.offset! * 60_000, p.offset!));
 }
 if (valid.length === 0) return unresolved(`${local} does not exist in ${zone}`);
 if (valid.length > 1) return unresolved(`${local} occurs twice in ${zone}; the offset is not stated`);
 return known(formatInstant(wall - valid[0] * 60_000, valid[0]));
}

function addMonths(day: Day, months: number): Day {
 const index = day.y * 12 + (day.m - 1) + months, y = Math.floor(index / 12), m = index - y * 12 + 1;
 return { y, m, d: Math.min(day.d, daysIn(y, m)) };
}
function addCalendarDays(day: Day, amount: number, unit: string): Day {
 return unit === 'mo' || unit === 'a' ? addMonths(day, amount * (unit === 'a' ? 12 : 1)) : fromDayNumber(dayNumber(day) + amount * (unit === 'wk' ? 7 : 1));
}

/**
 * Add a signed amount to a time. `duration` needs an instant and a fixed unit; `calendar` takes `d`, `wk`, `mo` or `a`,
 * clamps invalid month ends, keeps a date's precision when the unit is no finer, and otherwise gives a window over
 * the admissible anchors. Calendar arithmetic on an instant needs `zone`. An unknown anchor keeps its reason.
 */
export function addTime(anchor: Time | ResolvedInput, amount: Quantity, basis: 'duration' | 'calendar', zone?: string): ResolvedInput {
 if (typeof anchor !== 'string') {
  if (anchor.state === 'unknown') return anchor;
  if (typeof anchor.value !== 'string') return { state: 'unknown', reason: 'invalid_value', detail: `not a time: ${JSON.stringify(anchor.value)}` };
  anchor = anchor.value;
 }
 const p = parseTime(anchor);
 if (!p) return { state: 'unknown', reason: 'invalid_value', detail: `not a time: ${JSON.stringify(anchor)}` };
 const { value, unit } = amount;
 if (basis === 'duration') {
  if (!FIXED.includes(unit)) throw new Error(`${unit} is a calendar unit, not a fixed duration; use basis calendar.`);
  if (p.precision !== 'instant') return unresolved(`duration arithmetic needs an instant, not the date ${anchor}`);
  const ms = p.ms! + convert(value, unit, 's') * 1000;
  const offset = zone === undefined ? p.offset! : zoneOffset(ms, zone);
  return offset === undefined ? unresolved(`unknown time zone ${zone}`) : known(formatInstant(ms, offset));
 }
 if (!CALENDAR.includes(unit)) throw new Error(`${unit} is not a calendar unit; use d, wk, mo or a.`);
 if (!Number.isInteger(value)) throw new Error(`A calendar amount is a whole number of ${unit}, not ${value}.`);
 if (p.precision === 'instant') {
  if (!zone) return unresolved('calendar arithmetic on an instant needs the zone of its calendar');
  const offset = zoneOffset(p.ms!, zone);
  if (offset === undefined) return unresolved(`unknown time zone ${zone}`);
  const wall = new Date(p.ms! + offset * 60_000), day = addCalendarDays({ y: wall.getUTCFullYear(), m: wall.getUTCMonth() + 1, d: wall.getUTCDate() }, value, unit);
  return localInstant(`${formatDate(day, 'day')}T${pad(wall.getUTCHours())}:${pad(wall.getUTCMinutes())}:${pad(wall.getUTCSeconds())}`, zone);
 }
 // The result's precision: the anchor's, unless the unit is finer (months on a year, days on a month or year).
 const precision: Precision = unit === 'd' || unit === 'wk' ? 'day' : unit === 'mo' && p.precision === 'year' ? 'month' : p.precision;
 const [first, last] = days(p);
 const lo = formatDate(addCalendarDays(first, value, unit), precision), hi = formatDate(addCalendarDays(precision === p.precision ? first : last, value, unit), precision);
 return known(lo === hi ? lo : { min: lo, max: hi });
}

/** Completed calendar units from one day to another, counting a month-end anniversary on the clamped day. */
function completed(a: Day, b: Day, unit: string): number {
 if (dayNumber(b) < dayNumber(a)) return -completed(b, a, unit);
 if (unit === 'd' || unit === 'wk') return Math.floor((dayNumber(b) - dayNumber(a)) / (unit === 'wk' ? 7 : 1));
 let months = (b.y - a.y) * 12 + (b.m - a.m);
 if (b.d < Math.min(a.d, daysIn(b.y, b.m))) months -= 1;
 return unit === 'a' ? Math.floor(months / 12) : months;
}

/**
 * Elapsed time as a quantity in `unit`. `duration` needs instant endpoints and a fixed unit and does not truncate.
 * `calendar` counts completed `d`, `wk`, `mo` or `a` between dates; an instant endpoint needs `datesIn`, the zone of its
 * date. Imprecise endpoints give `{min, max}` over their admissible dates.
 */
export function elapsed(from: Time, to: Time, unit: string, basis: 'duration' | 'calendar', datesIn?: string): ResolvedInput {
 const p = parseTime(from), q = parseTime(to);
 if (!p || !q) return { state: 'unknown', reason: 'invalid_value', detail: `not a time: ${JSON.stringify(p ? to : from)}` };
 if (basis === 'duration') {
  if (!FIXED.includes(unit)) throw new Error(`${unit} is a calendar unit, not a fixed duration; use basis calendar.`);
  if (p.precision !== 'instant' || q.precision !== 'instant') return unresolved('duration arithmetic needs instant endpoints');
  return known({ value: convert((q.ms! - p.ms!) / 1000, 's', unit), unit });
 }
 if (!CALENDAR.includes(unit)) throw new Error(`${unit} is not a calendar unit; use d, wk, mo or a.`);
 const range = (x: ParsedTime): [Day, Day] | string => {
  if (x.precision !== 'instant') return days(x);
  if (!datesIn) return 'an instant endpoint needs dates_in, the zone of its calendar date';
  const offset = zoneOffset(x.ms!, datesIn);
  if (offset === undefined) return `unknown time zone ${datesIn}`;
  const t = new Date(x.ms! + offset * 60_000), day = { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
  return [day, day];
 };
 const a = range(p), b = range(q);
 if (typeof a === 'string') return unresolved(a);
 if (typeof b === 'string') return unresolved(b);
 const min = completed(a[1], b[0], unit), max = completed(a[0], b[1], unit);
 return known(min === max ? { value: min, unit } : { min: { value: min, unit }, max: { value: max, unit } });
}
