import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ActivityEntry } from './app-types';
import { answerBeyondOutcome, idleLogoutNotice, logoutNotice, payeeList, unclearTransfers } from './session-log.ts';

const entry = (over: Partial<ActivityEntry>): ActivityEntry => ({
  id: 'x', at: '2026-10-04T10:00:00.000Z', kind: 'transfer', outcome: 'executed',
  accountNumber: '1', name: 'Lea Becker', iban: 'DE02120300000000202051', amount: 50, instant: false,
  ...over,
});

test('only orders whose outcome is not known are unclear', () => {
  const log = [
    entry({ id: 'a', outcome: 'executed' }),
    entry({ id: 'b', outcome: 'unknown', name: 'Max Mustermann' }),
    entry({ id: 'c', outcome: 'failed' }),
    entry({ id: 'd', outcome: 'unknown' }),
  ];
  assert.deepEqual(unclearTransfers(log).map((e) => e.id), ['b', 'd']);
  assert.deepEqual(unclearTransfers([]), []);
});

test('payees are named once each, joined the German way', () => {
  assert.equal(payeeList([]), '');
  assert.equal(payeeList(['Lea Becker']), 'an Lea Becker');
  assert.equal(payeeList(['Lea Becker', 'Lea Becker ', 'Max Mustermann']), 'an Lea Becker und Max Mustermann');
  assert.equal(payeeList(['A', 'B', 'C']), 'an A, B und C');
});

test('the logout notice claims the PIN is gone only once the server dropped the session', () => {
  assert.equal(logoutNotice('user', false), 'Du hast dich abgemeldet.');
  assert.equal(logoutNotice('user', true), 'Du hast dich abgemeldet. Die App hat deine PIN verworfen.');
  assert.equal(logoutNotice('cancelled', false), 'Anmeldung abgebrochen.');
  assert.equal(logoutNotice('cancelled', true), 'Anmeldung abgebrochen. Die App hat deine PIN verworfen.');
});

test('the idle notice names unclear transfers and asks to check before sending again', () => {
  assert.equal(idleLogoutNotice([]), 'Du wurdest aus Sicherheitsgründen abgemeldet.');
  assert.equal(
    idleLogoutNotice(['Max Mustermann']),
    'Du wurdest aus Sicherheitsgründen abgemeldet. Der Status deiner Überweisung an Max Mustermann ist unklar – prüfe deine Umsätze, bevor du sie noch einmal sendest.',
  );
  // An order without a readable name still counts.
  assert.equal(
    idleLogoutNotice([''], 1),
    'Du wurdest aus Sicherheitsgründen abgemeldet. Der Status deiner Überweisung ist unklar – prüfe deine Umsätze, bevor du sie noch einmal sendest.',
  );
  assert.match(idleLogoutNotice(['Max', 'Lea'], 2), /Der Status von 2 Überweisungen an Max und Lea ist unklar – prüfe deine Umsätze, bevor du eine davon/);
});

test('the bank line that only repeats "Ausgeführt" is left out; everything else stays', () => {
  assert.equal(answerBeyondOutcome({ outcome: 'executed', message: 'Auftrag ausgeführt.' }), '');
  assert.equal(answerBeyondOutcome({ outcome: 'executed', message: 'Der Auftrag wurde ausgeführt' }), '');
  assert.equal(
    answerBeyondOutcome({ outcome: 'executed', message: 'Auftrag ausgeführt.\nDie Gutschrift erfolgt am nächsten Bankarbeitstag.' }),
    'Die Gutschrift erfolgt am nächsten Bankarbeitstag.',
  );
  // An unclear or refused order keeps every word of the bank's.
  assert.equal(answerBeyondOutcome({ outcome: 'unknown', message: 'Auftrag ausgeführt.' }), 'Auftrag ausgeführt.');
  assert.equal(answerBeyondOutcome({ outcome: 'failed', message: 'Auftrag abgelehnt.' }), 'Auftrag abgelehnt.');
  assert.equal(answerBeyondOutcome({ outcome: 'executed' }), '');
});
