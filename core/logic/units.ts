/** A number with its UCUM unit, as printed: `{ value: 11, unit: 'g/dL' }`. */
export interface Quantity { value: number; unit: string }

/**
 * The UCUM subset the snippets use. Within a dimension each unit is a whole multiple of the smallest one,
 * so conversions are exact. A calendar month is not a fixed number of days: `mo` and `a` form their own
 * dimension, convertible with each other (1 a = 12 mo) but never with `d` or `wk`.
 */
const units: Record<string, { dimension: string; factor: number }> = {};
const define = (dimension: string, factors: Record<string, number>) => { for (const [unit, factor] of Object.entries(factors)) units[unit] = { dimension, factor }; };
define('mass', { ug: 1, 'µg': 1, 'μg': 1, mcg: 1, mg: 1e3, g: 1e6, kg: 1e9 });
define('length', { mm: 1, cm: 10, m: 1000 });
define('time', { s: 1, min: 60, h: 3600, d: 86400, wk: 604800 });
define('calendar time', { mo: 1, a: 12 });
define('mass concentration', { 'mg/dL': 1, 'g/L': 100, 'g/dL': 1000 });
define('substance concentration', { 'umol/L': 1, 'µmol/L': 1, 'mmol/L': 1000 });
define('number concentration', { '/mL': 1, '{copies}/mL': 1 });
define('pressure', { 'mm[Hg]': 1, mmHg: 1 });
define('temperature', { Cel: 1 });
define('rate', { '/wk': 1, '/d': 7, '/h': 168, '/min': 10080, '/s': 604800 });
// A dose per kilogram of body weight. Kept apart from mass ratios such as a urine mg/g.
define('dose per body weight', { 'ug/kg': 1, 'mg/kg': 1e3, 'g/kg': 1e6 });
define('percent', { '%': 1 });
define('tablets', { '{tbl}': 1, '{tablet}': 1 });
define('count', { '1': 1 });
define('flow', { 'mL/min': 1, 'L/min': 1000 });
define('filtration rate', { 'mL/min/{1.73_m2}': 1, 'mL/min/1.73m2': 1 });
define('equivalent concentration', { 'meq/L': 1, 'mmol/L{eq}': 1 });
define('mass ratio', { 'mg/g': 1 });
define('mass per substance', { 'mg/mmol': 1 });
define('activity per week', { 'min/wk': 1, 'h/wk': 60 });
define('international units', { IU: 1, '[iU]': 1 });
define('body mass index', { 'kg/m2': 1 });

// Any other UCUM annotation, `{copies}` or `{puffs}`, counts things of that kind: comparable only with itself.
const lookup = (unit: string) => Object.hasOwn(units, unit) ? units[unit] : /^\{[^{}]+\}$/.test(unit) ? { dimension: `count of ${unit}`, factor: 1 } : undefined;

/** The dimension a unit measures (`mass`, `time`, `calendar time`, …), or undefined for a unit outside the subset. */
export function unitDimension(unit: string): string | undefined {
 return lookup(unit)?.dimension;
}

// Twelve significant digits absorb binary rounding (2.01 kg is 2010000000 µg, not 2009999999.9999998).
const tidy = (n: number) => Number(n.toPrecision(12));

/** Convert a value between two units of one dimension; throws when they measure different things. */
export function convert(value: number, from: string, to: string): number {
 const a = lookup(from), b = lookup(to);
 if (!a) throw new Error(`Unknown unit '${from}'.`);
 if (!b) throw new Error(`Unknown unit '${to}'.`);
 if (a.dimension !== b.dimension) {
  const calendar = [a.dimension, b.dimension].includes('calendar time') && [a.dimension, b.dimension].includes('time');
  throw new Error(calendar ? `Cannot convert ${from} to ${to}: a month or year is a calendar unit, not a fixed number of days. Compare months and years with mo or a.`
   : `Cannot compare ${from} with ${to}: ${a.dimension} and ${b.dimension} are different things.`);
 }
 return tidy(value * a.factor / b.factor);
}

/** -1, 0 or 1 as `a` is less than, equal to or greater than `b`, after converting `a` into `b`'s unit. */
export function compareQuantities(a: Quantity, b: Quantity): -1 | 0 | 1 {
 const left = convert(a.value, a.unit, b.unit), right = tidy(b.value);
 return left < right ? -1 : left > right ? 1 : 0;
}
