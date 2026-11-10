// Every field of the saved data has to pass through each place that rebuilds
// it field by field. One that is missing there is not an error anywhere: the
// field is simply gone after the next login or sync round, and the round
// after that deletes it on every device (contractNames, 6.1.0-nightly: a
// renamed contract had the bank's name back after a login).
//
// The page's own copy (components/provider/model.ts normalizeVault) imports
// through the "@/" alias and cannot be loaded here, so its source is read.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

/** The keys of `export type VaultData = { … }` as the source names them. */
function vaultKeys(): string[] {
  const src = read('lib/app-types.ts');
  const start = src.indexOf('export type VaultData = {');
  assert.ok(start >= 0, 'VaultData not found');
  const body = src.slice(start, src.indexOf('\n};', start));
  return [...body.matchAll(/^ {2}([A-Za-z]+)\??:/gm)].map((m) => m[1]);
}

/** One function's source, from its declaration to the next top-level one. */
function functionSource(rel: string, name: string): string {
  const src = read(rel);
  const start = src.indexOf(`export function ${name}(`);
  assert.ok(start >= 0, `${name} not found in ${rel}`);
  const next = src.indexOf('\nexport ', start + 1);
  return src.slice(start, next < 0 ? undefined : next);
}

test('the page keeps every field of the saved data when it loads or merges it', () => {
  const keys = vaultKeys();
  assert.ok(keys.includes('contractNames') && keys.includes('templates'), 'the key list reads the type');
  const body = functionSource('components/provider/model.ts', 'normalizeVault');
  // `version` is written as a constant; every other field is read from what came in.
  const missing = keys.filter((k) => k !== 'version' && !new RegExp(`\\braw\\.${k}\\b`).test(body));
  assert.deepEqual(missing, []);
});

test('the server keeps every field of the saved data when it stores it', () => {
  const body = functionSource('lib/vault.ts', 'sanitizeVault');
  const missing = vaultKeys().filter((k) => k !== 'version' && !new RegExp(`\\b${k}\\b`).test(body));
  assert.deepEqual(missing, []);
});
