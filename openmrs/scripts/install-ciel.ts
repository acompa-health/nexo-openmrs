#!/usr/bin/env bun
/**
 * Make each CIEL concept that the generated forms use resolvable on a server, without a second concept or a second
 * mapping for any CIEL code. The forms and the Initializer files name a CIEL concept by its mapping, "CIEL:<code>", and
 * the server resolves it to its own concept. For each code in build/ciel.json:
 *
 * - a concept on the server already maps to the code: nothing changes, and the forms use that concept;
 * - otherwise a concept with the CIEL UUID (<code> padded with "A") gets a SAME-AS mapping to the code;
 * - otherwise a new concept with the CIEL UUID and the mapping. A name clash gets the suffix "(CIEL <code>)".
 *
 * It never adds a mapping to a code that the server already maps: two concepts for one code make every lookup of that
 * code fail, and Initializer files on the server use those lookups. See installCiel in packages/nexo-forms/src/dictionary.ts.
 *
 * Run it before the start that first loads the Initializer files: their coded questions name CIEL answers by mapping,
 * and an answer that does not resolve stops Initializer.
 *
 * Usage: bun scripts/install-ciel.ts protocols/rwanda-htn [http://localhost:8090/openmrs]
 * Credentials: OPENMRS_USER and OPENMRS_PASSWORD (required). On the local O3 server, use its demo administrator login.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { installCiel, type CielConcept } from '../packages/nexo-forms/src/dictionary.ts';
import { openmrsRest } from './rest.ts';

const folder = resolve(process.argv[2] ?? 'protocols/rwanda-htn');
const rest = openmrsRest(process.argv[3] ?? 'http://localhost:8090/openmrs');
const { concepts } = JSON.parse(readFileSync(join(folder, 'build/ciel.json'), 'utf8')) as { concepts: CielConcept[] };

const done = await installCiel(rest, concepts);
for (const d of done) console.log(`${d.action.padEnd(7)} CIEL:${d.code} ${d.name} (${d.uuid})${d.warning ? `. Check: ${d.warning}` : ''}`);
const count = (action: string) => done.filter(d => d.action === action).length;
console.log(`${count('have')} already on the server, ${count('mapped')} mapped, ${count('created')} created. All ${done.length} CIEL concepts resolve.`);
