/** A readable account of what the compiler made and why: one section per form, one row per question. */
import type { Compiled, Hints } from './compile.ts';
import { checkLabelDecisions, describeDecision, type Layout } from './layout.ts';

export function report(c: Compiled, hints: Hints, layout: Layout = {}): string {
  const lines: string[] = [];
  const local = c.concepts.filter(x => !x.mapping?.startsWith('CIEL:'));
  lines.push(`# Generated forms: ${c.protocol.id} ${c.protocol.revision}`, '',
    `Identity \`${c.protocol.identity}\`. Status \`${c.protocol.status}\`. Draft for clinical review. Not for care.`, '',
    `${c.forms.length} forms, ${c.forms.reduce((n, f) => n + f.questions.length, 0)} questions, ${c.concepts.length} concepts `
    + `(${c.concepts.length - local.length} CIEL, ${local.length} local). Hints: ${Object.keys(hints).join(', ') || 'none'}.`, '');
  if (c.warnings.length) lines.push('## Warnings', '', ...c.warnings.map(w => `- ${w}`), '');
  if (c.findings.length) lines.push('## For the protocol author', '',
    'The forms ask what the protocol needs. These points are for the protocol author. The compiler reports them and does not work around them. See also [the protocol observations](../../../docs/protocol-observations.md).', '',
    ...c.findings.map(f => `- ${f.text}`), '');
  const labelDecisions = Object.entries(checkLabelDecisions(hints.$labelDecisions, hints.labels));
  if (labelDecisions.length) lines.push('## Label decisions', '',
    'These labels replace authoring words of the protocol on the forms and the care pathway. The protocol is unchanged.', '',
    ...labelDecisions.map(([key, d]) => `- \`${key}\` → "${hints.labels![key]}": ${describeDecision(d)}. ${d.reason}`), '');
  lines.push('## Forms', '', '| Form | Kind | Performer | Questions | Required | Conditional | Starts |', '| --- | --- | --- | --- | --- | --- | --- |');
  for (const f of c.forms) lines.push(`| [${f.title}](#${f.name}) | ${f.kind} | ${f.role ?? 'any'} | ${f.questions.length} | ${f.questions.filter(q => q.required).length} | ${f.questions.filter(q => q.hide).length} | ${f.starts.map(s => s.workflow).join(', ')} |`);
  lines.push('');
  for (const f of c.forms) {
    lines.push(`### ${f.name}`, '', `**${f.title}** (${f.kind}${f.template ? ` \`${f.template}\`` : ` \`${f.event}\``}). Encounter type "${f.encounterType.name}".`, '');
    if (f.evidence) lines.push(`Evidence: ${f.evidence}`, '');
    const content = Object.keys(f.content);
    if (content.length) lines.push(`Prefilled from the task: ${content.map(k => `\`${k}\``).join(', ')}.`, '');
    const filled = [...Object.entries(f.host).map(([k, v]) => `\`${k}\` ← ${describe(v)}`),
      ...f.objects.flatMap(o => Object.entries(o.host).map(([k, v]) => `\`${o.path.join('.')}.${k}\` ← ${describe(v)}`))];
    if (filled.length) lines.push(`Filled by the host: ${filled.join('; ')}.`, '');
    if (!f.questions.length) lines.push('No questions: completing the task is the evidence.', '');
    else {
      lines.push('| Section | Question | Nexo path | Type | Concept | Required | Shown when | Why |', '| --- | --- | --- | --- | --- | --- | --- | --- |');
      for (const g of f.design.groups) for (const id of g.questions) {
        const q = f.questions.find(x => x.id === id)!;
        const concept = c.concepts.find(x => x.reference === q.concept);
        const section = g.stop ? `${g.label} (stop: \`${g.stop.row}\`)` : g.label;
        lines.push(`| ${section} | ${q.label} | \`${q.path.join('.')}\` | ${typeLabel(q.type)} | ${concept?.mapping ?? 'local'} | ${q.required ? 'yes' : 'no'} | ${q.shownWhen ?? 'always'} | ${q.why} |`);
      }
      lines.push('');
    }
    const decided = [
      ...f.design.groups.filter(g => g.decision).map(g => `- Section "${g.label}" (\`${g.id}\`): ${describeDecision(g.decision!)}. ${g.decision!.reason}`),
      ...Object.entries(layout[f.name]?.fields ?? {}).map(([path, d]) => {
        const what = [d.info !== undefined && `ⓘ ${d.info === 'none' ? 'none' : `"${d.info}"`}`, d.control && `control ${d.control}`, d.orientation && `orientation ${d.orientation}`].filter(Boolean).join(', ');
        return `- Question \`${path}\` (${what}): ${describeDecision(d)}. ${d.reason}`;
      }),
    ];
    if (decided.length) lines.push('Layout decisions:', '', ...decided, '');
    if (f.starts.length) lines.push(`Can start: ${f.starts.map(s => `\`${s.workflow}\``).join(', ')}.`, '');
  }
  return lines.join('\n');
}

const describe = (v: { from: string; key?: string; object?: string; path?: string[] }) =>
  v.from === 'content' ? `task content \`${v.key}\`` : v.from === 'latest' ? `latest \`${v.object}\`` : v.from === 'object' ? `new object \`${v.path!.join('.')}\`` : v.from;

const typeLabel = (t: any) => t.type === 'listed' ? `one of ${t.values.join(', ')}` : t.type === 'quantity' ? `quantity${t.unit ? ` (${t.unit})` : ''}` : t.type;
