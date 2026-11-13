import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  owedByPerson, personMatches, sanitizeSplitRequests, settleRequests, splitRequestId, withRequests, type Incoming, type SplitRequest,
} from './split-requests.ts';

const req = (name: string, cents: number, on: string, tx = 'd2|2026-11-01|-30.00|DE1|R', paid?: SplitRequest['paid']): SplitRequest =>
  ({ tx, name, cents, on, ...(paid ? { paid } : {}) });
const money = (names: string[], cents: number, day: string, key = `in-${day}-${cents}`): Incoming => ({ key, day, cents, names });

test('a person is matched by whole words, the umlauts as a bank writes them', () => {
  assert.ok(personMatches('LEA MUELLER', 'Lea'));
  assert.ok(personMatches('Müller, Lea', 'lea müller'));
  assert.ok(personMatches('Lea Mueller', 'Lea M.'));
  assert.ok(!personMatches('Leander Schmidt', 'Lea'));
  assert.ok(!personMatches('Max Mustermann', 'Lea'));
  assert.ok(!personMatches('', 'Lea'));
});

test('sanitize keeps well formed requests, one per booking and person, and drops the rest', () => {
  const clean = sanitizeSplitRequests([
    req('Lea', 1250, '2026-11-01'),
    { ...req('lea', 1300, '2026-11-02') },
    req('Max', 0, '2026-11-01'),
    req('Tom', 12.5, '2026-11-01'),
    { tx: 'x', name: '  ', cents: 100, on: '2026-11-01' },
    { tx: 'x', name: 'Ana', cents: 100, on: '1.11.2026' },
    { ...req('Ana', 500, '2026-11-01'), paid: { on: 'nope', by: 'k' }, extra: 'gone' },
    null,
  ]);
  assert.deepEqual(clean, [req('lea', 1300, '2026-11-02'), req('Ana', 500, '2026-11-01')]);
  assert.deepEqual(sanitizeSplitRequests('nope'), []);
});

test('splitting a booking again replaces its requests and keeps what was paid for the same amount', () => {
  const paid = { on: '2026-11-03', by: 'k1' };
  const list = [req('Lea', 1000, '2026-11-01', 'A', paid), req('Max', 1000, '2026-11-01', 'A'), req('Lea', 500, '2026-10-01', 'B')];
  const next = withRequests(list, 'A', [{ name: 'Lea', cents: 1000 }, { name: 'Tom', cents: 1000 }], '2026-11-05');
  assert.deepEqual(next, [req('Lea', 500, '2026-10-01', 'B'), req('Lea', 1000, '2026-11-01', 'A', paid), req('Tom', 1000, '2026-11-05', 'A')]);
  assert.equal(splitRequestId(req('Lea Müller', 1, '2026-11-01', 'A')), 'A|lea mueller');
});

test('money from the person on or after the request settles it, the sum or one exact amount', () => {
  const list = [req('Lea', 1000, '2026-11-01', 'A'), req('Lea', 500, '2026-11-04', 'B'), req('Max', 700, '2026-11-01', 'A')];
  // Before the request, from someone else, or too little: nothing.
  assert.equal(settleRequests(list, [money(['LEA MUELLER'], 5000, '2026-10-30'), money(['Tom'], 700, '2026-11-05'), money(['Max'], 300, '2026-11-05')]), list);
  // 10 € from Lea on the 2nd pays the first only (the second was not asked yet).
  const one = settleRequests(list, [money(['LEA MUELLER'], 1000, '2026-11-02', 'k1')]);
  assert.deepEqual(one.map((r) => r.paid?.by ?? null), ['k1', null, null]);
  // 15 € on the 5th covers both of hers.
  const both = settleRequests(list, [money(['Lea Müller'], 1500, '2026-11-05', 'k2')]);
  assert.deepEqual(both.map((r) => r.paid ?? null), [{ on: '2026-11-05', by: 'k2' }, { on: '2026-11-05', by: 'k2' }, null]);
  // 5 € on the 5th equals the second one.
  const exact = settleRequests(list, [money(['Lea'], 500, '2026-11-05', 'k3')]);
  assert.deepEqual(exact.map((r) => r.paid?.by ?? null), [null, 'k3', null]);
  // A booking settles once, and settling again changes nothing.
  assert.equal(settleRequests(one, [money(['LEA MUELLER'], 1000, '2026-11-02', 'k1')]), one);
});

test('what each person owes, the one owing most first, or only the person asked about', () => {
  const list = [
    req('Lea', 1000, '2026-11-01', 'A', { on: '2026-11-03', by: 'k1' }),
    req('Lea Müller', 500, '2026-11-04', 'B'),
    req('lea', 250, '2026-11-06', 'C'),
    req('Max', 700, '2026-11-01', 'A'),
  ];
  const all = owedByPerson(list, null);
  assert.deepEqual(all.map((p) => [p.name, p.openCents, p.paidCents]), [['Max', 700, 0], ['Lea Müller', 500, 0], ['lea', 250, 1000]]);
  const lea = owedByPerson(list, 'lea');
  assert.deepEqual(lea.map((p) => [p.name, p.openCents]), [['Lea Müller', 500], ['lea', 250]]);
  assert.deepEqual(owedByPerson(list, 'tom'), []);
});
