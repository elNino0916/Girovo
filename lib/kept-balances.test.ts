import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  KEPT_LIMITS, keepBalances, netWorthPoints, recordNetWorth, sanitizeKeptBalances, sanitizeNetWorth,
  type KeptBalance,
} from './kept-balances.ts';

const at = (iso: string, cents = 1000): KeptBalance => ({ cents, currency: 'EUR', readAt: iso });

test('sanitizeKeptBalances: well-formed entries only, newest reads within the cap', () => {
  const out = sanitizeKeptBalances({
    good: at('2026-11-02T18:02:00.000Z', 78011),
    float: { cents: 1.5, currency: 'EUR', readAt: '2026-11-02T18:02:00.000Z' },
    currency: { cents: 1, currency: 'euro', readAt: '2026-11-02T18:02:00.000Z' },
    date: { cents: 1, currency: 'EUR', readAt: 'gestern' },
    [`x${'y'.repeat(70)}`]: at('2026-11-02T18:02:00.000Z'),
  });
  assert.deepEqual(Object.keys(out), ['good']);
  const many = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`a${i}`, at(new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString())]));
  const capped = sanitizeKeptBalances(many);
  assert.equal(Object.keys(capped).length, KEPT_LIMITS.accounts);
  assert.ok('a59' in capped && !('a0' in capped));
  assert.deepEqual(sanitizeKeptBalances([at('2026-11-02T18:02:00.000Z')]), {});
});

test('keepBalances: a newer read replaces, an older one never does; unchanged keeps the object', () => {
  const kept = { giro: at('2026-11-02T18:00:00.000Z', 100) };
  assert.equal(keepBalances(kept, { giro: at('2026-11-02T18:00:00.000Z', 100) }), kept);
  assert.equal(keepBalances(kept, { giro: at('2026-11-01T18:00:00.000Z', 5) }), kept);
  const next = keepBalances(kept, { giro: at('2026-11-03T08:00:00.000Z', 250), tg: at('2026-11-03T08:01:00.000Z', 9) });
  assert.deepEqual(next.giro, at('2026-11-03T08:00:00.000Z', 250));
  assert.equal(next.tg.cents, 9);
});

test('recordNetWorth: one entry per day, the last of the day; unchanged keeps the array', () => {
  const day = (d: string, total: number) => ({ day: d, total, assets: total, liabilities: 0 });
  const days = [day('2026-11-01', 100)];
  const same = recordNetWorth(days, day('2026-11-01', 100));
  assert.equal(same, days);
  const later = recordNetWorth(days, day('2026-11-01', 150));
  assert.deepEqual(later, [day('2026-11-01', 150)]);
  const next = recordNetWorth(later, day('2026-11-03', 90));
  assert.deepEqual(next.map((d) => d.day), ['2026-11-01', '2026-11-03']);
});

test('sanitizeNetWorth: sorted, one per day, the newest two years', () => {
  const out = sanitizeNetWorth([
    { day: '2026-11-02', total: 2, assets: 2, liabilities: 0 },
    { day: '2026-11-01', total: 1, assets: 1, liabilities: 0 },
    { day: '2026-11-02', total: 3, assets: 3, liabilities: 0 },
    { day: '2.11.2026', total: 1, assets: 1, liabilities: 0 },
    { day: '2026-11-04', total: 0.5, assets: 1, liabilities: 0 },
  ]);
  assert.deepEqual(out.map((d) => [d.day, d.total]), [['2026-11-01', 1], ['2026-11-02', 3]]);
  const long = Array.from({ length: 800 }, (_, i) => ({ day: new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10), total: i, assets: i, liabilities: 0 }));
  assert.equal(sanitizeNetWorth(long).length, KEPT_LIMITS.days);
});

test('netWorthPoints: a staircase up to today, the last reading carried over a gap', () => {
  const days = [
    { day: '2026-11-01', total: 10000, assets: 10000, liabilities: 0 },
    { day: '2026-11-03', total: 12000, assets: 12000, liabilities: 0 },
  ];
  assert.deepEqual(netWorthPoints(days, '2026-11-04'), [
    { date: '2026-11-01', balance: 100 },
    { date: '2026-11-02', balance: 100 },
    { date: '2026-11-03', balance: 120 },
    { date: '2026-11-04', balance: 120 },
  ]);
  assert.equal(netWorthPoints(days.slice(0, 1), '2026-11-04'), null);
});
