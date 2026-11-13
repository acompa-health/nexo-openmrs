#!/usr/bin/env bun
/**
 * nexo-forms compile <protocol folder>
 *
 * Reads <folder>/build/protocol.json (made by the folder's build.ts), the optional <folder>/forms.hints.json and the
 * optional <folder>/forms.layout.json (layout decisions).
 * Writes <folder>/build/o3/forms/*.json, <folder>/build/binding.json, <folder>/build/initializer/,
 * <folder>/build/o3-review/ (the review build) and <folder>/build/report.md.
 */
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join, resolve } from 'node:path';
import { compile, type Hints } from './compile.ts';
import { initializerFiles } from './initializer.ts';
import { report } from './report.ts';
import { checkLayout } from './layout.ts';

const folder = resolve(process.argv[2] ?? '.');
const bundle = JSON.parse(readFileSync(join(folder, 'build/protocol.json'), 'utf8'));
const hintsPath = join(folder, 'forms.hints.json');
const hints: Hints = existsSync(hintsPath) ? JSON.parse(readFileSync(hintsPath, 'utf8')) : {};
const layoutPath = join(folder, 'forms.layout.json');
const layout = existsSync(layoutPath) ? JSON.parse(readFileSync(layoutPath, 'utf8')) : undefined;
const compiled = compile(bundle.document, bundle.catalog, bundle.content, hints, layout);

const out = join(folder, 'build');
for (const dir of ['o3', 'o3-review', 'initializer']) rmSync(join(out, dir), { recursive: true, force: true });
mkdirSync(join(out, 'o3/forms'), { recursive: true });
for (const f of compiled.forms) writeFileSync(join(out, 'o3/forms', `${f.name}.json`), JSON.stringify(f.o3, null, 2) + '\n');
// The review build: the same forms with every reason on the page. The file names match the Initializer folder, so
// distro/docker-compose.review.yml can load it in place of the production forms.
mkdirSync(join(out, 'o3-review/ampathforms'), { recursive: true });
for (const f of compiled.forms) writeFileSync(join(out, 'o3-review/ampathforms', `nexo-${f.name}.json`), JSON.stringify(f.review, null, 2) + '\n');
writeFileSync(join(out, 'binding.json'), JSON.stringify({ protocol: compiled.protocol, labels: hints.labels ?? {}, host: { existing: hints.existing ?? {}, carryOver: hints.carryOver ?? [], roles: hints.roles ?? {} }, forms: compiled.forms.map(({ o3, review, design, ...rest }) => ({ ...rest, o3: { uuid: o3.uuid, name: o3.name } })) }, null, 1) + '\n');
// CIEL concepts the forms use, with names and types from the pinned CIEL index, for the install step.
const cielIndex = new Map<string, any>();
const gz = join(import.meta.dir, '../../../../core/vocabulary/ciel/ciel-v2026-09-24.jsonl.gz');
for (const line of gunzipSync(readFileSync(gz)).toString('utf8').split('\n')) if (line) { const c = JSON.parse(line); cielIndex.set(String(c.id), c); }
const ciel = compiled.concepts.filter(c => c.mapping?.startsWith('CIEL:')).map(c => {
  const code = c.mapping!.slice(5), row = cielIndex.get(code);
  return { uuid: c.uuid, code, name: row?.names?.en ?? c.name, datatype: row?.datatype ?? c.datatype, conceptClass: row?.class ?? c.conceptClass, units: c.units, used_as: c.key };
});
writeFileSync(join(out, 'ciel.json'), JSON.stringify({ version: 'v2026-09-24', concepts: ciel }, null, 1) + '\n');
for (const [path, text] of Object.entries(initializerFiles(compiled))) {
  mkdirSync(join(out, 'initializer', path, '..'), { recursive: true });
  writeFileSync(join(out, 'initializer', path), text);
}
writeFileSync(join(out, 'report.md'), report(compiled, hints, checkLayout(layout)));
const asked = compiled.forms.reduce((n, f) => n + f.questions.length, 0);
console.log(`${compiled.forms.length} forms, ${asked} questions, ${compiled.concepts.length} concepts, ${compiled.warnings.length} warnings, ${compiled.findings.length} points for the protocol author`);
for (const w of compiled.warnings) console.log(`warning: ${w}`);
for (const f of compiled.findings) console.log(`for the protocol author: ${f.text}`);
