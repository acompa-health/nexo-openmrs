/**
 * What the rules read. For every table input, follow its binding through the catalog's object contracts and record
 * which object fields it reads. For the tables that hear a form's completion, also record the conditions under
 * which a rule can read each input ("gates"), so a form can hide a field that no rule can read.
 */
import { parseCondition, type Expr } from '../../../../core/logic/index.ts';
import { objectTarget, type FieldDecl, type NexoType, type ProtocolModel, type Table, type Workflow } from './model.ts';

export interface FieldRead { object: string; field: string; table: string; input: string; binding: string; required?: string }

/** A test on one form question that a rule needs, as a set of allowed values (or forbidden ones). */
export interface Gate { input: string; values: string[]; negate: boolean; fromOr?: boolean }
/** One way a rule can come to read an input: all its gates hold. An empty list means always. */
export type Occurrence = Gate[];

const ROOT_EVENT_RESULT = 'event.payload.result.';
const ROOT_EVENT_PAYLOAD = 'event.payload.';

/** Resolve a dotted binding to the object fields it passes through. */
export function resolveBinding(model: ProtocolModel, table: Table, workflow: Workflow | undefined, binding: string): { object: string; field: string; type: NexoType }[] {
  const out: { object: string; field: string; type: NexoType }[] = [];
  let type: NexoType | undefined, rest: string[] = [];
  const templates = table.on.work ? model.handleTemplates(table.on.work) : [];
  const fixed = /^event\.payload\.(fixed|collected)\.([^.]+)\.?(.*)$/.exec(binding);
  if (fixed) {
    // A decision request carries values its requester fixed; the workflow input of the same name declares the type.
    type = workflow?.inputs?.[fixed[2]]?.type; rest = fixed[3] ? fixed[3].split('.') : [];
  } else if (binding.startsWith(ROOT_EVENT_RESULT)) {
    const [name, ...more] = binding.slice(ROOT_EVENT_RESULT.length).split('.');
    type = templates.map(t => t.result?.[name]?.type).find(Boolean); rest = more;
  } else if (binding.startsWith(ROOT_EVENT_PAYLOAD)) {
    const [name, ...more] = binding.slice(ROOT_EVENT_PAYLOAD.length).split('.');
    type = model.events[table.on.event]?.payload?.[name]?.type; rest = more;
  } else {
    const [head, second, ...more] = binding.split('.');
    if (second === 'content' && model.handles.has(head) && more.length) {
      const [name, ...after] = more;
      type = model.handleTemplates(head).map(t => t.content?.[name]?.type).find(Boolean); rest = after;
    } else {
      const decl = workflow?.inputs?.[head] ?? table.inputs?.[head];
      type = decl?.type; rest = [second, ...more].filter(x => x !== undefined) as string[];
    }
  }
  for (const segment of rest) {
    const object = objectTarget(type);
    if (!object) break;
    const decl: FieldDecl | undefined = model.objects[object]?.fields?.[segment];
    if (!decl) break;
    out.push({ object, field: segment, type: decl.type });
    type = decl.type;
  }
  return out;
}

/** Every object field that some table input reads. */
export function fieldReads(model: ProtocolModel): FieldRead[] {
  const reads: FieldRead[] = [];
  for (const { table, workflow } of model.tables()) {
    for (const [input, decl] of Object.entries(table.inputs ?? {})) {
      if (typeof decl.binding !== 'string') continue;
      for (const step of resolveBinding(model, table, workflow, decl.binding))
        reads.push({ object: step.object, field: step.field, table: table.id, input, binding: decl.binding, required: decl.required });
    }
  }
  return reads;
}

/** The names a condition mentions, through workflow calculations. */
export function namesIn(e: Expr, calcs: Record<string, any>, seen = new Set<string>()): string[] {
  const out: string[] = [];
  const visit = (x: Expr) => {
    switch (x.kind) {
      case 'name': {
        out.push(x.name);
        const calc = calcs[x.name];
        if (calc && !seen.has(x.name)) { seen.add(x.name); out.push(...calcNames(calc, calcs, seen)); }
        break;
      }
      case 'compare': visit(x.left); visit(x.right); break;
      case 'and': case 'or': case 'call': x.args.forEach(visit); break;
      case 'not': visit(x.arg); break;
    }
  };
  visit(e);
  return out;
}

function calcNames(calc: any, calcs: Record<string, any>, seen: Set<string>): string[] {
  const out: string[] = [];
  if (typeof calc?.when === 'string') { const p = parseCondition(calc.when); if (p.ok) out.push(...namesIn(p.value, calcs, seen)); }
  const visit = (n: unknown) => {
    if (Array.isArray(n)) n.forEach(visit);
    else if (n && typeof n === 'object') for (const [k, v] of Object.entries(n)) {
      if (k === 'input' && typeof v === 'string') { out.push(v); if (calcs[v] && !seen.has(v)) { seen.add(v); out.push(...calcNames(calcs[v], calcs, seen)); } }
      else visit(v);
    }
  };
  visit(calc?.elapsed ?? calc?.lookup ?? (calc?.when ? undefined : calc));
  return out;
}

/** A comparison of a form input with listed words, as a gate. */
function asGate(e: Expr, formInputs: Set<string>): Gate | undefined {
  if (e.kind === 'compare' && (e.op === '==' || e.op === '!=') && e.left.kind === 'name' && formInputs.has(e.left.name) && e.right.kind === 'word')
    return { input: e.left.name, values: [e.right.value], negate: e.op === '!=' };
  if (e.kind === 'or') {
    const gates = e.args.map(a => asGate(a, formInputs));
    if (gates.every(g => g && !g.negate && g.input === gates[0]!.input)) return { input: gates[0]!.input, values: gates.flatMap(g => g!.values), negate: false };
  }
  return undefined;
}


/**
 * For each input of `table`, the ways its rules can read it. Within an `and`, a sibling test on another form input
 * must hold for the rule to read it.
 */
export function readOccurrences(table: Table, workflow: Workflow | undefined, formInputs: Set<string>): Map<string, Occurrence[]> {
  const calcs = { ...(workflow?.calculations ?? {}), ...(table.calculations ?? {}) };
  const out = new Map<string, Occurrence[]>();
  const add = (name: string, gates: Gate[]) => {
    if (!out.has(name)) out.set(name, []);
    out.get(name)!.push(gates.filter(g => g.input !== name));
  };
  const visit = (e: Expr, gates: Gate[]) => {
    if (e.kind === 'and' || e.kind === 'or') {
      const own = e.args.map(a => asGate(a, formInputs));
      e.args.forEach((arg, i) => {
        // An `and` sibling must hold. An `or` sibling that already decides the result must fail; the compiler uses
        // such gates only for detail fields (amounts, dates, text), never to hide a finding.
        const siblings = own.flatMap((g, j) => (j === i || !g ? [] : [e.kind === 'and' ? g : { ...g, negate: !g.negate, fromOr: true }]));
        visit(arg, [...gates, ...siblings]);
      });
      return;
    }
    for (const name of namesIn(e, calcs)) add(name, gates);
  };
  for (const rule of table.rules) {
    const parsed = parseCondition(rule.when);
    if (!parsed.ok) continue;
    visit(parsed.value, []);
    const ruleGates = topGates(parsed.value, formInputs);
    for (const effect of rule.effects ?? []) {
      if (typeof effect?.when !== 'string') continue;
      const p = parseCondition(effect.when);
      if (p.ok) visit(p.value, ruleGates);
    }
  }
  return out;
}

function topGates(e: Expr, formInputs: Set<string>): Gate[] {
  if (e.kind === 'and') return e.args.flatMap(a => { const g = asGate(a, formInputs); return g ? [g] : []; });
  const g = asGate(e, formInputs);
  return g ? [g] : [];
}

/** True when some occurrence needs no gate: the input can be read whatever else the form says. */
export const alwaysRead = (occ: Occurrence[] | undefined) => !!occ?.some(o => o.length === 0);
