import './__fixtures__/tz.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { legacyTxKey, txKey } from './categories.ts';
import type { SerializedTransaction } from './fints-types';
import { bankDay, berlinDay, statedDay } from './format.ts';

// A booking's key names the bank's Buchungstag, not the UTC date of the
// moment the fetching device made of it. These tests hold the three shapes a
// booking's day arrives in — MT940's local midnight, camt's local noon, a
// bare yyyy-mm-dd — to one day and one key, on whatever time the device that
// reads them is.

const ZONES = ['Europe/Berlin', 'UTC', 'America/New_York', 'Asia/Tokyo'];

/** Runs `fn` with the process on `zone`'s time (Node applies a TZ change at once). */
function inZone<T>(zone: string, fn: () => T): T {
  const was = process.env.TZ;
  process.env.TZ = zone;
  try {
    return fn();
  } finally {
    process.env.TZ = was;
  }
}

const parts = (day: string) => day.split('-').map(Number) as [number, number, number];
/** The wire's JSON of what the parsers build, on the zone the process is on. */
const midnight = (day: string) => { const [y, m, d] = parts(day); return new Date(y, m - 1, d).toISOString(); };
const noon = (day: string) => { const [y, m, d] = parts(day); return new Date(y, m - 1, d, 12).toISOString(); };

const booking = (entryDate: string, over: Partial<SerializedTransaction> = {}) => ({
  entryDate, valueDate: entryDate, amount: -12.9, remoteIban: 'DE02120300000000202051', remoteName: 'REWE', e2eReference: 'E1', bankReference: 'B1', ...over,
}) as SerializedTransaction;

/** Days where a slip shows: both clock changes and the nights around them, the turn of the year, a leap day. */
const DAYS = [
  '2026-01-01', '2025-12-31', '2026-03-28', '2026-03-29', '2026-03-30', '2026-07-15',
  '2026-10-24', '2026-10-25', '2026-10-26', '2026-11-01', '2024-02-29', '2027-01-01',
];

test('the fixture took: this process is on German time', () => {
  assert.equal(new Date(2026, 10, 1).toISOString(), '2026-10-31T23:00:00.000Z');
});

test('the day in Germany at a moment follows the clock changes to the hour', () => {
  // Winter: UTC+1.
  assert.equal(berlinDay(Date.parse('2026-01-01T22:59:59.999Z')), '2026-01-01');
  assert.equal(berlinDay(Date.parse('2026-01-01T23:00:00.000Z')), '2026-01-02');
  // Summer: UTC+2.
  assert.equal(berlinDay(Date.parse('2026-07-01T21:59:59.999Z')), '2026-07-01');
  assert.equal(berlinDay(Date.parse('2026-07-01T22:00:00.000Z')), '2026-07-02');
  // The night the clocks go forward (29 March 2026, 01:00 UTC) and back (25 October 2026, 01:00 UTC).
  assert.equal(berlinDay(Date.parse('2026-03-28T23:00:00.000Z')), '2026-03-29');
  assert.equal(berlinDay(Date.parse('2026-03-29T21:59:59.999Z')), '2026-03-29');
  assert.equal(berlinDay(Date.parse('2026-03-29T22:00:00.000Z')), '2026-03-30');
  assert.equal(berlinDay(Date.parse('2026-10-24T22:00:00.000Z')), '2026-10-25');
  assert.equal(berlinDay(Date.parse('2026-10-25T22:59:59.999Z')), '2026-10-25');
  assert.equal(berlinDay(Date.parse('2026-10-25T23:00:00.000Z')), '2026-10-26');
  // The turn of the year.
  assert.equal(berlinDay(Date.parse('2025-12-31T22:59:59.999Z')), '2025-12-31');
  assert.equal(berlinDay(Date.parse('2025-12-31T23:00:00.000Z')), '2026-01-01');
  assert.equal(berlinDay(Number.NaN), '');
});

test('the day in Germany agrees with the system’s own time zone data, every hour of thirty years', () => {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' });
  const day = (ms: number) => {
    const p = Object.fromEntries(fmt.formatToParts(ms).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}`;
  };
  // Whatever time the process is on changes nothing: the rule counts in UTC.
  for (let ms = Date.UTC(1996, 0, 1); ms < Date.UTC(2027, 0, 1); ms += 3_600_000) {
    if (berlinDay(ms) !== day(ms)) assert.fail(`${new Date(ms).toISOString()}: ${berlinDay(ms)} is not ${day(ms)}`);
  }
  inZone('Asia/Tokyo', () => assert.equal(berlinDay(Date.parse('2026-10-31T23:00:00.000Z')), '2026-11-01'));
});

test('a booking without a stated day: its day is the one in Germany, read on any time', () => {
  for (const d of DAYS) {
    // What a device on German time kept before bookings carried their day.
    const kept = inZone('Europe/Berlin', () => ({ mt940: midnight(d), camt: noon(d) }));
    for (const zone of ZONES) {
      inZone(zone, () => {
        assert.equal(bankDay({ entryDate: kept.mt940, valueDate: kept.mt940 }), d, `MT940 ${d} read in ${zone}`);
        assert.equal(bankDay({ entryDate: kept.camt, valueDate: kept.camt }), d, `camt ${d} read in ${zone}`);
        assert.equal(bankDay({ entryDate: d, valueDate: d }), d, `bare ${d} read in ${zone}`);
        // As a Date, the way a server-side caller holds it before it is JSON.
        assert.equal(bankDay({ entryDate: new Date(kept.mt940), valueDate: new Date(kept.mt940) }), d);
      });
    }
  }
});

test('the day a parser’s Date names is the bank’s, on whatever time the device is', () => {
  for (const zone of [...ZONES, 'Pacific/Honolulu', 'Pacific/Kiritimati', 'America/Sao_Paulo']) {
    inZone(zone, () => {
      for (const d of DAYS) {
        const [y, m, dd] = parts(d);
        assert.equal(statedDay(new Date(y, m - 1, dd)), d, `MT940 ${d} in ${zone}`);
        assert.equal(statedDay(new Date(y, m - 1, dd, 12)), d, `camt ${d} in ${zone}`);
        assert.equal(statedDay(new Date(y, m - 1, dd).toISOString()), d, `MT940 ${d} as JSON in ${zone}`);
        assert.equal(statedDay(d), d);
      }
    });
  }
  assert.equal(statedDay(null), '');
  assert.equal(statedDay(new Date(Number.NaN)), '');
  assert.equal(statedDay('morgen'), '');
});

test('a date the bank states with its own offset is the day in Germany, wherever it is read', () => {
  // camt's "2026-01-22+01:00" and a full date-time, as lib-fints makes moments of them.
  const dateWithOffset = new Date('2026-01-22T00:00:00+01:00');
  const dateTime = new Date('2026-07-03T09:30:00+02:00');
  for (const zone of ZONES) {
    inZone(zone, () => {
      assert.equal(statedDay(dateWithOffset), '2026-01-22', zone);
      assert.equal(statedDay(dateTime), '2026-07-03', zone);
    });
  }
});

test('one bank day, one marked key: MT940, camt and a bare day, with or without the stated day, on any time', () => {
  for (const d of DAYS) {
    const want = `d2|${d}|-12.90|DE02120300000000202051|E1`;
    const kept = inZone('Europe/Berlin', () => ({ mt940: midnight(d), camt: noon(d) }));
    for (const zone of ZONES) {
      inZone(zone, () => {
        // Kept on German time before this, read here.
        assert.equal(txKey(booking(kept.mt940)), want, `kept MT940 ${d} read in ${zone}`);
        assert.equal(txKey(booking(kept.camt)), want, `kept camt ${d} read in ${zone}`);
        assert.equal(txKey(booking(d)), want, `bare ${d} in ${zone}`);
        // Fetched here, now: the moment differs by zone, the stated day does not.
        assert.equal(txKey(booking(midnight(d), { bankDay: d })), want, `fresh MT940 ${d} in ${zone}`);
        assert.equal(txKey(booking(noon(d), { bankDay: d })), want, `fresh camt ${d} in ${zone}`);
      });
    }
  }
});

test('the key before: the first ten characters of the moment, as it was', () => {
  inZone('Europe/Berlin', () => {
    // MT940 on German time: the UTC date is the day before.
    assert.equal(legacyTxKey(booking(midnight('2026-11-01'))), '2026-10-31|-12.90|DE02120300000000202051|E1');
    assert.equal(legacyTxKey(booking(midnight('2026-01-01'))), '2025-12-31|-12.90|DE02120300000000202051|E1');
    // camt and a bare day: the day itself — the key now is the key before with the mark in front.
    assert.equal(`d2|${legacyTxKey(booking(noon('2026-11-01')))}`, txKey(booking(noon('2026-11-01'))));
    assert.equal(`d2|${legacyTxKey(booking('2026-11-01'))}`, txKey(booking('2026-11-01')));
    // No key from before ever starts like one of now: its first field is a day, or empty.
    for (const tx of [booking(midnight('2026-11-01')), booking(noon('2026-11-01')), booking('2026-11-01'), booking(''), booking('morgen')]) {
      assert.match(legacyTxKey(tx), /^(\d{4}-\d{2}-\d{2}|morgen)?\|/, String(tx.entryDate));
      assert.ok(txKey(tx).startsWith('d2|'));
    }
    // The stated day changes nothing about the key before.
    assert.equal(legacyTxKey(booking(midnight('2026-11-01'), { bankDay: '2026-11-01' })), '2026-10-31|-12.90|DE02120300000000202051|E1');
  });
});

test('what is no date keeps the key it had, marked; a stated day that is none is not believed', () => {
  assert.equal(txKey(booking('morgen')), `d2|${legacyTxKey(booking('morgen'))}`);
  assert.equal(txKey(booking('')), 'd2||-12.90|DE02120300000000202051|E1');
  assert.equal(bankDay({ entryDate: '', valueDate: '' }), '');
  assert.equal(bankDay({ bankDay: '01.11.2026', entryDate: '2026-11-01', valueDate: '' }), '2026-11-01');
  assert.equal(bankDay({ bankDay: '2026-02-31', entryDate: '2026-03-03', valueDate: '' }), '2026-03-03');
  // Without a Buchungstag the Wertstellung stands in, as in the key before.
  assert.equal(bankDay({ entryDate: '', valueDate: '2026-11-02' }), '2026-11-02');
});
