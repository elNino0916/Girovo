import './__fixtures__/tz.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { camtDay } from './camt-day.ts';
import { CamtParser } from './fints-internals.js';
import { statedDay } from './format.ts';

// A camt date is the day the bank wrote, whatever moment lib-fints makes of
// it and whatever time the device is on: "2026-07-22+02:00" read at UTC-10
// is local noon of the 21st, exactly like a bare "2026-07-21" there.

const ZONES = ['Europe/Berlin', 'UTC', 'America/New_York', 'Asia/Tokyo', 'Pacific/Honolulu', 'Pacific/Pago_Pago', 'Pacific/Kiritimati'];

function inZone<T>(zone: string, fn: () => T): T {
  const was = process.env.TZ;
  process.env.TZ = zone;
  try {
    return fn();
  } finally {
    process.env.TZ = was;
  }
}

/** The parser's own reading of a date text (lib-fints CamtParser.parseDate), as a statement read calls it. */
const parse = (text: string) => (CamtParser.prototype as unknown as { parseDate(t: string): Date }).parseDate.call({}, text);

const CASES: [text: string, day: string][] = [
  ['2026-01-22', '2026-01-22'],
  ['2026-01-22+01:00', '2026-01-22'],
  ['2026-07-22+02:00', '2026-07-22'],
  ['2026-01-22Z', '2026-01-22'],
  ['2026-01-22+00:00', '2026-01-22'],
  ['20260122', '2026-01-22'],
  ['2026-01-22T00:00:00', '2026-01-22'],
  ['2026-01-22T23:30:00+01:00', '2026-01-22'],
  ['2026-03-29', '2026-03-29'],
  ['2026-10-25', '2026-10-25'],
];

test('the day a camt date names is the bank’s, read on any time (p7)', () => {
  for (const zone of ZONES) {
    inZone(zone, () => {
      for (const [text, day] of CASES) {
        const d = parse(text);
        assert.equal(camtDay(d), day, `${text} in ${zone}`);
        // What the serialiser takes: the bank's text first, the moment only without it.
        assert.equal(camtDay(d) || statedDay(d), day, `${text} in ${zone}`);
      }
    });
  }
});

test('the moment alone is what went wrong: at UTC-10 a German date reads as the day before', () => {
  inZone('Pacific/Honolulu', () => {
    const d = parse('2026-07-22+02:00');
    assert.equal(statedDay(d), '2026-07-21', 'the moment is local noon of the 21st');
    assert.equal(camtDay(d), '2026-07-22');
  });
});

test('a Date the parser did not make has no text: the caller falls back', () => {
  assert.equal(camtDay(new Date(2026, 6, 22, 12)), '');
  assert.equal(camtDay(new Date(parse('2026-07-22').getTime())), '', 'a copy is another object');
  assert.equal(camtDay('2026-07-22'), '');
  assert.equal(camtDay(null), '');
});

