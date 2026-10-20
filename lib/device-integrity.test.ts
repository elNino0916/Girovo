import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyVerdict, deviceVerdict, integrityOf, integrityWarning, RELEASE_SIGNERS, type IntegrityFacts } from './device-integrity.ts';

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
