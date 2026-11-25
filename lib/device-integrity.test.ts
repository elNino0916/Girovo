import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bootContradicted, copyVerdict, deviceVerdict, doubtSigns, integrityClass, integrityOf, integrityWarning, keepsNothing,
  mayAllowSaving, modifiedByPair, RELEASE_SIGNERS, strongSigns, unsafePhone, weakSigns,
  type IntegrityFacts, type RuntimeCheck, type SystemFacts,
} from './device-integrity.ts';

const attested: IntegrityFacts = {
  attestation: 'hardware', securityLevel: 'strongbox', chain: 'google', challengeOk: true,
  deviceLocked: true, bootState: 'verified',
  signers: [RELEASE_SIGNERS[0]], installer: null, debug: false, flavor: 'github',
};

test('a locked phone running its maker\'s system, attested up to Google, is trusted', () => {
  assert.equal(deviceVerdict(attested), 'trusted');
  assert.equal(deviceVerdict({ ...attested, securityLevel: 'tee' }), 'trusted');
});

test('an unlocked bootloader or an unverified system is a modified phone', () => {
  assert.equal(deviceVerdict({ ...attested, deviceLocked: false }), 'modified');
  assert.equal(deviceVerdict({ ...attested, deviceLocked: false, bootState: 'unverified' }), 'modified');
  assert.equal(deviceVerdict({ ...attested, bootState: 'failed' }), 'modified');
});

test('a root manager app alone is no finding, and no verified phone either', () => {
  const manager = { id: 'package:me.weishu.kernelsu', status: 'found' as const, detail: 'exact declared package query' };
  // The owner's S26: KernelSU's manager installed, locked verified boot, nothing else seen.
  const alone = integrityOf({ ...attested, runtime: [manager, { id: 'mounts', status: 'nothing seen', detail: 'own mount table read' }] });
  // Never a modification: the app is an app, and runs without root.
  assert.notEqual(alone.device, 'modified');
  assert.equal(integrityWarning(alone), null);
  // Never a verified phone: a root that hides from apps leaves nothing else to see.
  assert.equal(alone.device, 'inconclusive');
  assert.equal(integrityClass(alone.device), 'insufficient');
  assert.deepEqual(alone.doubt, ['manager']);
  assert.deepEqual(alone.runtime?.[0], manager, 'still shown as an observation');
  assert.equal(deviceVerdict({ runtime: [manager] }), 'unknown');
  assert.equal(deviceVerdict({ ...attested, runtime: [manager, { id: 'hosts', status: 'found', detail: 'bind mount' }] }), 'modified');
});

test('the three answers stay apart: verified, modified, insufficient evidence', () => {
  assert.equal(integrityClass('trusted'), 'verified');
  assert.equal(integrityClass('custom'), 'verified');
  assert.equal(integrityClass('modified'), 'modified');
  assert.equal(integrityClass('inconclusive'), 'insufficient');
  assert.equal(integrityClass('unknown'), 'insufficient');
  const doubt = [{ id: 'package:me.weishu.kernelsu', status: 'found' as const, detail: 'exact declared package query' }];
  // No finding is no clean phone: a doubt takes "verified" away, on the maker's system and on a custom one.
  assert.equal(deviceVerdict(attested), 'trusted');
  assert.equal(deviceVerdict({ ...attested, runtime: doubt }), 'inconclusive');
  assert.equal(deviceVerdict({ ...attested, bootState: 'self-signed' }), 'custom');
  assert.equal(deviceVerdict({ ...attested, bootState: 'self-signed', runtime: doubt }), 'inconclusive');
  // A doubt is no finding: only a finding or a second sign makes "modified".
  assert.equal(deviceVerdict({ ...attested, runtime: [...doubt, { id: 'covers', status: 'found', detail: 'own mount table read' }] }), 'modified');
  // Where nothing is proven to begin with, a doubt changes nothing: unknown stays unknown, modified stays modified.
  assert.equal(deviceVerdict({ ...attested, attestation: 'software', runtime: doubt }), 'unknown');
  assert.equal(deviceVerdict({ ...attested, revoked: true }), 'unknown');
  assert.equal(deviceVerdict({ ...attested, deviceLocked: false, runtime: doubt }), 'modified');
});

test('an inconclusive phone is handled as one that cannot prove itself, and says why', () => {
  const doubt = [{ id: 'package:me.weishu.kernelsu', status: 'found' as const, detail: 'exact declared package query' }];
  const phone = integrityOf({ ...attested, runtime: doubt });
  // No red warning at the login: nothing is shown to be wrong.
  assert.equal(integrityWarning(phone), null);
  // Nothing is kept and no PIN goes behind a fingerprint, until the user allows the keeping.
  assert.equal(unsafePhone(phone), true);
  assert.equal(keepsNothing(phone), true);
  assert.equal(mayAllowSaving(phone), true);
  const allowed = integrityOf({ ...attested, runtime: doubt }, 'inconclusive');
  assert.equal(allowed.savingAllowed, true);
  assert.equal(keepsNothing(allowed), false);
  assert.equal(unsafePhone(allowed), true, 'still no PIN behind a fingerprint');
  // The choice was made for this verdict: allowed while unprovable is asked again, and so is a phone that turns out modified.
  assert.equal(keepsNothing(integrityOf({ ...attested, runtime: doubt }, 'unknown')), true);
  assert.equal(keepsNothing(integrityOf({ ...attested, runtime: [...doubt, { id: 'maps', status: 'found', detail: 'zygisk' }] }, 'inconclusive')), true);
  // Once the app is gone the phone is verified again, with nothing left to allow.
  assert.equal(integrityOf(attested, 'inconclusive').device, 'trusted');
  assert.equal(integrityOf(attested, 'inconclusive').savingAllowed, false);
  // A foreign copy never; a debug build keeps its data, as on any unproven phone.
  assert.equal(keepsNothing(integrityOf({ ...attested, runtime: doubt, signers: ['ab'.repeat(32)] }, 'inconclusive')), true);
  assert.equal(keepsNothing(integrityOf({ ...attested, runtime: doubt, debug: true })), false);
});

// What an unmodified phone says of itself (the owner's S26, Android 17, as read on 2026-11-24).
const stock: SystemFacts = { type: 'user', tags: 'release-keys', bootState: 'green', deviceState: 'locked', warranty: '0' };
const found = (id: string): RuntimeCheck => ({ id, status: 'found', detail: 'observed in app process' });
const manager = found('package:me.weishu.kernelsu');
const covers = found('covers');

test('two weak signs of different kinds are a modified phone, whatever the attestation says', () => {
  // The owner's S26 in October 2026: rooted through a kernel exploit, so the
  // boot was attested locked and verified, truthfully. KernelSU's manager
  // and a module's cover over /product/app/YouTube were all Girovo could see.
  const october = integrityOf({ ...attested, system: stock, runtime: [manager, covers] });
  assert.deepEqual(weakSigns({ ...attested, system: stock, runtime: [manager, covers] }), ['manager', 'covers']);
  assert.equal(october.device, 'modified');
  assert.equal(integrityWarning(october), 'modified');
  assert.equal(keepsNothing(october), true);
  // Every other pair that holds a sign of a root tool as well.
  assert.equal(deviceVerdict({ ...attested, runtime: [covers], system: { ...stock, warranty: '1' } }), 'modified');
  assert.equal(deviceVerdict({ ...attested, runtime: [manager], system: { ...stock, warranty: '1' } }), 'modified');
  assert.equal(deviceVerdict({ ...attested, revoked: true, runtime: [manager] }), 'modified');
  assert.equal(deviceVerdict({ ...attested, revoked: true, runtime: [covers] }), 'modified');
});

test('two signs of what a phone once was are no pair: no root tool among them', () => {
  // A second-hand Galaxy back on Samsung's system and locked again, from a
  // batch whose factory key leaked: the Knox bit and a revoked key, no root.
  const secondHand: IntegrityFacts = { ...attested, revoked: true, system: { ...stock, warranty: '1' } };
  assert.deepEqual(weakSigns(secondHand), ['warranty', 'revoked']);
  assert.equal(modifiedByPair(secondHand), false);
  assert.equal(deviceVerdict(secondHand), 'unknown');
  assert.equal(integrityWarning(integrityOf(secondHand)), null);
  // The keys a system is signed with are no sign at all, alone or beside another: only logged.
  assert.deepEqual(weakSigns({ ...attested, system: { ...stock, tags: 'test-keys' } }), []);
  assert.equal(deviceVerdict({ ...attested, system: { ...stock, tags: 'dev-keys,debug' } }), 'trusted');
  assert.equal(deviceVerdict({ ...attested, revoked: true, system: { ...stock, tags: 'test-keys' } }), 'unknown');
  assert.equal(deviceVerdict({ ...attested, runtime: [manager], system: { ...stock, tags: 'test-keys' } }), 'inconclusive');
});

test('one weak sign is never a modification, however often it is seen', () => {
  // A root manager app casts a doubt on a phone whose attestation passes.
  assert.equal(deviceVerdict({ ...attested, system: stock, runtime: [manager] }), 'inconclusive');
  assert.deepEqual(doubtSigns({ ...attested, system: stock, runtime: [manager] }), ['manager']);
  // A covered app folder alone casts none yet: no stock phone is known to
  // have one, and none is proven not to. Logged, and a pair's second sign.
  assert.equal(deviceVerdict({ ...attested, system: stock, runtime: [covers] }), 'trusted');
  assert.deepEqual(doubtSigns({ ...attested, system: stock, runtime: [covers] }), []);
  assert.deepEqual(weakSigns({ ...attested, system: stock, runtime: [covers] }), ['covers']);
  // What the phone once was casts none: the Knox bit stays set for good on a phone back on Samsung's system.
  assert.equal(deviceVerdict({ ...attested, system: { ...stock, warranty: '1' } }), 'trusted');
  assert.deepEqual(doubtSigns({ ...attested, system: { ...stock, warranty: '1' } }), []);
  // Two manager apps are one kind of sign.
  const two = [manager, found('package:com.topjohnwu.magisk')];
  assert.deepEqual(weakSigns({ runtime: two }), ['manager']);
  assert.equal(deviceVerdict({ ...attested, system: stock, runtime: two }), 'inconclusive');
  // Checks that saw nothing or could not look are no signs.
  assert.deepEqual(weakSigns({ runtime: [{ ...manager, status: 'nothing seen' }, { ...covers, status: 'unavailable' }] }), []);
  assert.deepEqual(weakSigns({ ...attested, system: stock }), []);
  assert.deepEqual(weakSigns({ system: { tags: 'release-keys' } }), []);
});

test('the same phone a month later, its root hidden: only the manager app is left to see', () => {
  // The owner's S26 on 2026-11-24, as its Girovo process saw it (read over
  // adb): a true locked, verified attestation, clean properties, no module
  // mounts, nothing in the process, no su for an app that is not granted
  // root. Nothing shows the root, so the phone is not called modified; the
  // manager app is there, so it is not called verified.
  const hidden = integrityOf({ ...attested, system: stock, runtime: [
    manager,
    { id: 'mounts', status: 'nothing seen', detail: 'own mount table read' },
    { id: 'covers', status: 'nothing seen', detail: 'own mount table read' },
    { id: 'maps', status: 'nothing seen', detail: '4209 mappings read' },
    { id: 'tools', status: 'nothing seen', detail: '10 folders: 70 absent, 0 refused' },
    { id: 'selinux', status: 'unavailable', detail: 'FileNotFoundException' },
  ] });
  assert.equal(hidden.device, 'inconclusive');
  assert.equal(integrityWarning(hidden), null);
  assert.equal(keepsNothing(hidden), true);
});

test('a key Google has revoked proves nothing: the phone cannot show it is unmodified', () => {
  const revoked = integrityOf({ ...attested, system: stock, revoked: true });
  assert.equal(revoked.device, 'unknown');
  assert.equal(keepsNothing(revoked), true);
  // Factory keys are shared by a batch of phones: said in Einstellungen, not warned about at the login.
  assert.equal(integrityWarning(revoked), null);
  assert.equal(mayAllowSaving(revoked), true);
  assert.equal(deviceVerdict({ ...attested, revoked: false }), 'trusted');
  // A copy of the list that could not be read says nothing either way.
  assert.equal(deviceVerdict({ ...attested, revoked: undefined }), 'trusted');
  // An unlocked boot is an admission, whatever key signs it; so is a contradiction.
  assert.equal(deviceVerdict({ ...attested, revoked: true, deviceLocked: false }), 'modified');
  assert.equal(deviceVerdict({ ...attested, revoked: true, system: { ...stock, bootState: 'orange' } }), 'modified');
});

test('a system that contradicts its attested boot gives the forgery away', () => {
  // A forged "locked, verified" over an unlocked phone whose properties nobody rewrote.
  for (const system of [
    { ...stock, bootState: 'orange', deviceState: 'unlocked' },
    { ...stock, bootState: 'orange' },
    { ...stock, deviceState: 'unlocked' },
    { ...stock, bootState: 'yellow' },
    { ...stock, bootState: 'red' },
  ]) {
    assert.equal(bootContradicted({ ...attested, system }), true, JSON.stringify(system));
    assert.equal(deviceVerdict({ ...attested, system }), 'modified', JSON.stringify(system));
  }
  // GrapheneOS: attested self-signed, and yellow in its properties. No contradiction.
  const graphene: IntegrityFacts = { ...attested, bootState: 'self-signed', system: { ...stock, bootState: 'yellow' } };
  assert.equal(bootContradicted(graphene), false);
  assert.equal(deviceVerdict(graphene), 'custom');
  // A phone that leaves the properties out, or names states the standard does not, says nothing.
  assert.equal(deviceVerdict({ ...attested, system: { type: 'user' } }), 'trusted');
  assert.equal(deviceVerdict({ ...attested, system: { ...stock, bootState: 'GREEN ', deviceState: '' } }), 'trusted');
  assert.equal(deviceVerdict(attested), 'trusted');
  // Without an attestation to contradict, the properties alone decide nothing (an emulator boots orange).
  assert.equal(deviceVerdict({ attestation: 'software', system: { ...stock, bootState: 'orange', deviceState: 'unlocked' } }), 'unknown');
});

test('a debuggable or insecure system is no phone maker\'s release', () => {
  for (const system of [
    { ...stock, type: 'userdebug' }, { ...stock, type: 'eng' }, { ...stock, debuggable: '1' }, { ...stock, secure: '0' },
  ]) {
    assert.equal(deviceVerdict({ ...attested, system }), 'modified', JSON.stringify(system));
    assert.equal(deviceVerdict({ system }), 'modified', 'with no attestation at all');
  }
  assert.deepEqual(strongSigns({ system: { type: 'userdebug', debuggable: '1', secure: '0' } }), ['build:type', 'build:debuggable', 'build:insecure']);
  assert.deepEqual(strongSigns({ ...attested, system: { ...stock, debuggable: '0', secure: '1' } }), []);
  // A debug build of Girovo runs on the emulator's debuggable system and keeps its data there.
  const emulator: IntegrityFacts = { ...attested, chain: 'other', debug: true, system: { type: 'userdebug', debuggable: '1', bootState: 'orange' } };
  assert.equal(deviceVerdict(emulator), 'unknown');
  assert.equal(keepsNothing(integrityOf(emulator)), false);
});

test('each positive system check overrides a verified boot, warning and persistence', () => {
  for (const id of ['mounts', 'hosts', 'path:/system/bin/su', 'maps', 'tools', 'selinux']) {
    const runtime = [{ id, status: 'found' as const, detail: 'observed in app process' }];
    const result = integrityOf({ ...attested, runtime });
    assert.equal(result.device, 'modified', id);
    assert.equal(integrityWarning(result), 'modified', id);
    assert.equal(keepsNothing(result), true, id);
    assert.deepEqual(result.runtime, runtime, 'retain diagnostics for unavailable and positive observations');
    assert.equal(deviceVerdict({ runtime }), 'modified', 'missing attestation cannot erase evidence');
    assert.equal(deviceVerdict({ ...attested, bootState: 'self-signed', runtime }), 'modified');
    assert.equal(keepsNothing(integrityOf({ ...attested, debug: true, runtime })), true, 'debug must not bypass the lock');
  }
});

test('unavailable and negative runtime observations stay distinct and never manufacture a finding', () => {
  const runtime = [
    { id: 'mounts', status: 'unavailable' as const, detail: 'ErrnoException errno=13' },
    { id: 'package:com.topjohnwu.magisk', status: 'nothing seen' as const, detail: 'not returned by exact declared query' },
  ];
  const result = integrityOf({ ...attested, runtime });
  assert.equal(result.device, 'trusted', 'this verdict still describes the attested boot, not a clean runtime');
  assert.deepEqual(result.runtime, runtime);
  assert.equal(deviceVerdict({ runtime }), 'unknown');
  assert.equal(deviceVerdict({ ...attested, runtime: [...runtime, { id: 'hosts', status: 'found', detail: 'zero links' }] }), 'modified');
});

test('a custom system with its own key and a locked bootloader is no warning', () => {
  // GrapheneOS: self-signed, locked — as safe as the maker's system.
  assert.equal(deviceVerdict({ ...attested, bootState: 'self-signed' }), 'custom');
  assert.equal(integrityWarning(integrityOf({ ...attested, bootState: 'self-signed' })), null);
});

test('nothing the phone cannot prove is taken for either answer', () => {
  for (const f of [
    { ...attested, attestation: 'software' as const },
    { ...attested, attestation: 'error' as const },
    { ...attested, chain: 'other' as const }, // an emulator's test root, or a forged chain
    { ...attested, chain: 'broken' as const },
    { ...attested, challengeOk: false }, // an answer to some other request
    { ...attested, bootState: undefined },
    { signers: [] },
  ]) assert.equal(deviceVerdict(f), 'unknown', JSON.stringify(f));
  // An unprovable phone is said in Einstellungen, not warned about at the login.
  assert.equal(integrityWarning(integrityOf({ ...attested, attestation: 'software', deviceLocked: false })), null);
});

test('the copy: the release key, Play\'s own re-signing, someone else\'s key', () => {
  assert.equal(copyVerdict(attested), 'official');
  assert.equal(copyVerdict({ ...attested, signers: [RELEASE_SIGNERS[0].toUpperCase()] }), 'official');
  const other = { ...attested, signers: ['00'.repeat(32)] };
  assert.equal(copyVerdict(other), 'foreign');
  // Play App Signing: Play's key, installed by Play.
  assert.equal(copyVerdict({ ...other, flavor: 'play', installer: 'com.android.vending' }), 'official');
  // The Play build with another key, sideloaded: someone else's copy.
  assert.equal(copyVerdict({ ...other, flavor: 'play', installer: 'com.example.store' }), 'foreign');
  assert.equal(copyVerdict({ ...other, debug: true }), 'development');
  assert.equal(copyVerdict({ ...attested, signers: [] }), 'unknown');
});

test('the login warns about a foreign copy first, then a modified phone', () => {
  assert.equal(integrityWarning(integrityOf(attested)), null);
  assert.equal(integrityWarning(integrityOf({ ...attested, deviceLocked: false })), 'modified');
  assert.equal(integrityWarning(integrityOf({ ...attested, deviceLocked: false, signers: ['ab'] })), 'foreign');
  assert.equal(integrityWarning(null), null);
});

test('Girovo keeps nothing on a phone that is modified or cannot prove it is not', () => {
  assert.equal(keepsNothing(integrityOf(attested)), false);
  assert.equal(keepsNothing(integrityOf({ ...attested, bootState: 'self-signed' })), false); // GrapheneOS
  assert.equal(keepsNothing(integrityOf({ ...attested, deviceLocked: false })), true);
  assert.equal(keepsNothing(integrityOf({ ...attested, attestation: 'software' })), true);
  // The check itself failed: nothing proven.
  assert.equal(keepsNothing(null), true);
  // A debug build on an emulator keeps its data.
  assert.equal(keepsNothing(integrityOf({ ...attested, chain: 'other', debug: true })), false);
});

test('past the warning, an unsafe phone keeps its data — for the verdict it was allowed on', () => {
  const rooted: IntegrityFacts = { ...attested, deviceLocked: false };
  const allowed = integrityOf(rooted, 'modified');
  assert.equal(allowed.savingAllowed, true);
  assert.equal(keepsNothing(allowed), false);
  // Still a modified phone: the login warns, no PIN goes behind a fingerprint.
  assert.equal(integrityWarning(allowed), 'modified');
  assert.equal(unsafePhone(allowed), true);
  // Allowed while it could not prove anything, then found modified: asked again.
  assert.equal(keepsNothing(integrityOf(rooted, 'unknown')), true);
  assert.equal(keepsNothing(integrityOf({ ...attested, attestation: 'software' }, 'unknown')), false);
  // A positive runtime finding is a modified phone like any other.
  const found = integrityOf({ ...attested, runtime: [{ id: 'su', status: 'found', detail: '/system/bin/su' }] }, 'modified');
  assert.equal(keepsNothing(found), false);
});

test('a foreign copy, or a safe phone, has nothing to allow', () => {
  const foreign = integrityOf({ ...attested, deviceLocked: false, signers: ['ab'.repeat(32)] }, 'modified');
  assert.equal(mayAllowSaving(foreign), false);
  assert.equal(foreign.savingAllowed, false);
  assert.equal(keepsNothing(foreign), true);
  // Even a hand-made answer claiming the choice cannot open a foreign copy.
  assert.equal(keepsNothing({ ...foreign, savingAllowed: true }), true);
  assert.equal(mayAllowSaving(integrityOf(attested)), false);
  assert.equal(integrityOf(attested, 'modified').savingAllowed, false);
  assert.equal(mayAllowSaving(null), false);
});
