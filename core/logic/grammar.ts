import { unitDimension } from './units.ts';

export type CompareOp = '==' | '!=' | '<' | '<=' | '>' | '>=';
/**
 * A parsed condition. `at` is the node's 0-based offset in the text it came from.
 * A `name` is a concept (`danger.convulsions`); a `word` is a bare value (`yes`, `red`, `not_better`).
 */
export type Expr =
 | { kind: 'name'; name: string; at: number }
 | { kind: 'number'; value: number; unit?: string; at: number }
 | { kind: 'string'; value: string; at: number }
 | { kind: 'word'; value: string; at: number }
 | { kind: 'boolean'; value: boolean; at: number }
 | { kind: 'compare'; op: CompareOp; left: Expr; right: Expr; at: number }
 | { kind: 'and' | 'or'; args: Expr[]; at: number }
 | { kind: 'not'; arg: Expr; at: number }
 | { kind: 'call'; fn: string; args: Expr[]; at: number };

export interface LogicError { at: number; message: string }
export type Parsed<T> = { ok: true; value: T } | { ok: false; error: LogicError };
/** What the registry declares about a concept: its UCUM unit and its listed values. */
export interface Concept { unit?: string; values?: readonly string[]; ordered?: boolean }
export type Concepts = Readonly<Record<string, Concept>>;
/**
 * `definition`: the text defines a derived concept, so the history functions are allowed.
 * `concepts`: lets a bare word on the right of a comparison be read as a concept rather than a value.
 */
export interface ParseOptions { definition?: boolean; concepts?: Concepts }
/** A table input column: the concept it tests and the unit its header prints (`weight (kg)`). */
export interface Column { concept: string; unit?: string }

/** Functions whose result is true or false; the rest return a value to compare. */
const truthFunctions = new Set(['known', 'unknown', 'any_unknown', 'any', 'all', 'includes', 'consecutive', 'on', 'apart']);
/** Functions that look back over the record: only in a derived concept's definition. */
export const historyFunctions: ReadonlySet<string> = new Set(['since', 'count', 'consecutive', 'on', 'apart', 'previous', 'latest', 'mean']);
const functions = new Set([...truthFunctions, ...historyFunctions]);
const keywords = new Set(['and', 'or', 'not']);
const ops: Record<string, CompareOp> = { '==': '==', '!=': '!=', '<=': '<=', '>=': '>=', '<': '<', '>': '>', '≥': '>=', '≤': '<=', '≠': '!=' };

type Token = { at: number; end?: number } & (
 | { k: 'number'; value: number; unit?: string } | { k: 'word'; value: string } | { k: 'string'; value: string }
 | { k: 'op'; value: CompareOp } | { k: 'punct'; value: '(' | ')' | ',' });

class Failure extends Error { at: number; constructor(at: number, message: string) { super(message); this.at = at; } }
/** Stop a parse with an error at `at`; `attempt` turns it into a `Parsed` error. */
export function fail(at: number, message: string): never { throw new Failure(at, message); }
/** Run a parser, turning its failure into a `Parsed` error. */
export function attempt<T>(parse: () => T): Parsed<T> {
 try { return { ok: true, value: parse() }; }
 catch (e) { if (e instanceof Failure) return { ok: false, error: { at: e.at, message: e.message } }; throw e; }
}
/** Re-raise a nested parse error at its place in the enclosing text. */
export function failAt(offset: number, error: LogicError): never { return fail(offset + error.at, error.message); }

function lex(text: string): Token[] {
 const tokens: Token[] = [];
 for (let i = 0, made = 0; i < text.length;) {
  // Each token made by the last pass ends where that pass stopped.
  for (let k = made; k < tokens.length; k++) tokens[k].end = i;
  made = tokens.length;
  const rest = text.slice(i);
  let m: RegExpExecArray | null;
  if (/^\s/.test(rest)) { i++; continue; }
  if ((m = /^-?(?:\d+(?:\.\d+)?|\.\d+)/.exec(rest))) {
   const at = i; i += m[0].length;
   // A unit follows its number; `and`/`or` after a number are not units.
   const u = /^\s*([^\s(),;<>=!≥≤≠"']+)/.exec(text.slice(i));
   let unit: string | undefined;
   if (u && unitDimension(u[1])) { unit = u[1]; i += u[0].length; }
   else if (u && !keywords.has(u[1])) fail(i + u[0].length - u[1].length, `Unknown unit '${u[1]}'. Write a UCUM unit, such as a, mo, wk, d, h, min, kg, g/dL, mmol/L, mmHg, Cel, /min or %.`);
   tokens.push({ k: 'number', value: Number(m[0]), ...(unit ? { unit } : {}), at });
  } else if ((m = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/.exec(rest))) {
   if (/[A-Z]/.test(m[0])) fail(i, `'${m[0]}' has capital letters; names and values are lower case.`);
   tokens.push({ k: 'word', value: m[0], at: i }); i += m[0].length;
  } else if (rest[0] === '"' || rest[0] === "'") {
   const end = text.indexOf(rest[0], i + 1);
   if (end < 0) fail(i, 'This quote is never closed.');
   tokens.push({ k: 'string', value: text.slice(i + 1, end), at: i }); i = end + 1;
  } else if (Object.hasOwn(ops, rest.slice(0, 2)) || Object.hasOwn(ops, rest[0])) {
   const op = Object.hasOwn(ops, rest.slice(0, 2)) ? rest.slice(0, 2) : rest[0];
   tokens.push({ k: 'op', value: ops[op], at: i }); i += op.length;
  } else if (rest[0] === '(' || rest[0] === ')' || rest[0] === ',') {
   tokens.push({ k: 'punct', value: rest[0], at: i }); i++;
  } else if (rest[0] === '=') fail(i, 'Write == to test equality.');
  else fail(i, `Unexpected '${rest[0]}'.`);
 }
 for (const t of tokens) t.end ??= text.length;
 return tokens;
}

/** One lexical piece of a condition, for display: `text.slice(at, end)` is exactly what the author wrote. */
export interface ConditionToken { at: number; end: number; kind: 'number' | 'word' | 'string' | 'op' | 'punct' }
/** The core lexer's pieces of a condition, in order. Undefined when the text does not lex (a bad unit, a stray character). */
export function conditionTokens(text: string): ConditionToken[] | undefined {
 const r = attempt(() => lex(text));
 return r.ok ? r.value.map(t => ({ at: t.at, end: t.end!, kind: t.k })) : undefined;
}

const show = (t: Token) => t.k === 'number' ? `${t.value}${t.unit ? ` ${t.unit}` : ''}` : t.k === 'string' ? `"${t.value}"` : t.value;
const describe = (e: Expr) => `'${printCondition(e)}'`;
const isTruth = (e: Expr) => e.kind === 'call' ? truthFunctions.has(e.fn) : ['name', 'boolean', 'compare', 'and', 'or', 'not'].includes(e.kind);
const isValue = (e: Expr) => e.kind === 'call' ? !truthFunctions.has(e.fn) : ['name', 'number', 'string', 'word', 'boolean'].includes(e.kind);
const truth = (e: Expr) => { if (!isTruth(e)) fail(e.at, `${describe(e)} is a value, not a condition.`); };
const value = (e: Expr) => { if (!isValue(e)) fail(e.at, `${describe(e)} is a condition; a comparison needs a value on each side.`); };

/** Recursive descent over the tokens. With a `column`, each test has the column as its implicit left side. */
function parser(text: string, options: ParseOptions, column?: Column, valueMode = false) {
 const tokens = lex(text);
 let p = 0, callDepth = 0;
 const named = (name: string, at: number): Expr & { kind: 'name' } => {
  if (options.concepts?.[name]?.values?.some(v => typeof v !== 'string' || (v.trim() !== '' && Number.isFinite(Number(v)))))
   fail(at, `${name} has numeric listed values. Use named values such as stage_1, or unit 1 for a count.`);
  return { kind: 'name', name, at };
 };
 const compare = (left: Expr, op: CompareOp, right: Expr, at: number): Expr => {
  for (const [subject, other] of [[left, right], [right, left]]) {
   if (subject.kind === 'name' && other.kind === 'number' && options.concepts?.[subject.name]?.values)
    fail(other.at, `${subject.name} takes listed values (${options.concepts[subject.name].values!.join(', ')}), not a number. Use its declared name.`);
  }
  return { kind: 'compare', op, left, right, at };
 };
 const peek = (): Token | undefined => tokens[p];
 const isWord = (t: Token | undefined, w: string) => t?.k === 'word' && t.value === w;
 const isPunct = (t: Token | undefined, v: string) => t?.k === 'punct' && t.value === v;
 const close = (opened: number) => {
  const t = peek();
  if (!t) fail(opened, 'This bracket is never closed.');
  if (!isPunct(t, ')')) fail(t.at, `Expected ')' to close the bracket at ${opened}, found '${show(t)}'.`);
  p++;
 };
 const junction = (): Expr => {
  const first = unary(), args = [first];
  let op: 'and' | 'or' | undefined;
  for (let t = peek(); t?.k === 'word' && (t.value === 'and' || t.value === 'or'); t = peek()) {
   if (op && t.value !== op) fail(t.at, `'and' and 'or' are mixed without brackets. Bracket the part that goes together, as in (a and b) or c.`);
   op = t.value as 'and' | 'or'; p++; args.push(unary());
  }
  if (!op) return first;
  args.forEach(truth);
  return { kind: op, args, at: first.at };
 };
 const unary = (): Expr => {
  const t = peek();
  if (t && isWord(t, 'not')) { p++; const arg = unary(); truth(arg); return { kind: 'not', arg, at: t.at }; }
  return column ? test(column) : comparison();
 };
 const comparison = (): Expr => {
  const left = operand('left'), t = peek();
  if (t?.k !== 'op') return left;
  p++; value(left);
  let right = operand('right');
  // A declared listed value is literal even when another concept has that name.
  if (left.kind === 'name' && right.kind === 'name' && options.concepts?.[left.name]?.values?.includes(right.name))
   right = { kind: 'word', value: right.name, at: right.at };
  value(right);
  const more = peek();
  if (more?.k === 'op') fail(more.at, 'Comparisons cannot be chained. Join them with and, as in x > 1 and x < 5.');
  return compare(left, t.value, right, left.at);
 };
 // A table cell: `< 110 g/L`, `yes` (equality), `known`/`unknown`, or a bracketed group of tests.
 const test = (column: Column): Expr => {
  const t = peek(), subject = named(column.concept, t?.at ?? 0);
  if (t?.k === 'op') { p++; const right = operand('right'); value(right); return compare(subject, t.value, right, t.at); }
  if (isPunct(t, '(')) return operand('right');
  if (t?.k === 'word' && (t.value === 'known' || t.value === 'unknown') && !isPunct(tokens[p + 1], '(')) { p++; return { kind: 'call', fn: t.value, args: [subject], at: t.at }; }
  const right = operand('right'); value(right);
  return compare(subject, '==', right, right.at);
 };
 const operand = (side: 'left' | 'right'): Expr => {
  const t = tokens[p++];
  if (!t) return fail(text.length, 'The condition ends too early.');
  switch (t.k) {
   case 'number': { const unit = t.unit ?? column?.unit; return { kind: 'number', value: t.value, ...(unit ? { unit } : {}), at: t.at }; }
   case 'string': return { kind: 'string', value: t.value, at: t.at };
   case 'op': return fail(t.at, `Expected a value before '${t.value}'.`);
   case 'punct': {
    if (t.value !== '(') return fail(t.at, `Expected a value before '${t.value}'.`);
    const e = junction(); close(t.at); return e;
   }
   case 'word': {
    const w = t.value;
    if (w === 'true' || w === 'false') return { kind: 'boolean', value: w === 'true', at: t.at };
    if (keywords.has(w)) return fail(t.at, `Expected a value before '${w}'.`);
    if (isPunct(peek(), '(')) return call(w, t.at);
    if (w === 'yes' || w === 'no') return { kind: 'word', value: w, at: t.at };
    // A dotted word is always a concept. Otherwise a word is a concept on the left (or standing alone)
    // and a value on the right, unless the registry declares it as a concept. In a cell it is a value.
    const concept = w.includes('.') || (!column && (!valueMode || callDepth > 0) && (side === 'left' || (options.concepts !== undefined && Object.hasOwn(options.concepts, w))));
    return concept ? named(w, t.at) : { kind: 'word', value: w, at: t.at };
   }
  }
 };
 const call = (fn: string, at: number): Expr => {
  if (column) return fail(at, 'A cell holds tests on its column, not functions. Use a when column for this condition.');
  if (!functions.has(fn) && !(valueMode && fn === 'next')) return fail(at, `Unknown function '${fn}'. The functions are ${[...functions].join(', ')}.`);
  if (historyFunctions.has(fn) && !options.definition && !(valueMode && fn === 'previous')) return fail(at, `${fn}() looks back over the record, so it belongs only in the definition of a derived concept, never in a rule, a cell or an If clause.`);
  const open = tokens[p++].at, args: Expr[] = [];
  callDepth++;
  if (!isPunct(peek(), ')')) for (;;) { args.push(junction()); if (!isPunct(peek(), ',')) break; p++; }
  close(open);
  callDepth--;
  // includes(list, member): the member is a literal of the list's item domain, even when it also names an input.
  if (fn === 'includes' && args[1]?.kind === 'name') args[1] = { kind: 'word', value: args[1].name, at: args[1].at };
  checkCall(fn, args, at);
  return { kind: 'call', fn, args, at };
 };
 const end = () => {
  const t = peek();
  if (t) fail(t.at, isPunct(t, ')') ? "This ')' has no matching '('." : `Unexpected '${show(t)}'. Join conditions with and or or.`);
 };
 return { junction, end };
}

function checkCall(fn: string, args: Expr[], at: number) {
 const arity = (n: number) => { if (args.length !== n) fail(at, `${fn}() takes ${n === 1 ? 'one argument' : `${n} arguments`}.`); };
 const name = (a: Expr) => { if (a.kind !== 'name') fail(a.at, `${fn}() takes concept names, not ${describe(a)}.`); };
 const count = (a: Expr) => { if (a.kind !== 'number' || a.unit || !Number.isInteger(a.value) || a.value < 1) fail(a.at, `${fn}() needs a whole number of 1 or more here, not ${describe(a)}.`); };
 switch (fn) {
  case 'known': case 'unknown': case 'previous': case 'next': arity(1); name(args[0]); break;
  case 'any': case 'all': case 'any_unknown': if (!args.length) fail(at, `${fn}() needs at least one concept.`); args.forEach(name); break;
  case 'includes': arity(2); name(args[0]);
   if (!['word', 'string', 'boolean'].includes(args[1].kind) && !(args[1].kind === 'number' && !args[1].unit))
    fail(args[1].at, `includes() takes a list and one literal member, as in includes(failure.unknown_inputs, pregnant), not ${describe(args[1])}.`); break;
  case 'count': arity(2); args.forEach(name); break;
  case 'since': arity(1); truth(args[0]); break;
  case 'consecutive': arity(2); count(args[0]); truth(args[1]); break;
  case 'on': arity(3); count(args[0]); truth(args[1]); name(args[2]); break;   // held at n different occurrences of an event (2 separate visits)
  case 'apart': arity(3); count(args[0]); truth(args[1]);                      // held at n recordings, each at least a duration after the one before
   if (args[2].kind !== 'number' || !args[2].unit || !Number.isFinite(args[2].value) || args[2].value < 0 || !['time', 'calendar time'].includes(unitDimension(args[2].unit) ?? ''))
    fail(args[2].at, 'apart() needs a finite nonnegative duration with its unit of time, as in 6 h.'); break;
  case 'latest': arity(2); name(args[0]); count(args[1]); break;
  case 'mean': arity(1); if (args[0].kind !== 'call' || args[0].fn !== 'latest') fail(args[0].at, 'mean() takes latest(<concept>, <n>).'); break;
 }
}

/**
 * Parse a condition: a rule's `when`, an `Applies to`, a tag's condition, a `when` column.
 * In definition mode the top level may also be a history value (`previous(htn.step)`).
 */
export function parseCondition(text: string, options: ParseOptions = {}): Parsed<Expr> {
 return attempt(() => {
  if (!text.trim()) fail(0, 'The condition is empty.');
  const p = parser(text, options), e = p.junction();
  p.end();
  if (!(options.definition && e.kind === 'call' && historyFunctions.has(e.fn))) truth(e);
  return e;
 });
}

/** A value assigned by an output: a literal, concept, or next(c)/previous(c) ordered step. */
export function parseValue(text: string): Parsed<Expr> {
 return attempt(() => {
  if (!text.trim()) fail(0, 'The expression is empty.');
  const p = parser(text, {}, undefined, true), e = p.junction();
  p.end(); value(e);
  return e;
 });
}

/**
 * Parse a table cell as a test on its column: `< 110 g/L`, `>= 5 kg and < 15 kg`, `yes`, `red or yellow`.
 * A bare number takes the column's unit. A blank cell is `true` (any value, known or not); `unknown` is `unknown(column)`.
 */
export function parseCell(text: string, column: Column, options: ParseOptions = {}): Parsed<Expr> {
 return attempt(() => {
  if (column.unit && !unitDimension(column.unit)) fail(0, `Unknown unit '${column.unit}' in the ${column.concept} column.`);
  if (!text.trim()) return { kind: 'boolean', value: true, at: 0 } satisfies Expr;
  const p = parser(text, options, column), e = p.junction();
  p.end();
  return e;
 });
}

/** Print a condition in canonical form: ASCII operators, `and`/`or` inside each other bracketed. */
export function printCondition(e: Expr): string {
 switch (e.kind) {
  case 'name': return e.name;
  case 'number': return e.unit ? `${e.value} ${e.unit}` : String(e.value);
  case 'string': return e.value.includes('"') ? `'${e.value}'` : `"${e.value}"`;
  case 'word': return e.value;
  case 'boolean': return String(e.value);
  case 'compare': return `${printCondition(e.left)} ${e.op} ${printCondition(e.right)}`;
  case 'and': case 'or': return e.args.map(a => a.kind === 'and' || a.kind === 'or' ? `(${printCondition(a)})` : printCondition(a)).join(` ${e.kind} `);
  case 'not': return ['compare', 'and', 'or'].includes(e.arg.kind) ? `not (${printCondition(e.arg)})` : `not ${printCondition(e.arg)}`;
  case 'call': return `${e.fn}(${e.args.map(printCondition).join(', ')})`;
 }
}

/** The concept names a condition reads, in order of first use. */
export function conditionNames(e: Expr): string[] {
 const names = new Set<string>();
 const walk = (e: Expr): void => {
  if (e.kind === 'name') names.add(e.name);
  else if (e.kind === 'compare') { walk(e.left); walk(e.right); }
  else if (e.kind === 'not') walk(e.arg);
  else if (e.kind === 'and' || e.kind === 'or' || e.kind === 'call') e.args.forEach(walk);
 };
 walk(e);
 return [...names];
}
