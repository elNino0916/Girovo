import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REMINDER_EVERY_MS, askAllowed, bankAllowed, forecastAllowed, goalsAllowed, iconChoosable, readStatus, reminderDue, splitAllowed,
  trialDaysOf, unlocked,
} from './plus.ts';

test('Plus locks only in the Play build without it', () => {
  for (const s of ['free', 'active'] as const) {
    assert.equal(unlocked(s), true, s);
    assert.equal(bankAllowed(s, false), true, s);
    assert.equal(forecastAllowed(s), true, s);
    assert.equal(askAllowed(s), true, s);
    assert.equal(splitAllowed(s), true, s);
    assert.equal(goalsAllowed(s), true, s);
  }
  for (const s of ['inactive', 'unavailable'] as const) {
    assert.equal(unlocked(s), false, s);
    assert.equal(forecastAllowed(s), false, s);
    assert.equal(askAllowed(s), false, s);
    assert.equal(splitAllowed(s), false, s);
    assert.equal(goalsAllowed(s), false, s);
    // The bank the app opens with always stays usable.
    assert.equal(bankAllowed(s, true), true, s);
    assert.equal(bankAllowed(s, false), false, s);
  }
  // Still asking: nothing flips to locked while the answer is on its way.
  assert.equal(unlocked(null), true);
});

test('the Plus icon only while Plus is active', () => {
  assert.equal(iconChoosable('active'), true);
  assert.equal(iconChoosable('free'), false);
  assert.equal(iconChoosable('inactive'), false);
});

test("Play's trial length in days", () => {
  assert.equal(trialDaysOf('P3D'), 3);
  assert.equal(trialDaysOf('P1W'), 7);
  assert.equal(trialDaysOf('P1M'), null);
  assert.equal(trialDaysOf(undefined), null);
});

test("the bridge's answer, read safely", () => {
  assert.deepEqual(readStatus({ state: 'active', plan: 'yearly', icon: 'plus' }, true), {
    state: 'active', plan: 'yearly', offers: [], icon: 'plus',
  });
  // The Plus icon cannot outlast Plus.
  assert.equal(readStatus({ state: 'inactive', icon: 'plus' }, true).icon, 'standard');
  // Nonsense: locked on Play, open elsewhere.
  assert.equal(readStatus({ state: 'gold' }, true).state, 'unavailable');
  assert.equal(readStatus(null, false).state, 'free');
  assert.deepEqual(readStatus({
    state: 'inactive',
    offers: [{ plan: 'yearly', price: '9,99 €', trialDays: 3 }, { plan: 'monthly', price: '0,99 €' }, { plan: 'weekly', price: 'x' }],
  }, true).offers, [{ plan: 'monthly', price: '0,99 €', trialDays: null }, { plan: 'yearly', price: '9,99 €', trialDays: 3 }]);
});

test('the Plus reminder comes once a week, only to whom it could sell', () => {
  const now = Date.UTC(2026, 9, 22);
  const week = REMINDER_EVERY_MS;
  // Never asked of a subscriber, off Play, or where Play can't sell.
  for (const s of ['free', 'active', 'unavailable', null] as const) assert.equal(reminderDue(s, now - 2 * week, now), 'none', String(s));
  // The first look only starts the clock.
  assert.equal(reminderDue('inactive', null, now), 'start');
  assert.equal(reminderDue('inactive', NaN, now), 'start');
  assert.equal(reminderDue('inactive', now - week + 1, now), 'wait');
  assert.equal(reminderDue('inactive', now - week, now), 'show');
  assert.equal(reminderDue('inactive', now - 5 * week, now), 'show');
  // A clock set back does not hold the reminder off for good.
  assert.equal(reminderDue('inactive', now + week, now), 'start');
});

test('the owner key opens Plus as a mark of its own, only while active', () => {
  const own = readStatus({ state: 'active', owner: true, icon: 'plus' }, true);
  assert.equal(own.owner, true);
  assert.equal(own.plan, null);
  assert.equal(unlocked(own.state), true);
  assert.equal(iconChoosable(own.state), true);
  assert.equal('owner' in readStatus({ state: 'inactive', owner: true }, true), false);
  assert.equal('owner' in readStatus({ state: 'active', owner: 'yes' }, true), false);
  assert.equal('owner' in readStatus({ state: 'active', plan: 'monthly' }, true), false);
});
