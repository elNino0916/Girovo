import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  disable, enroll, enrolled, forget, isOn, mergeSeen, newBookings, parseSecret, runCheck, touch,
  type BankSide, type CheckedLogin,
} from './background-check.ts';
import type { BackgroundStore } from './background-store.ts';
import type { SerializedTransaction } from './fints-types';

/** A store in memory, as the phone's preferences or the desktop's file would be. */
function memoryStore(): BackgroundStore & { text: string | null } {
  const s = {
    text: null as string | null,
    read: async () => s.text,
    write: async (t: string | null, expected?: string | null) => {
      if (expected !== undefined && s.text !== expected) return false;
      s.text = t;
      return true;
    },
  };
  return s;
}

const secret = crypto.randomBytes(32);
const spk: CheckedLogin = { blz: '50050201', userId: 'max', pin: '12345', bank: 'Sparkasse' };
const dkb: CheckedLogin = { blz: '12030000', userId: 'max.muster', pin: '99999', bank: 'DKB' };
const NOW = Date.parse('2026-11-03T12:00:00Z');

function tx(day: string, amount: number, name: string, ref = ''): SerializedTransaction {
  return {
    valueDate: `${day}T00:00:00.000Z`, entryDate: `${day}T00:00:00.000Z`, amount, currency: 'EUR',
    purpose: '', bookingText: '', remoteName: name, remoteIban: '', remoteBic: '', creditorId: '', ultimateName: '',
    e2eReference: '', mandateReference: '', customerReference: '', bankReference: ref, transactionCode: '',
    primeNotesNr: '', textKeyExtension: '', additionalInformation: '', statementNumber: '',
  } as unknown as SerializedTransaction;
}

/** A bank whose answers the test sets per login and account; it records what was asked. */
function fakeBank(answers: Record<string, unknown>, { busy = [] as string[] } = {}) {
  const asked: string[] = [];
  const opened: string[] = [];
  const closed: string[] = [];
  const side: BankSide = {
    async open(login) {
      opened.push(login.blz);
      const a = answers[`${login.blz}:open`];
      if (a === 'login') return 'login';
      return { handle: login.blz, accounts: (a as string[] | undefined ?? ['DE01']).map((accountNumber) => ({ accountNumber })) };
    },
    async read(handle, accountNumber, from) {
      asked.push(`${handle}:${accountNumber}:${from.toISOString().slice(0, 10)}`);
      const a = answers[`${handle}:${accountNumber}`];
      if (typeof a === 'string') return { kind: a as 'approval' | 'refused' | 'failed' };
      return { kind: 'ok', transactions: (a as SerializedTransaction[] | undefined) ?? [] };
    },
    close(handle) { closed.push(handle); },
    busy(login) { return busy.includes(login.blz); },
  };
  return { side, asked, opened, closed };
}

test('parseSecret: exactly 32 bytes of base64', () => {
  assert.deepEqual(parseSecret(secret.toString('base64')), secret);
  assert.equal(parseSecret(crypto.randomBytes(16).toString('base64')), null);
  assert.equal(parseSecret(undefined), null);
});

test('on, off, and the box names neither a login nor a PIN', async () => {
  const store = memoryStore();
  assert.equal(await isOn(store), false);
  assert.equal(await enroll(store, secret, [spk, dkb], true), 2);
  assert.equal(await isOn(store), true);
  assert.ok(!store.text!.includes('12345') && !store.text!.includes('max'));
  const state = await enrolled(store, secret);
  assert.deepEqual(state?.logins.map((l) => l.bank), ['Sparkasse', 'DKB']);
  assert.ok(state?.logins.every((l) => !('pin' in l)));
  await disable(store);
  assert.equal(await isOn(store), false);
});

test('the first check only learns; the next one reports what is new, counted', async () => {
  const store = memoryStore();
  await enroll(store, secret, [spk], true);
  const first = [tx('2026-10-30', -12.5, 'REWE'), tx('2026-11-01', -3, 'Bäcker')];
  const bank = fakeBank({ '50050201:DE01': first });
  const learnt = await runCheck(store, secret, bank.side, NOW);
  assert.equal(learnt.checked, 1);
  assert.deepEqual(learnt.notices, []);

  // Two equal coffees on one day: the second is new as well.
  const later = [...first, tx('2026-11-03', 2350, 'ARBEITGEBER GMBH'), tx('2026-11-01', -3, 'Bäcker')];
  const bank2 = fakeBank({ '50050201:DE01': later });
  const found = await runCheck(store, secret, bank2.side, NOW + 6 * 3600_000);
  assert.equal(found.notices.length, 1);
  const [n] = found.notices;
  assert.equal(n.kind, 'new');
  assert.equal(n.title, '2 neue Umsätze bei Sparkasse');
  assert.equal(n.lines.length, 2);
  assert.match(n.lines[0], /2\.350,00\s€ · Arbeitgeber GmbH/);
  assert.match(n.lines[1], /−3,00\s€ · Bäcker/);
  // From the last check, three days back — never more than two weeks.
  assert.equal(bank2.asked[0], '50050201:DE01:2026-10-31');
  assert.deepEqual(bank2.closed, ['50050201']);

  // Nothing new the third time.
  const again = await runCheck(store, secret, fakeBank({ '50050201:DE01': later }).side, NOW + 12 * 3600_000);
  assert.deepEqual(again.notices, []);
});

test('amounts off: the notice names who, never how much', async () => {
  const store = memoryStore();
  await enroll(store, secret, [spk], false);
  await runCheck(store, secret, fakeBank({ '50050201:DE01': [] }).side, NOW);
  const found = await runCheck(store, secret, fakeBank({ '50050201:DE01': [tx('2026-11-03', -42.9, 'AMAZON')] }).side, NOW);
  assert.deepEqual(found.notices[0].lines, ['Amazon']);
});

test('a bank that wants an approval pauses its login, said once; a touch resumes it', async () => {
  const store = memoryStore();
  await enroll(store, secret, [spk, dkb], true);
  const bank = fakeBank({ '50050201:DE01': 'approval' });
  const r = await runCheck(store, secret, bank.side, NOW);
  assert.deepEqual(r.notices.map((n) => [n.kind, n.title]), [['approval', 'Sparkasse möchte eine Freigabe']]);
  // Paused: not asked again, and not said again.
  const bank2 = fakeBank({});
  const r2 = await runCheck(store, secret, bank2.side, NOW + 1);
  assert.deepEqual(bank2.opened, ['12030000']);
  assert.deepEqual(r2.notices, []);
  assert.equal((await enrolled(store, secret))?.logins.find((l) => l.blz === spk.blz)?.paused, 'approval');
  // The user logged in: the PIN the bank took replaces the kept one, and checks resume.
  assert.equal(await touch(store, secret, { ...spk, pin: '54321' }), true);
  assert.equal((await enrolled(store, secret))?.logins.find((l) => l.blz === spk.blz)?.paused, undefined);
});

test('a refused PIN is deleted at once and never tried again', async () => {
  const store = memoryStore();
  await enroll(store, secret, [spk, dkb], true);
  const r = await runCheck(store, secret, fakeBank({ '50050201:DE01': 'refused' }).side, NOW);
  assert.equal(r.notices[0].kind, 'refused');
  assert.deepEqual((await enrolled(store, secret))?.logins.map((l) => l.blz), ['12030000']);
  // The last one refused too: nothing is kept, the switch is off.
  await runCheck(store, secret, fakeBank({ '12030000:DE01': 'refused' }).side, NOW);
  assert.equal(await isOn(store), false);
});

test('a remembered device that no longer opens is not taken to the bank', async () => {
  const store = memoryStore();
  await enroll(store, secret, [spk], true);
  const bank = fakeBank({ '50050201:open': 'login' });
  const r = await runCheck(store, secret, bank.side, NOW);
  assert.equal(r.notices[0].kind, 'login');
  assert.deepEqual(bank.asked, []);
  assert.equal((await enrolled(store, secret))?.logins[0].paused, 'login');
});

test('a login in use is left to the app; a failed read says nothing and changes nothing', async () => {
  const store = memoryStore();
  await enroll(store, secret, [spk, dkb], true);
  const bank = fakeBank({ '12030000:DE01': 'failed' }, { busy: ['50050201'] });
  const r = await runCheck(store, secret, bank.side, NOW);
  assert.deepEqual(bank.opened, ['12030000']);
  assert.deepEqual(r.notices, []);
  assert.equal(r.checked, 1);
});

test('bookings the app showed count as seen: no notice for them later', async () => {
  const store = memoryStore();
  await enroll(store, secret, [spk], true);
  await runCheck(store, secret, fakeBank({ '50050201:DE01': [] }).side, NOW);
  const shown = tx('2026-11-03', -9.99, 'NETFLIX');
  const { txKey } = await import('./categories.ts');
  await touch(store, secret, spk, 'DE01', [txKey(shown)]);
  const r = await runCheck(store, secret, fakeBank({ '50050201:DE01': [shown] }).side, NOW + 1);
  assert.deepEqual(r.notices, []);
});

test('forget drops one login; a box another secret sealed is dropped by the next check', async () => {
  const store = memoryStore();
  await enroll(store, secret, [spk, dkb], true);
  await forget(store, secret, dkb);
  assert.deepEqual((await enrolled(store, secret))?.logins.map((l) => l.blz), ['50050201']);
  const r = await runCheck(store, crypto.randomBytes(32), fakeBank({}).side, NOW);
  assert.equal(r.checked, 0);
  assert.equal(await isOn(store), false);
});

test('re-enrolling keeps what each account was seen with', async () => {
  const store = memoryStore();
  await enroll(store, secret, [spk], true);
  await runCheck(store, secret, fakeBank({ '50050201:DE01': [tx('2026-11-01', -5, 'KIOSK')] }).side, NOW);
  await enroll(store, secret, [spk, dkb], true);
  const r = await runCheck(store, secret, fakeBank({ '50050201:DE01': [tx('2026-11-01', -5, 'KIOSK')] }).side, NOW + 1);
  assert.deepEqual(r.notices, []);
});

test('anything but Umsätze ends that login\'s round: no second dialog with the PIN', async () => {
  const store = memoryStore();
  await enroll(store, secret, [spk], true);
  const bank = fakeBank({ '50050201:open': ['DE01', 'DE02', 'DE03'], '50050201:DE01': 'failed' });
  await runCheck(store, secret, bank.side, NOW);
  assert.deepEqual(bank.asked.map((a) => a.split(':')[1]), ['DE01']);
});

test('a round where every read failed does not move the window on', async () => {
  const store = memoryStore();
  await enroll(store, secret, [spk], true);
  await runCheck(store, secret, fakeBank({ '50050201:DE01': 'failed' }).side, NOW);
  assert.equal((await enrolled(store, secret))?.logins[0].checkedAt, undefined);
  await runCheck(store, secret, fakeBank({ '50050201:DE01': [] }).side, NOW);
  assert.ok((await enrolled(store, secret))?.logins[0].checkedAt);
});

test('new bookings are still reported when a later account wants an approval', async () => {
  const store = memoryStore();
  await enroll(store, secret, [spk], true);
  await runCheck(store, secret, fakeBank({ '50050201:open': ['DE01', 'DE02'], '50050201:DE01': [], '50050201:DE02': [] }).side, NOW);
  const r = await runCheck(store, secret, fakeBank({
    '50050201:open': ['DE01', 'DE02'], '50050201:DE01': [tx('2026-11-03', -20, 'TANKSTELLE')], '50050201:DE02': 'approval',
  }).side, NOW + 1);
  assert.deepEqual(r.notices.map((n) => n.kind).sort(), ['approval', 'new']);
});

test('switched off while a check runs: the check does not bring the PINs back', async () => {
  const store = memoryStore();
  await enroll(store, secret, [spk, dkb], true);
  const bank = fakeBank({});
  const read = bank.side.read;
  bank.side.read = async (...args) => {
    await disable(store);
    return read(...args);
  };
  const r = await runCheck(store, secret, bank.side, NOW);
  assert.equal(store.text, null);
  assert.equal(r.on, false);
  assert.equal(await isOn(store), false);
});

test('a PIN the user changed during the check is never deleted for the old one\'s refusal', async () => {
  const store = memoryStore();
  await enroll(store, secret, [spk], true);
  const bank = fakeBank({ '50050201:DE01': 'refused' });
  const read = bank.side.read;
  bank.side.read = async (...args) => {
    await touch(store, secret, { ...spk, pin: '77777' });
    return read(...args);
  };
  await runCheck(store, secret, bank.side, NOW);
  assert.deepEqual((await enrolled(store, secret))?.logins.map((l) => l.blz), ['50050201']);
});

test('a refused PIN is saved as gone before the next login is checked', async () => {
  const store = memoryStore();
  await enroll(store, secret, [spk, dkb], true);
  const bank = fakeBank({ '50050201:DE01': 'refused' });
  const open = bank.side.open;
  let seenWhenDkb: string[] | undefined;
  bank.side.open = async (login) => {
    if (login.blz === dkb.blz) seenWhenDkb = (await enrolled(store, secret))?.logins.map((l) => l.blz);
    return open(login);
  };
  await runCheck(store, secret, bank.side, NOW);
  assert.deepEqual(seenWhenDkb, ['12030000']);
});

test('mergeSeen keeps each key as often as either side has it, and forgets old days', () => {
  const merged = mergeSeen(['2026-11-01|1|a|', '2026-11-01|1|a|'], ['2026-11-01|1|a|', '2026-09-01|1|b|'], NOW);
  assert.deepEqual(merged, ['2026-11-01|1|a|', '2026-11-01|1|a|']);
});

test('newBookings counts equal bookings', () => {
  const a = tx('2026-11-01', -3, 'BÄCKER');
  const { length } = newBookings([], [a, a]);
  assert.equal(length, 2);
});
