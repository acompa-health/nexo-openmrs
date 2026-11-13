// The review copy (export-review.ts) is what readers outside this repository get. These tests keep it small and
// complete: only openmrs/ and the listed files go in, and its code needs nothing that stays behind.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { FORBIDDEN, allowedOutside, blobId, importsOf, outsideDifferences, resolveImport, reviewFiles } from './export-review.ts';

const root = resolve(import.meta.dir, '../..');
const CODE = /\.(ts|tsx|mts|mjs|js)$/;

describe('the review copy', () => {
  const { files, outside } = reviewFiles(root);

  test('takes from outside openmrs/ exactly the files of the committed list', () => {
    expect(outsideDifferences(outside, allowedOutside(root))).toEqual([]);
  });

  test('names a file that is new or no longer needed', () => {
    expect(outsideDifferences(['core/a.ts', 'web/src/b.ts'], ['core/a.ts', 'core/old.ts'])).toEqual([
      'not in the list: web/src/b.ts',
      'in the list, but no longer needed: core/old.ts',
    ]);
  });

  test('takes nothing from the other components', () => {
    expect(files.filter(file => /^(web|studio|demo|server|site|docs|scripts|deploy)\//.test(file))).toEqual([]);
    expect(files.filter(file => file.startsWith('library/') && !file.startsWith('library/protocols/wip/2026-10-29-rwanda-baseline/hypertension'))).toEqual([]);
    expect(files.filter(file => file.startsWith('core/') && /(\.test\.|\/conformance\/|\/fixtures\/|\/tests\/)/.test(file))).toEqual([]);
    expect(files).toContain('openmrs/README.md');
    expect(files).toContain('core/protocol/runtime/engine.ts');
  });

  test('is self-contained: each relative import of its code resolves inside the copy', () => {
    const copy = new Set(files);
    const missing: string[] = [];
    // The frontend module also imports styles and assets, which its bundler resolves.
    for (const file of files.filter(file => CODE.test(file) && !file.startsWith('openmrs/packages/esm-nexo-care-app/'))) {
      for (const specifier of importsOf(readFileSync(join(root, file), 'utf8'))) {
        if (!resolveImport(copy, file, specifier)) missing.push(`${file} imports ${specifier}`);
      }
    }
    expect(missing).toEqual([]);
  });

  test('holds the CIEL release that the compiler reads from disk', () => {
    const cli = readFileSync(join(root, 'openmrs/packages/nexo-forms/src/cli.ts'), 'utf8');
    const read = cli.match(/core\/vocabulary\/ciel\/[\w.-]+\.jsonl\.gz/);
    expect(read).not.toBeNull();
    expect(files).toContain(read![0]);
  });

  test('no file of the copy holds text that must stay in the repository', () => {
    const hits: string[] = [];
    for (const file of files) {
      const content = readFileSync(join(root, file));
      const hit = FORBIDDEN.find(pattern => pattern.test(content.toString('utf8')));
      if (hit) hits.push(`${file}: ${hit}`);
    }
    expect(hits).toEqual([]);
  });

  test('blobId gives the id that git gives', () => {
    expect(blobId(Buffer.from(''))).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
    expect(blobId(Buffer.from('hello\n'))).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
  });

  test('the forbidden-text check finds secrets and accepts placeholders', () => {
    const forbidden = (text: string) => FORBIDDEN.some(pattern => pattern.test(text));
    // The samples are joined from parts, so that this file passes the check itself.
    for (const sample of [
      'Admin' + '123',
      '-----BEGIN OPENSSH ' + 'PRIVATE KEY-----',
      'gh' + 'p_abcdefghijklmnopqrstuvwxyz0123',
      'github_' + 'pat_11ABCDEFG0abcdefghijkl_mnop',
      'OMRS_DB_PASS' + 'WORD=hunter2hunter2',
      'admin_pass' + 'word: "correct-horse"',
      'ssh root@203.0.' + '113.5', // a documentation address
      '"pass' + 'word": "correct-horse-battery"',
      '  MYSQL_PASS' + 'WORD: hunter2hunter2',
      'connection.pass' + 'word=hunter2hunter2', // the OpenMRS runtime properties form
      'connection.pass' + 'word = hunter2hunter2',
      '      - MYSQL_PASS' + 'WORD=hunter2hunter2', // a compose list item
      'docker run -e MYSQL_ROOT_PASS' + 'WORD=hunter2hunter2',
      'export OPENMRS_USER=admin OPENMRS_PASS' + 'WORD=hunter2hunter2',
      'OPENMRS_USER=admin OPENMRS_PASS' + 'WORD=hunter2hunter2 bun scripts/walk.ts',
      'mysql --pass' + 'word=hunter2hunter2',
      '    pass' + 'word: hunter2hunter2',
      'spring.datasource.pass' + 'word: hunter2hunter2',
      'pass' + 'word: "correct horse battery"',
      'OMRS_DB_PASS' + 'WORD=Xk3;pL9qR2', // a value with a symbol in it
      'Log in as admin, pass' + 'word: hunter2hunter2.', // a sentence in a document
      '| pass' + 'word: hunter2hunter2 |', // a table cell
      'connection.pass' + 'word:hunter2hunter2',
      'the server at 203.0.' + '113.5.',
    ]) expect(forbidden(sample), sample).toBe(true);
    for (const sample of [
      'OMRS_DB_PASSWORD=' + '\n' + 'MYSQL_ROOT_PASSWORD=' + '\n', // an empty value on each line
      'MYSQL_PASSWORD: ${MYSQL_PASSWORD}',
      'export OPENMRS_USER=… OPENMRS_PASSWORD=…',
      'ports: "127.0.0.1:8090:80"',
      'the chart at 13.0.2-pre.12837 and core 2.8.10',
      'password: string;',
      'const password = process.env.OPENMRS_PASSWORD;',
      'password: `${user}:${secret}`,',
      '"@inquirer/password": "^5.0.10",',
      '"passwordLabel": "Password",', // a translation file
      '      - MYSQL_PASSWORD=${MYSQL_PASSWORD}',
      'OPENMRS_PASSWORD=<your password>',
      'if (password === expected) {',
      'password: z.string(),',
      'Never print the password: read it into the process that uses it.',
    ]) expect(forbidden(sample), sample).toBe(false);
  });
});
