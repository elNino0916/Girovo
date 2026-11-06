import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  contractNotices, dayNum, reminderDaysLeft, reminderDue, sanitizeNoticed, sanitizeReminders, unseenNotices, withNoticed,
} from './contract-watch.ts';
import type { RecurringSeries } from './recurring.ts';

const series = (id: string, over: Partial<RecurringSeries> = {}): RecurringSeries => ({
  id, key: `out|cred:${id}`, kind: 'expense', name: id.toUpperCase(), iban: null, creditorId: null, mandateReference: null,
  directDebit: true, category: 'subscriptions', cadence: 'monthly', cadenceLabel: 'monatlich', intervalDays: 30,
  amount: -14.99, lastAmount: -14.99, previousAmount: -12.99, changed: false, change: null, priceChange: null, variable: false,
  monthlyAmount: -14.99, yearlyAmount: -179.88, currency: 'EUR', count: 6, firstDate: '2026-04-10', lastDate: '2026-09-10',
  nextDate: '2026-10-12', overdue: false, ended: false, transactions: [], ...over,
} as RecurringSeries);

const name = (s: RecurringSeries) => s.name;

test('dayNum takes only real days', () => {
  assert.equal(dayNum('2026-03-01')! - dayNum('2026-02-28')!, 1);
  assert.equal(dayNum('2026-02-30'), null);
  assert.equal(dayNum('31.03.2026'), null);
});

test('a reminder speaks from its lead until a few days past its day', () => {
  const r = { by: '2026-11-30', lead: 14 };
  assert.equal(reminderDaysLeft(r, '2026-11-15'), null, 'fifteen days before: not yet');
  assert.equal(reminderDaysLeft(r, '2026-11-16'), 14);
  assert.equal(reminderDaysLeft(r, '2026-11-30'), 0);
  assert.equal(reminderDaysLeft(r, '2026-12-03'), -3);
  assert.equal(reminderDaysLeft(r, '2026-12-04'), null, 'past: gone from Mitteilungen');
  assert.equal(reminderDue(r, '2026-11-30'), true);
  assert.equal(reminderDue(r, '2026-12-01'), false, 'no notification once the day is past');
});

test('notices: reminders nearest first, then this autumn\'s price rises, newest first', () => {
  const live = [
    series('spotify', { priceChange: { since: '2026-09-10', previous: 12.99, delta: 2, perYear: 24 } }),
    series('netflix', { priceChange: { since: '2026-08-20', previous: 13.99, delta: 1, perYear: 12 } }),
    series('gym', { priceChange: { since: '2026-04-01', previous: 30, delta: 5, perYear: 60 } }),
    series('cheaper', { priceChange: { since: '2026-09-15', previous: 20, delta: -2, perYear: -24 } }),
  ];
  const reminders = {
    netflix: { by: '2026-10-20', lead: 30, name: 'Netflix' },
    phone: { by: '2026-10-05', lead: 7, name: 'Telefon (nicht mehr in der Liste)' },
    later: { by: '2027-03-01', lead: 30, name: 'Später' },
  };
  const notices = contractNotices(live, reminders, '2026-10-03', name);
  assert.deepEqual(notices.map((n) => n.key), [
    'cancel|phone|2026-10-05', 'cancel|netflix|2026-10-20', 'price|spotify|2026-09-10', 'price|netflix|2026-08-20',
  ]);
  const phone = notices[0];
  assert.equal(phone.kind === 'cancel' && phone.daysLeft, 2);
  assert.equal(phone.name, 'Telefon (nicht mehr in der Liste)', 'a contract no longer detected keeps the name it was saved with');
  assert.equal(notices[1].name, 'NETFLIX', 'a live one is named as Verträge names it');
});

test('seen once, the dot does not come back for it', () => {
  const live = [series('spotify', { priceChange: { since: '2026-09-10', previous: 12.99, delta: 2, perYear: 24 } })];
  const notices = contractNotices(live, undefined, '2026-10-03', name);
  assert.equal(unseenNotices(notices, undefined).length, 1);
  const noticed = withNoticed(undefined, notices);
  assert.equal(unseenNotices(notices, noticed).length, 0);
  assert.deepEqual(withNoticed(noticed, notices), noticed, 'no duplicates');
});

test('the vault keeps only well-formed reminders and keys', () => {
  assert.deepEqual(sanitizeReminders({
    ok: { by: '2026-12-31', lead: 30, name: ' Strom\u0007 ' },
    badDay: { by: '2026-13-01', lead: 30, name: 'x' },
    badLead: { by: '2026-12-31', lead: 3, name: 'x' },
    notObject: 'x',
  }), { ok: { by: '2026-12-31', lead: 30, name: 'Strom' } });
  assert.equal(sanitizeReminders([]), undefined);
  assert.equal(sanitizeReminders({}), undefined);
  assert.deepEqual(sanitizeNoticed(['a', 'a', 7, '', 'b']), ['a', 'b']);
  assert.equal(sanitizeNoticed('a'), undefined);
});
