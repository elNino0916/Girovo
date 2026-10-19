import './__fixtures__/tz.ts';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Session } from './session';

// STATE_DIR is read when state-store.ts loads: the scratch directory first.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'girovo-backup-'));
process.env.FINTS_STATE_DIR = dir;
const { makeBackup, readBackup, restoreBackup, BackupError } = await import('./backup.ts');
const vault = await import('./vault.ts');
const docs = await import('./doc-store.ts');
const historyStore = await import('./history-store.ts');
const { EMPTY_VAULT } = await import('./app-types.ts');
const { mt940 } = await import('./__fixtures__/transactions.ts');

after(() => fs.rmSync(dir, { recursive: true, force: true }));

const session = (pin: string, userId = 'kunde1', blz = '12345678') =>
  ({ meta: { blz, bankName: 'Musterbank' }, client: { config: { userId, pin } } }) as unknown as Session;

const PDF = Buffer.from('%PDF-1.7\n%fake invoice\n', 'utf8');
const PASSWORD = 'korrekt pferd batterie';

test('a backup carries vault, Umsätze and documents to another PIN, and fills only what is missing', async () => {
  const before = session('11111');
  await vault.saveVault(before, {
    ...EMPTY_VAULT,
    keepBookings: true,
    aliases: { '1234': 'Haushaltskonto' },
    customCategories: [{ id: 'c_spenden1234', name: 'Spenden', direction: 'out' }],
    notes: { k1: 'Rechnung liegt im Ordner' },
  });
  const day = (d: string) => mt940({ day: d, amount: -10, name: `Laden ${d}` });
  await historyStore.fillKeptGaps(before, {
    version: 1,
    accounts: { 1234: { txs: [day('2025-03-02'), day('2025-03-05')], coverage: [{ from: '2025-03-01', to: '2025-03-31' }], balances: [] } },
    updatedAt: new Date(0).toISOString(),
  });
  await docs.addReceipt(before, { name: 'Rechnung.pdf', data: PDF, accountNumber: '1234', tx: 'k1', awaiting: null });

  const { text, summary } = await makeBackup([before], PASSWORD, 'test');
  assert.deepEqual(summary, [{ bank: 'Musterbank', vault: true, accounts: 1, bookings: 2, docs: 1, missing: [] }]);
  // Nothing readable without the password: not the bank, not a note.
  assert.ok(!text.includes('Musterbank') && !text.includes('Ordner') && !text.includes('PDF'));

  // A new machine: everything gone, and the bank's PIN changed meanwhile.
  await historyStore.wipeHistory(before);
  await docs.wipeDocs(before);
  await vault.wipeVault(before);
  const after = session('22222');
  // Something is here already: the new name for the account wins, March 3rd was kept here.
  await vault.saveVault(after, { ...EMPTY_VAULT, keepBookings: true, aliases: { '1234': 'Girokonto' } });
  await historyStore.fillKeptGaps(after, {
    version: 1,
    accounts: { 1234: { txs: [], coverage: [{ from: '2025-03-03', to: '2025-03-03' }], balances: [] } },
    updatedAt: new Date(0).toISOString(),
  });

  const contents = await readBackup(text, PASSWORD);
  const [report] = await restoreBackup([after], contents);
  assert.equal(report.skipped, false);
  assert.equal(report.vault, true);
  assert.equal(report.docs, 1);
  assert.equal(report.days, 30, 'March less the day already kept');

  const restored = await vault.loadVault(after);
  assert.equal(restored.status, 'ready');
  assert.equal(restored.status === 'ready' && restored.data?.aliases['1234'], 'Girokonto', 'what is here wins');
  assert.equal(restored.status === 'ready' && restored.data?.notes.k1, 'Rechnung liegt im Ordner');
  assert.equal(restored.status === 'ready' && restored.data?.customCategories[0]?.name, 'Spenden');
  const listed = await docs.listDocs(after);
  assert.equal(listed.docs.length, 1);
  assert.deepEqual((await docs.readDoc(after, listed.docs[0].id)).bytes, PDF);

  // Restoring the same file again adds nothing twice.
  const [again] = await restoreBackup([after], await readBackup(text, PASSWORD));
  assert.equal(again.docs, 0);
  assert.equal(again.days, 0);

  // Another login's backup is never this login's data.
  const [other] = await restoreBackup([session('22222', 'jemand')], contents);
  assert.equal(other.skipped, true);
});

test('a wrong password, a foreign file and a short password are refused in words', async () => {
  const s = session('33333', 'kunde3');
  await vault.saveVault(s, { ...EMPTY_VAULT });
  const { text } = await makeBackup([s], PASSWORD, 'test');
  await assert.rejects(readBackup(text, 'falsches passwort'), (e: unknown) => e instanceof BackupError && e.status === 403);
  await assert.rejects(readBackup('{"hello":1}', PASSWORD), (e: unknown) => e instanceof BackupError && e.status === 400);
  await assert.rejects(readBackup('nope', PASSWORD), BackupError);
  await assert.rejects(makeBackup([s], 'kurz', 'test'), BackupError);
});
