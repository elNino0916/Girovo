import './__fixtures__/tz.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nearestEntryYear } from './entry-date.ts';

// lib-fints builds MT940 dates as local midnight: new Date(y, m, d).
const local = (y: number, m: number, d: number) => new Date(y, m - 1, d);
const at = (v: Date | string) => new Date(v).getTime();

test('a booking valued 31.12. and booked 02.01. lands in the new year', () => {
  // What lib-fints makes of ":61:2512310102CR1500,00NTRFNONREF".
  const out = nearestEntryYear(local(2025, 1, 2), local(2025, 12, 31));
  assert.ok(out instanceof Date);
  assert.equal(at(out), at(local(2026, 1, 2)));
  // Still local midnight: the Buchungstag buckets into the right local day.
  assert.equal(out.getHours(), 0);
  assert.equal(out.getDate(), 2);
});

test('a booking entered a month after its value date is moved forward too', () => {
  // value 15.03.2026, entered 14.04. — lib-fints puts it in April 2025.
  assert.equal(at(nearestEntryYear(local(2025, 4, 14), local(2026, 3, 15))), at(local(2026, 4, 14)));
});

test('booked 31.12., valued 02.01. — lib-fints already gets this one right', () => {
  const entry = local(2025, 12, 31);
  assert.equal(nearestEntryYear(entry, local(2026, 1, 2)), entry);
});

test('dates in the same month or a few days apart pass through as the same value', () => {
  const entry = local(2026, 10, 2);
  assert.equal(nearestEntryYear(entry, local(2026, 10, 1)), entry);
  assert.equal(nearestEntryYear(entry, local(2026, 9, 28)), entry);
});

test('CAMT dates (full dates at local noon) are never touched', () => {
  const entry = new Date('2026-10-02T10:00:00.000Z');
  assert.equal(nearestEntryYear(entry, new Date('2026-09-30T10:00:00.000Z')), entry);
  // Even a long-backdated value date: the bank said so, in full.
  const backdated = new Date('2026-09-01T10:00:00.000Z');
  assert.equal(nearestEntryYear(backdated, new Date('2026-01-15T11:00:00.000Z')), backdated);
});

test('a gap the year cannot explain is left alone', () => {
  // Seven months apart either way: moving a year would not make it plausible.
  const entry = local(2026, 8, 1);
  assert.equal(nearestEntryYear(entry, local(2026, 1, 1)), entry);
});

test('ISO strings from the wire work as well', () => {
  const out = nearestEntryYear('2025-01-01T23:00:00.000Z', '2025-12-30T23:00:00.000Z');
  assert.equal(at(out), at(local(2026, 1, 2)));
});

test('missing or unreadable dates come back unchanged', () => {
  const entry = local(2025, 1, 2);
  assert.equal(nearestEntryYear(entry, null), entry);
  assert.equal(nearestEntryYear(entry, undefined), entry);
  assert.equal(nearestEntryYear(entry, 'gestern'), entry);
  assert.equal(nearestEntryYear('', local(2025, 12, 31)), '');
  assert.equal(nearestEntryYear('kein Datum', local(2025, 12, 31)), 'kein Datum');
});
