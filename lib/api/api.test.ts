import '../__fixtures__/tz.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  API_LIMITS, appendLog, capLog, clientKey, findGrant, grantKey, identityOf, normalPath, sanitizeApiGrants, sanitizeApiLog,
  withGrant, withPermission, withoutGrant,
} from './grants.ts';
import { fakeData } from './fixtures.ts';
import { accountId, accountsList, budgetsList, contractsList, goalsList, insightsMonth, transactionsList } from './methods.ts';
import { ApiRouter, type ConsentAnswer, type ConsentRequest, type RouterHost } from './router.ts';
import type { ApiCall, ApiClient, ApiGrant, ApiLogEntry, ApiProcess } from './types.ts';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

const verified: ApiClient = {
  pid: 10, exe: 'C:\\Program Files\\Haushalt\\Haushalt.exe', sha256: SHA_A, name: 'Haushaltsbuch',
  publisher: { kind: 'verified', name: 'Beispiel GmbH' },
};
const unknownApp: ApiClient = {
  pid: 11, exe: 'C:\\Users\\nino\\Downloads\\tool.exe', sha256: SHA_A, name: 'tool.exe', publisher: { kind: 'unknown' },
};
const claude: ApiProcess = {
  pid: 12, exe: 'C:\\Users\\nino\\AppData\\Local\\Claude\\Claude.exe', sha256: SHA_B, name: 'Claude',
  publisher: { kind: 'verified', name: 'Anthropic PBC' },
};
const helper: ApiClient = {
  pid: 13, exe: 'C:\\Program Files\\Girovo\\girovo-mcp.exe', sha256: SHA_A, name: 'Girovo MCP',
  publisher: { kind: 'mtmedia', name: 'MT-Media', thumbprint: 'ab' }, parent: claude,
};

// ---------------------------------------------------------------------------
// Grants
// ---------------------------------------------------------------------------

test('a signed app keeps its grant through an update by the same publisher', () => {
  const grants = withGrant([], verified, ['accounts.read'], '2026-11-14T10:00:00.000Z');
  assert.equal(grants.length, 1);
  assert.deepEqual(grants[0].publisher, { kind: 'verified', name: 'Beispiel GmbH' });
  assert.equal(grants[0].sha256, undefined, 'a signed app is not bound to its file');
  // A new version: other bytes, same publisher and path (the path in another case, as Windows allows).
  const updated = { ...verified, sha256: SHA_B, exe: 'c:/program files/haushalt/HAUSHALT.EXE' };
  assert.ok(findGrant(grants, updated));
  // Another publisher at the same path, or the same publisher elsewhere, is another app.
  assert.equal(findGrant(grants, { ...verified, publisher: { kind: 'verified', name: 'Andere AG' } }), null);
  assert.equal(findGrant(grants, { ...verified, exe: 'C:\\Temp\\Haushalt.exe' }), null);
  // The same path unsigned is not the signed app.
  assert.equal(findGrant(grants, { ...verified, publisher: { kind: 'unknown' } }), null);
});

test('an unknown publisher is bound to its path and its file', () => {
  const grants = withGrant([], unknownApp, ['transactions.read'], '2026-11-14T10:00:00.000Z');
  assert.equal(grants[0].publisher, undefined);
  assert.equal(grants[0].sha256, SHA_A);
  assert.ok(findGrant(grants, { ...unknownApp, pid: 99 }));
  assert.equal(findGrant(grants, { ...unknownApp, sha256: SHA_B }), null, 'any change to the file asks again');
  assert.equal(findGrant(grants, { ...unknownApp, sha256: SHA_A.toUpperCase() })?.exe, unknownApp.exe, 'hex in either case');
});

test('MT-Media is always shown as MT-Media, whatever the certificate names', () => {
  const app: ApiClient = { ...verified, publisher: { kind: 'mtmedia', name: 'MT Media e.K.' } };
  assert.deepEqual(identityOf(app).publisher, { kind: 'mtmedia', name: 'MT-Media' });
});

test('through Girovo MCP the grant is the parent\'s; a parent beside any other client is ignored', () => {
  const grants = withGrant([], helper, ['accounts.read'], '2026-11-14T10:00:00.000Z');
  assert.equal(grants[0].name, 'Claude');
  assert.equal(grants[0].viaMcp, true);
  assert.deepEqual(grants[0].publisher, { kind: 'verified', name: 'Anthropic PBC' });
  assert.equal(clientKey(helper), grantKey(identityOf(claude)));
  // Another assistant through the same helper is another app.
  assert.equal(findGrant(grants, { ...helper, parent: { ...claude, publisher: { kind: 'verified', name: 'Andere AG' } } }), null);
  // An app that is not the helper can't borrow a parent's grant.
  const forged: ApiClient = { ...unknownApp, parent: claude };
  assert.equal(findGrant(grants, forged), null);
  assert.equal(clientKey(forged), grantKey(identityOf(unknownApp)));
});

test('paths: Windows without regard to case and slashes, Linux exactly', () => {
  assert.equal(normalPath('C:/Apps/X.exe'), normalPath('c:\\apps\\x.EXE'));
  assert.notEqual(normalPath('/usr/bin/App'), normalPath('/usr/bin/app'));
});

test('permissions switch one by one, and an app can go', () => {
  let grants = withGrant([], verified, ['accounts.read', 'transactions.read'], '2026-11-14T10:00:00.000Z');
  const key = grantKey(grants[0]);
  grants = withPermission(grants, key, 'accounts.read', false);
  assert.deepEqual(grants[0].permissions, ['transactions.read']);
  grants = withPermission(grants, key, 'insights.read', true);
  grants = withPermission(grants, key, 'accounts.read', true);
  assert.deepEqual(grants[0].permissions, ['accounts.read', 'transactions.read', 'insights.read'], 'in the list\'s order');
  // A later grant adds to what there is.
  grants = withGrant(grants, verified, ['ask'], '2026-11-15T10:00:00.000Z');
  assert.equal(grants.length, 1);
  assert.equal(grants[0].at, '2026-11-14T10:00:00.000Z');
  assert.deepEqual(grants[0].permissions, ['accounts.read', 'transactions.read', 'insights.read', 'ask']);
  assert.deepEqual(withoutGrant(grants, key), []);
});

test('the vault keeps only well-formed grants, each app once', () => {
  const good = withGrant([], verified, ['accounts.read'], '2026-11-14T10:00:00.000Z')[0];
  const out = sanitizeApiGrants([
    good,
    { ...good, permissions: ['accounts.read', 'transfers.request', 'root', 7], name: 'Neu\u0007er Name' },
    { exe: 'C:\\x.exe', at: '2026-11-14T10:00:00.000Z', permissions: [], sha256: 'nothex' },
    { exe: 'C:\\x.exe', at: 'yesterday', permissions: [], sha256: SHA_A },
    { exe: 'C:\\y.exe', at: '2026-11-14T10:00:00.000Z', permissions: ['ask'], publisher: { kind: 'unknown', name: 'X' } },
    { exe: 'C:\\z.exe', at: '2026-11-14T10:00:00.000Z', permissions: ['ask'], publisher: { kind: 'mtmedia', name: 'Fake' }, viaMcp: 'yes' },
    'nonsense',
  ]);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0].permissions, ['accounts.read', 'transfers.request'], 'the last copy of an app wins, unknown permissions go');
  assert.equal(out[0].name, 'Neu er Name');
  assert.deepEqual(out[1].publisher, { kind: 'mtmedia', name: 'MT-Media' });
  assert.equal(out[1].viaMcp, undefined);
  assert.deepEqual(sanitizeApiGrants('x'), []);
  const many = Array.from({ length: 70 }, (_, i) => ({ ...good, exe: `C:\\app${i}.exe` }));
  assert.equal(sanitizeApiGrants(many).length, API_LIMITS.grants);
});

test('the Verlauf keeps the newest calls, 200 per app and 1000 in all', () => {
  const entry = (app: string, i: number): ApiLogEntry => ({ at: new Date(Date.UTC(2026, 10, 1) + i * 1000).toISOString(), app, name: app, method: 'accounts.list', ok: true });
  const log = [...Array.from({ length: 300 }, (_, i) => entry('a', i)), ...Array.from({ length: 50 }, (_, i) => entry('b', 300 + i))];
  const capped = capLog(log);
  assert.equal(capped.filter((e) => e.app === 'a').length, API_LIMITS.logPerApp);
  assert.equal(capped.filter((e) => e.app === 'b').length, 50);
  assert.equal(capped[0].at, entry('a', 100).at, 'the oldest of an app go first');
  const lots = Array.from({ length: 8 }, (_, k) => Array.from({ length: 200 }, (_, i) => entry(`app${k}`, k * 200 + i))).flat();
  assert.equal(capLog(lots).length, API_LIMITS.logTotal);
  assert.equal(capLog(lots).at(-1)!.at, lots.at(-1)!.at);
  assert.equal(appendLog([], [entry('a', 1)]).length, 1);
  const clean = sanitizeApiLog([
    entry('a', 1),
    { ...entry('a', 2), ok: false, code: 'not_permitted' },
    { ...entry('a', 3), ok: true, code: 'denied' },
    { ...entry('a', 4), ok: false, code: 'made_up' },
    { ...entry('a', 5), ok: 'yes' },
    { at: 'x', app: 'a', method: 'm', ok: true },
  ]);
  assert.equal(clean.length, 4);
  assert.equal(clean[1].code, 'not_permitted');
  assert.equal(clean[2].code, undefined, 'a code only on a refused call');
  assert.equal(clean[3].code, undefined, 'an unknown code is dropped');
});

// ---------------------------------------------------------------------------
// The methods (fake data: ./fixtures.ts)
// ---------------------------------------------------------------------------

const ok = (out: ReturnType<typeof accountsList>) => {
  assert.ok('result' in out, JSON.stringify(out));
  return out.result as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
};

test('accounts.list: balances in cents, Verfügbar, the Gesamtsaldo, no session keys', () => {
  const r = ok(accountsList(fakeData()));
  assert.equal(r.accounts.length, 3);
  assert.deepEqual(r.accounts[0], {
    id: accountId('1001'), name: 'Girokonto', type: 'Girokonto', iban: 'DE00123456780000001001', currency: 'EUR', bank: 'Testbank',
    balance: { cents: 123456, currency: 'EUR', day: '2026-11-14' }, available: { cents: 223456, currency: 'EUR' },
  });
  assert.equal(r.accounts[1].available, null);
  assert.equal(r.accounts[2].balance, null);
  assert.deepEqual(r.total, [{ cents: 203456, currency: 'EUR' }]);
  assert.ok(!JSON.stringify(r).includes('2002@'), 'the session\'s account keys never leave');
  assert.match(r.accounts[1].id, /^a_[0-9a-z]+$/);
});

test('transactions.list: newest first, shapes, filters and the cursor', () => {
  const data = fakeData();
  const all = ok(transactionsList(data, {}));
  assert.equal(all.transactions.length, 7);
  assert.equal(all.next, undefined);
  const first = all.transactions[0];
  assert.equal(first.day, '2026-11-03');
  assert.deepEqual(first.amount, { cents: -5420, currency: 'EUR' });
  assert.deepEqual(first.category, { id: 'groceries', name: 'Lebensmittel' });
  assert.deepEqual(first.split, [
    { category: { id: 'groceries', name: 'Lebensmittel' }, amount: { cents: -4420, currency: 'EUR' } },
    { category: { id: 'shopping', name: 'Shopping' }, amount: { cents: -1000, currency: 'EUR' } },
  ]);
  assert.equal(first.counterparty.name, 'Rewe');
  assert.equal(first.account, accountId('1001'));
  assert.match(first.id, /^t_[0-9a-z]+$/);
  assert.ok(!JSON.stringify(all).includes('d2|'), 'no vault key leaves');
  assert.equal(all.transactions.find((t: { note?: string }) => t.note)?.note, 'Nebenkosten');
  // The same booking keeps its id between calls.
  assert.equal(ok(transactionsList(data, {})).transactions[0].id, first.id);

  const savings = ok(transactionsList(data, { account: accountId('2002@12345678') }));
  assert.equal(savings.transactions.length, 1);
  assert.equal(ok(transactionsList(data, { from: '2026-11-01', to: '2026-11-02' })).transactions.length, 1);
  assert.equal(ok(transactionsList(data, { category: 'shopping' })).transactions.length, 1, 'a share counts');
  assert.equal(ok(transactionsList(data, { query: 'netflix' })).transactions.length, 1);
  assert.equal(ok(transactionsList(data, { query: 'nebenkosten' })).transactions[0].counterparty.name, 'Miete', 'notes are searched');

  const page1 = ok(transactionsList(data, { limit: 3 }));
  assert.equal(page1.transactions.length, 3);
  assert.ok(page1.next);
  const page2 = ok(transactionsList(data, { limit: 3, cursor: page1.next }));
  const page3 = ok(transactionsList(data, { limit: 3, cursor: page2.next }));
  assert.equal(page3.transactions.length, 1);
  assert.equal(page3.next, undefined);
  const ids = [...page1.transactions, ...page2.transactions, ...page3.transactions].map((t: { id: string }) => t.id);
  assert.deepEqual(ids, all.transactions.map((t: { id: string }) => t.id));

  for (const bad of [{ limit: 0 }, { limit: 501 }, { limit: 2.5 }, { from: '14.11.2026' }, { cursor: 'abc' }, { account: 'a_nope' }, { query: 3 }, 'x']) {
    assert.ok('invalid' in transactionsList(data, bad), JSON.stringify(bad));
  }
});

test('insights.month: the Analyse\'s figures, Umbuchungen left out', () => {
  const r = ok(insightsMonth(fakeData(), { month: '2026-10' }));
  assert.equal(r.coverage, 'complete');
  assert.deepEqual(r.income, { cents: 250000, currency: 'EUR' });
  assert.deepEqual(r.expense, { cents: 5309, currency: 'EUR' });
  assert.deepEqual(r.net, { cents: 244691, currency: 'EUR' });
  assert.equal(r.transfersLeftOut, 1);
  assert.deepEqual(r.expenseByCategory.map((c: { category: { id: string } }) => c.category.id), ['groceries', 'media']);
  const now = ok(insightsMonth(fakeData(), {}));
  assert.equal(now.month, '2026-11');
  assert.equal(now.coverage, 'running');
  assert.equal(ok(insightsMonth(fakeData(), { month: '2025-01' })).coverage, 'none');
  assert.ok('invalid' in insightsMonth(fakeData(), { month: '2026-13' }));
});

test('budgets.list, contracts.list, goals.list', () => {
  const b = ok(budgetsList(fakeData(), {}));
  assert.equal(b.month, '2026-11');
  assert.deepEqual(b.budgets.map((x: { category: { id: string }; state: string }) => [x.category.id, x.state]), [['housing', 'over'], ['groceries', 'left']]);
  const groceries = b.budgets.find((x: { category: { id: string } }) => x.category.id === 'groceries');
  assert.deepEqual(groceries.spent, { cents: 4420, currency: 'EUR' }, 'only the booking\'s groceries share');
  assert.deepEqual(groceries.rest, { cents: 25580, currency: 'EUR' });

  const c = ok(contractsList(fakeData()));
  assert.equal(c.contracts.length, 1);
  assert.equal(c.contracts[0].name, 'Netflix');
  assert.deepEqual(c.contracts[0].perYear, { cents: -15588, currency: 'EUR' });
  assert.equal(c.contracts[0].nextDay, '2026-11-17');
  assert.match(c.contracts[0].id, /^c_/);
  assert.ok(!JSON.stringify(c).includes('ser1'));

  const g = ok(goalsList(fakeData()));
  assert.deepEqual(g.goals[0], {
    account: accountId('2002@12345678'), name: 'Urlaub', target: { cents: 200000, currency: 'EUR' }, by: '2027-06',
    balance: { cents: 80000, currency: 'EUR' }, reached: false, missing: { cents: 120000, currency: 'EUR' }, perMonth: { cents: 15000, currency: 'EUR' },
  });
});

// ---------------------------------------------------------------------------
// The router
// ---------------------------------------------------------------------------

function harness(opts: { answer?: (r: ConsentRequest) => ConsentAnswer | 'hang'; open?: boolean; grants?: ApiGrant[] } = {}) {
  let grants: ApiGrant[] = opts.grants ?? [];
  const log: ApiLogEntry[] = [];
  const asked: ConsentRequest[] = [];
  const state = { open: opts.open ?? true };
  const host: RouterHost = {
    vaultOpen: () => state.open,
    grants: () => grants,
    setGrants: (fn) => { grants = fn(grants); },
    data: () => fakeData(),
    ask: (r, signal) => {
      asked.push(r);
      const a = opts.answer?.(r) ?? { allow: r.permissions };
      if (a === 'hang') return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
      return Promise.resolve(a);
    },
    log: (e) => log.push(e),
    now: () => new Date('2026-11-14T12:00:00.000Z'),
    girovoVersion: '7.0.0',
  };
  const router = new ApiRouter(host);
  let id = 0;
  const call = (client: ApiClient, method: string, params?: unknown, connection = 'c1'): Promise<any> => // eslint-disable-line @typescript-eslint/no-explicit-any
    router.handle({ id: ++id, connection, client, method, params } satisfies ApiCall);
  return { router, call, log, asked, state, grants: () => grants };
}

test('router: hello first, then the dialog, then the methods it allowed', async () => {
  const h = harness();
  const early = await h.call(verified, 'girovo.accounts.list');
  assert.equal(early.error.code, 'invalid', 'nothing is answered before hello');

  const hello = await h.call(verified, 'girovo.hello', { app: 'Haushalt', version: '2.1', permissions: ['accounts.read', 'insights.read'], reason: 'Zeigt dein Monatsbudget.' });
  assert.deepEqual(hello.result, { granted: ['accounts.read', 'insights.read'], girovo: { version: '7.0.0', api: 1 } });
  assert.equal(h.asked.length, 1);
  assert.deepEqual(h.asked[0].permissions, ['accounts.read', 'insights.read']);
  assert.equal(h.asked[0].reason, 'Zeigt dein Monatsbudget.');
  assert.equal(h.grants().length, 1);

  assert.ok((await h.call(verified, 'girovo.accounts.list')).result.accounts);
  assert.ok((await h.call(verified, 'girovo.goals.list')).result.goals);
  const tx = await h.call(verified, 'girovo.transactions.list');
  assert.deepEqual(tx.error, { code: 'not_permitted', message: tx.error.message, data: { permission: 'transactions.read' } });
  const unknown = await h.call(verified, 'girovo.transfers.make', {});
  assert.equal(unknown.error.code, 'method_not_found');
  const bad = await h.call(verified, 'girovo.insights.month', { month: 'Oktober' });
  assert.deepEqual(bad.error.data, { param: 'month' });

  // Asking again for what it has opens no dialog; for something new, a dialog for just that.
  await h.call(verified, 'girovo.hello', { app: 'Haushalt', permissions: ['accounts.read'] });
  assert.equal(h.asked.length, 1);
  await h.call(verified, 'girovo.hello', { app: 'Haushalt', permissions: ['accounts.read', 'transactions.read'] });
  assert.equal(h.asked.length, 2);
  assert.deepEqual(h.asked[1].permissions, ['transactions.read']);
  assert.deepEqual(h.asked[1].existing, ['accounts.read', 'insights.read']);
  assert.ok((await h.call(verified, 'girovo.transactions.list', { limit: 2 })).result.transactions);

  assert.equal(h.grants()[0].used, '2026-11-14T12:00:00.000Z');
  assert.equal(h.log.length, 10, 'every call is in the Verlauf');
  assert.deepEqual(h.log[0], { at: '2026-11-14T12:00:00.000Z', app: clientKey(verified), name: 'Haushaltsbuch', method: 'accounts.list', ok: false, code: 'invalid' });
});

test('router: a hello that names an unknown permission, or none at all, is invalid', async () => {
  const h = harness();
  assert.equal((await h.call(verified, 'girovo.hello', { app: 'X', permissions: ['accounts.read', 'everything'] })).error.data.permission, 'everything');
  assert.equal((await h.call(verified, 'girovo.hello', { permissions: [] })).error.data.param, 'app');
  assert.equal((await h.call(verified, 'girovo.hello', { app: 'X' })).error.data.param, 'permissions');
  assert.equal(h.asked.length, 0);
});

test('router: refused is remembered until restart, switched off is not asked again on that connection', async () => {
  const h = harness({ answer: (r) => (r.client.publisher.kind === 'unknown' ? { refused: true } : { allow: ['accounts.read'] }) });
  const no = await h.call(unknownApp, 'girovo.hello', { app: 'Tool', permissions: ['transactions.read'] });
  assert.equal(no.error.code, 'refused_by_user');
  assert.equal((await h.call(unknownApp, 'girovo.hello', { app: 'Tool', permissions: ['transactions.read'] })).error.code, 'denied');
  assert.equal((await h.call(unknownApp, 'girovo.accounts.list')).error.code, 'denied');
  assert.equal(h.asked.length, 1, 'no second dialog');
  assert.ok(h.router.isRefused(unknownApp));
  // Changed on disk, it is another app and may ask.
  await h.call({ ...unknownApp, sha256: SHA_B }, 'girovo.hello', { app: 'Tool', permissions: ['transactions.read'] }, 'c2');
  assert.equal(h.asked.length, 2);

  const yes = await h.call(verified, 'girovo.hello', { app: 'Haushalt', permissions: ['accounts.read', 'transactions.read'] }, 'c3');
  assert.deepEqual(yes.result.granted, ['accounts.read']);
  await h.call(verified, 'girovo.hello', { app: 'Haushalt', permissions: ['accounts.read', 'transactions.read'] }, 'c3');
  assert.equal(h.asked.length, 3, 'what the user switched off is not asked again on the same connection');
  // The app's next connection (it ran again) may ask once more (owner 2026-11-15).
  h.router.closed('c3');
  const again = await h.call(verified, 'girovo.hello', { app: 'Haushalt', permissions: ['accounts.read', 'transactions.read'] }, 'c4');
  assert.equal(h.asked.length, 4, 'a new connection asks for what is still missing');
  assert.deepEqual(h.asked[3].permissions, ['transactions.read'], 'only what the app does not have yet');
  assert.deepEqual(again.result.granted, ['accounts.read']);
  // A fresh router (a restart) asks again.
  const after = new ApiRouter({ ...harnessHost(h.grants()), ask: async (r) => { h.asked.push(r); return { allow: [] }; } });
  await after.handle({ id: 1, connection: 'x', client: verified, method: 'girovo.hello', params: { app: 'Haushalt', permissions: ['transactions.read'] } });
  assert.equal(h.asked.length, 5);
});

function harnessHost(grants: ApiGrant[]): RouterHost {
  return {
    vaultOpen: () => true, grants: () => grants, setGrants: (fn) => { grants = fn(grants); }, data: () => fakeData(),
    ask: async () => ({ allow: [] }), log: () => {}, now: () => new Date('2026-11-14T12:00:00.000Z'), girovoVersion: '7.0.0',
  };
}

test('router: locked while the vault is closed, before and after the dialog', async () => {
  const h = harness({ open: false });
  assert.equal((await h.call(verified, 'girovo.hello', { app: 'X', permissions: ['accounts.read'] })).error.code, 'locked');
  assert.equal(h.asked.length, 0);
  h.state.open = true;
  await h.call(verified, 'girovo.hello', { app: 'X', permissions: ['accounts.read'] });
  h.state.open = false;
  assert.equal((await h.call(verified, 'girovo.accounts.list')).error.code, 'locked');
});

test('router: a hang-up ends its dialog; the app is not refused for it', async () => {
  const h = harness({ answer: () => 'hang' });
  const waiting = h.call(unknownApp, 'girovo.hello', { app: 'Tool', permissions: ['accounts.read'] }, 'c9');
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(h.asked.length, 1);
  h.router.closed('c9');
  const out = await waiting;
  assert.equal(out.error.code, 'timeout');
  assert.equal(h.router.isRefused(unknownApp), false);
  // Its hello is gone with the connection.
  assert.equal((await h.call(unknownApp, 'girovo.accounts.list', undefined, 'c9')).error.code, 'invalid');
});

test('router: two hellos of one app share one dialog', async () => {
  let release: (a: ConsentAnswer) => void = () => {};
  let n = 0;
  const h = harness();
  const host = harnessHost([]);
  const router = new ApiRouter({
    ...host,
    ask: () => { n++; return new Promise((r) => { release = r; }); },
  });
  const a = router.handle({ id: 1, connection: 'a', client: verified, method: 'girovo.hello', params: { app: 'H', permissions: ['accounts.read'] } });
  const b = router.handle({ id: 2, connection: 'b', client: verified, method: 'girovo.hello', params: { app: 'H', permissions: ['accounts.read'] } });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(n, 1);
  release({ allow: ['accounts.read'] });
  assert.deepEqual(((await a) as { result: { granted: string[] } }).result.granted, ['accounts.read']);
  assert.deepEqual(((await b) as { result: { granted: string[] } }).result.granted, ['accounts.read']);
  assert.equal(n, 1);
  void h;
});
