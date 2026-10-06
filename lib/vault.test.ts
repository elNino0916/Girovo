import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { VaultData } from './app-types.ts';
import type { Session } from './session';

// STATE_DIR is read when state-store.ts loads, so the scratch directory has to
// be in place before the first import of vault.ts.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fints-vault-'));
process.env.FINTS_STATE_DIR = dir;
const vault = await import('./vault.ts');
const { EMPTY_VAULT } = await import('./app-types.ts');
const { openWithPin, parseBox } = await import('./crypto-box.ts');

after(() => fs.rmSync(dir, { recursive: true, force: true }));

/** Just enough of a Session for the vault: who, which bank, the PIN. */
const fakeSession = (pin: string, userId = 'kunde1', blz = '12345678') =>
  ({ meta: { blz }, client: { config: { userId, pin } } }) as unknown as Session;

const vaultFile = (userId = 'kunde1', blz = '12345678') =>
  path.join(dir, `${crypto.createHash('sha256').update(`${blz}|${userId}|vault`).digest('hex').slice(0, 32)}.vault`);

const IBAN = 'DE02120300000000202051';
const LS = String.fromCharCode(0x2028);

const base = (over: Partial<VaultData> = {}): VaultData => ({ ...EMPTY_VAULT, ...over });

const template = (i: number, over: Record<string, unknown> = {}) => ({
  id: `t${i}`,
  label: `Vorlage ${i}`,
  name: 'Max Mustermann',
  iban: IBAN,
  createdAt: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString(),
  ...over,
});

// ---------------------------------------------------------------------------
// sanitizeVault
// ---------------------------------------------------------------------------

test('only a version-1 object is a vault', () => {
  for (const v of [null, undefined, 'x', 42, [], {}, { version: 2 }, { version: '1' }]) {
    assert.equal(vault.sanitizeVault(v), null);
  }
  assert.deepEqual(vault.sanitizeVault({ version: 1 }), EMPTY_VAULT);
});

test('the profile picture is kept when it is one of the offered ones, and nothing else', () => {
  assert.equal(vault.sanitizeVault({ version: 1, avatar: 'cat' })?.avatar, 'cat');
  for (const avatar of ['dog', '../cat', 7, null, '']) {
    assert.equal('avatar' in (vault.sanitizeVault({ version: 1, avatar }) ?? {}), false, String(avatar));
  }
});

test('an own picture is kept only as a small image data URL, and chosen only with one', () => {
  const picture = `data:image/webp;base64,${'A'.repeat(400)}`;
  const own = vault.sanitizeVault({ version: 1, avatar: 'own', avatarImage: picture });
  assert.equal(own?.avatar, 'own');
  assert.equal(own?.avatarImage, picture);
  // Kept while an icon is shown, so it can be chosen again.
  assert.equal(vault.sanitizeVault({ version: 1, avatar: 'cat', avatarImage: picture })?.avatarImage, picture);
  // "Own" with nothing to show is the initials.
  assert.equal('avatar' in (vault.sanitizeVault({ version: 1, avatar: 'own' }) ?? {}), false);
  for (const bad of [
    'data:image/svg+xml;base64,PHN2Zz4=', // could carry script
    'https://example.com/me.png', // would be fetched
    `data:image/webp;base64,${'A'.repeat(70 * 1024)}`, // too big
    'data:image/png;base64,not base64!',
    42,
  ]) {
    const out = vault.sanitizeVault({ version: 1, avatar: 'own', avatarImage: bad });
    assert.equal(out?.avatarImage, undefined, String(bad).slice(0, 40));
    assert.equal(out?.avatar, undefined, String(bad).slice(0, 40));
  }
});

test('unknown keys are dropped at every level', () => {
  const out = vault.sanitizeVault({
    ...base({ templates: [template(1)] }),
    evil: '<script>',
    templates: [{ ...template(1), html: '<b>x</b>', instant: 'yes' }],
  });
  assert.ok(out);
  assert.equal('evil' in out, false);
  assert.deepEqual(Object.keys(out.templates[0]).sort(), ['createdAt', 'iban', 'id', 'label', 'name']);
});

test('template strings are clipped and cleaned, IBANs normalised and checked', () => {
  const out = vault.sanitizeVault(base({
    templates: [
      template(1, {
        label: 'L'.repeat(80),
        name: `  Max${LS}Muster\tmann  ${'n'.repeat(80)}`,
        iban: 'de02 1203 0000 0000 2020 51',
        purpose: 'P'.repeat(200),
        amount: '1.234,56',
        instant: true,
        lastUsedAt: '2026-09-30T10:00:00Z',
      }),
      template(2, { iban: 'DE02120300000000202052' }), // checksum wrong
      template(3, { iban: 'DE0212030000000020205' }), // too short for DE
      template(4, { name: '   ' }),
      template(5, { amount: '1'.repeat(21) }),
      template(1, { label: 'duplicate id' }),
    ] as never,
  }));
  assert.ok(out);
  assert.deepEqual(out.templates.map((t) => t.id), ['t1', 't5']);
  const [t] = out.templates;
  assert.equal(t.label.length, 60);
  assert.ok(t.name.startsWith('Max Muster mann n'));
  assert.equal(Array.from(t.name).length, 70);
  assert.equal(t.iban, IBAN);
  assert.equal(t.purpose?.length, 140);
  assert.equal(t.amount, '1.234,56');
  assert.equal(t.instant, true);
  assert.equal(t.lastUsedAt, '2026-09-30T10:00:00.000Z');
  // An over-long amount is dropped, never clipped into a different figure.
  assert.equal(out.templates[1].amount, undefined);
});

test('clipping never splits a character in two', () => {
  const out = vault.sanitizeVault(base({ templates: [template(1, { label: `${'a'.repeat(59)}😀😀` })] as never }));
  assert.equal(out?.templates[0].label, `${'a'.repeat(59)}😀`);
});

test('over 200 templates, the least recently used go and the order stays', () => {
  const many = Array.from({ length: 205 }, (_, i) => template(i));
  // t0 is the oldest by creation but was used yesterday — it must survive.
  many[0] = template(0, { lastUsedAt: '2026-10-02T12:00:00Z' });
  const out = vault.sanitizeVault(base({ templates: many as never }));
  assert.ok(out);
  assert.equal(out.templates.length, 200);
  assert.equal(out.templates[0].id, 't0');
  assert.deepEqual(out.templates.slice(1, 3).map((t) => t.id), ['t6', 't7']);
});

test('aliases: clipped, empty ones dropped, at most 50 (newest kept)', () => {
  const aliases: Record<string, unknown> = { '1234567890': 'Girokonto für alles und noch viel mehr Text der zu lang ist', '42': '   ', '43': 7 };
  for (let i = 0; i < 60; i++) aliases[`ACC-${i}`] = `Konto ${i}`;
  const out = vault.sanitizeVault(base({ aliases: aliases as never }));
  assert.ok(out);
  assert.equal(Object.keys(out.aliases).length, 50);
  assert.equal('42' in out.aliases || '43' in out.aliases, false);
  assert.equal(out.aliases['ACC-59'], 'Konto 59');
  assert.equal(out.aliases['ACC-0'], undefined);
});

test('category maps keep only valid category ids and plausible keys', () => {
  const rules = JSON.parse(
    '{"iban:DE02120300000000202051":"housing","cred:DE98ZZZ09999999999":"media","name:REWE":"nope","REWE":"groceries","__proto__":"media"}',
  );
  const out = vault.sanitizeVault(base({
    categoryRules: rules,
    txCategories: { '2026-10-02|-12.90|DE02120300000000202051|E1': 'groceries', bad: 'Lebensmittel', ['x'.repeat(201)]: 'other' } as never,
  }));
  assert.ok(out);
  assert.deepEqual(out.categoryRules, { 'iban:DE02120300000000202051': 'housing', 'cred:DE98ZZZ09999999999': 'media' });
  assert.deepEqual(out.txCategories, { '2026-10-02|-12.90|DE02120300000000202051|E1': 'groceries' });
  assert.equal(Object.getPrototypeOf(out.categoryRules), Object.prototype);
});

test('category maps are capped at 5000, the newest entries surviving', () => {
  const tx: Record<string, string> = {};
  for (let i = 0; i < 5010; i++) tx[`2026-01-01|-${i}.00|X|`] = 'other';
  const out = vault.sanitizeVault(base({ txCategories: tx as never }));
  assert.ok(out);
  const keys = Object.keys(out.txCategories);
  assert.equal(keys.length, 5000);
  assert.equal(keys[0], '2026-01-01|-10.00|X|');
  assert.equal(keys.at(-1), '2026-01-01|-5009.00|X|');
});

test('dismissed series: strings only, deduplicated, ≤ 200 chars, at most 500', () => {
  const ids = [...Array.from({ length: 510 }, (_, i) => `s${i}`), 's509', 7, 'x'.repeat(201), '', `a\nb`];
  const out = vault.sanitizeVault(base({ dismissedRecurring: ids as never }));
  assert.ok(out);
  assert.equal(out.dismissedRecurring.length, 500);
  assert.equal(out.dismissedRecurring[0], 's10');
  assert.equal(out.dismissedRecurring.at(-1), 's509');
});

test('updatedAt is normalised to ISO or falls back to the epoch', () => {
  assert.equal(vault.sanitizeVault({ version: 1, updatedAt: '2026-10-03T08:00:00+02:00' })?.updatedAt, '2026-10-03T06:00:00.000Z');
  assert.equal(vault.sanitizeVault({ version: 1, updatedAt: 'gestern' })?.updatedAt, EMPTY_VAULT.updatedAt);
});

test('sent orders: two weeks kept, older and malformed ones dropped', () => {
  const now = Date.UTC(2026, 9, 4, 12);
  const sent = (daysAgo: number, over: Record<string, unknown> = {}) => ({
    at: new Date(now - daysAgo * 86_400_000).toISOString(), accountNumber: '1234567890', iban: IBAN, cents: 5000, outcome: 'unknown', ...over,
  });
  const out = vault.sanitizeVault(base({
    sentOrders: [sent(1), sent(20), sent(2, { cents: -1 }), sent(3, { name: 'Lea Becker' })] as never,
  }), now);
  assert.ok(out);
  assert.equal(out.sentOrders.length, 2);
  assert.equal('name' in out.sentOrders[1], false);
  // A vault from before the log existed reads as an empty log.
  assert.deepEqual(vault.sanitizeVault({ version: 1 })?.sentOrders, []);
});

// ---------------------------------------------------------------------------
// The file round trip
// ---------------------------------------------------------------------------

const FULL = base({
  templates: [template(1, { purpose: 'Miete Oktober', amount: '850,00' })] as never,
  aliases: { '1234567890': 'Haushaltskonto' },
  categoryRules: { [`iban:${IBAN}`]: 'housing' },
  txCategories: { '2026-10-02|-12.90|DE02120300000000202051|E1': 'groceries' },
  dismissedRecurring: ['rec:abc'],
  sentOrders: [{
    at: new Date(Date.now() - 3_600_000).toISOString(), accountNumber: '1234567890', iban: IBAN, cents: 85_000, outcome: 'executed',
  }],
});

const owner = fakeSession('13579');

test('a first use reads as an empty, ready vault and writes nothing', async () => {
  assert.deepEqual(await vault.loadVault(owner), { status: 'ready', data: null });
  assert.equal(fs.existsSync(vaultFile()), false);
});

test('save then load returns the sanitised data with a server timestamp', async () => {
  const started = Date.now();
  const put = await vault.saveVault(owner, { ...FULL, junk: 1 });
  assert.equal(put.ok, true);
  assert.ok(Date.parse(put.updatedAt) >= started - 1000);

  const got = await vault.loadVault(owner);
  assert.equal(got.status, 'ready');
  assert.deepEqual(got.status === 'ready' && got.data, { ...FULL, updatedAt: put.updatedAt });

  // Another session of the same login (a second window, a later login) opens it too.
  const again = await vault.loadVault(fakeSession('13579'));
  assert.deepEqual(again, got);
});

test('the file on disk is sealed: no IBAN, no alias, no sent order in sight', () => {
  const raw = fs.readFileSync(vaultFile(), 'utf8');
  assert.ok(!raw.includes(IBAN) && !raw.includes('Haushaltskonto') && !raw.includes('housing') && !raw.includes('85000'));
  const box = parseBox(JSON.parse(raw));
  assert.ok(box);
  // AAD-bound: the profile's plain open must not accept it.
  assert.throws(() => openWithPin('13579', box));
  if (process.platform !== 'win32') assert.equal(fs.statSync(vaultFile()).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp')), [], 'no temp files left behind');
});

test('saves reuse the salt (key cached) but never the IV', async () => {
  const a = JSON.parse(fs.readFileSync(vaultFile(), 'utf8'));
  await vault.saveVault(owner, FULL);
  const b = JSON.parse(fs.readFileSync(vaultFile(), 'utf8'));
  assert.equal(a.salt, b.salt);
  assert.notEqual(a.iv, b.iv);
});

test('overlapping saves land in call order', async () => {
  const puts = await Promise.all(
    [1, 2, 3, 4, 5].map((n) => vault.saveVault(owner, { ...FULL, aliases: { '1234567890': `Stand ${n}` } })),
  );
  assert.equal(puts.length, 5);
  const got = await vault.loadVault(owner);
  assert.equal(got.status === 'ready' && got.data?.aliases['1234567890'], 'Stand 5');
});

test('another PIN cannot read the vault, and cannot overwrite it either', async () => {
  const original = fs.readFileSync(vaultFile(), 'utf8');
  const stranger = fakeSession('99999');
  assert.deepEqual(await vault.loadVault(stranger), { status: 'error', reason: 'decrypt' });
  await assert.rejects(vault.saveVault(stranger, FULL), (err: unknown) => err instanceof vault.VaultError && err.status === 409);
  assert.equal(fs.readFileSync(vaultFile(), 'utf8'), original);
});

test('reset moves the unreadable file aside and starts empty', async () => {
  const original = fs.readFileSync(vaultFile(), 'utf8');
  const newPin = fakeSession('99999');
  const res = await vault.resetVault(newPin);
  assert.equal(res.ok, true);
  assert.equal(fs.readFileSync(`${vaultFile()}.bak`, 'utf8'), original, 'old data kept, recoverable with the old PIN');
  assert.deepEqual(await vault.loadVault(newPin), { status: 'ready', data: { ...EMPTY_VAULT, updatedAt: res.updatedAt } });
  // The old PIN's session now sees an unreadable file rather than stale data.
  assert.deepEqual(await vault.loadVault(fakeSession('13579')), { status: 'error', reason: 'decrypt' });

  // A second reset never clobbers the first backup.
  await vault.resetVault(newPin);
  const baks = fs.readdirSync(dir).filter((f) => f.endsWith('.bak'));
  assert.equal(baks.length, 2);
});

test('a damaged file reads as corrupt and is not overwritten by a save', async () => {
  const s = fakeSession('11111', 'kunde2');
  fs.writeFileSync(vaultFile('kunde2'), '{"v":1,"salt":"broken"');
  assert.deepEqual(await vault.loadVault(s), { status: 'error', reason: 'corrupt' });
  await assert.rejects(vault.saveVault(s, FULL), (err: unknown) => err instanceof vault.VaultError && err.status === 409);
  assert.equal(fs.readFileSync(vaultFile('kunde2'), 'utf8'), '{"v":1,"salt":"broken"');
});

test('malformed input and oversized vaults are refused', async () => {
  const s = fakeSession('22222', 'kunde3');
  await assert.rejects(vault.saveVault(s, { version: 2 }), (err: unknown) => err instanceof vault.VaultError && err.status === 400);
  // 5000 rules with long keys: within every count cap, over the byte cap.
  const rules: Record<string, string> = {};
  for (let i = 0; i < 5000; i++) rules[`name:${'X'.repeat(150)}${i}`] = 'other';
  await assert.rejects(
    vault.saveVault(s, base({ categoryRules: rules as never })),
    (err: unknown) => err instanceof vault.VaultError && err.status === 413,
  );
  assert.equal(fs.existsSync(vaultFile('kunde3')), false);
});

test('a session without a PIN has no vault', async () => {
  const s = fakeSession('', 'kunde4');
  await assert.rejects(vault.loadVault(s), (err: unknown) => err instanceof vault.VaultError && err.status === 409);
});

// ---------------------------------------------------------------------------
// Wiping
// ---------------------------------------------------------------------------

test('vaultBaseName is the name the vault file is stored under', () => {
  assert.equal(path.join(dir, `${vault.vaultBaseName('12345678', 'kunde1')}.vault`), vaultFile());
});

test('wipe removes the vault, every backup and stray temp files — and nothing else', async () => {
  const s = fakeSession('31337', 'kunde5');
  const file = vaultFile('kunde5');
  await vault.saveVault(s, FULL);
  await vault.resetVault(s);
  await vault.saveVault(s, FULL);
  await vault.resetVault(s); // a second backup, under a timestamped name
  fs.writeFileSync(`${file}.abc123.tmp`, 'torn write');
  const neighbour = vaultFile('kunde6');
  fs.writeFileSync(neighbour, 'another login');
  const profile = path.join(dir, 'unrelated-profile.json');
  fs.writeFileSync(profile, '{}');
  const mine = () => fs.readdirSync(dir).filter((f) => f.startsWith(path.basename(file)));
  assert.equal(mine().length, 4, 'vault + two backups + temp file');

  assert.equal(await vault.wipeVault(s), 4);
  assert.deepEqual(mine(), []);
  assert.ok(fs.existsSync(neighbour) && fs.existsSync(profile), 'other logins and the device profile stay');
  // The session's cached key went with the file: a later load is a first use.
  assert.deepEqual(await vault.loadVault(s), { status: 'ready', data: null });
  // Nothing left to wipe is not an error.
  assert.equal(await vault.wipeVault(s), 0);
});

test('wipe needs no PIN — an unreadable file is removed as well', async () => {
  const file = vaultFile('kunde2'); // the damaged one from above
  assert.ok(fs.existsSync(file));
  assert.equal(await vault.wipeVault(fakeSession('', 'kunde2')), 1);
  assert.equal(fs.existsSync(file), false);
});

test('wipe without a login to go by is refused', async () => {
  const s = { meta: {}, client: { config: {} } } as unknown as Session;
  await assert.rejects(vault.wipeVault(s), (err: unknown) => err instanceof vault.VaultError && err.status === 409);
});
