// The in-memory tree's bundled files: listed only, mounted with content, and
// let go again (desktop/server/model.ts hands the tokenizer over that way).
import test from 'node:test';
import assert from 'node:assert/strict';

import { existsSync, mountAssets, readFileSync, statSync, unmountAssets } from './fs.ts';

test('a listed file exists without content until it is mounted', () => {
  mountAssets({}, { '/model-a': ['tokenizer.json'] });
  assert.equal(existsSync('/model-a/tokenizer.json'), true);
  assert.throws(() => readFileSync('/model-a/tokenizer.json', 'utf8'), { code: 'ENOENT' });
  mountAssets({ '/model-a/tokenizer.json': '{"vocab":["ä"]}' });
  assert.equal(readFileSync('/model-a/tokenizer.json', 'utf8'), '{"vocab":["ä"]}');
});

test('unmounting lets go of the content, the file still listed with its size', () => {
  mountAssets({ '/model-b/tokenizer.json': '{"vocab":["ä"]}' });
  unmountAssets(['/model-b/tokenizer.json']);
  assert.equal(existsSync('/model-b/tokenizer.json'), true);
  assert.throws(() => readFileSync('/model-b/tokenizer.json', 'utf8'), { code: 'ENOENT' });
  assert.equal(statSync('/model-b/tokenizer.json').size, 16, 'bytes, "ä" counted as two');
  mountAssets({ '/model-b/tokenizer.json': '{}' });
  assert.equal(readFileSync('/model-b/tokenizer.json', 'utf8'), '{}', 'and mounts again');
});

test('a saved file is never let go', () => {
  // Mounted rather than written: the same path rule, without the write-through to the phone's storage.
  mountAssets({ '/data/fints-state/keep.json': '{"kept":true}' });
  unmountAssets(['/data/fints-state/keep.json', '/nowhere/missing.json']);
  assert.equal(readFileSync('/data/fints-state/keep.json', 'utf8'), '{"kept":true}');
  assert.equal(existsSync('/nowhere/missing.json'), false);
});
