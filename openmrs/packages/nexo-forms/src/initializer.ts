/**
 * OpenMRS Initializer files for the compiled forms: local concepts, encounter types and the O3 form schemas.
 * CIEL concepts are not created here. The files name each one by its mapping, "CIEL:<code>", and Initializer resolves
 * the mapping to the server's own concept. scripts/install-ciel.ts adds a CIEL concept that the server lacks; run it
 * before the start that loads these files, because an answer that does not resolve stops Initializer.
 */
import type { Compiled, ConceptSpec } from './compile.ts';

const csvCell = (v: unknown) => {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (header: string[], rows: unknown[][]) => [header, ...rows].map(r => r.map(csvCell).join(',')).join('\n') + '\n';

export function initializerFiles(compiled: Compiled): Record<string, string> {
  const files: Record<string, string> = {};
  const local = compiled.concepts.filter(c => !c.mapping?.startsWith('CIEL:'));
  const answers = local.filter(c => c.datatype === 'N/A');
  const questions = local.filter(c => c.datatype !== 'N/A');
  const header = ['Uuid', 'Void/Retire', 'Fully specified name:en', 'Short name:en', 'Description:en', 'Data class', 'Data type', 'Answers',
    'Absolute low', 'Absolute high', 'Units', 'Allow decimals', 'Same as mappings', '_version:1', '_order:1000'];
  // Fully specified names must be unique in a locale. Fall back to the Nexo key for a repeated readable name.
  const fsnCount = new Map<string, number>();
  for (const c of local) fsnCount.set(c.fsn ?? c.name, (fsnCount.get(c.fsn ?? c.name) ?? 0) + 1);
  const fsn = (c: ConceptSpec) => (fsnCount.get(c.fsn ?? c.name)! > 1 || !c.fsn ? `${c.name} (Nexo ${c.key})` : c.fsn);
  const row = (c: ConceptSpec) => [
    c.uuid, '', fsn(c).slice(0, 255), c.name.slice(0, 255), `Generated from Nexo ${compiled.protocol.id}: ${c.key}.`,
    c.conceptClass, c.datatype, (c.answers ?? []).join(';'), c.datatype === 'Numeric' ? '0' : '', '', c.units ?? '', c.datatype === 'Numeric' ? 'true' : '',
    c.mapping && !c.mapping.startsWith('CIEL:') ? c.mapping : '', '', '',
  ];
  // Answers load before the questions that list them.
  files['concepts/nexo-1-answers.csv'] = csv(header, answers.map(row));
  files['concepts/nexo-2-questions.csv'] = csv(header, questions.map(row));
  files['encountertypes/nexo.csv'] = csv(['Uuid', 'Void/Retire', 'Name', 'Description', '_version:1', '_order:1000'],
    compiled.forms.map(f => [f.encounterType.uuid, '', f.encounterType.name, f.encounterType.description, '', '']));
  for (const f of compiled.forms) files[`ampathforms/nexo-${f.name}.json`] = JSON.stringify(f.o3, null, 2) + '\n';
  return files;
}
