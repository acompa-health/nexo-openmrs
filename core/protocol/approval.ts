import type { RegisterEntry } from './types.ts';

const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

/** A recorded choice can be structurally valid while clinical sign-off is pending. */
export function validDecision(entry: RegisterEntry): entry is RegisterEntry & { decided: NonNullable<RegisterEntry['decided']> } {
 const ids = Array.isArray(entry.options) ? entry.options.map(o => o?.id) : [];
 const d = entry.decided;
 return entry.status === 'decided' && ids.length > 0 && ids.every(nonempty) && new Set(ids).size === ids.length
  && d !== null && d !== undefined && nonempty(d.by) && nonempty(d.on) && nonempty(d.choice) && ids.includes(d.choice);
}

const date = (value: unknown): value is string => nonempty(value) && /^\d{4}-\d{2}-\d{2}$/.test(value)
 && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

/** Shared by the register checker and approval consumers. No reviewer authentication is implied. */
export function signoffProblems(entry: RegisterEntry): string[] {
 const d = entry.decided, s = entry.signoff, problems: string[] = [];
 if ((entry.status === 'decided' || d?.kind !== undefined) && d?.kind !== 'agent' && d?.kind !== 'clinician') problems.push('decided.kind must be agent or clinician');
 if (d?.kind !== 'agent' && !('signoff' in entry)) return problems;
 if (d?.kind !== 'agent') problems.push('signoff needs decided.kind agent');
 if (!validDecision(entry)) problems.push('an agent decision needs status decided and decided {by, on, choice}');
 if (!nonempty(d?.session)) problems.push('decided.session must name the agent session');
 if (!date(d?.on)) problems.push('decided.on must be a valid YYYY-MM-DD date');
 if (!nonempty(d?.how)) problems.push('decided.how must describe the research');
 if (!s || typeof s !== 'object' || Array.isArray(s)) return [...problems, 'an agent decision needs signoff'];
 const extra = Object.keys(s).filter(k => !['status', 'pathway', 'version', 'risk', 'production', 'by', 'on', 'choice', 'how'].includes(k));
 if (extra.length) problems.push(`signoff has unknown fields ${extra.join(', ')}`);
 if (!['pending', 'approved'].includes(s.status)) problems.push('signoff.status must be pending or approved');
 for (const key of ['pathway', 'version'] as const) if (!nonempty(s[key])) problems.push(`signoff.${key} must be nonempty`);
 if (!['safety', 'wording'].includes(s.risk)) problems.push('signoff.risk must be safety or wording');
 if (typeof s.production !== 'boolean') problems.push('signoff.production must be true or false');
 if (s.status === 'pending' && ['by', 'on', 'choice', 'how'].some(k => k in s)) problems.push('pending signoff cannot contain a clinical signature');
 if (s.status === 'approved') {
  if (!nonempty(s.by) || (nonempty(d?.by) && s.by.trim().toLowerCase() === d.by.trim().toLowerCase())) problems.push('signoff.by must name a clinical reviewer separate from the agent');
  if (!date(s.on) || (date(d?.on) && s.on < d.on)) problems.push('signoff.on must be a valid date on or after the agent decision');
  if (!nonempty(s.choice) || s.choice !== d?.choice) problems.push('signoff.choice must match decided.choice');
  if (!nonempty(s.how)) problems.push('signoff.how must identify the review and exact content reviewed');
 }
 return problems;
}

/** Require explicit authorship. An agent also needs a separate clinical signature. */
export function validApproval(entry: RegisterEntry): entry is RegisterEntry & { decided: NonNullable<RegisterEntry['decided']> } {
 if (!validDecision(entry) || signoffProblems(entry).length !== 0) return false;
 return entry.decided.kind === 'clinician' || entry.signoff?.status === 'approved';
}
