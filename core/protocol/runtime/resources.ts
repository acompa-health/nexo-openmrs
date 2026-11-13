/** Local resources reuse input resolution. Trace their dependencies without a second fact store or update path. */
import type { Calculation, InputDecl, ResolvedInput, ResourceRead, TrustedEvent } from '../types.ts';
import { calculationNamesRead } from './calculations.ts';

export function resourceReads(
 names: readonly string[], declarations: Readonly<Record<string, InputDecl>>, values: Readonly<Record<string, ResolvedInput>>,
 calculations: Readonly<Record<string, Calculation>>, event: TrustedEvent,
): Record<string, ResourceRead> {
 const out: Record<string, ResourceRead> = {}, seen = new Set<string>(), todo = [...names];
 for (let name; (name = todo.pop()) !== undefined;) {
  if (seen.has(name)) continue;
  seen.add(name);
  const decl = Object.hasOwn(declarations, name) ? declarations[name] : undefined;
  if (!decl) {
   if (Object.hasOwn(calculations, name)) todo.push(...calculationNamesRead(calculations[name]));
   continue;
  }
  const binding = decl.binding;
  if (typeof binding === 'object' && 'content' in binding && 'key' in binding) todo.push(binding.key);
  if (!decl.resource) continue;
  const value = values[name];
  const source = value.source ?? (typeof binding === 'string'
   ? binding.startsWith('event.') ? `${event.id}:${binding}` : binding : undefined);
  out[name] = { ...decl.resource, binding, value: { ...value, ...(source ? { source } : {}) }, mode: event.mode };
 }
 return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
}
