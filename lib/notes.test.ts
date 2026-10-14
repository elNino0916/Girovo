import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NOTE_LIMITS, NOTE_MAX_CHARS, cleanNote, sanitizeNotes, withNote } from './notes.ts';

const KEY = '2026-10-02|-12.90|DE02120300000000202051|E1';
const LS = String.fromCharCode(0x2028);
const NUL = String.fromCharCode(0);

test('a note is one clean line of at most 280 characters', () => {
  assert.equal(cleanNote('  Geschenk\tfür\r\nMama  '), 'Geschenk für Mama');
  assert.equal(cleanNote(`a${NUL}b${LS}c\u0085d`), 'a b c d');
  assert.equal(cleanNote('   '), '');
  assert.equal(cleanNote(42), '');
  assert.equal(cleanNote(null), '');
  const long = cleanNote('x'.repeat(400));
  assert.equal(long.length, NOTE_MAX_CHARS);
  // Clipped by character, never between the halves of an emoji.
  assert.equal(cleanNote(`${'a'.repeat(279)}😀😀`), `${'a'.repeat(279)}😀`);
  // Clipping never leaves a trailing space behind.
  assert.equal(cleanNote(`${'a'.repeat(279)} b`), 'a'.repeat(279));
});

test('sanitizeNotes: plausible keys only, notes cleaned, empty ones dropped', () => {
  const raw = JSON.parse(
    `{"${KEY}":"  Rechnung  2026-117 ","":"leer","__proto__":"x","k2":"   ","k3":7,"${'x'.repeat(201)}":"zu lang"}`,
  );
  raw['bad\nkey'] = 'control in the key';
  const out = sanitizeNotes(raw);
  assert.deepEqual(out, { [KEY]: 'Rechnung 2026-117' });
  assert.equal(Object.getPrototypeOf(out), Object.prototype);
  for (const v of [null, undefined, 'x', 42, ['a']]) assert.deepEqual(sanitizeNotes(v), {});
});

test('over the count cap the newest notes stay', () => {
  const many: Record<string, string> = {};
  for (let i = 0; i < NOTE_LIMITS.count + 10; i++) many[`2026-01-01|-${i}.00|X|`] = `Notiz ${i}`;
  const out = sanitizeNotes(many);
  const keys = Object.keys(out);
  assert.equal(keys.length, NOTE_LIMITS.count);
  assert.equal(keys[0], '2026-01-01|-10.00|X|');
  assert.equal(keys.at(-1), `2026-01-01|-${NOTE_LIMITS.count + 9}.00|X|`);
});

test('over the byte budget the oldest notes go, so the vault stays well under its 512 KB', () => {
  const many: Record<string, string> = {};
  // 280 characters with umlauts each: two bytes for every "ä".
  for (let i = 0; i < 1500; i++) many[`2026-01-01|-${i}.00|DE02120300000000202051|REF${i}`] = 'ä'.repeat(NOTE_MAX_CHARS);
  const out = sanitizeNotes(many);
  const kept = Object.keys(out);
  assert.ok(kept.length < 1500 && kept.length > 300, String(kept.length));
  assert.equal(kept.at(-1), '2026-01-01|-1499.00|DE02120300000000202051|REF1499', 'the newest survives');
  assert.ok(Buffer.byteLength(JSON.stringify(out), 'utf8') <= NOTE_LIMITS.bytes + 2);
});

test('withNote adds at the end, rewrites as the newest, removes on empty — and keeps identity when nothing changes', () => {
  const start = { a: 'eins', b: 'zwei' };
  const added = withNote(start, 'c', '  drei ');
  assert.deepEqual(Object.entries(added.notes), [['a', 'eins'], ['b', 'zwei'], ['c', 'drei']]);
  assert.equal(added.dropped, 0);
  const rewritten = withNote(added.notes, 'a', 'eins, neu');
  assert.deepEqual(Object.keys(rewritten.notes), ['b', 'c', 'a']);
  assert.equal(rewritten.notes.a, 'eins, neu');
  const removed = withNote(rewritten.notes, 'b', '   ');
  assert.deepEqual(Object.keys(removed.notes), ['c', 'a']);
  assert.equal(withNote(removed.notes, 'b', null).notes, removed.notes, 'removing what is not there');
  assert.equal(withNote(removed.notes, 'a', ' eins,  neu ').notes, removed.notes, 'the same text after cleaning');
  assert.equal(withNote(removed.notes, 'x'.repeat(201), 'zu lang').notes, removed.notes, 'an unusable key');
  assert.equal(start.a, 'eins', 'never mutated');
});

test('withNote says how many old notes the caps took', () => {
  const full: Record<string, string> = {};
  for (let i = 0; i < NOTE_LIMITS.count; i++) full[`k${i}`] = 'n';
  const { notes, dropped } = withNote(full, 'neu', 'Neue Notiz');
  assert.equal(dropped, 1);
  assert.equal(Object.keys(notes).length, NOTE_LIMITS.count);
  assert.equal('k0' in notes, false);
  assert.equal(notes.neu, 'Neue Notiz');
});
