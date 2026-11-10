import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  alertSettings, disable, enroll, enrolled, forget, isOn, limitsKey, mergeSeen, newBookings, parseSecret, runCheck,
  setAlerts, setWatch, touch, type BankSide, type CheckedLogin,
} from './background-check.ts';
import { seriesIdentity } from './recurring.ts';
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

function tx(day: string, amount: number, name: string, ref = '', extra: Partial<Record<string, string>> = {}): SerializedTransaction {
  return {
    valueDate: `${day}T00:00:00.000Z`, entryDate: `${day}T00:00:00.000Z`, amount, currency: 'EUR',
    purpose: '', bookingText: '', remoteName: name, remoteIban: '', remoteBic: '', creditorId: '', ultimateName: '',
    e2eReference: '', mandateReference: '', customerReference: '', bankReference: ref, transactionCode: '',
    primeNotesNr: '', textKeyExtension: '', additionalInformation: '', statementNumber: '',
    ...extra,
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
      // { transactions, balance }: an answer with the statement's closing balance.
      if (a && !Array.isArray(a) && typeof a === 'object') {
        const r = a as { transactions?: SerializedTransaction[]; balance?: number };
        return { kind: 'ok', transactions: r.transactions ?? [], balance: r.balance == null ? null : { value: r.balance, currency: 'EUR' } };
      }
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
  // '"max' as JSON would write either login; a bare "max" turns up in the sealed base64 now and then.
  assert.ok(!store.text!.includes('12345') && !store.text!.includes('"max'));
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

/** The bank's side, noting every login whose refused PIN it was told to delete everywhere. */
function withRefusedHook(bank: ReturnType<typeof fakeBank>) {
  const told: string[] = [];
  bank.side.refused = async (login) => {
    told.push(`${login.blz}:${login.pin}`);
  };
  return told;
}

test('a refused PIN is deleted everywhere: the hook runs once, for that login, after its PIN left the box', async () => {
  const store = memoryStore();
  await enroll(store, secret, [spk, dkb], true);
  const bank = fakeBank({ '50050201:DE01': 'refused' });
  let keptWhenTold: string[] | undefined;
  const told: string[] = [];
  bank.side.refused = async (login) => {
    told.push(`${login.blz}:${login.pin}`);
    keptWhenTold = (await enrolled(store, secret))?.logins.map((l) => l.blz);
  };
  await runCheck(store, secret, bank.side, NOW);
  assert.deepEqual(told, ['50050201:12345']);
  assert.deepEqual(keptWhenTold, ['12030000']);
  // Gone from the box: the next round has nothing to refuse, and nothing to tell.
  await runCheck(store, secret, bank.side, NOW + 1);
  assert.deepEqual(told, ['50050201:12345']);
});

test('the hook stays quiet for an outage, an approval, a device that does not open and a plain read', async () => {
  for (const answers of [
    { '50050201:DE01': 'failed' },
    { '50050201:DE01': 'approval' },
    { '50050201:open': 'login' },
    { '50050201:DE01': [tx('2026-11-01', -3, 'Bäcker')] },
  ]) {
    const store = memoryStore();
    await enroll(store, secret, [spk], true);
    const bank = fakeBank(answers);
    const told = withRefusedHook(bank);
    await runCheck(store, secret, bank.side, NOW);
    assert.deepEqual(told, [], JSON.stringify(answers));
  }
  // A bank that cannot be reached at all (the read throws) says nothing about the PIN either.
  const store = memoryStore();
  await enroll(store, secret, [spk], true);
  const bank = fakeBank({});
  const told = withRefusedHook(bank);
  bank.side.read = async () => {
    throw new Error('ECONNRESET');
  };
  await runCheck(store, secret, bank.side, NOW);
  assert.deepEqual(told, []);
  assert.deepEqual((await enrolled(store, secret))?.logins.map((l) => l.blz), ['50050201']);
});

test('the hook does not run for the old PIN once the user gave a new one, and a failing hook ends nothing', async () => {
  const store = memoryStore();
  await enroll(store, secret, [spk], true);
  const bank = fakeBank({ '50050201:DE01': 'refused' });
  const told = withRefusedHook(bank);
  const read = bank.side.read;
  bank.side.read = async (...args) => {
    await touch(store, secret, { ...spk, pin: '77777' });
    return read(...args);
  };
  await runCheck(store, secret, bank.side, NOW);
  assert.deepEqual(told, []);

  // Switched off meanwhile: the refused PIN may still be kept elsewhere, so the hook runs.
  const off = memoryStore();
  await enroll(off, secret, [spk], true);
  const bank2 = fakeBank({ '50050201:DE01': 'refused' });
  const told2 = withRefusedHook(bank2);
  const read2 = bank2.side.read;
  bank2.side.read = async (...args) => {
    await disable(off);
    return read2(...args);
  };
  assert.equal((await runCheck(off, secret, bank2.side, NOW)).on, false);
  assert.deepEqual(told2, ['50050201:12345']);

  // A hook that throws: the PIN is out of the box all the same, and the next login is still checked.
  const failing = memoryStore();
  await enroll(failing, secret, [spk, dkb], true);
  const bank3 = fakeBank({ '50050201:DE01': 'refused' });
  bank3.side.refused = async () => {
    throw new Error('EBUSY');
  };
  const r = await runCheck(failing, secret, bank3.side, NOW);
  assert.deepEqual(bank3.opened, ['50050201', '12030000']);
  assert.equal(r.notices[0].kind, 'refused');
  assert.deepEqual((await enrolled(failing, secret))?.logins.map((l) => l.blz), ['12030000']);
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


// ---- payment alerts (lib/payment-alerts.ts) ----------------------------------

const NFX = { creditorId: 'DE98ZZZ09999999999', mandateReference: 'NFX-4711', bookingText: 'FOLGELASTSCHRIFT' };
const netflix = (day: string, amount: number) => tx(day, amount, 'Netflix International B.V.', '', NFX);
const salary = (day: string) => tx(day, 2500, 'ACME GmbH', '', { bookingText: 'LOHN/GEHALT' });

test('alerts: a contract kept by 6.0 under the raw bank name is tidied in the notice; a name the user gave stays as typed', async () => {
  const key = seriesIdentity(netflix('2026-10-03', -12.99)).key!;
  const titleFor = async (contract: { name: string; named?: true }) => {
    const store = memoryStore();
    await enroll(store, secret, [spk], true);
    await setWatch(store, secret, { contracts: [{ key, ...contract, cents: 1299, at: '2026-11-01' }], income: [] }, NOW);
    await runCheck(store, secret, fakeBank({ '50050201:DE01': [] }).side, NOW);
    const r = await runCheck(store, secret, fakeBank({ '50050201:DE01': [netflix('2026-11-03', -13.99)] }).side, NOW + 1);
    return r.notices.find((n) => n.kind === 'dearer')?.title;
  };
  assert.equal(await titleFor({ name: 'NETFLIX INTERNATIONAL B.V.' }), 'Netflix International B.V. ist teurer geworden');
  assert.equal(await titleFor({ name: 'HBO', named: true }), 'HBO ist teurer geworden');
});

test('alerts: a dearer contract and salary each get their own notice; the rest is "new"', async () => {
  const store = memoryStore();
  await enroll(store, secret, [spk], true);
  assert.equal(await setWatch(store, secret, {
    contracts: [{ key: seriesIdentity(netflix('2026-10-03', -12.99)).key!, name: 'Netflix International B.V.', cents: 1299, at: '2026-11-01' }],
    income: [],
  }, NOW), true);
  await runCheck(store, secret, fakeBank({ '50050201:DE01': [] }).side, NOW);
  const r = await runCheck(store, secret, fakeBank({
    '50050201:DE01': [netflix('2026-11-03', -13.99), salary('2026-11-02'), tx('2026-11-02', -4.5, 'Bäcker')],
  }).side, NOW + 1);
  assert.deepEqual(r.notices.map((n) => n.kind).sort(), ['dearer', 'income', 'new']);
  const dearer = r.notices.find((n) => n.kind === 'dearer')!;
  assert.equal(dearer.title, 'Netflix International B.V. ist teurer geworden');
  assert.match(dearer.text, /^13,99\s€ statt 12,99\s€ · Sparkasse$/);
  const income = r.notices.find((n) => n.kind === 'income')!;
  assert.equal(income.title, 'Geld eingegangen bei Sparkasse');
  assert.match(income.lines[0], /2\.500,00\s€ · Acme GmbH/i);
  // Told once: the generic notice has only the bakery.
  const plain = r.notices.find((n) => n.kind === 'new')!;
  assert.equal(plain.title, 'Ein neuer Umsatz bei Sparkasse');
  assert.equal(plain.lines.length, 1);

  // The new price is the usual one now: next month's 13,99 is no news.
  const next = await runCheck(store, secret, fakeBank({
    '50050201:DE01': [netflix('2026-11-03', -13.99), salary('2026-11-02'), tx('2026-11-02', -4.5, 'Bäcker'), netflix('2026-12-03', -13.99)],
  }).side, NOW + 2);
  assert.deepEqual(next.notices.map((n) => n.kind), ['new']);
});

test('alerts: "every new booking" off leaves only the specific notices', async () => {
  const store = memoryStore();
  await enroll(store, secret, [spk], false);
  assert.equal(await setAlerts(store, secret, { prefs: { every: false } }), true);
  await runCheck(store, secret, fakeBank({ '50050201:DE01': [] }).side, NOW);
  const r = await runCheck(store, secret, fakeBank({ '50050201:DE01': [salary('2026-11-02'), tx('2026-11-02', -4.5, 'Bäcker')] }).side, NOW + 1);
  assert.deepEqual(r.notices.map((n) => n.kind), ['income']);
  // Amounts off: who, never how much.
  assert.deepEqual(r.notices[0].lines, ['ACME GmbH']);
  // Income off too: nothing at all about bookings.
  await setAlerts(store, secret, { prefs: { income: false } });
  const r2 = await runCheck(store, secret, fakeBank({ '50050201:DE01': [salary('2026-11-02'), salary('2026-11-03')] }).side, NOW + 2);
  assert.deepEqual(r2.notices, []);
});

test('alerts: under a limit is said once, again only after the balance was back above it', async () => {
  const store = memoryStore();
  await enroll(store, secret, [spk], true);
  assert.equal(await setAlerts(store, secret, { limits: [{ login: spk, account: 'DE01', limit: { cents: 10000, label: 'Girokonto' } }] }), true);
  const at = (balance: number, n: number) => runCheck(store, secret, fakeBank({ '50050201:DE01': { transactions: [], balance } }).side, NOW + n);
  const first = await at(50, 0);
  assert.deepEqual(first.notices.map((n) => [n.kind, n.title]), [['low', 'Kontostand unter 100,00\u00a0€']]);
  assert.match(first.notices[0].text, /^Girokonto bei Sparkasse: 50,00\s€$/);
  assert.deepEqual((await at(40, 1)).notices, []);
  assert.deepEqual((await at(200, 2)).notices, []);
  assert.equal((await at(60, 3)).notices.length, 1);
  // A changed limit is judged afresh.
  await setAlerts(store, secret, { limits: [{ login: spk, account: 'DE01', limit: { cents: 8000, label: 'Girokonto' } }] });
  assert.equal((await at(60, 4)).notices.length, 1);
  // Removed: nothing more, whatever the balance.
  await setAlerts(store, secret, { limits: [{ login: spk, account: 'DE01', limit: null }] });
  assert.deepEqual((await at(1, 5)).notices, []);
});

test('alerts: settings stay through a new enrolment, go with their login, and only kept logins take limits', async () => {
  const store = memoryStore();
  await enroll(store, secret, [spk, dkb], true);
  await setAlerts(store, secret, {
    prefs: { dearer: false },
    limits: [
      { login: spk, account: 'DE01', limit: { cents: 100, label: '' } },
      { login: dkb, account: 'DE02', limit: { cents: 200, label: '' } },
      { login: { blz: '10000000', userId: 'nobody' }, account: 'DE03', limit: { cents: 300, label: '' } },
    ],
  });
  await setWatch(store, secret, { contracts: [{ key: 'out|cred:A|mref:1', name: 'A', cents: 500, at: '2026-11-01' }], income: [] }, NOW);
  // Turned on again (a new PIN, another bank): the choices stay.
  await enroll(store, secret, [spk, dkb], false);
  let s = await alertSettings(store, secret);
  assert.equal(s?.prefs.dearer, false);
  assert.equal(s?.amounts, false);
  assert.deepEqual(Object.keys(s!.limits).sort(), [limitsKey(dkb), limitsKey(spk)].sort());
  // The box names no login, no limit label, no contract in the clear.
  assert.ok(!store.text!.includes('out|cred:A'));
  await forget(store, secret, dkb);
  s = await alertSettings(store, secret);
  assert.deepEqual(Object.keys(s!.limits), [limitsKey(spk)]);
  // Off: nothing to change, and nothing changed.
  await disable(store);
  assert.equal(await setAlerts(store, secret, { prefs: { every: false } }), false);
  assert.equal(await setWatch(store, secret, { contracts: [], income: [] }, NOW), false);
  assert.equal(await isOn(store), false);
});

test('reminders: said once per date from their lead, only for kept logins, a new date says it again', async () => {
  const store = memoryStore();
  await enroll(store, secret, [spk], true);
  const owner = `${spk.blz}|${spk.userId}`;
  await setWatch(store, secret, {
    contracts: [], income: [], owner,
    reminders: [
      { owner, id: 'gym', by: '2026-11-10', lead: 7, name: 'FitX' },
      { owner, id: 'later', by: '2026-12-31', lead: 7, name: 'Strom' },
    ],
  }, NOW);
  // Another login's reminder, set while it was kept, says nothing once it is gone.
  await setWatch(store, secret, {
    contracts: [], income: [], owner: 'x|y', reminders: [{ owner: 'x|y', id: 'tv', by: '2026-11-05', lead: 7, name: 'TV' }],
  }, NOW);
  const bank = () => fakeBank({ '50050201:DE01': 'failed' }).side;
  const first = await runCheck(store, secret, bank(), NOW);
  assert.deepEqual(first.notices.map((n) => n.kind), ['remind']);
  assert.equal(first.notices[0].title, 'FitX: Kündigungsfrist');
  assert.equal(first.notices[0].text, 'Kündbar bis 10.11.2026 – noch 7 Tage');
  assert.deepEqual((await runCheck(store, secret, bank(), NOW + 3_600_000)).notices, [], 'said once');

  // The app hands over the same list again: still said.
  await setWatch(store, secret, {
    contracts: [], income: [], owner,
    reminders: [{ owner, id: 'gym', by: '2026-11-10', lead: 7, name: 'FitX' }],
  }, NOW);
  assert.deepEqual((await runCheck(store, secret, bank(), NOW + 7_200_000)).notices, []);
  // A new date: said again.
  await setWatch(store, secret, {
    contracts: [], income: [], owner,
    reminders: [{ owner, id: 'gym', by: '2026-11-08', lead: 7, name: 'FitX' }],
  }, NOW);
  assert.deepEqual((await runCheck(store, secret, bank(), NOW + 10_800_000)).notices.map((n) => n.text), ['Kündbar bis 08.11.2026 – noch 5 Tage']);
});
