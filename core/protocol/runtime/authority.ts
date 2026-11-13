/**
 * Clinical authority, from the host only. A role grant needs the actual actor bound to that role at this site. A protocol
 * grant needs a host authorization for the exact effective content identity, workflow/state scope, site, mode and time;
 * an authorization ID in the content is only a lookup hint. A document `status`, an event payload or an approval field
 * grants nothing. Protected clinical writes need a granted decision whatever the table's purpose.
 * Source: the resolved v1 contract, "Clinical authority".
 */
import type { ActorRef, AttemptReport, ContentRef, ContractCatalog, Effect, Id, Instant, ProtocolDocument, StateDecl, TrustContext } from '../types.ts';
import { compareTimes } from './time.ts';

export type AuthorityResult = NonNullable<AttemptReport['authority']>;

/** Check the decision authority of one state for one actor, at one instant, against the host's trust context. */
export function checkAuthority(args: { state: StateDecl; workflow: Id; actor: ActorRef; mode: 'live' | 'simulation'; content: ContentRef; trust: TrustContext; at: Instant }): AuthorityResult {
 const { state, workflow, actor, mode, content, trust, at } = args;
 const refuse = (reason: string): AuthorityResult => ({ decision: 'not_authorized', reason });
 if (!state.decision) return refuse(`state ${state.id} declares no decision authority`);
 if (mode !== trust.mode) return refuse(`a ${mode} attempt cannot use a ${trust.mode} trust context`);
 const authority = state.decision.authority;
 if (authority.kind === 'role') {
  const binding = trust.roles.find(r => r.role === authority.role && r.site === trust.site && r.actor.id === actor.id && r.actor.kind === actor.kind);
  return binding ? { decision: 'granted', grant: { id: `role:${authority.role}`, revision: binding.owner.revision } }
   : refuse(`${actor.kind} ${actor.id} is not bound to role ${authority.role} at site ${trust.site}`);
 }
 const within = (a: TrustContext['authorizations'][number]) =>
  (a.valid?.from === undefined || compareTimes(a.valid.from, at) !== 1) && (a.valid?.until === undefined || compareTimes(at, a.valid.until) === -1);
 const grants = trust.authorizations.filter(a => a.content.protocol === content.protocol && a.content.revision === content.revision
  && a.content.identity === content.identity && a.scope.workflow === workflow && a.scope.state === state.id
  && a.site === trust.site && a.mode === mode && (authority.authorization === undefined || a.id === authority.authorization.id));
 const current = grants.filter(within);
 if (current.length === 1) return { decision: 'granted', grant: { id: current[0].id, revision: current[0].revision } };
 if (current.length > 1) return refuse(`${current.length} authorizations match ${workflow}/${state.id}; a grant must be unique`);
 return refuse(grants.length ? `the authorization for ${workflow}/${state.id} is not valid at ${at}` : `no host authorization for ${workflow}/${state.id} on this content, site and mode`);
}

/**
 * The effects of a row that are protected clinical writes: a record that sets a protected field, a protected task
 * template, or an order with protected content (`*` protects the whole order). Validation restricts stage records to
 * the designated lifecycle; creation checks keep one active lifecycle per object.
 */
export function protectedEffects(effects: readonly Effect[], document: ProtocolDocument, catalog: ContractCatalog): Id[] {
 const records = { ...catalog.records, ...document.definitions?.records };
 const tasks = { ...catalog.tasks, ...document.definitions?.work_templates };
 return effects.filter(e => {
  if (e.kind === 'record') {
   const contract = records[e.record];
   return !!contract && (contract.protected ?? []).some(f => Object.hasOwn(e.fields, f));
  }
  if (e.kind === 'task') return tasks[e.task]?.protected === true;
  if (e.kind === 'order') {
   const p = catalog.orders[e.order].protected;
   return p.includes('*') || p.some(f => Object.hasOwn(e.content, f));
  }
  return false;
 }).map(e => e.id);
}
