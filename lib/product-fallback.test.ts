import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UNREGISTERED, restoreProductId, withProductFallback } from './product-fallback.ts';

const OWN = 'B0000000000000000000000CD';
const PREVIOUS = 'A0000000000000000000000AB';

type Answer = { codes: number[] };
const codesOf = (a: Answer) => new Set(a.codes);

/** A bank that answers each product ID as `answers` says, counting the tries. */
function bank(answers: Record<string, number[]>) {
  const config = { productId: OWN };
  const tried: string[] = [];
  const run = async (): Promise<Answer> => {
    tried.push(config.productId);
    return { codes: answers[config.productId] ?? [] };
  };
  return { config, tried, run };
}

const quietly = async <T>(fn: () => Promise<T>): Promise<T> => {
  const { log } = console;
  console.log = () => {};
  try { return await fn(); } finally { console.log = log; }
};

test('a bank that knows the new ID is asked once, with it', async () => {
  const b = bank({ [OWN]: [20, 3920] });
  const r = await withProductFallback(b.config, PREVIOUS, codesOf, b.run);
  assert.deepEqual(b.tried, [OWN]);
  assert.deepEqual(r.codes, [20, 3920]);
  assert.equal(b.config.productId, OWN);
});

test('a bank that does not know it yet (9078) is asked once more, with the previous ID, which the session keeps', async () => {
  const b = bank({ [OWN]: [9010, UNREGISTERED], [PREVIOUS]: [20, 3920] });
  const r = await quietly(() => withProductFallback(b.config, PREVIOUS, codesOf, b.run));
  assert.deepEqual(b.tried, [OWN, PREVIOUS]);
  assert.deepEqual(r.codes, [20, 3920]);
  assert.equal(b.config.productId, PREVIOUS);
});

test('any other refusal is sent once: no second try with the PIN', async () => {
  const b = bank({ [OWN]: [9010, 9931] });
  await withProductFallback(b.config, PREVIOUS, codesOf, b.run);
  assert.deepEqual(b.tried, [OWN]);
});

test('never more than one fallback, and none without a previous ID', async () => {
  const twice = bank({ [OWN]: [UNREGISTERED], [PREVIOUS]: [UNREGISTERED] });
  const r = await quietly(() => withProductFallback(twice.config, PREVIOUS, codesOf, twice.run));
  assert.deepEqual(twice.tried, [OWN, PREVIOUS]);
  assert.ok(r.codes.includes(UNREGISTERED));

  const none = bank({ [OWN]: [UNREGISTERED] });
  await withProductFallback(none.config, null, codesOf, none.run);
  assert.deepEqual(none.tried, [OWN]);

  // A session already on the previous ID (the first step fell back) is not asked twice.
  const again = bank({ [PREVIOUS]: [UNREGISTERED] });
  again.config.productId = PREVIOUS;
  await withProductFallback(again.config, PREVIOUS, codesOf, again.run);
  assert.deepEqual(again.tried, [PREVIOUS]);
});

const device = (systemId: string, productId?: string) => ({ bankingInformation: { systemId }, ...(productId ? { productId } : {}) });

test('a remembered device opens under the ID it was set up with', () => {
  assert.equal(restoreProductId(device('ABC', OWN), OWN, PREVIOUS), OWN);
  assert.equal(restoreProductId(device('ABC', PREVIOUS), OWN, PREVIOUS), PREVIOUS);
  // From before devices named their ID: made under the previous one.
  assert.equal(restoreProductId(device('ABC'), OWN, PREVIOUS), PREVIOUS);
});

test('a device whose ID Girovo no longer sends is synchronised afresh', () => {
  assert.equal(restoreProductId(device('ABC', 'C0000000000000000000000EF'), OWN, PREVIOUS), null);
  // The previous ID retired: its devices start over under the new one.
  assert.equal(restoreProductId(device('ABC', PREVIOUS), OWN, null), null);
  assert.equal(restoreProductId(device('ABC'), OWN, null), null);
  assert.equal(restoreProductId(device('0', OWN), OWN, PREVIOUS), null);
  assert.equal(restoreProductId(null, OWN, PREVIOUS), null);
});
