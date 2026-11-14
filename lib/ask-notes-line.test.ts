import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_VAULT } from './app-types.ts';
import { vaultEntries, vaultFromEntries } from './sync-entries.ts';
import { mergeVaults, sanitizeVault } from './vault.ts';
import { CLOSED_KEY_MAX, CLOSED_MAX, lineNote, sanitizeClosedNotes, withClosedNotes } from './ask-notes-line.ts';

const note = (key: string) => ({ key });

test('the line says the first open note and counts the rest', () => {
  const notes = [note('double|a'), note('budget|b'), note('spike|c')];
  assert.deepEqual(lineNote(notes, undefined), { note: notes[0], more: 2, keys: ['double|a', 'budget|b', 'spike|c'] });
  // A closed note gives its place to the next one, and is not counted.
  assert.deepEqual(lineNote(notes, ['double|a']), { note: notes[1], more: 1, keys: ['budget|b', 'spike|c'] });
  assert.deepEqual(lineNote([notes[2]], []), { note: notes[2], more: 0, keys: ['spike|c'] });
});

test('nothing to say: no line', () => {
  assert.equal(lineNote([], undefined), null);
  assert.equal(lineNote([note('a'), note('b')], ['a', 'b']), null);
});

test('closing every counted note hides the line until a new one comes', () => {
  const now = [note('spike|2026-11|p|rewe'), note('new|netflix')];
  const shown = lineNote(now, undefined)!;
  const closed = withClosedNotes(undefined, shown.keys);
  assert.equal(lineNote(now, closed), null);
  const later = [note('double|x|3990|2026-11-12|2026-11-13'), ...now];
  assert.deepEqual(lineNote(later, closed), { note: later[0], more: 0, keys: [later[0].key] });
});

test('the closed keys stay few: each once, the newest kept', () => {
  assert.deepEqual(withClosedNotes(['a', 'b'], ['b', 'c']), ['a', 'b', 'c']);
  assert.deepEqual(withClosedNotes(['a'], ['', 'x'.repeat(CLOSED_KEY_MAX + 1)]), ['a']);
  const many = Array.from({ length: CLOSED_MAX + 5 }, (_, i) => `k${i}`);
  const kept = withClosedNotes(many.slice(0, CLOSED_MAX), many.slice(CLOSED_MAX));
  assert.equal(kept.length, CLOSED_MAX);
  assert.equal(kept.at(-1), `k${CLOSED_MAX + 4}`);
  assert.equal(kept[0], 'k5');
});

test('only well formed keys are kept', () => {
  assert.deepEqual(sanitizeClosedNotes(['a', 'a', 7, '', 'b']), ['a', 'b']);
  assert.equal(sanitizeClosedNotes('a'), undefined);
  assert.equal(sanitizeClosedNotes([]), undefined);
  assert.equal(sanitizeClosedNotes(Array.from({ length: CLOSED_MAX + 3 }, (_, i) => `k${i}`))?.length, CLOSED_MAX);
});

test('the vault keeps the closed notes on this device; a sync never carries them', () => {
  const here = { ...EMPTY_VAULT, aiNotesClosed: ['spike|2026-11|p|rewe'] };
  assert.deepEqual(sanitizeVault(here)?.aiNotesClosed, ['spike|2026-11|p|rewe']);
  assert.equal(sanitizeVault({ ...EMPTY_VAULT, aiNotesClosed: 'spike' })?.aiNotesClosed, undefined);
  assert.ok(![...vaultEntries(here).keys()].some((k) => k.startsWith('aiNotesClosed')));
  assert.deepEqual(vaultFromEntries(vaultEntries(here), here).aiNotesClosed, ['spike|2026-11|p|rewe']);
  assert.equal(vaultFromEntries(vaultEntries(here), EMPTY_VAULT).aiNotesClosed, undefined);
  // A backup restored keeps this device's.
  assert.deepEqual(mergeVaults(here, { ...EMPTY_VAULT, aiNotesClosed: ['new|x'] }).aiNotesClosed, ['spike|2026-11|p|rewe']);
});
