import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contractIntentOf, contractsAsked, deadlines, untilOf } from './ask-contracts.ts';
import { intentOf } from './ask-intents.ts';
import type { RecurringSeries } from './recurring.ts';

const TODAY = '2026-11-12';
const CONTRACTS = ['Netflix', 'Spotify'];

test('what can be cancelled by a day: the end of this month unless one is named', () => {
  assert.deepEqual(contractIntentOf('Was kann ich bis Ende des Monats noch kündigen?', TODAY), { kind: 'cancelBy', until: '2026-11-30' });
  assert.deepEqual(contractIntentOf('Welche Verträge kann ich bald kündigen?', TODAY), { kind: 'cancelBy', until: '2026-12-12' });
  assert.deepEqual(contractIntentOf('what can i cancel before the end of the month', TODAY), { kind: 'cancelBy', until: '2026-11-30' });
  assert.deepEqual(contractIntentOf('which subscriptions can i cancel soon', TODAY), { kind: 'cancelBy', until: '2026-12-12' });
  assert.deepEqual(contractIntentOf('Was kann ich bis zum 15.12. kündigen', TODAY), { kind: 'cancelBy', until: '2026-12-15' });
  assert.deepEqual(contractIntentOf('Welche Abos kann ich im Januar kündigen', TODAY), { kind: 'cancelBy', until: '2027-01-31' });
  assert.deepEqual(contractIntentOf('Was kann ich bis nächsten Monat kündigen', TODAY), { kind: 'cancelBy', until: '2026-12-31' });
  assert.deepEqual(contractIntentOf('Welche Verträge laufen dieses Jahr aus', TODAY), { kind: 'cancelBy', until: '2026-12-31' });
  assert.deepEqual(contractIntentOf('Wann kann ich kündigen?', TODAY), { kind: 'cancelBy', until: null });
  // Through intentOf, before "Welche Verträge habe ich?".
  assert.deepEqual(intentOf('Welche Verträge kann ich bald kündigen?', CONTRACTS, TODAY), { kind: 'cancelBy', until: '2026-12-12' });
  assert.deepEqual(intentOf('Welche Verträge habe ich?', CONTRACTS, TODAY), { kind: 'contracts' });
});

test('when one contract renews and by when to cancel it', () => {
  assert.deepEqual(contractIntentOf('Wann verlängert sich mein Handyvertrag?', TODAY), { kind: 'renewal', name: 'handyvertrag' });
  assert.deepEqual(contractIntentOf('Bis wann muss ich Spotify kündigen?', TODAY), { kind: 'renewal', name: 'spotify' });
  assert.deepEqual(contractIntentOf('When does my phone contract renew?', TODAY), { kind: 'renewal', name: 'phone' });
  assert.deepEqual(contractIntentOf('by when do i have to cancel netflix', TODAY), { kind: 'renewal', name: 'netflix' });
  assert.deepEqual(contractIntentOf('Kann ich Netflix noch kündigen?', TODAY), { kind: 'renewal', name: 'netflix' });
  assert.deepEqual(contractIntentOf('Wann läuft Netflix aus', TODAY, CONTRACTS), { kind: 'renewal', name: 'netflix' });
});

test('no contract question', () => {
  for (const q of ['Wann endet der Monat?', 'what can i spend until the end of the month', 'Wann läuft die Rabattaktion aus', 'Wie viel ging an Netflix?']) {
    assert.equal(contractIntentOf(q, TODAY, CONTRACTS), null, q);
  }
});

test('the day a "bis …" names, from today on', () => {
  assert.equal(untilOf('bis Ende des Jahres', TODAY), '2026-12-31');
  assert.equal(untilOf('bis nächste Woche', TODAY), '2026-11-19');
  assert.equal(untilOf('bis zum 3.11.', TODAY), '2027-11-03', 'a day gone this year is next year\'s');
  assert.equal(untilOf('bis 15. Dezember', TODAY), '2026-12-15');
  assert.equal(untilOf('by december 15th', TODAY), '2026-12-15');
  assert.equal(untilOf('im Oktober', TODAY), '2027-10-31');
  assert.equal(untilOf('bis zum 31.11.', TODAY), '2026-11-30', 'a day that does not exist is no day: the default');
  assert.equal(untilOf('was kann ich kündigen', '2026-12-05'), '2026-12-31');
});

const series = (id: string, over: Partial<RecurringSeries> = {}): RecurringSeries => ({
  id, key: `out|cred:${id}`, kind: 'expense', name: id.toUpperCase(), iban: null, creditorId: null, mandateReference: null,
  directDebit: true, category: 'media', cadence: 'monthly', cadenceLabel: 'monatlich', intervalDays: 30,
  amount: -9.99, lastAmount: -9.99, previousAmount: -9.99, changed: false, change: null, priceChange: null, variable: false,
  monthlyAmount: -9.99, yearlyAmount: -119.88, currency: 'EUR', count: 2, firstDate: '2026-01-20', lastDate: '2026-11-10',
  nextDate: '2026-12-10', overdue: false, ended: false, transactions: [], ...over,
} as RecurringSeries);

const LIVE = [
  series('spotify', { name: 'Spotify AB' }),
  series('telekom', { name: 'Telekom Deutschland GmbH', customName: 'Handy', amount: -39.95, yearlyAmount: -479.4 }),
  series('gym', { name: 'McFit GmbH', category: 'leisure' }),
  series('allianz', { name: 'Allianz Versicherungs-AG', category: 'insurance', yearlyAmount: -300 }),
];
const REMINDERS = {
  spotify: { by: '2026-11-20', lead: 7, name: 'Spotify' },
  telekom: { by: '2027-03-01', lead: 30, name: 'Telekom' },
  old: { by: '2026-11-25', lead: 7, name: 'Zeitung' },
  gone: { by: '2026-11-22', lead: 7, name: 'Altvertrag' },
  past: { by: '2026-11-01', lead: 7, name: 'Vorbei' },
};

test('the days to cancel by, the nearest first, none past and none for a contract that ended', () => {
  const ended = [series('gone', { ended: true })];
  assert.deepEqual(deadlines(REMINDERS, LIVE, ended, TODAY, '2026-11-30').map((d) => [d.id, d.name, d.by]), [
    ['spotify', 'Spotify AB', '2026-11-20'],
    ['old', 'Zeitung', '2026-11-25'],
  ]);
  assert.deepEqual(deadlines(REMINDERS, LIVE, ended, TODAY, null).map((d) => d.id), ['spotify', 'old', 'telekom']);
  assert.deepEqual(deadlines(undefined, LIVE, [], TODAY, null), []);
});

test('the contract a question names: by name, by what it is, by the reminder\'s name', () => {
  assert.deepEqual(contractsAsked('spotify', REMINDERS, LIVE, TODAY).map((c) => [c.id, c.by]), [['spotify', '2026-11-20']]);
  // "Handyvertrag": a mobile network's contract, under whatever name.
  assert.deepEqual(contractsAsked('handyvertrag', REMINDERS, LIVE, TODAY).map((c) => [c.id, c.name, c.by]), [['telekom', 'Handy', '2027-03-01']]);
  assert.deepEqual(contractsAsked('fitnessstudio', REMINDERS, LIVE, TODAY).map((c) => [c.id, c.by]), [['gym', null]]);
  assert.deepEqual(contractsAsked('versicherung', REMINDERS, LIVE, TODAY).map((c) => c.id), ['allianz']);
  assert.deepEqual(contractsAsked('zeitung', REMINDERS, LIVE, TODAY).map((c) => [c.id, c.series, c.by]), [['old', null, '2026-11-25']]);
  assert.deepEqual(contractsAsked('netflix', REMINDERS, LIVE, TODAY), []);
});
