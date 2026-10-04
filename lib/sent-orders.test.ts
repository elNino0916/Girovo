import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_SENT_ORDERS, SENT_ORDER_DAYS, recordSentOrder, sanitizeSentOrders, type SentOrder } from './sent-orders.ts';

const NOW = Date.UTC(2026, 9, 4, 12, 0, 0);
const IBAN = 'DE02120300000000202051';
const DAY = 24 * 60 * 60 * 1000;

const order = (over: Partial<SentOrder> & { ago?: number } = {}): SentOrder => {
  const { ago = 0, ...rest } = over;
  return {
    at: new Date(NOW - ago).toISOString(),
    accountNumber: '1234567890',
    iban: IBAN,
    cents: 12_000,
    outcome: 'executed',
    ...rest,
  };
};

test('well-formed entries survive, newest first, IBANs compacted', () => {
  const out = sanitizeSentOrders([
    order({ ago: 3 * DAY, outcome: 'unknown' }),
    order({ ago: DAY, iban: 'de02 1203 0000 0000 2020 51' }),
  ], NOW);
  assert.equal(out.length, 2);
  assert.equal(out[0].iban, IBAN);
  assert.equal(out[1].outcome, 'unknown');
  assert.ok(out[0].at > out[1].at);
});

test(`entries older than ${SENT_ORDER_DAYS} days are pruned`, () => {
  const out = sanitizeSentOrders([order({ ago: (SENT_ORDER_DAYS + 1) * DAY }), order({ ago: SENT_ORDER_DAYS * DAY - 1000 })], NOW);
  assert.equal(out.length, 1);
});

test('anything malformed is dropped, never repaired into something else', () => {
  const bad = [
    null, 'x', 42, [],
    { ...order(), at: 'gestern' },
    { ...order(), accountNumber: '' },
    { ...order(), accountNumber: 'a\nb' },
    { ...order(), iban: 'DE02120300000000202052' }, // checksum wrong
    { ...order(), cents: 12.5 },
    { ...order(), cents: 0 },
    { ...order(), cents: '12000' },
    { ...order(), outcome: 'failed' },
    { ...order(), at: new Date(NOW + 3 * DAY).toISOString() }, // far in the future
  ];
  assert.deepEqual(sanitizeSentOrders(bad, NOW), []);
  assert.deepEqual(sanitizeSentOrders('not a list', NOW), []);
  // Unknown keys go.
  const [kept] = sanitizeSentOrders([{ ...order(), name: 'Lea', purpose: 'Miete' }], NOW);
  assert.deepEqual(Object.keys(kept).sort(), ['accountNumber', 'at', 'cents', 'iban', 'outcome']);
});

test('recordSentOrder puts the new order first and caps the log', () => {
  const many = Array.from({ length: MAX_SENT_ORDERS }, (_, i) => order({ ago: (i + 1) * 60_000 }));
  const out = recordSentOrder(many, order({ cents: 99 }), NOW);
  assert.equal(out.length, MAX_SENT_ORDERS);
  assert.equal(out[0].cents, 99);
  assert.equal(recordSentOrder(null, order(), NOW).length, 1);
});
