import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CALM_MS, MIN_DAYS, MIN_REFRESHES, asked, mayAsk, noted, readState, type ReviewMoment, type ReviewState,
} from './play-review.ts';

const DAY = 86_400_000;
const START = Date.UTC(2026, 9, 1, 9);
const VERSION = '5.15.0';

/** A phone first started at START, with `refreshes` reads landed, nothing failed, nothing approved. */
const used = (refreshes: number): ReviewState => ({
  firstSeen: START, refreshes, askedIn: null, troubleAt: null, approvalAt: null,
});

const after = (state: ReviewState, moments: Array<[ReviewMoment, number]>): ReviewState =>
  moments.reduce((s, [m, at]) => noted(s, m, at), state);

test('a few reads into a week of use, a landed read is the moment', () => {
  const now = START + MIN_DAYS * DAY;
  const s = noted(used(MIN_REFRESHES - 1), 'refresh', now);
  assert.equal(s.refreshes, MIN_REFRESHES);
  assert.equal(mayAsk(s, { kind: 'refresh', at: now }, now, VERSION), true);
  // One read fewer: not yet.
  assert.equal(mayAsk(used(MIN_REFRESHES - 1), { kind: 'refresh', at: now }, now, VERSION), false);
});

test('never in the first week, however much is read or sent', () => {
  const now = START + MIN_DAYS * DAY - 1;
  const s = used(40);
  assert.equal(mayAsk(s, { kind: 'refresh', at: now }, now, VERSION), false);
  assert.equal(mayAsk(s, { kind: 'transfer', at: now }, now, VERSION), false);
});

test('a transfer that went through is the moment without the reads, its own approval included', () => {
  const now = START + 10 * DAY;
  const s = after(used(0), [['approval', now - 30_000], ['transfer', now]]);
  assert.equal(mayAsk(s, { kind: 'transfer', at: now }, now, VERSION), true);
});

test('never right after something failed', () => {
  const now = START + 10 * DAY;
  const failed = after(used(9), [['trouble', now - 60_000]]);
  assert.equal(mayAsk(failed, { kind: 'refresh', at: now }, now, VERSION), false);
  assert.equal(mayAsk(failed, { kind: 'transfer', at: now }, now, VERSION), false);
  // Long enough ago, it no longer counts.
  const later = now - 60_000 + CALM_MS;
  assert.equal(mayAsk(failed, { kind: 'refresh', at: later }, later, VERSION), true);
});

test('a TAN that ran out before the transfer went through keeps the card away', () => {
  const now = START + 10 * DAY;
  const s = after(used(0), [['approval', now - 200_000], ['trouble', now - 80_000], ['approval', now - 60_000], ['transfer', now]]);
  assert.equal(mayAsk(s, { kind: 'transfer', at: now }, now, VERSION), false);
});

test('not for a read the user had to approve, nor one right after an approval', () => {
  const now = START + 10 * DAY;
  const s = after(used(9), [['approval', now - 20_000], ['refresh', now]]);
  assert.equal(mayAsk(s, { kind: 'refresh', at: now }, now, VERSION), false);
  const calm = now + CALM_MS;
  assert.equal(mayAsk(noted(s, 'refresh', calm), { kind: 'refresh', at: calm }, calm, VERSION), true);
});

test('what happens before Play is asked counts too', () => {
  const at = START + 10 * DAY;
  const good = { kind: 'transfer' as const, at };
  const s = noted(used(0), 'transfer', at);
  assert.equal(mayAsk(s, good, at, VERSION), true);
  // The next read asks for an approval: something else is under way.
  assert.equal(mayAsk(noted(s, 'approval', at + 1000), good, at + 2000, VERSION), false);
  // …or it failed.
  assert.equal(mayAsk(noted(s, 'trouble', at + 1000), good, at + 2000, VERSION), false);
  assert.equal(mayAsk(s, good, at + 2000, VERSION), true);
});

test('at most once per version; the next one after a few reads again', () => {
  const now = START + 10 * DAY;
  const once = asked(used(9), VERSION);
  assert.equal(once.refreshes, 0);
  assert.equal(mayAsk(once, { kind: 'transfer', at: now }, now, VERSION), false);
  assert.equal(mayAsk(noted({ ...once, refreshes: 40 }, 'refresh', now), { kind: 'refresh', at: now }, now, VERSION), false);
  // The next version: a transfer may be the moment at once, a read after a few more.
  assert.equal(mayAsk(once, { kind: 'transfer', at: now }, now, '5.16.0'), true);
  assert.equal(mayAsk(noted(once, 'refresh', now), { kind: 'refresh', at: now }, now, '5.16.0'), false);
  const reads = after(once, Array.from({ length: MIN_REFRESHES }, (): [ReviewMoment, number] => ['refresh', now]));
  assert.equal(mayAsk(reads, { kind: 'refresh', at: now }, now, '5.16.0'), true);
});

test('the kept state is read defensively', () => {
  const now = START + DAY;
  // Nothing kept, or nothing readable: a fresh state from now.
  for (const raw of [null, '', 'nonsense', '[]', '42', '{"firstSeen":"yesterday","refreshes":-3,"askedIn":7}']) {
    assert.deepEqual(readState(raw, now), { firstSeen: now, refreshes: 0, askedIn: null, troubleAt: null, approvalAt: null }, String(raw));
  }
  const kept = { firstSeen: START, refreshes: 6, askedIn: '5.14.2', troubleAt: now - 5, approvalAt: now - 9 };
  assert.deepEqual(readState(JSON.stringify(kept), now), kept);
  // A first start "in the future" (the clock was set back) would hold the card off for good.
  assert.equal(readState(JSON.stringify({ firstSeen: now + 30 * DAY }), now).firstSeen, now);
});
