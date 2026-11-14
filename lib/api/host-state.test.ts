import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageReadyFor, publisherLabel, vaultSwitchMove, waitingNotice } from './host-state.ts';
import type { ApiClient } from './types.ts';

const SHA = 'a'.repeat(64);
const haushalt: ApiClient = {
  pid: 10, exe: 'C:\\Program Files\\Haushalt\\Haushalt.exe', sha256: SHA, name: 'Haushaltsbuch',
  publisher: { kind: 'verified', name: ' Beispiel GmbH ' },
};
const unknownApp: ApiClient = { pid: 11, exe: 'C:\\Tools\\konto-export.exe', sha256: SHA, name: 'konto-export.exe', publisher: { kind: 'unknown' } };
const viaMcp: ApiClient = {
  pid: 12, exe: 'C:\\Program Files\\Girovo\\girovo-mcp.exe', sha256: SHA, name: 'Girovo MCP', publisher: { kind: 'mtmedia', name: 'MT-Media' },
  parent: { pid: 9, exe: 'C:\\Program Files\\Claude\\Claude.exe', sha256: SHA, name: 'Claude', publisher: { kind: 'verified', name: 'Anthropic PBC' } },
};

test('the publisher as the sheet and the login name it', () => {
  assert.equal(publisherLabel(haushalt), 'Beispiel GmbH');
  assert.equal(publisherLabel(unknownApp), null);
  assert.equal(publisherLabel(viaMcp), 'MT-Media');
  // A verified chain without a name says nothing either.
  assert.equal(publisherLabel({ ...haushalt, publisher: { kind: 'verified', name: '  ' } }), null);
});

test('the login names the first app waiting, each app once, an assistant as itself', () => {
  assert.equal(waitingNotice([]), null);
  assert.equal(waitingNotice(null), null);
  assert.deepEqual(waitingNotice([haushalt]), { app: 'Haushaltsbuch', publisher: 'Beispiel GmbH', more: 0 });
  // The same program from a second process is still one app.
  assert.deepEqual(waitingNotice([haushalt, { ...haushalt, pid: 20 }, unknownApp]), { app: 'Haushaltsbuch', publisher: 'Beispiel GmbH', more: 1 });
  assert.deepEqual(waitingNotice([viaMcp]), { app: 'Claude', publisher: 'Anthropic PBC', more: 0 });
  assert.deepEqual(waitingNotice([unknownApp]), { app: 'konto-export.exe', publisher: null, more: 0 });
  // No name at all: the file.
  assert.equal(waitingNotice([{ ...unknownApp, name: '' }])!.app, 'C:\\Tools\\konto-export.exe');
});

test('the page answers once the vault is open', () => {
  assert.equal(pageReadyFor('ready'), true);
  for (const status of ['idle', 'loading', 'unavailable', 'error']) assert.equal(pageReadyFor(status), false);
});

test('the vault’s old switch moves to the shell once, and only while the shell’s is known', () => {
  // The shell has not said yet: nothing happens.
  assert.deepEqual(vaultSwitchMove(true, null), { turnOn: false, dropFromVault: false });
  // A build that kept it in the vault only: the shell's goes on, the vault's goes.
  assert.deepEqual(vaultSwitchMove(true, false), { turnOn: true, dropFromVault: true });
  assert.deepEqual(vaultSwitchMove(true, true), { turnOn: false, dropFromVault: true });
  // Nothing in the vault: the shell's switch stands, on or off.
  assert.deepEqual(vaultSwitchMove(false, false), { turnOn: false, dropFromVault: false });
  assert.deepEqual(vaultSwitchMove(false, true), { turnOn: false, dropFromVault: false });
});
