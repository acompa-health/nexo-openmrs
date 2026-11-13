import { attempt, fail, failAt, parseCondition, printCondition } from './grammar.ts';
import type { Expr, Parsed, ParseOptions } from './grammar.ts';
import { unitDimension } from './units.ts';
import type { Quantity } from './units.ts';

/** Which occurrence of an event a clock counts from: the first, the latest, or the nth (2 for "the 2nd"). */
export type Which = 'first' | 'latest' | number;
/** A parsed timing. Every form names its clock (D11). */
export type Timing =
 | { kind: 'duration'; duration: Quantity }                                  // `7 d`: the field it sits in says from when
 | { kind: 'anchor'; concept: string; at: Quantity }                         // `ga 20 wk`
 | { kind: 'after event'; duration: Quantity; which: Which; event: string }  // `8 h after the first dose`
 | { kind: 'at event'; which: Which; event: string }                         // `at the 2nd visit`
 | { kind: 'calendar day'; day: number; which: Which; event: string }       // `day 2 after the first dose`: dates, not hours
 | { kind: 'frequency'; count: number; per: string }                         // `2 per d` (FHIR frequency and period)
 | { kind: 'once' }                                                          // a single dose, given now (FHIR count 1)
 | { kind: 'for' | 'over'; duration: Quantity }                              // course length; administration time
 | { kind: 'time of day'; words: string; code: string }                      // `before breakfast`, FHIR EventTiming ACM
 | { kind: 'every'; interval: Quantity; intervalMax?: Quantity; times?: number; until?: Expr } // `every 3–6 mo`; `every 5 min ×2`
 | { kind: 'range'; from: Quantity; to: Quantity; which?: Which; event?: string }  // `4–6 wk after the latest visit`: a window
 | { kind: 'within'; duration: Quantity; which?: Which; event?: string }     // `within 72 h after the latest refill.missed`: a deadline
 | { kind: 'before event'; duration?: Quantity; which: Which; event: string } // `before the first dose`; `2 h before the first dose`
 | { kind: 'each'; event: string }                                           // `at each clinic.visited`
 | { kind: 'band'; gap: Quantity; while: Expr }                              // `8 wk while ga < 20 wk`
 | { kind: 'later of'; of: [Timing, Timing] }                                // `the later of A and B`
 | { kind: 'strictly after'; timing: Timing }                                // `after ga 41 wk`
 | { kind: 'list'; items: Timing[] };                                        // `A; B`

const timesOfDay: Record<string, string> = { morning: 'MORN', evening: 'EVE', night: 'NIGHT', 'before breakfast': 'ACM', 'before dinner': 'ACV' };
/** Bare timing words take precedence over concept names in tags. */
export const reservedTimingWords = new Set([...Object.keys(timesOfDay), 'once']);
const eventName = /^[a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)*$/;
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;

/** Words separated by spaces; `;` and `×` stand alone; `8h` splits into `8 h`; quoted text stays whole. */
function tokenize(text: string): { text: string; at: number }[] {
 const out: { text: string; at: number }[] = [];
 for (const m of text.matchAll(/"[^"]*"|'[^']*'|;|×|[^\s;×]+/g)) {
  const glued = /^(\d+(?:\.\d+)?)(\D.*)$/.exec(m[0]);
  if (glued && unitDimension(glued[2])) out.push({ text: glued[1], at: m.index }, { text: glued[2], at: m.index + glued[1].length });
  else out.push({ text: m[0], at: m.index });
 }
 return out;
}

/** Parse a timing: the snippet contract's clocks, frequencies, durations, times of day, repeats, bands and lists. */
export function parseTiming(text: string, options: Pick<ParseOptions, 'concepts'> = {}): Parsed<Timing> {
 return attempt(() => {
  const toks = tokenize(text);
  let p = 0;
  const peek = () => toks[p]?.text;
  const here = () => toks[p]?.at ?? text.length;
  const found = () => p < toks.length ? `, found '${toks[p].text}'` : ' at the end';
  const take = (word: string, hint = `Expected '${word}'`) => { if (peek() !== word) fail(here(), `${hint}${found()}.`); p++; };
  const number = (what: string) => {
   const t = toks[p];
   if (!t || !/^\d+(?:\.\d+)?$/.test(t.text)) return fail(here(), `Expected ${what}${found()}.`);
   const n = Number(t.text);
   if (!Number.isFinite(n)) fail(t.at, `Expected ${what}: a finite number.`);
   p++; return n;
  };
  const whole = (what: string) => {
   const at = here(), n = number(what);
   if (!Number.isInteger(n) || n < 1) fail(at, `Expected ${what}: a whole number of 1 or more.`);
   return n;
  };
  const unit = (time: boolean) => {
   const t = toks[p], dimension = t && unitDimension(t.text);
   if (!t) return fail(text.length, 'Expected a unit at the end.');
   if (!dimension) fail(t.at, `Unknown unit '${t.text}'. Durations are in s, min, h, d, wk, mo or a.`);
   if (time && dimension !== 'time' && dimension !== 'calendar time') fail(t.at, `'${t.text}' is not a unit of time. Use s, min, h, d, wk, mo or a.`);
   p++; return t.text;
  };
  const duration = (positive = false): Quantity => {
   const at = here(), value = number('a duration');
   if (positive && value <= 0) fail(at, 'A repeat interval, course or administration duration is more than 0.');
   return { value, unit: unit(true) };
  };
  const range = (positive = false): { from: Quantity; to: Quantity } | undefined => {
   const at = here(), text = peek() ?? '', m = /^(\d+(?:\.\d+)?)[–-](\d+(?:\.\d+)?)$/.exec(text);
   if (!m) return undefined;
   p++; const u = unit(true), from = { value: Number(m[1]), unit: u }, to = { value: Number(m[2]), unit: u };
   if (!Number.isFinite(from.value) || !Number.isFinite(to.value)) fail(at, 'A duration range needs finite endpoints.');
   if (positive && from.value <= 0) fail(at, 'A repeat interval is more than 0.');
   if (from.value >= to.value) fail(at, `A range runs from the smaller value to the larger: ${text}.`);
   return { from, to };
  };
  const occurrence = (): { which: Which; event: string } => {
   take('the', "Say which occurrence, as in 'the first dose'");
   const t = toks[p], m = t && /^(\d+)(st|nd|rd|th)$/.exec(t.text);
   let which: Which;
   if (t?.text === 'first' || t?.text === 'latest') which = t.text;
   else if (m && Number(m[1]) >= 1 && ordinal(Number(m[1])) === t.text) which = Number(m[1]) === 1 ? 'first' : Number(m[1]);
   else return fail(here(), `Say which occurrence: first, latest, or an ordinal such as 2nd${found()}.`);
   p++;
   const e = toks[p];
   if (!e || !eventName.test(e.text)) return fail(here(), `Expected an event name${found()}.`);
   p++;
   return { which, event: e.text };
  };
  const repeat = (): number | undefined => {
   if (peek() === '×') { p++; return whole('a repeat count after ×'); }
   const m = /^[x×](\d+)$/.exec(peek() ?? '');
   if (!m) return undefined;
   if (Number(m[1]) < 1) fail(here(), 'A repeat count is 1 or more.');
   p++; return Number(m[1]);
  };
  const simple = (): Timing => {
   const t = peek(), at = here();
   if (t === undefined || t === ';') return fail(at, 'Expected a timing.');
   if (t === 'once') { p++; return { kind: 'once' }; }
   if (t === 'after') { p++; return { kind: 'strictly after', timing: simple() }; }
   if (t === 'every') {
    p++; const window = range(true), interval = window?.from ?? duration(true), times = repeat();
    const base: Timing = { kind: 'every', interval, ...window ? { intervalMax: window.to } : {}, ...times === undefined ? {} : { times } };
    if (peek() !== 'until') return base;
    const from = toks[p].at + 'until'.length;
    let stop = p + 1;
    while (stop < toks.length && toks[stop].text !== ';') stop++;
    const condition = parseCondition(text.slice(from, stop < toks.length ? toks[stop].at : text.length), options);
    if (!condition.ok) failAt(from, condition.error);
    p = stop;
    return { ...base, until: condition.value };
   }
   if (t === 'within') {
    p++; const d = duration();
    if (peek() !== 'after') return { kind: 'within', duration: d };
    p++; return { kind: 'within', duration: d, ...occurrence() };
   }
   if (t === 'for' || t === 'over') { p++; return { kind: t, duration: duration(true) }; }
   if (t === 'at') {
    p++;
    if (peek() !== 'each') return { kind: 'at event', ...occurrence() };
    p++; const e = toks[p];
    if (!e || !eventName.test(e.text)) return fail(here(), `Expected an event name after 'at each'${found()}.`);
    p++; return { kind: 'each', event: e.text };
   }
   if (t === 'day') { p++; const day = whole('a day number'); take('after'); return { kind: 'calendar day', day, ...occurrence() }; }
   if (t === 'the') { p++; take('later', "Expected 'the later of'"); take('of'); const a = simple(); take('and', "Expected 'and' between the two timings"); return { kind: 'later of', of: [a, simple()] }; }
   if (t === 'before') {
    p++;
    if (peek() === 'the') return { kind: 'before event', ...occurrence() };
    const words = `before ${peek()}`;
    if (!Object.hasOwn(timesOfDay, words)) fail(here(), `Expected 'breakfast' or 'dinner' after 'before'${found()}.`);
    p++; return { kind: 'time of day', words, code: timesOfDay[words] };
   }
   if (Object.hasOwn(timesOfDay, t)) { p++; return { kind: 'time of day', words: t, code: timesOfDay[t] }; }
   const window = range();
   if (window) {
    if (peek() !== 'after') return { kind: 'range', ...window };
    p++; return { kind: 'range', ...window, ...occurrence() };
   }
   if (/^\d/.test(t)) {
    if (toks[p + 1]?.text === 'per') { const count = whole('a count'); p++; return { kind: 'frequency', count, per: unit(true) }; }
    const d = duration();
    if (peek() === 'before') { p++; return { kind: 'before event', duration: d, ...occurrence() }; }
    if (peek() !== 'after') return { kind: 'duration', duration: d };
    p++; return { kind: 'after event', duration: d, ...occurrence() };
   }
   if (eventName.test(t)) { p++; const value = number(`a value of ${t}, with its unit`); return { kind: 'anchor', concept: t, at: { value, unit: unit(false) } }; }
   return fail(at, `Unexpected '${t}'.`);
  };
  // A list item: a timing, or a band (a gap, `while`, and a condition running to the next `;`).
  const item = (): Timing => {
   const start = here(), first = simple();
   if (peek() !== 'while') return first;
   if (first.kind !== 'duration') fail(start, 'A band is a gap and a condition, as in 8 wk while ga < 20 wk.');
   const from = toks[p].at + 'while'.length;
   let stop = p + 1;
   while (stop < toks.length && toks[stop].text !== ';') stop++;
   const condition = parseCondition(text.slice(from, stop < toks.length ? toks[stop].at : text.length), options);
   if (!condition.ok) failAt(from, condition.error);
   p = stop;
   return { kind: 'band', gap: first.duration, while: condition.value };
  };
  if (!toks.length) fail(0, 'The timing is empty.');
  const items = [item()];
  while (p < toks.length) {
   if (toks[p].text !== ';') fail(toks[p].at, `Unexpected '${toks[p].text}'.`);
   p++; items.push(item());
  }
  return items.length === 1 ? items[0] : { kind: 'list', items };
 });
}

const quantity = (q: Quantity) => `${q.value} ${q.unit}`;
const which = (w: Which) => typeof w === 'number' ? ordinal(w) : w;

/** Print a timing in canonical form; `printTiming(parseTiming(s).value)` gives back a canonical `s`. */
export function printTiming(t: Timing): string {
 switch (t.kind) {
  case 'duration': return quantity(t.duration);
  case 'anchor': return `${t.concept} ${quantity(t.at)}`;
  case 'after event': return `${quantity(t.duration)} after the ${which(t.which)} ${t.event}`;
  case 'at event': return `at the ${which(t.which)} ${t.event}`;
  case 'calendar day': return `day ${t.day} after the ${which(t.which)} ${t.event}`;
  case 'frequency': return `${t.count} per ${t.per}`;
  case 'once': return 'once';
  case 'for': case 'over': return `${t.kind} ${quantity(t.duration)}`;
  case 'time of day': return t.words;
  case 'every': return `every ${t.intervalMax ? `${t.interval.value}–${quantity(t.intervalMax)}` : quantity(t.interval)}${t.times === undefined ? '' : ` ×${t.times}`}${t.until ? ` until ${printCondition(t.until)}` : ''}`;
  case 'range': return `${t.from.value}–${t.to.value} ${t.to.unit}${t.event ? ` after the ${which(t.which!)} ${t.event}` : ''}`;
  case 'within': return `within ${quantity(t.duration)}${t.event ? ` after the ${which(t.which!)} ${t.event}` : ''}`;
  case 'before event': return `${t.duration ? `${quantity(t.duration)} ` : ''}before the ${which(t.which)} ${t.event}`;
  case 'each': return `at each ${t.event}`;
  case 'band': return `${quantity(t.gap)} while ${printCondition(t.while)}`;
  case 'later of': return `the later of ${printTiming(t.of[0])} and ${printTiming(t.of[1])}`;
  case 'strictly after': return `after ${printTiming(t.timing)}`;
  case 'list': return t.items.map(printTiming).join('; ');
 }
}

/** The events, quantities and conditions a timing names, for checks that look inside it (a number printed in its words, an event declared). */
export function timingParts(t: Timing): { events: string[]; quantities: Quantity[]; conditions: Expr[]; counts: (number | {frequency:number; per:string})[] } {
 const out = { events: [] as string[], quantities: [] as Quantity[], conditions: [] as Expr[], counts: [] as (number | {frequency:number; per:string})[] };
 const walk = (t: Timing): void => {
  switch (t.kind) {
   case 'duration': out.quantities.push(t.duration); break;
   case 'anchor': out.events.push(t.concept); out.quantities.push(t.at); break;
   case 'after event': case 'before event': if (t.duration) out.quantities.push(t.duration); out.events.push(t.event); break;
   case 'at event': case 'each': out.events.push(t.event); break;
   case 'calendar day': out.events.push(t.event); out.counts.push(t.day); break;
   case 'frequency': out.counts.push({frequency:t.count, per:t.per}); break;
   case 'once': break;
   case 'for': case 'over': out.quantities.push(t.duration); break;
   case 'time of day': break;
   case 'every': if (t.times !== undefined) out.counts.push(t.times); out.quantities.push(t.interval); if (t.intervalMax) out.quantities.push(t.intervalMax); if (t.until) out.conditions.push(t.until); break;
   case 'range': out.quantities.push(t.from, t.to); if (t.event) out.events.push(t.event); break;
   case 'within': out.quantities.push(t.duration); if (t.event) out.events.push(t.event); break;
   case 'band': out.quantities.push(t.gap); out.conditions.push(t.while); break;
   case 'later of': t.of.forEach(walk); break;
   case 'strictly after': walk(t.timing); break;
   case 'list': t.items.forEach(walk); break;
  }
 };
 walk(t);
 return out;
}
