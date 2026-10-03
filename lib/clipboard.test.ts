import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyText } from './clipboard.ts';

// The DOM paths are exercised in the desktop shell; here only the contract
// that matters to every caller: copyText answers, and never throws.

test('copyText resolves false where there is no clipboard and no document', async () => {
  assert.equal(await copyText('DE02 1203 0000 0000 2020 51'), false);
});

test('copyText uses navigator.clipboard when it works, and survives when it does not', async (t) => {
  const written: string[] = [];
  const nav = globalThis.navigator as Navigator & { clipboard?: unknown };
  const had = Object.getOwnPropertyDescriptor(nav, 'clipboard');
  t.after(() => {
    if (had) Object.defineProperty(nav, 'clipboard', had);
    else delete (nav as { clipboard?: unknown }).clipboard;
  });

  Object.defineProperty(nav, 'clipboard', {
    configurable: true,
    value: { writeText: async (s: string) => void written.push(s) },
  });
  assert.equal(await copyText('ok'), true);
  assert.deepEqual(written, ['ok']);

  // Denied (the desktop shell's permission handler) — falls back, which has no document here.
  Object.defineProperty(nav, 'clipboard', {
    configurable: true,
    value: { writeText: async () => { throw new DOMException('denied', 'NotAllowedError'); } },
  });
  assert.equal(await copyText('denied'), false);

  // Never answers — gives up after the timeout instead of hanging the button.
  Object.defineProperty(nav, 'clipboard', {
    configurable: true,
    value: { writeText: () => new Promise<void>(() => {}) },
  });
  const started = Date.now();
  assert.equal(await copyText('hangs'), false);
  assert.ok(Date.now() - started < 3000);
});
