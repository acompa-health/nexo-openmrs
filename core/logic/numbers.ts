import vocabulary from '../vocabulary/words.json' with { type: 'json' };
export interface NumberToken {
 value: number; text: string; start: number; end: number;
 unit?: string; comparator?: '<' | '<=' | '>' | '>=' | '=';
 range?: [number, number]; decimal?: '.' | ',' | '·'; power?: number; flattened?: boolean;
}
const synonyms = vocabulary.unitSynonyms.map(({ pattern, unit }) => [new RegExp(pattern, 'i'), unit] as const);
const words = vocabulary.numberWords as Record<string, number>;
const superscripts = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const fractions: Record<string, number> = { '½': 0.5, '¼': 0.25, '¾': 0.75 };
const numericContent = new RegExp(String.raw`[0-9${Object.keys(fractions).join('')}]|\b(?:${Object.keys(words).join('|')})\b`, 'iu');
const number = String.raw`(?:[1-9]\d{0,2}(?:,\d{3})+(?!\d)|\d+(?:[.,·]\d+)?|[.,]\d+)`;
// Integer scalar fractions need explicit non-pressure units; labels, decimal pairs and slash lists keep their convention.
const scalarUnits = synonyms.filter(([, unit]) => unit !== 'mm[Hg]').map(([re]) => re.source.slice(1)).join('|');
const dayUnits = synonyms.filter(([, unit]) => unit === 'd').map(([re]) => re.source.slice(1)).join('|');
// A day label starts a line, table cell or slash-separated heading; sentence dosing stays scalar.
const fraction = String.raw`(?<!(?:^|[\r\n|/])[\t ]*(?:${dayUnits})\s+)(?<!/\s*)(?:\d+\s+)?\d+\s*/\s*\d+(?=\s*(?:${scalarUnits}))`;
const pattern = new RegExp(String.raw`[+−-]?(?:${fraction}|(?:\d+\s*)?[½¼¾]|${number}(?:\s*[×x]\s*10\s*\d+(?=\s*/\s*[\p{L}])|[⁰¹²³⁴⁵⁶⁷⁸⁹]+)?)|\b(?:${Object.keys(words).join('|')})\b`, 'giu');
/** Numeric spans retain their original offsets; separators, signs and powers never disappear. */
export function numberTokens(text: string): NumberToken[] {
 if (!numericContent.test(text)) return [];
 const out: NumberToken[] = [];
 const inherited = new Set<NumberToken>();
 for (const m of text.matchAll(pattern)) {
  let start = m.index, raw = m[0];
  const before = text.slice(0, start);
  if (/[A-WYZa-wyz_]$|[A-Za-z_]\.$|\d\.$/.test(before)) continue;
  if (raw.startsWith('-') && /\d\s*$/.test(before)) { start++; raw = raw.slice(1); }
  const end = start + raw.length;
  const powerText = /[⁰¹²³⁴⁵⁶⁷⁸⁹]+$/.exec(raw)?.[0];
  const flat = /\s*[×x]\s*10\s*(\d+)$/.exec(raw);
  const base = raw.slice(0, powerText ? -powerText.length : flat ? flat.index : undefined);
  const decimal = /[.,·]/.exec(base)?.[0];
  const thousands = /^[-+−]?[1-9]\d{0,2}(?:,\d{3})+$/.test(base);
  const mixed = /^([+−-]?)(\d*)\s*([½¼¾])$/.exec(base);
  const slash = /^([+−-]?)(?:(\d+)\s+)?(\d+)\s*\/\s*(\d+)$/.exec(base);
  if (slash && Number(slash[4]) === 0) throw new Error(`Cannot read fraction "${raw}": denominator must be positive.`);
  const value = mixed ? (mixed[1] === '-' || mixed[1] === '−' ? -1 : 1) * (Number(mixed[2]) + fractions[mixed[3]])
   : slash ? (slash[1] === '-' || slash[1] === '−' ? -1 : 1) * (Number(slash[2] ?? 0) + Number(slash[3]) / Number(slash[4]))
   : words[base.toLowerCase()] ?? Number(base.replace('−', '-').replace(thousands ? /,/g : /[,·]/g, thousands ? '' : '.'));
  if (!Number.isFinite(value)) continue;
  const power = powerText ? Number([...powerText].map(c => superscripts.indexOf(c)).join('')) : flat ? Number(flat[1]) : undefined;
  const token: NumberToken = { value: power === undefined ? value : (powerText ? value ** power : value * 10 ** power), text: raw, start, end };
  const suffix = text.slice(end).trimStart();
  const synonym = synonyms.find(([re]) => re.test(suffix));
  const unit = synonym?.[1]; if (unit) token.unit = unit;
  const afterUnit = synonym ? suffix.slice(synonym[0].exec(suffix)![0].length) : text.slice(end);
  if (decimal && !thousands) token.decimal = decimal as NumberToken['decimal'];
  if (power !== undefined) token.power = power;
  if (flat) token.flattened = true;
  const sign = /(<=|>=|[<>≤≥=])\s*$/.exec(text.slice(0, start))?.[1];
  if (sign) token.comparator = ({ '≤': '<=', '≥': '>=' }[sign] ?? sign) as NumberToken['comparator'];
  else for (const c of vocabulary.comparators) {
   if (('before' in c && new RegExp(c.before!, 'i').test(text.slice(0, start))) || ('after' in c && new RegExp(c.after!, 'i').test(afterUnit))) { token.comparator = c.op as NumberToken['comparator']; break; }
  }
  out.push(token);
 }
 for (let i = 0; i + 1 < out.length; i++) {
  const a = out[i], b = out[i + 1];
  const between = text.slice(a.end, b.start).trimStart().replace(synonyms.find(([re]) => re.test(text.slice(a.end, b.start).trimStart()))?.[0] ?? /$^/, '').trim();
  if (/^(?:[-–—]|to|up to)\s*<?$/i.test(between)) {
   a.range = [a.value, b.value]; if (!a.unit) a.unit = b.unit;
   if (inherited.has(a) && out[i - 2]?.range?.[1] === out[i - 1]?.value) a.comparator = '>=';
   a.comparator ??= '>='; b.comparator ??= /up to|</i.test(between) ? '<' : '<=';
  } else if (/^\s*\/\s*$/.test(between) && !a.unit) {
   if (b.unit && b.unit !== 'mm[Hg]' && /^[−-]/.test(b.text)) throw new Error(`Cannot read scalar fraction "${text.slice(a.start, b.end)}": slash notation is ambiguous.`);
   a.unit = b.unit; if (a.comparator && !b.comparator) { b.comparator = a.comparator; inherited.add(b); }
  }
 }
 for (let i = 0; i + 2 < out.length; i++) if (!out[i].unit && /^\s*\(\s*$/.test(text.slice(out[i].end, out[i + 1].start)) && out[i + 1].range && /^\s*\)/.test(text.slice(out[i + 2].end))) out[i].unit = out[i + 2].unit;
 return out;
}
