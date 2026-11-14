import '../__fixtures__/tz.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SerializedTransaction } from '../fints-types';
import type { CategoryId, CategoryResult } from '../categories';
import type { ContractReminder } from '../contract-watch';
import type { SavingsGoal } from '../savings-goal';
import { EVENT_PERMISSION, dataEvents, eventTargets, snapshotOf, type Subscription } from './events.ts';
import { clientKey, sanitizeApiLog, withLogOutcome } from './grants.ts';
import { account, fakeData, tx } from './fixtures.ts';
import { accountId, bookingIds, seriesId, transactionsList, type ApiData } from './methods.ts';
import { ApiRouter, type RouterHost } from './router.ts';
import { NEVER_KEYS, SETTING_KEYS, settingsGet, settingsSet, type SettingsHost, type SettingsValues } from './settings.ts';
import { TRANSFER_LIMITS, TransferRequests, refreshAnswer, transferAsk, type RefreshReport, type TransferAsk } from './transfers.ts';
import {
  budgetsSet, categoriesCreate, categoriesSet, contractsRename, goalsSet, notesSet, remindersSet, rulesAdd, type ApiActions,
} from './writes.ts';
import { API_PERMISSIONS, type ApiCall, type ApiClient, type ApiGrant, type ApiLogEntry, type ApiPermission } from './types.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

/** The fixtures, with a savings account that takes a goal, a dated-transfer offer, and a payee per IBAN. */
function data(extra: Partial<ApiData> = {}): ApiData {
  const d = fakeData();
  const iban: Record<string, string> = { Rewe: 'DE11', Miete: 'DE22', Arbeitgeber: 'DE33', Netflix: 'DE44', Umbuchung: 'DE55', Shell: 'DE66' };
  const fix = (t: SerializedTransaction) => ({ ...t, remoteIban: `${iban[t.remoteName] ?? 'DE99'}0000000000000000` });
  const giro = [...d.txByAccount['1001'], tx('2026-11-02', -60, 'Shell'), tx('2026-10-20', -55, 'Shell')].map(fix);
  return {
    ...d,
    accounts: [
      { ...d.accounts[0], account: account('1001', { dated: { create: true, list: true, remove: true, change: true, rules: { minDays: 1, maxDays: 360, fromBank: true } } as Any }) },
      { ...d.accounts[1], account: account('2002', { accountType: 'SavingsAccount', canTransfer: false }) },
      d.accounts[2],
    ],
    txByAccount: { 1001: giro, '2002@12345678': d.txByAccount['2002@12345678'].map(fix) },
    categoryOf: (t): CategoryResult => {
      if (t.remoteName === 'Rewe' && t.amount === -54.2) return { id: 'groceries', source: 'manual', parts: [{ id: 'groceries', amount: -44.2 }, { id: 'shopping', amount: -10 }] };
      const base: Record<string, CategoryId> = { Rewe: 'groceries', Miete: 'housing', Arbeitgeber: 'income', Netflix: 'media', Umbuchung: 'transfer', Shell: 'other' };
      return { id: base[t.remoteName] ?? 'other', source: 'auto' };
    },
    customCategories: [{ id: 'c_spenden01', name: 'Spenden', direction: 'out' }],
    reminders: {},
    ...extra,
  };
}

/** A fake vault the actions write to, as the provider's setters would. */
function fakeState(opts: { goalsAllowed?: boolean } = {}) {
  const state = {
    categories: [] as Array<{ name: string; id: CategoryId | null; rule: boolean }>,
    notes: new Map<string, string | null>(),
    budgets: null as Record<string, number> | null,
    goals: new Map<string, Omit<SavingsGoal, 'accountNumber'> | null>(),
    reminders: new Map<string, ContractReminder | null>(),
    names: new Map<string, string | null>(),
    customs: [] as Array<{ name: string; direction: string }>,
  };
  const actions: ApiActions = {
    setCategory: (t, id, rule) => state.categories.push({ name: t.remoteName, id, rule }),
    addCategory: (name, direction) => {
      if (name.toLowerCase() === 'spenden') return { error: 'taken' };
      state.customs.push({ name, direction });
      return { id: 'c_new0001' };
    },
    setNote: (t, text) => state.notes.set(t.remoteName, text),
    setBudgets: (next) => { state.budgets = { ...next } as Record<string, number>; },
    goalsAllowed: opts.goalsAllowed ?? true,
    setGoal: (key, goal) => state.goals.set(key, goal),
    setReminder: (id, r) => state.reminders.set(id, r),
    setContractName: (id, n) => state.names.set(id, n),
  };
  return { state, actions };
}

const res = (out: unknown) => {
  assert.ok(out && typeof out === 'object' && 'result' in out, JSON.stringify(out));
  return (out as { result: Any }).result;
};
const bookingId = (d: ApiData, name: string) => (res(transactionsList(d, { query: name })).transactions[0].id as string);

// ---------------------------------------------------------------------------
// The write methods
// ---------------------------------------------------------------------------

test('categories.set: one booking, a known category or back to automatic; anything else is invalid', () => {
  const d = data();
  const { state, actions } = fakeState();
  const id = bookingId(d, 'Netflix');
  assert.deepEqual(res(categoriesSet(d, actions, { booking: id, category: 'leisure' })).category.id, 'leisure');
  assert.deepEqual(state.categories.at(-1), { name: 'Netflix', id: 'leisure', rule: false });
  res(categoriesSet(d, actions, { booking: id, category: 'c_spenden01' }));
  assert.equal(state.categories.at(-1)!.id, 'c_spenden01', 'an own category');
  res(categoriesSet(d, actions, { booking: id, category: null }));
  assert.equal(state.categories.at(-1)!.id, null);
  const n = state.categories.length;
  for (const bad of [{ booking: id, category: 'made_up' }, { booking: id, category: 'c_unknown00' }, { booking: 't_nope', category: 'leisure' },
    { booking: id }, { category: 'leisure' }, 'x', null]) {
    assert.ok('invalid' in categoriesSet(d, actions, bad), JSON.stringify(bad));
  }
  assert.equal(state.categories.length, n, 'nothing changed by a refused call');
});

test('rules.add: by a booking or a payee name, never over what the user filed by hand', () => {
  const d = data();
  const { state, actions } = fakeState();
  const shell = res(rulesAdd(d, actions, { payee: 'shell', category: 'mobility' }));
  assert.equal(shell.applied, true);
  assert.equal(shell.bookings, 2);
  assert.deepEqual(state.categories, [{ name: 'Shell', id: 'mobility', rule: true }], 'one rule for the counterparty');
  // Rewe has a booking the user split: left alone.
  const rewe = res(rulesAdd(d, actions, { payee: 'Rewe', category: 'shopping' }));
  assert.equal(rewe.applied, false);
  assert.equal(rewe.reason, 'filed_by_hand');
  assert.equal(res(rulesAdd(d, actions, { payee: 'Miete', category: 'housing' })).reason, 'already');
  assert.equal((rulesAdd(d, actions, { payee: 'Niemand', category: 'housing' }) as Any).data.reason, 'not_found');
  res(rulesAdd(d, actions, { booking: bookingId(d, 'Netflix'), category: 'leisure' }));
  assert.deepEqual(state.categories.at(-1), { name: 'Netflix', id: 'leisure', rule: true });
  // No IBAN, no creditor, no name: no rule.
  const blank = data({ txByAccount: { 1001: [tx('2026-11-01', -5, '', { remoteIban: '', purpose: '' })] } });
  const blankId = res(transactionsList(blank, {})).transactions[0].id;
  assert.equal((rulesAdd(blank, actions, { booking: blankId, category: 'other' }) as Any).data.reason, 'no_counterparty');
  assert.ok('invalid' in rulesAdd(d, actions, { payee: 'Shell', category: 'nope' }));
  assert.ok('invalid' in rulesAdd(d, actions, { payee: '   ', category: 'other' }));
});

test('categories.create: a new own category, its name checked as the app checks it', () => {
  const d = data();
  const { state, actions } = fakeState();
  const made = res(categoriesCreate(d, actions, { name: '  Hund  ' }));
  assert.deepEqual(made, { category: { id: 'c_new0001', name: 'Hund' }, direction: 'out' });
  assert.deepEqual(state.customs, [{ name: 'Hund', direction: 'out' }]);
  assert.equal((categoriesCreate(d, actions, { name: 'Spenden' }) as Any).data.reason, 'taken');
  assert.equal((categoriesCreate(d, actions, { name: '   ' }) as Any).data.reason, 'empty');
  assert.equal((categoriesCreate(d, actions, { name: 'Bonus', direction: 'sideways' }) as Any).invalid, 'direction');
  assert.equal(res(categoriesCreate(d, actions, { name: 'Bonus', direction: 'in' })).direction, 'in');
});

test('notes.set: one line, cleaned; null or empty removes it', () => {
  const d = data();
  const { state, actions } = fakeState();
  const id = bookingId(d, 'Miete');
  assert.equal(res(notesSet(d, actions, { booking: id, text: 'Nebenkosten\nNovember' })).note, 'Nebenkosten November');
  assert.equal(state.notes.get('Miete'), 'Nebenkosten November');
  assert.equal(res(notesSet(d, actions, { booking: id, text: '  ' })).note, null);
  assert.equal(state.notes.get('Miete'), null);
  res(notesSet(d, actions, { booking: id, text: null }));
  assert.equal([...res(notesSet(d, actions, { booking: id, text: 'x'.repeat(400) })).note].length, 280);
  assert.ok('invalid' in notesSet(d, actions, { booking: id, text: 5 }));
  assert.ok('invalid' in notesSet(d, actions, { booking: 't_none', text: 'a' }));
});

test('budgets.set: a spending category in whole cents; null removes it; income and Umbuchung take none', () => {
  const d = data();
  const { state, actions } = fakeState();
  res(budgetsSet(d, actions, { category: 'dining', cents: 15000 }));
  assert.deepEqual(state.budgets, { groceries: 30000, housing: 80000, dining: 15000 });
  res(budgetsSet(d, actions, { category: 'groceries', cents: null }));
  assert.deepEqual(state.budgets, { housing: 80000 });
  for (const bad of [{ category: 'income', cents: 100 }, { category: 'transfer', cents: 100 }, { category: 'dining', cents: 0 },
    { category: 'dining', cents: 12.5 }, { category: 'dining', cents: 100_000_000 }, { category: 'dining' }]) {
    assert.ok('invalid' in budgetsSet(d, actions, bad), JSON.stringify(bad));
  }
});

test('goals.set: savings accounts only, Plus where it applies, removed with target null', () => {
  const d = data();
  const { state, actions } = fakeState();
  const savings = accountId('2002@12345678');
  const out = res(goalsSet(d, actions, { account: savings, name: 'Auto', target: 500000, by: '2027-12' }, '2026-11'));
  assert.deepEqual(out.goal, { name: 'Auto', target: 500000, by: '2027-12' });
  assert.deepEqual(state.goals.get('2002@12345678'), { name: 'Auto', target: 500000, by: '2027-12', since: '2026-11' }, 'the existing goal had no since: this month');
  // A goal kept its name when only the target changes.
  res(goalsSet(d, actions, { account: savings, target: 250000 }, '2026-11'));
  assert.equal(state.goals.get('2002@12345678')!.name, 'Urlaub');
  res(goalsSet(d, actions, { account: savings, target: null }, '2026-11'));
  assert.equal(state.goals.get('2002@12345678'), null);
  assert.equal((goalsSet(d, actions, { account: accountId('1001'), name: 'X', target: 100 }, '2026-11') as Any).invalid, 'account', 'a Girokonto takes no goal');
  assert.equal((goalsSet(d, actions, { account: savings, name: 'X', target: 100, by: '2026-01' }, '2026-11') as Any).invalid, 'by');
  assert.equal((goalsSet(d, actions, { account: savings, name: 'X', target: -5 }, '2026-11') as Any).invalid, 'target');
  const noPlus = fakeState({ goalsAllowed: false });
  assert.deepEqual(goalsSet(d, noPlus.actions, { account: savings, name: 'X', target: 100 }, '2026-11'), { fail: 'not_permitted', data: { reason: 'plus' } });
});

test('reminders.set and contracts.rename: by the contract\'s id, as Verträge & Abos sets them', () => {
  const d = data({ reminders: { ser1: { by: '2027-01-31', lead: 14, name: 'Netflix' } } });
  const { state, actions } = fakeState();
  const c = seriesId('ser1');
  assert.deepEqual(res(remindersSet(d, actions, { contract: c, by: '2027-03-31' })).reminder, { by: '2027-03-31', lead: 14 }, 'the lead it had');
  assert.deepEqual(state.reminders.get('ser1'), { by: '2027-03-31', lead: 14, name: 'Netflix' });
  res(remindersSet(d, actions, { contract: c, by: '2027-03-31', lead: 30 }));
  assert.equal(state.reminders.get('ser1')!.lead, 30);
  res(remindersSet(d, actions, { contract: c, by: null }));
  assert.equal(state.reminders.get('ser1'), null);
  assert.equal((remindersSet(d, actions, { contract: c, by: '2026-11-13' }) as Any).invalid, 'by', 'not in the past');
  assert.equal((remindersSet(d, actions, { contract: c, by: '2027-03-31', lead: 3 }) as Any).invalid, 'lead');
  assert.equal((remindersSet(d, actions, { contract: 'c_nope', by: '2027-03-31' }) as Any).invalid, 'contract');

  assert.deepEqual(res(contractsRename(d, actions, { contract: c, name: '  Netflix Familie ' })), { contract: c, name: 'Netflix Familie', own: true });
  assert.equal(state.names.get('ser1'), 'Netflix Familie');
  res(contractsRename(d, actions, { contract: c, name: 'NETFLIX INT' }));
  assert.equal(state.names.get('ser1'), null, 'the bank\'s own name is no name of the user\'s');
  res(contractsRename(d, actions, { contract: c, name: null }));
  assert.equal(state.names.get('ser1'), null);
  assert.equal([...res(contractsRename(d, actions, { contract: c, name: 'x'.repeat(100) })).name].length, 70);
  assert.ok('invalid' in contractsRename(d, actions, { contract: c, name: 4 }));
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function fakeSettings(over: Partial<SettingsValues> = {}) {
  const values: Partial<SettingsValues> = {
    language: 'de', theme: 'system', blackBackground: false, idleMinutes: 10, balancesAtLogin: false, bookingsAtLogin: true,
    keepBalances: true, keepBookings: false, companyLogos: true, ai: true, aiTone: 'friendly', aiLength: 'short', aiUseName: true,
    aiNames: false, singleKeyShortcuts: true, accountOrder: ['1001', '2002@12345678', '3003'], accountGrouping: 'type', hiddenAccounts: [],
    ...over,
  };
  const writes: Array<[string, unknown]> = [];
  const host: SettingsHost = {
    values: () => values,
    write: (k, v) => {
      writes.push([k, v]);
      (values as Record<string, unknown>)[k] = v;
    },
  };
  return { host, writes, values };
}

test('settings.get: the allowlist only, accounts by their ids, and what may only go one way', () => {
  const d = data();
  const { host } = fakeSettings();
  const r = res(settingsGet(d, host));
  assert.deepEqual(Object.keys(r.settings), [...SETTING_KEYS]);
  assert.deepEqual(r.settings.accountOrder, [accountId('1001'), accountId('2002@12345678'), accountId('3003')]);
  assert.ok(!JSON.stringify(r).includes('2002@'), 'no session key leaves');
  assert.deepEqual(r.onlyOn, ['keepBalances', 'keepBookings']);
  assert.deepEqual(r.onlyOff, ['companyLogos']);
  // A setting this app does not offer now is not listed.
  const { host: lean } = fakeSettings({ aiNames: undefined, companyLogos: undefined });
  const lr = res(settingsGet(d, lean));
  assert.ok(!('aiNames' in lr.settings));
  assert.deepEqual(lr.onlyOff, []);
});

test('settings.set: each key checked by its own rule, and written as Einstellungen writes it', () => {
  const d = data();
  const { host, writes, values } = fakeSettings();
  const good: Array<[string, unknown]> = [
    ['language', 'en'], ['theme', 'dark'], ['blackBackground', true], ['idleMinutes', 30], ['balancesAtLogin', true],
    ['bookingsAtLogin', false], ['keepBookings', true], ['companyLogos', false], ['ai', false], ['aiTone', 'plain'],
    ['aiLength', 'long'], ['aiUseName', false], ['aiNames', true], ['singleKeyShortcuts', false], ['accountGrouping', 'bank'],
    ['accountOrder', [accountId('3003'), accountId('1001'), accountId('2002@12345678')]], ['hiddenAccounts', [accountId('3003')]],
  ];
  for (const [key, value] of good) assert.equal(res(settingsSet(d, host, { key, value })).changed, true, key);
  assert.deepEqual(values.accountOrder, ['3003', '1001', '2002@12345678']);
  assert.deepEqual(values.hiddenAccounts, ['3003']);
  assert.equal(writes.length, good.length);
  // The same value again changes nothing and writes nothing.
  assert.equal(res(settingsSet(d, host, { key: 'language', value: 'en' })).changed, false);
  assert.equal(writes.length, good.length);

  const bad: Array<[string, unknown]> = [
    ['language', 'fr'], ['theme', 'blue'], ['blackBackground', 'yes'], ['idleMinutes', 7], ['idleMinutes', '10'], ['aiTone', 'rude'],
    ['accountGrouping', 'colour'], ['accountOrder', [accountId('1001')]], ['accountOrder', [accountId('1001'), accountId('1001'), accountId('3003')]],
    ['hiddenAccounts', [accountId('1001'), accountId('2002@12345678'), accountId('3003')]], ['hiddenAccounts', ['a_nope']],
  ];
  for (const [key, value] of bad) assert.deepEqual((settingsSet(d, host, { key, value }) as Any).invalid, 'value', `${key} ${JSON.stringify(value)}`);
  assert.equal((settingsSet(d, host, { key: 'colour', value: 1 }) as Any).invalid, 'key');
  assert.equal((settingsSet(d, fakeSettings({ aiNames: undefined }).host, { key: 'aiNames', value: true }) as Any).data.reason, 'unavailable');
  assert.equal(writes.length, good.length, 'nothing written by a refused call');
});

test('settings.set: what deletes kept data or needs the user\'s consent is refused', () => {
  const d = data();
  const { host, writes } = fakeSettings({ keepBookings: true, companyLogos: false });
  assert.deepEqual(settingsSet(d, host, { key: 'keepBalances', value: false }), { fail: 'not_permitted', data: { key: 'keepBalances', reason: 'deletes_data' } });
  assert.deepEqual(settingsSet(d, host, { key: 'keepBookings', value: false }), { fail: 'not_permitted', data: { key: 'keepBookings', reason: 'deletes_data' } });
  assert.deepEqual(settingsSet(d, host, { key: 'companyLogos', value: true }), { fail: 'not_permitted', data: { key: 'companyLogos', reason: 'consent' } });
  assert.equal(writes.length, 0);
});

test('settings.set: every key on the never list is refused, whatever the value', () => {
  const d = data();
  const { host, writes } = fakeSettings();
  for (const key of NEVER_KEYS) {
    for (const value of [true, false, null, '1234', { on: true }]) {
      assert.deepEqual(settingsSet(d, host, { key, value }), { fail: 'not_permitted', data: { key, reason: 'never' } }, key);
    }
    assert.ok(!(SETTING_KEYS as readonly string[]).includes(key), `${key} is not on the allowlist too`);
  }
  // Spelled as the spec names them.
  for (const key of ['pin', 'windowsHello', 'securityKeys', 'linkedUnlock', 'forgetDevice', 'deleteData', 'restoreBackup', 'apiOn', 'apiGrants', 'updateChannel', 'installUpdate']) {
    assert.ok((NEVER_KEYS as readonly string[]).includes(key), key);
  }
  assert.equal(writes.length, 0);
});

// ---------------------------------------------------------------------------
// transfers.request
// ---------------------------------------------------------------------------

const IBAN = 'DE89 3704 0044 0532 0130 00';

test('transfers.request: IBAN checksum, name and purpose lengths, the amount, the day, the account', () => {
  const d = data();
  const ok = transferAsk(d, { iban: IBAN, name: ' Stadtwerke  Musterstadt ', cents: 8450, purpose: 'Abschlag' });
  assert.deepEqual(ok, { ask: { name: 'Stadtwerke Musterstadt', iban: 'DE89370400440532013000', cents: 8450, purpose: 'Abschlag' } });
  const dated = transferAsk(d, { iban: IBAN, name: 'A', cents: 1, executeOn: '2026-12-01', account: accountId('1001') }) as { ask: TransferAsk };
  assert.equal(dated.ask.executeOn, '2026-12-01');
  assert.equal(dated.ask.accountKey, '1001');
  assert.equal((transferAsk(d, { iban: IBAN, name: 'A', cents: 1, executeOn: '2026-11-14' }) as { ask: TransferAsk }).ask.executeOn, undefined, 'today is now');
  const cases: Array<[unknown, string]> = [
    [{ iban: 'DE89 3704 0044 0532 0130 01', name: 'A', cents: 1 }, 'iban'],
    [{ iban: 'nonsense', name: 'A', cents: 1 }, 'iban'],
    [{ iban: IBAN, name: '', cents: 1 }, 'name'],
    [{ iban: IBAN, name: 'x'.repeat(71), cents: 1 }, 'name'],
    [{ iban: IBAN, name: 'ä'.repeat(36), cents: 1 }, 'name'],
    [{ iban: IBAN, name: 'A', cents: 0 }, 'cents'],
    [{ iban: IBAN, name: 'A', cents: -100 }, 'cents'],
    [{ iban: IBAN, name: 'A', cents: 1.5 }, 'cents'],
    [{ iban: IBAN, name: 'A', cents: '100' }, 'cents'],
    [{ iban: IBAN, name: 'A', cents: 1, purpose: 'p'.repeat(141) }, 'purpose'],
    [{ iban: IBAN, name: 'A', cents: 1, executeOn: '2026-11-13' }, 'executeOn'],
    [{ iban: IBAN, name: 'A', cents: 1, executeOn: '14.12.2026' }, 'executeOn'],
    [{ iban: IBAN, name: 'A', cents: 1, account: accountId('2002@12345678') }, 'account'],
    [{ iban: IBAN, name: 'A', cents: 1, account: 'a_nope' }, 'account'],
    [{ iban: 'DE00123456780000001001', name: 'A', cents: 1, account: accountId('1001') }, 'iban'],
    ['x', 'params'],
  ];
  for (const [params, param] of cases) assert.equal((transferAsk(d, params) as Any).invalid, param, JSON.stringify(params));
  // A day ahead where no account offers a dated transfer.
  const plain = fakeData();
  assert.equal((transferAsk(plain, { iban: IBAN, name: 'A', cents: 1, executeOn: '2026-12-01' }) as Any).data.reason, 'not_offered');
});

test('the transfer requests: pending, settled once, final, seen only by their own app, limited', () => {
  const r = new TransferRequests();
  const a = r.create('app-a', 'c1', '2026-11-14T12:00:00.000Z')!;
  assert.equal(a.state, 'pending');
  assert.equal(r.get(a.id, 'app-b'), null, 'another app does not see it');
  const sent = r.settle(a.id, 'sent', '2026-11-14T12:01:00.000Z', { text: 'Auftrag ausgeführt.', changed: true })!;
  assert.equal(sent.state, 'sent');
  assert.equal(sent.text, 'Auftrag ausgeführt.');
  assert.equal(r.settle(a.id, 'refused', '2026-11-14T12:02:00.000Z'), null, 'final stays final');
  assert.equal(r.get(a.id, 'app-a')!.state, 'sent');
  for (let i = 0; i < TRANSFER_LIMITS.pendingPerApp; i++) assert.ok(r.create('app-a', 'c1', 'x'));
  assert.equal(r.create('app-a', 'c1', 'x'), null, 'too many waiting for one app');
  assert.ok(r.create('app-b', 'c2', 'x'), 'another app may still ask');
  assert.equal(r.pending().length, TRANSFER_LIMITS.pendingPerApp + 1);
  assert.equal(r.get(42, 'app-a'), null);
});

// ---------------------------------------------------------------------------
// The router with phase 2
// ---------------------------------------------------------------------------

const app: ApiClient = {
  pid: 10, exe: 'C:\\Program Files\\Haushalt\\Haushalt.exe', sha256: 'a'.repeat(64), name: 'Haushaltsbuch',
  publisher: { kind: 'verified', name: 'Beispiel GmbH' },
};
const other: ApiClient = { ...app, exe: 'C:\\Tools\\other.exe', name: 'Other' };

function harness(permissions: ApiPermission[], opts: { refresh?: RouterHost['refresh']; data?: () => ApiData } = {}) {
  const grant = (c: ApiClient, p: ApiPermission[]): ApiGrant => ({ exe: c.exe, publisher: { kind: 'verified', name: 'Beispiel GmbH' }, name: c.name, permissions: p, at: '2026-11-01T00:00:00.000Z' });
  let grants: ApiGrant[] = [grant(app, permissions), grant(other, [...API_PERMISSIONS])];
  const log: ApiLogEntry[] = [];
  const notes: Array<{ connection: string; method: string; params: Any }> = [];
  const opened: Array<{ id: string; ask: TransferAsk }> = [];
  const { state, actions } = fakeState();
  const settings = fakeSettings();
  let currentData = opts.data ?? (() => data());
  const host: RouterHost = {
    vaultOpen: () => true,
    grants: () => grants,
    setGrants: (fn) => { grants = fn(grants); },
    data: () => currentData(),
    ask: async (r) => ({ allow: r.permissions }),
    log: (e) => log.push(e),
    now: () => new Date('2026-11-14T12:00:00.000Z'),
    girovoVersion: '7.0.0',
    actions: () => actions,
    settings: settings.host,
    refresh: opts.refresh,
    openTransfer: (record, ask) => opened.push({ id: record.id, ask }),
    notify: (connection, method, params) => notes.push({ connection, method, params }),
    setLogOutcome: (request, outcome) => {
      const i = log.findIndex((e) => e.request === request);
      if (i >= 0) log[i] = { ...log[i], outcome };
    },
  };
  const router = new ApiRouter(host);
  let id = 0;
  const call = async (client: ApiClient, method: string, params?: unknown, connection = 'c1'): Promise<Any> =>
    router.handle({ id: ++id, connection, client, method, params } satisfies ApiCall);
  const hello = (client = app, connection = 'c1') => call(client, 'girovo.hello', { app: 'H', permissions: [] }, connection);
  return {
    router, call, hello, log, notes, opened, state, settings,
    setGrants: (fn: (g: ApiGrant[]) => ApiGrant[]) => { grants = fn(grants); },
    setData: (fn: () => ApiData) => { currentData = fn; },
  };
}

test('router: each write needs its permission, is done through the actions and is in the Verlauf', async () => {
  const h = harness(['transactions.read', 'categories.write', 'settings.read']);
  await h.hello();
  const id = (await h.call(app, 'girovo.transactions.list', { query: 'Netflix' })).result.transactions[0].id;
  const set = await h.call(app, 'girovo.categories.set', { booking: id, category: 'leisure' });
  assert.equal(set.result.category.id, 'leisure');
  assert.equal(h.state.categories.length, 1);
  const note = await h.call(app, 'girovo.notes.set', { booking: id, text: 'x' });
  assert.deepEqual(note.error.data, { permission: 'notes.write' });
  assert.equal((await h.call(app, 'girovo.settings.set', { key: 'language', value: 'en' })).error.data.permission, 'settings.write');
  const bad = await h.call(app, 'girovo.categories.set', { booking: id, category: 'nope' });
  assert.deepEqual(bad.error.data, { param: 'category' });
  const entry = h.log.find((e) => e.method === 'categories.set' && e.ok);
  assert.ok(entry);
});

test('router: settings.set names the key in the Verlauf; refusals carry a reason for the developer', async () => {
  const h = harness(['settings.read', 'settings.write']);
  await h.hello();
  assert.equal((await h.call(app, 'girovo.settings.set', { key: 'theme', value: 'dark' })).result.changed, true);
  const never = await h.call(app, 'girovo.settings.set', { key: 'pin', value: '0000' });
  assert.equal(never.error.code, 'not_permitted');
  assert.equal(never.error.data.reason, 'never');
  assert.match(never.error.message, /only be changed in Girovo/);
  const keep = await h.call(app, 'girovo.settings.set', { key: 'keepBalances', value: false });
  assert.equal(keep.error.data.reason, 'deletes_data');
  const lines = h.log.filter((e) => e.method === 'settings.set');
  assert.deepEqual(lines.map((e) => [e.detail, e.ok]), [['theme', true], ['pin', false], ['keepBalances', false]]);
  assert.ok((await h.call(app, 'girovo.settings.get')).result.settings.theme === 'dark');
});

test('router: a transfer request answers pending, opens the sheet, and later says how it ended', async () => {
  const h = harness(['transfers.request']);
  await h.hello();
  const out = await h.call(app, 'girovo.transfers.request', { iban: IBAN, name: 'Stadtwerke', cents: 8450, purpose: 'Abschlag' });
  assert.equal(out.result.state, 'pending');
  const request = out.result.request as string;
  assert.equal(h.opened.length, 1);
  assert.equal(h.opened[0].ask.cents, 8450);
  assert.equal(h.log.at(-1)!.outcome, 'pending');
  assert.equal((await h.call(app, 'girovo.transfers.status', { request })).result.state, 'pending');
  // Another app can't read it, even with the permission.
  await h.hello(other, 'c2');
  assert.equal((await h.call(other, 'girovo.transfers.status', { request }, 'c2')).error.code, 'invalid');
  // The other app subscribed to transfer.updated hears nothing of this app's request.
  await h.call(other, 'girovo.events.subscribe', { kinds: ['transfer.updated'] }, 'c2');

  h.router.settleTransfer(request, 'sent', { text: 'Auftrag ausgeführt.', changed: true });
  assert.deepEqual(h.notes, [{ connection: 'c1', method: 'girovo.transfer.updated', params: { request, state: 'sent', text: 'Auftrag ausgeführt.', changed: true } }]);
  assert.deepEqual((await h.call(app, 'girovo.transfers.status', { request })).result, { request, state: 'sent', text: 'Auftrag ausgeführt.', changed: true });
  assert.equal(h.log.find((e) => e.request === request)!.outcome, 'sent', 'the Verlauf names the outcome');
  // Settled once: a second end changes nothing, tells nobody.
  assert.equal(h.router.settleTransfer(request, 'refused'), null);
  assert.equal(h.notes.length, 1);
  const invalid = await h.call(app, 'girovo.transfers.request', { iban: 'DE00', name: 'A', cents: 1 });
  assert.deepEqual(invalid.error.data, { param: 'iban' });
});

test('router: requests still waiting end as refused at the logout; a hung up app is not told', async () => {
  const h = harness(['transfers.request']);
  await h.hello();
  const a = (await h.call(app, 'girovo.transfers.request', { iban: IBAN, name: 'A', cents: 1 })).result.request;
  h.router.closed('c1');
  h.router.settlePending();
  assert.equal(h.notes.length, 0, 'nobody to tell');
  assert.equal(h.router.transfers.get(a, clientKey(app))!.state, 'refused');
  // Too many waiting: refused with a reason.
  await h.hello(app, 'c3');
  for (let i = 0; i < TRANSFER_LIMITS.pendingPerApp; i++) await h.call(app, 'girovo.transfers.request', { iban: IBAN, name: 'A', cents: 1 }, 'c3');
  const busy = await h.call(app, 'girovo.transfers.request', { iban: IBAN, name: 'A', cents: 1 }, 'c3');
  assert.equal(busy.error.data.reason, 'busy');
});

test('the Verlauf keeps a transfer\'s outcome and a setting\'s key', () => {
  const line: ApiLogEntry = { at: '2026-11-14T12:00:00.000Z', app: 'a', name: 'A', method: 'transfers.request', ok: true, request: 'r_1', outcome: 'pending' };
  const updated = withLogOutcome([line], 'r_1', 'failed');
  assert.equal(updated[0].outcome, 'failed');
  const clean = sanitizeApiLog([...updated, { ...line, method: 'settings.set', request: undefined, outcome: undefined, detail: 'theme' }, { ...line, outcome: 'won' }]);
  assert.equal(clean[0].outcome, 'failed');
  assert.equal(clean[1].detail, 'theme');
  assert.equal(clean[2].outcome, undefined, 'an unknown state is dropped');
});

test('router: bank.refresh answers the new bookings, the bank\'s words, or that the user said no', async () => {
  const report: { next: RefreshReport; brings?: () => ApiData } = { next: { steps: [] } };
  // The reads bring their data while the refresh runs.
  const h = harness(['bank.refresh'], { refresh: async () => { if (report.brings) h.setData(report.brings); return report.next; } });
  await h.hello();
  const before = data();
  const fresh = tx('2026-11-14', -9.99, 'Spotify', { remoteIban: 'DE770000000000000000' });
  const after = () => ({ ...before, txByAccount: { ...before.txByAccount, 1001: [fresh, ...before.txByAccount['1001']] } });
  report.next = { steps: [{ key: '1001', outcome: 'applied' }, { key: '2002@12345678', outcome: 'applied' }] };
  report.brings = after;
  const out = await h.call(app, 'girovo.bank.refresh');
  report.brings = undefined;
  assert.equal(out.result.newBookings, 1);
  assert.deepEqual(out.result.accounts.map((a: Any) => [a.state, a.newBookings]), [['read', 1], ['read', 0]]);
  assert.deepEqual(out.result.accounts[0].balance, { cents: 123456, currency: 'EUR' });

  report.next = { steps: [{ key: '1001', outcome: 'cancelled' }] };
  assert.equal((await h.call(app, 'girovo.bank.refresh', { account: accountId('1001') })).error.code, 'refused_by_user');
  report.next = { steps: [{ key: '1001', outcome: 'failed', error: 'Der Auftrag wurde abgelehnt.' }] };
  const failed = await h.call(app, 'girovo.bank.refresh');
  assert.equal(failed.error.code, 'bank_error');
  assert.equal(failed.error.message, 'Der Auftrag wurde abgelehnt.');
  assert.equal(failed.error.data.text, 'Der Auftrag wurde abgelehnt.');
  assert.deepEqual((await h.call(app, 'girovo.bank.refresh', { account: 'a_nope' })).error.data, { param: 'account' });
});

test('refreshAnswer: a read that stopped at a called off Freigabe keeps what came before it', () => {
  const d = data();
  const out = res(refreshAnswer(d, d, { steps: [{ key: '1001', outcome: 'applied' }, { key: '2002@12345678', outcome: 'cancelled' }] }));
  assert.equal(out.stopped, true);
  assert.deepEqual(out.accounts.map((a: Any) => a.state), ['read', 'cancelled']);
});

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

test('events: subscribing needs the permission of each kind; a hang-up ends it', async () => {
  const h = harness(['accounts.read']);
  await h.hello();
  const no = await h.call(app, 'girovo.events.subscribe', { kinds: ['bookings.new'] });
  assert.deepEqual(no.error.data, { permission: 'transactions.read', kind: 'bookings.new' });
  assert.deepEqual((await h.call(app, 'girovo.events.subscribe', { kinds: ['balances.changed'] })).result.subscribed, ['balances.changed']);
  assert.equal((await h.call(app, 'girovo.events.subscribe', { kinds: ['everything'] })).error.data.kind, 'everything');
  assert.equal((await h.call(app, 'girovo.events.subscribe', { kinds: [] })).error.code, 'invalid');
  assert.ok(h.router.hasSubscribers());
  h.router.closed('c1');
  assert.equal(h.router.hasSubscribers(), false);
  await h.hello();
  await h.call(app, 'girovo.events.subscribe', { kinds: ['balances.changed'] });
  assert.deepEqual((await h.call(app, 'girovo.events.unsubscribe', {})).result.subscribed, []);
  assert.equal(h.router.hasSubscribers(), false);
});

test('events: new bookings and changed balances go to subscribers whose app may read them', async () => {
  const h = harness(['accounts.read', 'transactions.read']);
  await h.hello();
  await h.call(app, 'girovo.events.subscribe', { kinds: ['bookings.new', 'balances.changed'] });
  await h.hello(other, 'c2');
  await h.call(other, 'girovo.events.subscribe', { kinds: ['balances.changed'] }, 'c2');
  const d0 = data();
  h.router.dataChanged(snapshotOf(d0), d0);
  assert.equal(h.notes.length, 0, 'the first snapshot is a starting point');
  const fresh = tx('2026-11-14', -9.99, 'Spotify', { remoteIban: 'DE770000000000000000' });
  const d1: ApiData = {
    ...d0,
    txByAccount: { ...d0.txByAccount, 1001: [fresh, ...d0.txByAccount['1001']] },
    accounts: d0.accounts.map((a) => (a.key === '1001' ? { ...a, balance: { ...a.balance!, balance: 1224.57 } } : a)),
  };
  h.router.dataChanged(snapshotOf(d1), d1);
  const booked = h.notes.filter((n) => n.method === 'girovo.bookings.new');
  assert.equal(booked.length, 1);
  assert.equal(booked[0].connection, 'c1');
  assert.equal(booked[0].params.count, 1);
  assert.equal(booked[0].params.bookings[0].counterparty.name, 'Spotify');
  const balances = h.notes.filter((n) => n.method === 'girovo.balances.changed');
  assert.deepEqual(balances.map((n) => n.connection).sort(), ['c1', 'c2']);
  assert.deepEqual(balances[0].params.balance, { cents: 122457, currency: 'EUR', day: '2026-11-14' });
  // A permission taken back stops its events at once.
  h.notes.length = 0;
  h.setGrants((g) => g.map((x) => (x.name === 'Haushaltsbuch' ? { ...x, permissions: ['transactions.read'] } : x)));
  const d2: ApiData = { ...d1, accounts: d1.accounts.map((a) => (a.key === '1001' ? { ...a, balance: { ...a.balance!, balance: 1000 } } : a)) };
  h.router.dataChanged(snapshotOf(d2), d2);
  assert.deepEqual(h.notes.map((n) => n.connection), ['c2']);
});

test('eventTargets and dataEvents: filtered by kind and permission; an account loaded later is no news', () => {
  const grants: ApiGrant[] = [{ exe: app.exe, publisher: { kind: 'verified', name: 'Beispiel GmbH' }, name: 'H', permissions: ['accounts.read'], at: 'x' }];
  const subs: Subscription[] = [
    { connection: 'a', client: app, kinds: new Set(['balances.changed', 'bookings.new']) },
    { connection: 'b', client: other, kinds: new Set(['balances.changed']) },
  ];
  assert.deepEqual(eventTargets(subs, grants, 'balances.changed'), ['a'], 'b has no grant');
  assert.deepEqual(eventTargets(subs, grants, 'bookings.new'), [], 'no transactions.read');
  assert.equal(EVENT_PERMISSION['transfer.updated'], 'transfers.request');
  const d = data();
  const empty: ApiData = { ...d, txByAccount: {} };
  assert.deepEqual(dataEvents(snapshotOf(empty), snapshotOf(d), d).filter((e) => e.kind === 'bookings.new'), []);
  assert.equal(bookingIds(d).get('1001')!.size, 8);
});
