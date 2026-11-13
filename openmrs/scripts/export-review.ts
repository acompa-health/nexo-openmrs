// Writes the review copy: a self-contained copy of this folder for readers outside the repository. It holds
// `openmrs/`, the files that its code imports from the rest of the repository (Nexo Core and the hypertension
// protocol), a few named files, and a README. Nothing else leaves the repository, and nobody edits the copy
// by hand.
//
//   bun openmrs/scripts/export-review.ts <folder>     # the folder must be empty, or hold only .git
//
// See "The review copy" in openmrs/README.md.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
/** The folder of the copy's own README, notice, CI workflow and list, as a repository path. */
const TEMPLATES = 'openmrs/scripts/review-copy';

/** The folders whose files can change the copy. The export needs them to equal the commit. */
const SOURCES = ['openmrs', 'core', 'library/protocols/wip/2026-10-29-rwanda-baseline', '.claude/skills/nexo-to-openmrs-forms'];
/**
 * Files that no code imports: the CIEL release that the compiler reads from disk, with its record and the search
 * tool that the skill names, the skill, and the protocol guide.
 */
const NAMED = [
  'core/vocabulary/ciel/ciel-v2026-09-24.jsonl.gz',
  'core/vocabulary/ciel/manifest.json',
  'core/vocabulary/ciel/README.md',
  'core/vocabulary/ciel/search.py',
  '.claude/skills/nexo-to-openmrs-forms/SKILL.md',
  'library/protocols/wip/2026-10-29-rwanda-baseline/hypertension.md',
];
/**
 * The exact files that the copy may take from outside `openmrs/`, one path on each line. A new import that reaches
 * another file stops the export and fails the test, until a person adds that file here on purpose.
 */
export const OUTSIDE_LIST = `${TEMPLATES}/outside-files.txt`;
/** Text that must never leave the repository. The export stops, and writes nothing, if a file holds one of these. */
export const FORBIDDEN: readonly RegExp[] = [
  new RegExp('Admin' + '123'), // the default password of the O3 reference application, written so this file passes its own check
  /BEGIN [A-Z ]*PRIVATE KEY/,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bsk-ant-[A-Za-z0-9-]{10,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
  /\bsk-proj-[A-Za-z0-9_-]{20,}/,
  // A password with a value, in five forms. A reference to a variable, a placeholder, an empty value, a type
  // annotation and a value read from the environment are not passwords.
  // 1. A bare value directly after `…PASSWORD=`, anywhere: an env line, a compose list item, a command flag, a properties line.
  /password\w*=(?![$<{…"'`=]|\.\.\.)[^\s"'#]{6,}/i,
  // 2. A key at the start of a line, then a bare value to the end of the line: YAML, or properties with spaces.
  /^[ \t]*-?[ \t]*[\w.-]*password[\w.-]*[ \t]*[:=][ \t]+(?![$<{…"'`]|\.\.\.|string$)[^\s#]{5,}[^\s#;,][ \t]*$/im,
  // 3. A bare key, then a quoted value. The first word of the value decides.
  /password\w*[ \t]*[:=][ \t]*["'](?![$<{…]|\.\.\.)[^"'\s]{6,}/i,
  // 4. A quoted key, then a quoted value: JSON. A version range is the value of a package whose name ends in
  //    "password", and the word itself is a label in a translation file.
  /password\w*["'][ \t]*:[ \t]*["'](?![$<{…]|\.\.\.|[\^~]?\d+\.\d+\.\d+[\w.+-]*["']|password["'])[^"'\s]{6,}["']/i,
  // 5. A key anywhere in a line, then a bare value that holds a letter and a digit: a sentence or a table cell in a
  //    document. Code such as a type or a property has no digit.
  /\bpassword\w*[ \t]*[:=][ \t]*(?=[^\s]*\d)(?=[^\s]*[A-Za-z])(?![$<{…"'`=]|\.\.\.)[^\s"'`#|]{6,}/i,
  // An address of a real host. Local addresses are not one.
  /\b(?!127\.0\.0\.1\b|0\.0\.0\.0\b|10\.0\.0\.\d|192\.168\.)\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b(?!\.?\d)/,
];

const CODE = /\.(ts|tsx|mts|mjs|js)$/;
const IMPORTS = [
  /\bfrom\s*['"]([^'"\n]+)['"]/g,
  /\bimport\s*['"]([^'"\n]+)['"]/g,
  /\bimport\(\s*['"]([^'"\n]+)['"]\s*\)/g,
  /\brequire\(\s*['"]([^'"\n]+)['"]\s*\)/g,
];

export interface ReviewCopy { commit: string; date: string; files: string[]; outside: string[] }

const git = (root: string, ...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 });

/** The id that git gives these bytes as a blob. `length` is the length of an id in this repository. */
export function blobId(content: Buffer, length = 40): string {
  return createHash(length === 64 ? 'sha256' : 'sha1').update(`blob ${content.length}\0`).update(content).digest('hex');
}

/** The repository-relative file that a relative import names, or undefined when git tracks no such file. */
export function resolveImport(tracked: ReadonlySet<string>, from: string, specifier: string): string | undefined {
  const base = posix.normalize(posix.join(posix.dirname(from), specifier));
  return [base, `${base}.ts`, `${base}.tsx`, `${base}.mjs`, `${base}.js`, `${base}.json`, `${base}/index.ts`, `${base}/index.mjs`]
    .find(candidate => tracked.has(candidate));
}

/** The relative import specifiers in one source text. */
export function importsOf(text: string): string[] {
  const found: string[] = [];
  for (const pattern of IMPORTS) for (const match of text.matchAll(pattern)) if (match[1]!.startsWith('.')) found.push(match[1]!);
  return found;
}

/** The files that the copy is allowed to take from outside `openmrs/`. */
export function allowedOutside(root: string): string[] {
  return readFileSync(join(root, OUTSIDE_LIST), 'utf8').split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#')).sort();
}

/** Every file of the copy, in repository-relative paths: all of `openmrs/`, then what it needs from outside. */
export function reviewFiles(root: string): { files: string[]; outside: string[] } {
  const tracked = new Set(git(root, 'ls-files', '-z').split('\0').filter(Boolean));
  const inside = [...tracked].filter(file => file.startsWith('openmrs/'));
  const outside = new Set<string>();
  const queue = inside.filter(file => CODE.test(file));
  for (const file of NAMED) {
    if (!tracked.has(file)) throw new Error(`export-review: the named file ${file} is not in git.`);
    outside.add(file);
  }
  while (queue.length) {
    const file = queue.pop()!;
    for (const specifier of importsOf(readFileSync(join(root, file), 'utf8'))) {
      const target = resolveImport(tracked, file, specifier);
      if (!target) {
        // A bundler resolves style and asset imports inside the frontend module. Outside openmrs/ every import must resolve.
        if (file.startsWith('openmrs/')) continue;
        throw new Error(`export-review: ${file} imports '${specifier}', which git does not track.`);
      }
      if (target.startsWith('openmrs/') || outside.has(target)) continue;
      outside.add(target);
      if (CODE.test(target)) queue.push(target);
    }
  }
  return { files: [...inside, ...outside].sort(), outside: [...outside].sort() };
}

/** The differences between what the copy needs from outside and the committed list, as readable lines. */
export function outsideDifferences(needed: readonly string[], allowed: readonly string[]): string[] {
  const added = needed.filter(file => !allowed.includes(file)).map(file => `not in the list: ${file}`);
  const stale = allowed.filter(file => !needed.includes(file)).map(file => `in the list, but no longer needed: ${file}`);
  return [...added, ...stale];
}

/** Writes the review copy into `out` and returns what it wrote. It writes nothing when a check fails. */
export function exportReview(root: string, out: string): ReviewCopy {
  if (existsSync(out) && !statSync(out).isDirectory()) throw new Error(`export-review: ${out} is a file. Give a folder.`);
  if (existsSync(out) && readdirSync(out).some(name => name !== '.git')) {
    throw new Error(`export-review: ${out} is not empty. Give an empty folder, or a clone with every tracked file removed.`);
  }
  const changed = git(root, 'status', '--porcelain', '--', ...SOURCES).trim();
  if (changed) throw new Error(`export-review: commit or remove these changes first, so the copy equals a commit:\n${changed}`);
  const { files, outside } = reviewFiles(root);
  const differences = outsideDifferences(outside, allowedOutside(root));
  if (differences.length) {
    throw new Error(`export-review: the files that the copy needs from outside openmrs/ differ from ${OUTSIDE_LIST}.\n  ${differences.join('\n  ')}\nChange the list only when the file may leave the repository.`);
  }
  const commit = git(root, 'rev-parse', 'HEAD').trim();
  const date = git(root, 'show', '-s', '--format=%cs', 'HEAD').trim();

  // Read and check everything first, then write. git status does not report a file that is marked assume-unchanged,
  // and a filter can change the bytes on disk. So each file must have the content and the mode of the commit itself.
  const committed = new Map(git(root, 'ls-tree', '-r', '-z', 'HEAD', '--', ...files).split('\0').filter(Boolean).map(line => {
    const tab = line.indexOf('\t');
    const [mode, , id] = line.slice(0, tab).split(' ');
    return [line.slice(tab + 1), { mode: mode!, id: id! }] as const;
  }));
  const edited: string[] = [];
  const copies = files.map(file => {
    const source = join(root, file);
    if (lstatSync(source).isSymbolicLink()) throw new Error(`export-review: ${file} is a symbolic link. The copy takes plain files only.`);
    const entry = committed.get(file);
    if (entry && entry.mode !== '100644' && entry.mode !== '100755') throw new Error(`export-review: ${file} is not a plain file in the commit.`);
    const content = readFileSync(source);
    if (!entry || entry.id !== blobId(content, entry.id.length)) edited.push(file);
    return { file, content, mode: entry?.mode === '100755' ? 0o755 : 0o644 };
  });
  if (edited.length) throw new Error(`export-review: these files differ from the commit:\n  ${edited.join('\n  ')}`);
  for (const { file, content } of copies) {
    const hit = FORBIDDEN.find(pattern => pattern.test(content.toString('utf8')));
    if (hit) throw new Error(`export-review: ${file} holds text that must not leave the repository (${hit}). Nothing was written.`);
  }
  // The templates come from the bytes that were checked, not from a second read.
  const fill = (name: string) => copies.find(copy => copy.file === `${TEMPLATES}/${name}`)!.content.toString('utf8')
    .replaceAll('{{commit}}', commit).replaceAll('{{short}}', commit.slice(0, 8)).replaceAll('{{date}}', date);
  for (const { file, content, mode } of copies) {
    const target = join(out, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
    chmodSync(target, mode);
  }
  writeFileSync(join(out, 'README.md'), fill('README.md'));
  writeFileSync(join(out, 'NOTICE.md'), fill('NOTICE.md'));
  mkdirSync(join(out, '.github/workflows'), { recursive: true });
  writeFileSync(join(out, '.github/workflows/ci.yml'), fill('ci.yml'));
  writeFileSync(join(out, 'SOURCE.json'), `${JSON.stringify({
    repository: 'acompa-health/abrazos-v2', commit, date,
    files: { openmrs: files.length - outside.length, outside: outside.length },
  }, null, 1)}\n`);
  return { commit, date, files, outside };
}

if (import.meta.main) {
  const out = process.argv[2];
  if (!out) {
    console.error('Usage: bun openmrs/scripts/export-review.ts <folder>');
    process.exit(2);
  }
  const root = git(here, 'rev-parse', '--show-toplevel').trim();
  try {
    const copy = exportReview(root, out);
    console.log(`Review copy of ${copy.commit.slice(0, 8)} (${copy.date}) in ${out}: ${copy.files.length - copy.outside.length} files from openmrs/, ${copy.outside.length} from outside.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
