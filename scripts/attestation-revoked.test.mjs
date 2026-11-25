import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ageInDays, readSnapshot, serialsOf, SHORTEST, snapshotText, SNAPSHOT, staleWarning } from './attestation-revoked.mjs';

const status = {
  entries: {
    '2c8cdddfd5e03bfc': { status: 'REVOKED', reason: 'KEY_COMPROMISE' },
    C8966FCB2FBB0D7A: { status: 'SUSPENDED', reason: 'SOFTWARE_FLAW' },
    // Digits only, and hex like the others: kept as written.
    '5014131950868983053': { status: 'REVOKED', reason: 'KEY_COMPROMISE' },
  },
};

test('every listed serial is kept as Google writes it, revoked or suspended', () => {
  assert.deepEqual(serialsOf(status), ['2c8cdddfd5e03bfc', '5014131950868983053', 'c8966fcb2fbb0d7a']);
});

test('an answer that is no list is refused, never written as an empty one', () => {
  assert.throws(() => serialsOf({}));
  assert.throws(() => serialsOf(null));
  assert.throws(() => serialsOf({ entries: { '<html>': { status: 'REVOKED' } } }));
});

test('a list with a short number in it is refused whole', () => {
  // "entries" as an array would name 0, 1, 2 …, and 1 is the serial of the key every phone makes for the check.
  assert.throws(() => serialsOf({ entries: [{ status: 'REVOKED' }, { status: 'REVOKED' }] }));
  assert.throws(() => serialsOf({ entries: { ...status.entries, 1: { status: 'REVOKED' } } }));
  assert.throws(() => serialsOf({ entries: { ...status.entries, '000000000000000000001': { status: 'REVOKED' } } }));
  // Leading zeros go, as Google strips them and the app looks a serial up.
  assert.deepEqual(serialsOf({ entries: { '002c8cdddfd5e03bfc': { status: 'REVOKED' } } }), ['2c8cdddfd5e03bfc']);
});

test('a suspension with an end date is left out: the copy cannot follow it', () => {
  const entries = { ...status.entries, a1b2c3d4e5f60718: { status: 'SUSPENDED', reason: 'SOFTWARE_FLAW', expires: '2027-01-31' } };
  assert.equal(serialsOf({ entries }).includes('a1b2c3d4e5f60718'), false);
  assert.equal(serialsOf({ entries }).length, 3);
});

test('a copy says when it was fetched and how much it holds', () => {
  const text = snapshotText(serialsOf(status), '2026-11-24');
  assert.deepEqual(readSnapshot(text), { date: '2026-11-24', count: 3 });
  assert.deepEqual(readSnapshot(text.replace(/\n/g, '\r\n')), { date: '2026-11-24', count: 3 });
  assert.equal(readSnapshot('nothing'), null);
  assert.equal(ageInDays('2026-11-24', new Date('2026-12-24T10:00:00Z')), 30);
});

test('a release is warned about a missing or old copy only', () => {
  const dir = fs.mkdtempSync(`${process.env.TEMP ?? '/tmp'}/revoked-`);
  const file = `${dir}/attestation_revoked.txt`;
  assert.match(staleWarning(file), /missing/);
  fs.writeFileSync(file, snapshotText(serialsOf(status), '2026-11-24'));
  assert.equal(staleWarning(file, new Date('2026-12-01T00:00:00Z')), null);
  assert.match(staleWarning(file, new Date('2027-02-01T00:00:00Z')), /69 days old/);
  fs.rmSync(dir, { recursive: true });
});

test('the copy in the repository is one the app can read', () => {
  const text = fs.readFileSync(SNAPSHOT, 'utf8');
  const copy = readSnapshot(text);
  assert.ok(copy, 'android/app/src/main/res/raw/attestation_revoked.txt has its header');
  assert.ok(copy.count > 1000, `${copy.count} serials`);
  // No short number: it would match the key every phone makes for the check.
  const serials = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
  assert.deepEqual(serials.filter((serial) => !new RegExp(`^[0-9a-f]{${SHORTEST},64}$`).test(serial)), []);
});
