#!/usr/bin/env bun
/**
 * Writes the import map and routes registry that the O3 3.8.0 frontend needs to load @nexo/esm-nexo-care-app,
 * without rebuilding the frontend image. It reads the originals from the image, adds this module, and writes
 * distro/frontend/dist/{importmap.json,routes.registry.json} (git ignores dist/), each with a .gz and a .br copy:
 * the image's nginx serves the precompressed copies first. docker-compose.frontend.yml mounts all six over the
 * originals. Run it after each build of the module:
 *
 *   bun distro/frontend/add-nexo-care-app.mjs [image]   (default image: openmrs/openmrs-reference-application-3-frontend:3.8.0)
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const image = process.argv[2] ?? 'openmrs/openmrs-reference-application-3-frontend:3.8.0';
const app = resolve(here, '../../packages/esm-nexo-care-app');
const pkg = JSON.parse(readFileSync(resolve(app, 'package.json'), 'utf8'));
const routes = JSON.parse(readFileSync(resolve(app, 'dist/routes.json'), 'utf8'));
const folder = `${pkg.name.replace(/^@/, '').replace(/\//g, '-')}-${pkg.version}`; // the folder the compose file mounts
const bundle = pkg.browser.replace(/^dist\//, '');

const fromImage = (file) =>
  JSON.parse(execFileSync('docker', ['run', '--rm', '--entrypoint', 'cat', image, `/usr/share/nginx/html/${file}`], { encoding: 'utf8' }));

const importmap = fromImage('importmap.json');
// The entry keeps its name across builds, so its URL carries a content hash: the browser fetches a new build at once.
const hash = createHash('sha256').update(readFileSync(resolve(app, pkg.browser))).digest('hex').slice(0, 10);
importmap.imports[pkg.name] = `./${folder}/${bundle}?v=${hash}`;
const registry = fromImage('routes.registry.json');
registry.routes[pkg.name] = routes;

const out = resolve(here, 'dist');
mkdirSync(out, { recursive: true });
for (const [file, value] of [['importmap.json', importmap], ['routes.registry.json', registry]]) {
  const text = Buffer.from(JSON.stringify(value));
  writeFileSync(resolve(out, file), text);
  writeFileSync(resolve(out, `${file}.gz`), gzipSync(text, { level: 9 }));
  writeFileSync(resolve(out, `${file}.br`), brotliCompressSync(text));
}
console.log(`Added ${pkg.name} (${folder}/${bundle}?v=${hash}) to the import map and routes registry of ${image}.`);
