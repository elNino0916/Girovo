import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// STATE_DIR is read when state-store.ts loads, so the scratch directory has to
// be in place before the first import of profile.ts.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'girovo-profile-'));
process.env.FINTS_STATE_DIR = dir;
const p = await import('./profile.ts');

after(() => fs.rmSync(dir, { recursive: true, force: true }));

const secret = crypto.randomBytes(32);
const otherSecret = crypto.randomBytes(32);
const helloKey = crypto.randomBytes(32);
const sparkasse = { blz: '12345678', name: 'Sparkasse Musterstadt', userId: 'kunde1', pin: '12345', accounts: ['111', '222'] };
const volksbank = { blz: '50050201', name: 'Volksbank', userId: 'max', pin: '54321' };
const vault = { version: 1, aliases: { '111': 'Alltag' }, updatedAt: '2026-11-15T10:00:00.000Z' };

beforeEach(() => {
  p.lockProfile();
  for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { force: true });
});

const make = (extra: Partial<Parameters<typeof p.createProfile>[0]> = {}) => p.createProfile({
  name: 'Max', password: 'richtig gutes Passwort', secret, banks: [sparkasse, volksbank], vault, ...extra,
});

test('no profile: status says so, unlocking finds none', async () => {
  assert.deepEqual(await p.profileStatus(), { exists: false });
  assert.equal(p.isProfileOpen(), false);
  await assert.rejects(p.unlockProfile({ password: 'irgendwas123' }, secret), (e: Error) => (e as InstanceType<typeof p.ProfileError>).code === 'missing');
});

test('a new profile is open at once and holds the banks with their PINs and the vault', async () => {
  const opened = await make();
  assert.equal(opened.name, 'Max');
  assert.deepEqual(opened.banks.map((b) => [b.blz, b.userId, b.pin]), [['12345678', 'kunde1', '12345'], ['50050201', 'max', '54321']]);
  assert.deepEqual(opened.vault, vault);
  assert.equal(p.isProfileOpen(), true);
  assert.deepEqual(await p.profileStatus(), { exists: true, name: 'Max', hello: false, open: true });
  // On disk: the name, nothing else readable.
  const raw = fs.readFileSync(p.profileFile(), 'utf8');
  for (const s of ['12345', '54321', 'kunde1', 'Sparkasse', 'Alltag']) assert.ok(!raw.includes(s), s);
  assert.ok(raw.includes('"name":"Max"'));
});

test('a second profile is refused while one exists', async () => {
  await make();
  p.lockProfile();
  await assert.rejects(make(), (e: Error) => (e as InstanceType<typeof p.ProfileError>).code === 'exists');
});

test('a name that is nothing but spaces is refused: the unlock screen needs one', async () => {
  await assert.rejects(make({ name: '   ' }), (e: Error) => (e as InstanceType<typeof p.ProfileError>).code === 'name');
  assert.equal(fs.existsSync(p.profileFile()), false);
});

test('a short password is refused before anything is written', async () => {
  await assert.rejects(make({ password: 'kurz' }), (e: Error) => (e as InstanceType<typeof p.ProfileError>).code === 'short');
  assert.equal(fs.existsSync(p.profileFile()), false);
});

test('the password opens it again; a wrong password or another computer\'s secret does not', async () => {
  await make();
  p.lockProfile();
  assert.equal(p.isProfileOpen(), false);
  assert.equal(p.openProfile(), null);
  await assert.rejects(p.unlockProfile({ password: 'falsches Passwort' }, secret), (e: Error) => (e as InstanceType<typeof p.ProfileError>).code === 'wrong');
  await assert.rejects(p.unlockProfile({ password: 'richtig gutes Passwort' }, otherSecret), (e: Error) => (e as InstanceType<typeof p.ProfileError>).code === 'wrong');
  assert.equal(p.isProfileOpen(), false);
  const opened = await p.unlockProfile({ password: 'richtig gutes Passwort' }, secret);
  assert.equal(opened.banks.length, 2);
  assert.deepEqual(opened.vault, vault);
});

test('Windows Hello opens it once turned on, and no longer once turned off', async () => {
  await make();
  await assert.rejects(p.unlockProfile({ helloKey }, secret));
  assert.equal(await p.setHello(helloKey, secret), true);
  assert.equal((await p.profileStatus() as { hello: boolean }).hello, true);
  p.lockProfile();
  await assert.rejects(p.unlockProfile({ helloKey: crypto.randomBytes(32) }, secret));
  assert.equal((await p.unlockProfile({ helloKey }, secret)).name, 'Max');
  assert.equal(await p.setHello(null, secret), false);
  p.lockProfile();
  await assert.rejects(p.unlockProfile({ helloKey }, secret), (e: Error) => (e as InstanceType<typeof p.ProfileError>).code === 'wrong');
});

test('changing the password needs the current one; Windows Hello keeps working', async () => {
  await make();
  await p.setHello(helloKey, secret);
  await assert.rejects(p.changePassword('falsch falsch', 'neues Passwort!', secret), (e: Error) => (e as InstanceType<typeof p.ProfileError>).code === 'wrong');
  await assert.rejects(p.changePassword('richtig gutes Passwort', 'kurz', secret), (e: Error) => (e as InstanceType<typeof p.ProfileError>).code === 'short');
  await p.changePassword('richtig gutes Passwort', 'neues Passwort!', secret);
  p.lockProfile();
  await assert.rejects(p.unlockProfile({ password: 'richtig gutes Passwort' }, secret));
  assert.equal((await p.unlockProfile({ password: 'neues Passwort!' }, secret)).name, 'Max');
  p.lockProfile();
  assert.equal((await p.unlockProfile({ helloKey }, secret)).name, 'Max');
});

test('the vault saved while open is what opens next time', async () => {
  await make();
  const next = { ...vault, aliases: { '111': 'Haushalt' } };
  await p.saveProfileVault(next);
  assert.deepEqual(p.profileVault(), next);
  p.lockProfile();
  await assert.rejects(p.saveProfileVault(vault), (e: Error) => (e as InstanceType<typeof p.ProfileError>).code === 'locked');
  assert.deepEqual((await p.unlockProfile({ password: 'richtig gutes Passwort' }, secret)).vault, next);
});

test('banks: kept, a PIN replaced in place, a PIN forgotten, removed, reordered', async () => {
  await make({ banks: [sparkasse] });
  let banks = await p.keepBank(volksbank);
  assert.deepEqual(banks.map((b) => b.userId), ['kunde1', 'max']);
  banks = await p.keepBank({ ...sparkasse, pin: '99999', accounts: undefined });
  assert.equal(banks[0].pin, '99999');
  assert.deepEqual(banks[0].accounts, ['111', '222'], 'accounts kept when the update names none');
  // Kept again without a PIN: the one the profile has stays.
  banks = await p.keepBank({ blz: volksbank.blz, name: 'Volksbank eG', userId: 'max' });
  assert.equal(banks[1].pin, '54321');
  assert.equal(banks[1].name, 'Volksbank eG');
  banks = await p.forgetBankPin(sparkasse);
  assert.equal(banks[0].pin, undefined);
  banks = await p.orderBanks([volksbank]);
  assert.deepEqual(banks.map((b) => b.userId), ['max', 'kunde1']);
  banks = await p.removeBank(volksbank);
  assert.deepEqual(banks.map((b) => b.userId), ['kunde1']);
  p.lockProfile();
  const opened = await p.unlockProfile({ password: 'richtig gutes Passwort' }, secret);
  assert.deepEqual(opened.banks, [{ blz: sparkasse.blz, name: sparkasse.name, userId: 'kunde1', accounts: ['111', '222'] }]);
});

test('sanitizeBanks: each login once, a PIN only where it is one, nothing else kept', () => {
  const clean = p.sanitizeBanks([
    { ...sparkasse, extra: 'weg' },
    { ...sparkasse, pin: 'anders' },
    { blz: '1234', name: 'x', userId: 'y' },
    { blz: '87654321', name: 'Bank', userId: 'u', pin: 'zwei\nzeilen' },
    'kein Objekt',
  ]);
  assert.equal(clean.length, 2);
  assert.equal('extra' in clean[0], false);
  assert.equal(clean[0].pin, '12345');
  assert.equal(clean[1].pin, undefined);
  const many = Array.from({ length: 20 }, (_, i) => ({ blz: '12345678', name: 'B', userId: `u${i}` }));
  assert.equal(p.sanitizeBanks(many).length, p.PROFILE_LIMITS.banks);
});

test('profileName: one line, clipped, never empty spaces', () => {
  assert.equal(p.profileName('  Max \n Mustermann  '), 'Max Mustermann');
  assert.equal(p.profileName('x'.repeat(100)).length, p.PROFILE_LIMITS.name);
  assert.equal(p.profileName(42), '');
  assert.equal(p.profileName('   '), '');
});

test('rename: a new name on the unlock screen; an empty one is refused', async () => {
  await make();
  assert.equal(await p.renameProfile('  Familie  '), 'Familie');
  assert.equal((await p.profileStatus() as { name: string }).name, 'Familie');
  await assert.rejects(p.renameProfile('   '));
});

test('profileKey: the open profile\'s key and a fixed base, null when locked', async () => {
  await make();
  const k = p.profileKey();
  assert.ok(k && k.key.length === 32 && k.base === p.PROFILE_BASE);
  p.lockProfile();
  assert.equal(p.profileKey(), null);
});

test('set aside: kept as .bak, nothing open, a new profile can begin', async () => {
  await make();
  assert.equal(await p.setProfileAside(), true);
  assert.equal(p.isProfileOpen(), false);
  assert.deepEqual(await p.profileStatus(), { exists: false });
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('girovo.profile') && f.endsWith('.bak')));
  await make({ name: 'Neu' });
  assert.equal((await p.profileStatus() as { name: string }).name, 'Neu');
});

test('delete: needs the password, then every copy goes', async () => {
  await make();
  await p.setProfileAside();
  await make();
  await assert.rejects(p.deleteProfile('falsch falsch', secret), (e: Error) => (e as InstanceType<typeof p.ProfileError>).code === 'wrong');
  assert.ok(fs.existsSync(p.profileFile()));
  assert.ok(await p.deleteProfile('richtig gutes Passwort', secret) >= 2);
  assert.equal(p.isProfileOpen(), false);
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.startsWith('girovo.profile')), []);
});

test('a damaged file is a profile still: never replaced unasked, never opened', async () => {
  fs.writeFileSync(p.profileFile(), '{"v":1,"name":"Max"}');
  assert.deepEqual(await p.profileStatus(), { exists: true, name: '', hello: false, open: false, damaged: true });
  await assert.rejects(make(), (e: Error) => (e as InstanceType<typeof p.ProfileError>).code === 'exists');
  await assert.rejects(p.unlockProfile({ password: 'richtig gutes Passwort' }, secret), (e: Error) => (e as InstanceType<typeof p.ProfileError>).code === 'damaged');
});

test('a content box swapped in from another profile does not open', async () => {
  await make();
  const first = JSON.parse(fs.readFileSync(p.profileFile(), 'utf8'));
  await p.setProfileAside();
  await make({ name: 'Zweites' });
  const second = JSON.parse(fs.readFileSync(p.profileFile(), 'utf8'));
  fs.writeFileSync(p.profileFile(), JSON.stringify({ ...second, box: first.box }));
  p.lockProfile();
  await assert.rejects(p.unlockProfile({ password: 'richtig gutes Passwort' }, secret), (e: Error) => (e as InstanceType<typeof p.ProfileError>).code === 'damaged');
});
