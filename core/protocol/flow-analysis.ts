/** Bounded control-flow checks. Edges over-approximate guards, so an external wait is never a loop error. */
import { parseCondition } from '../logic/index.ts';
import { directSelfEmitLoops } from './analyze.ts';
import { outcomeKey } from './runtime/select.ts';
import type { InputDecl, StateDecl, Table, TableRule, ValueTemplate } from './types.ts';

export interface FlowSite {
 initial: string;
 inputs?: Readonly<Record<string, InputDecl>>;
 stateList: readonly StateDecl[];
 tables: readonly { table: Table; at: string }[];
}
export interface FlowAnalysis {
 unreachable: number[];
 loops: { at: string; states: string[]; tables: string[] }[];
 status: 'complete' | 'incomplete';
 limits?: string;
}
export const MAX_FLOW_STEPS = 50_000;
const literal = (text: string): boolean | undefined => {
 const p = parseCondition(text);
 return p.ok && p.value.kind === 'boolean' ? p.value.value : undefined;
};
const enabled = (r: TableRule, state: string) => r.in.includes(state) || r.in.includes('*');
const ownSubscription = (t: Table) => t.on.work === undefined && (t.on.for === undefined || t.on.for.binding === 'this_execution');
const literalValue = (v: unknown): unknown => v && typeof v === 'object' && 'value' in v ? (v as { value: unknown }).value : v;

/**
 * Reachability includes every possibly true edge, including shared fallback handlers. A reported state has no path
 * even in this generous graph. Internal cycles require one unconditional outcome and one self-addressed emit at each
 * step, with known effect values and no competing subscriber or external wait. Conditional, data-dependent and
 * child-start cycles remain unproved.
 */
export function analyzeFlow(site: FlowSite, maxSteps = MAX_FLOW_STEPS): FlowAnalysis {
 let steps = 0;
 const exhausted = new Error('flow budget');
 const tick = () => { if (++steps > maxSteps) throw exhausted; };
 try {
  const knownBindings = new Set(['this_execution']);
  for (const input of Object.values(site.inputs ?? {})) {
   tick();
   if (input.required === 'entry' && typeof input.binding === 'string' && input.binding.startsWith('entry.'))
    knownBindings.add(input.binding.slice('entry.'.length));
  }
  // Match resolveTemplate's literal escapes. Other reads can stop effect preflight, even for optional fields.
  const knownTemplate = (template: ValueTemplate): boolean => {
   const pending = [template];
   while (pending.length) {
    tick();
    const value = pending.pop()!;
    if (value === null || typeof value !== 'object') continue;
    if (Array.isArray(value)) {
     for (const item of value) { tick(); pending.push(item); }
     continue;
    }
    const map = value as Readonly<Record<string, ValueTemplate>>, keys = Object.keys(map);
    if (keys.length === 1) {
     if (keys[0] === 'value') continue;
     if (keys[0] === 'binding') {
      if (typeof map.binding !== 'string' || !knownBindings.has(map.binding)) return false;
      continue;
     }
     if (keys[0] === 'input' || keys[0] === 'effect') return false;
    }
    for (const key of keys) { tick(); pending.push(map[key]); }
   }
   return true;
  };
  const edges = new Map<string, Set<string>>(site.stateList.map(s => [s.id, new Set()]));
  for (const { table } of site.tables) for (const r of table.rules) {
   tick();
   if (!('state' in r.to) || literal(r.when) === false) continue;
   for (const state of site.stateList) {
    tick();
    if (enabled(r, state.id)) edges.get(state.id)!.add(r.to.state);
   }
  }
  const reached = new Set<string>(), queue = [site.initial];
  for (let i = 0; i < queue.length; i++) {
   tick();
   const state = queue[i];
   if (reached.has(state)) continue;
   reached.add(state);
   for (const next of edges.get(state) ?? []) { tick(); if (!reached.has(next)) queue.push(next); }
  }
  const unreachable = site.stateList.flatMap((s, i) => reached.has(s.id) ? [] : [i]);
  type Node = { state: string; table: number; rule: number; legacyCovered: boolean; next?: string };
  const nodes = new Map<string, Node>();
  const key = (state: string, table: number) => JSON.stringify([state, table]);
  for (const state of site.stateList) for (const [ti, { table }] of site.tables.entries()) {
   tick();
   if (!ownSubscription(table) || table.purpose === 'clinical_decision') continue;
   const rows = table.rules.map((r, ri) => ({ r, ri })).filter(({ r }) => { tick(); return enabled(r, state.id); });
   // A conditional escape or unresolved guard invalidates this proof, even when it looks unlikely.
   if (!rows.length || rows.some(({ r }) => literal(r.when) === undefined)) continue;
   const trueRows = rows.filter(({ r }) => literal(r.when) === true);
   const rank = table.hit === 'priority' ? Math.min(...trueRows.map(({ r }) => r.rank!)) : 1;
   const winners = trueRows.filter(({ r }) => table.hit !== 'priority' || r.rank === rank);
   if (!winners.length || winners.some(({ r }) => outcomeKey(r) !== outcomeKey(winners[0].r))) continue;
   const { r, ri } = winners[0];
   if ('end' in r.to || r.effects.length !== 1) continue;
   const emit = r.effects[0];
   if (emit.kind !== 'emit' || (emit.when !== undefined && literal(emit.when) !== true)) continue;
   // Runtime emit preflight defaults the target to this execution when activation is supplied.
   const selfTarget = emit.to === undefined ? emit.activation !== undefined
    : JSON.stringify(emit.to) === JSON.stringify({ binding: 'this_execution' });
   if (!selfTarget) continue;
   if (!knownTemplate(emit.fields) || (emit.for !== undefined && !knownTemplate(emit.for))) continue;
   const destination = 'state' in r.to ? r.to.state : state.id;
   // A state transition creates a new activation, even when the destination names the same state.
   if ('state' in r.to && emit.activation !== 'destination') continue;
   const candidates = site.tables.flatMap(({ table: next }, ni) => {
    tick();
    if (!ownSubscription(next) || next.on.event !== emit.event
     || (next.on.table !== undefined && next.on.table !== literalValue(emit.fields.table))) return [];
    return next.rules.some(row => { tick(); return enabled(row, destination); }) ? [ni] : [];
   });
   // Collapse identical enabled rows before calling the legacy helper, so its scan stays within this budget.
   const legacyCovered = 'stay' in r.to && rows.every(({ r: other }) => {
    tick(); return literal(other.when) === true && outcomeKey(other) === outcomeKey(r);
   }) && directSelfEmitLoops({ on: table.on, rules: [r] }, [state.id]).length > 0;
   // More than one subscriber can change the state or end it before the next step.
   nodes.set(key(state.id, ti), { state: state.id, table: ti, rule: ri, legacyCovered,
    ...(candidates.length === 1 ? { next: key(destination, candidates[0]) } : {}) });
  }
  const visited = new Set<string>(), loops: FlowAnalysis['loops'] = [];
  for (const start of nodes.keys()) {
   const path: string[] = [], positions = new Map<string, number>();
   let current: string | undefined = start;
   while (current !== undefined && nodes.has(current) && !visited.has(current)) {
    tick();
    const position = positions.get(current);
    if (position !== undefined) {
     const cycle = path.slice(position).map(k => nodes.get(k)!);
     // Suppress a one-node finding only when the legacy helper covers this rule in this state.
     if (cycle.length > 1 || !cycle[0].legacyCovered) loops.push({ at: `${site.tables[cycle[0].table].at}/rules/${cycle[0].rule}`,
      states: [...new Set(cycle.map(n => n.state))], tables: cycle.map(n => site.tables[n.table].table.id) });
     break;
    }
    positions.set(current, path.length); path.push(current); current = nodes.get(current)!.next;
   }
   path.forEach(k => visited.add(k));
  }
  return { unreachable, loops, status: 'complete' };
 } catch (error) {
  if (error !== exhausted) throw error;
  return { unreachable: [], loops: [], status: 'incomplete', limits: `Control-flow analysis stopped at ${maxSteps} steps. Split the workflow into smaller parts.` };
 }
}
