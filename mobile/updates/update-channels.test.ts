import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ed25519 } from '@noble/curves/ed25519.js';
import {
  CHANNELS_PREFIX,
  MAX_LIST_CHANNELS,
  PREVIEW_CHANNEL,
  STABLE_CHANNEL,
  acceptChannels,
  channelsMessage,
  keyId,
  offeredChannels,
  parseChannelList,
  readChannelList,
  resolveChannel,
  signChannelList,
  signManifest,
  toBase64,
  verifiedListText,
  verifyChannels,
  type ChannelList,
} from './update-trust.ts';
import { TRUSTED_KEYS } from './update-keys.ts';

// The channel list girovo.de serves (docs/update-channels.md): signed by the
// stable key alone, read entry by entry, never older than the list held. The
// desktop's Rust copy (src-tauri/src/updater/trust.rs) reads the same test file.

/** The test key [1; 32], the stable key in these tests. */
const TEST_SECRET = new Uint8Array(32).fill(1);
const TEST_PUBLIC = 'iojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w=';
const KEYS = { stable: TEST_PUBLIC, nightly: '' };
const FIXTURE = fs.readFileSync(new URL('./__fixtures__/channels-test.json', import.meta.url), 'utf8');

const ids = (list: ChannelList | null) => list?.channels.map((c) => c.id) ?? null;
const listText = (channels: unknown[], serial = 1) => `${JSON.stringify({ format: 'girovo-channel-list', v: 1, serial, channels }, null, 2)}\n`;
const entry = (id: string, extra: Record<string, unknown> = {}) => ({ id, keys: ['stable'], name: { de: id, en: id }, ...extra });
const envelope = (channels: unknown[], serial = 1) => signChannelList(listText(channels, serial), TEST_SECRET);

test('the test key is the one the test file names', () => {
  assert.equal(toBase64(ed25519.getPublicKey(TEST_SECRET)), TEST_PUBLIC);
  assert.equal(JSON.parse(JSON.parse(FIXTURE).sig).key, keyId(ed25519.getPublicKey(TEST_SECRET)));
});

test('the test file read on the desktop', () => {
  const list = verifyChannels(FIXTURE, KEYS, 'desktop')!;
  assert.equal(list.serial, 3);
  assert.deepEqual(ids(list), ['next', 'api', 'old']);
  const [next, api, old] = list.channels;
  assert.deepEqual(next, {
    id: 'next', keys: ['stable', 'next'], usage: true, hidden: true, ended: false, then: 'stable', platforms: ['desktop'],
    name: { de: 'Next', en: 'Next' },
    hint: { de: 'Vorschau auf die nächste große Version.', en: 'A preview of the next major version.' },
  });
  assert.deepEqual([api.keys, api.usage, api.hidden, api.ended, api.platforms], [['reserve1'], false, false, false, ['desktop', 'apk']]);
  assert.deepEqual(api.hint, { de: '', en: '' }, 'no hint: empty');
  assert.deepEqual([old.ended, old.then, old.usage, old.platforms], [true, 'preview', true, ['desktop']], 'the defaults');
});

test('the test file read on the APK', () => {
  assert.deepEqual(ids(verifyChannels(FIXTURE, KEYS, 'apk')), ['api', 'old', 'apkonly']);
});

test('the test file drops Bad, nokeys and the second api everywhere', () => {
  const text = verifiedListText(FIXTURE, KEYS)!;
  const read = readChannelList(text)!;
  assert.deepEqual(read.dropped.map((d) => [d.id, d.reason]), [['Bad', 'id'], ['nokeys', 'keys'], ['api', 'duplicate id']]);
  assert.deepEqual(read.channels.find((c) => c.id === 'api')?.name.de, 'API-Test', 'the first api stays');
});

test('the built-in keys don’t take the test file', () => {
  assert.equal(verifyChannels(FIXTURE, TRUSTED_KEYS, 'desktop'), null);
});

test('a list counts only signed by the stable key, over the list prefix', () => {
  const text = listText([entry('api')]);
  assert.deepEqual(ids(verifyChannels(signChannelList(text, TEST_SECRET), KEYS, 'desktop')), ['api']);
  const env = JSON.parse(signChannelList(text, TEST_SECRET));
  const bad = (patch: Record<string, unknown>) => JSON.stringify({ ...env, ...patch });

  // A release signature over the same bytes: the other prefix.
  assert.equal(verifyChannels(bad({ sig: signManifest(new TextEncoder().encode(text), TEST_SECRET) }), KEYS, 'desktop'), null, 'release prefix');
  // A list signature can't pass as a release signature either.
  const listSig = JSON.parse(env.sig);
  const asRelease = toBase64(ed25519.sign(channelsMessage(text), TEST_SECRET));
  assert.equal(listSig.sig, asRelease);
  assert.equal(CHANNELS_PREFIX, 'girovo-channels/1\n');
  // Signed with the right bytes, by a key the app holds in another role.
  const other = ed25519.utils.randomSecretKey();
  const otherPub = toBase64(ed25519.getPublicKey(other));
  for (const role of ['nightly', 'next', 'reserve1', 'reserve2']) {
    assert.equal(verifyChannels(signChannelList(text, other), { ...KEYS, [role]: otherPub }, 'desktop'), null, `the ${role} key`);
  }
  assert.equal(verifyChannels(signChannelList(text, other), KEYS, 'desktop'), null, 'a stranger’s key');
  // Tampered.
  assert.equal(verifyChannels(bad({ list: text.replace('"api"', '"apx"') }), KEYS, 'desktop'), null, 'a changed list');
  const flipped = Buffer.from(listSig.sig, 'base64');
  flipped[3] ^= 1;
  assert.equal(verifyChannels(bad({ sig: JSON.stringify({ ...listSig, sig: flipped.toString('base64') }) }), KEYS, 'desktop'), null, 'a damaged signature');
  // Not an envelope.
  for (const odd of [bad({ format: 'girovo-update' }), bad({ v: 2 }), bad({ sig: listSig }), bad({ list: JSON.parse(text) }), 'not json', '', 'null', '[]']) {
    assert.equal(verifyChannels(odd, KEYS, 'desktop'), null, odd.slice(0, 50));
  }
  assert.equal(verifyChannels(null, KEYS, 'desktop'), null);
  assert.equal(verifyChannels(signChannelList(text, TEST_SECRET), { stable: '', nightly: TEST_PUBLIC }, 'desktop'), null, 'an empty stable key trusts nothing');
});

test('a list that is no list is refused whole', () => {
  for (const serial of [0, -1, 1.5, '1', null, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(parseChannelList(listText([entry('api')], serial as number), 'desktop'), null, `serial ${serial}`);
  }
  assert.equal(parseChannelList(listText([entry('api')], Number.MAX_SAFE_INTEGER), 'desktop')?.serial, Number.MAX_SAFE_INTEGER);
  assert.equal(parseChannelList(JSON.stringify({ format: 'other', v: 1, serial: 1, channels: [] }), 'desktop'), null);
  assert.equal(parseChannelList(JSON.stringify({ format: 'girovo-channel-list', v: 2, serial: 1, channels: [] }), 'desktop'), null);
  assert.equal(parseChannelList(JSON.stringify({ format: 'girovo-channel-list', v: 1, serial: 1 }), 'desktop'), null);
  assert.deepEqual(parseChannelList(listText([]), 'desktop'), { serial: 1, channels: [] });
});

test('each entry is checked on its own: one that doesn’t fit drops itself, not the list', () => {
  const name24 = 'x'.repeat(24);
  const cases: [unknown, boolean][] = [
    [entry('ok'), true],
    [{ ...entry('ok'), extra: 'ignored' }, true],
    [entry('stable'), false],
    [entry('preview'), false],
    [entry('nightly'), false],
    [entry('a'), false],
    [entry('abcdefghijklmnop'), true],
    [entry('abcdefghijklmnopq'), false],
    [entry('9lives'), false],
    [entry('con_fig'), false],
    [{ ...entry('ok'), id: 7 }, false],
    [entry('ok', { keys: [] }), false],
    [entry('ok', { keys: 'stable' }), false],
    [entry('ok', { keys: ['stable', 'owner'] }), false],
    [entry('ok', { keys: ['reserve2', 'next', 'nightly'] }), true],
    [{ id: 'ok', name: { de: 'x', en: 'x' } }, false],
    [entry('ok', { usage: 'yes' }), false],
    [entry('ok', { hidden: 1 }), false],
    [entry('ok', { ended: null }), false],
    [entry('ok', { platforms: [] }), false],
    [entry('ok', { platforms: ['desktop', 'ios'] }), false],
    [entry('ok', { platforms: 'desktop' }), false],
    [entry('ok', { then: 'nightly' }), false],
    [entry('ok', { then: 'ok' }), false],
    [entry('ok', { then: 'nowhere' }), false],
    [entry('ok', { then: 'preview' }), true],
    [entry('ok', { then: 7 }), false],
    [entry('ok', { name: undefined }), false],
    [entry('ok', { name: { de: '', en: 'x' } }), false],
    [entry('ok', { name: { de: 'x' } }), false],
    [entry('ok', { name: { de: name24, en: name24 } }), true],
    [entry('ok', { name: { de: `${name24}x`, en: 'x' } }), false],
    [entry('ok', { name: { de: '🙂'.repeat(24), en: 'x' } }), true],
    [entry('ok', { hint: { de: '', en: '' } }), true],
    [entry('ok', { hint: { de: 'h'.repeat(120), en: '' } }), true],
    [entry('ok', { hint: { de: 'h'.repeat(121), en: '' } }), false],
    [entry('ok', { hint: { de: 'x' } }), false],
    [entry('ok', { hint: 'x' }), false],
    ['ok', false],
    [null, false],
  ];
  for (const [raw, kept] of cases) {
    const list = parseChannelList(listText([entry('first'), raw]), 'desktop')!;
    assert.deepEqual(ids(list), kept ? ['first', (raw as { id: string }).id] : ['first'], JSON.stringify(raw));
  }
});

test('then may name another channel of the list', () => {
  const list = parseChannelList(listText([entry('old', { ended: true, then: 'api' }), entry('api')]), 'desktop')!;
  assert.deepEqual(ids(list), ['old', 'api']);
  const dropped = readChannelList(listText([entry('old', { ended: true, then: 'gone' }), entry('api')]))!;
  assert.deepEqual(dropped.dropped.map((d) => [d.index, d.id, d.reason]), [[0, 'old', 'then']]);
});

test('only the first eight entries count, and an id seen before is dropped', () => {
  const many = Array.from({ length: 10 }, (_, i) => entry(`c${i}x`));
  assert.equal(MAX_LIST_CHANNELS, 8);
  assert.deepEqual(ids(parseChannelList(listText(many), 'desktop')), many.slice(0, 8).map((e) => e.id));
  assert.deepEqual(ids(parseChannelList(listText([entry('api'), entry('api', { name: { de: 'B', en: 'B' } })]), 'desktop')), ['api']);
  assert.equal(parseChannelList(listText([entry('api'), entry('api', { name: { de: 'B', en: 'B' } })]), 'desktop')!.channels[0].name.de, 'api');
  // An id seen before counts even when that entry did not fit.
  assert.deepEqual(ids(parseChannelList(listText([entry('api', { keys: [] }), entry('api')]), 'desktop')), []);
});

test('platforms: desktop by default; an entry for another platform counts as absent unless it has ended', () => {
  const text = listText([entry('desk'), entry('both', { platforms: ['apk', 'desktop'] }), entry('phone', { platforms: ['apk'] }), entry('gone', { ended: true })]);
  assert.deepEqual(ids(parseChannelList(text, 'desktop')), ['desk', 'both', 'gone']);
  assert.deepEqual(ids(parseChannelList(text, 'apk')), ['both', 'phone', 'gone']);
});

test('a list replaces the one held only with a serial at least as high', () => {
  const held = verifyChannels(envelope([entry('api')], 3), KEYS, 'apk')!;
  assert.equal(acceptChannels(envelope([entry('api'), entry('back')], 2), held, KEYS, 'apk'), null, 'an older list brings nothing back');
  assert.deepEqual(ids(acceptChannels(envelope([], 3), held, KEYS, 'apk')), [], 'the same serial is taken');
  assert.equal(acceptChannels(envelope([], 4), held, KEYS, 'apk')?.serial, 4);
  assert.equal(acceptChannels(envelope([], 1), null, KEYS, 'apk')?.serial, 1, 'none held: any signed list');
  assert.equal(acceptChannels(FIXTURE.replace('serial', 'serlal'), null, KEYS, 'apk'), null, 'unsigned: never');
  assert.equal(acceptChannels(signChannelList(listText([], 9), ed25519.utils.randomSecretKey()), held, KEYS, 'apk'), null);
});

test('the stored channel against the list held', () => {
  const desktop = verifyChannels(FIXTURE, KEYS, 'desktop')!;
  const apk = verifyChannels(FIXTURE, KEYS, 'apk')!;
  const at = (stored: unknown, list: ChannelList | null) => {
    const r = resolveChannel(stored, list);
    return [r.id, r.rule.id, r.moveTo];
  };
  // Built-ins are themselves, with or without a list.
  assert.deepEqual(at('stable', desktop), ['stable', 'stable', null]);
  assert.deepEqual(at('preview', null), ['preview', 'preview', null]);
  assert.deepEqual(resolveChannel('preview', desktop).rule, PREVIEW_CHANNEL);
  assert.deepEqual(resolveChannel('stable', null).rule, STABLE_CHANNEL);
  assert.deepEqual(at(null, desktop), ['stable', 'stable', null], 'unset: Stabil');
  assert.deepEqual(at('Not a channel', desktop), ['stable', 'stable', null], 'odd stored text reads as Stabil, as it always did');
  // A list channel on its platform, hidden or not.
  assert.deepEqual(at('next', desktop), ['next', 'next', null]);
  assert.deepEqual(resolveChannel('next', desktop).rule, { id: 'next', keys: ['stable', 'next'], manifest: 'next' });
  assert.deepEqual(at('api', apk), ['api', 'api', null]);
  // Absent (or for another platform): to Stabil.
  assert.deepEqual(at('gone', desktop), ['stable', 'stable', 'stable']);
  assert.deepEqual(at('next', apk), ['stable', 'stable', 'stable'], 'next is the desktop’s');
  assert.deepEqual(at('apkonly', desktop), ['stable', 'stable', 'stable']);
  // Ended: to its then.
  assert.deepEqual(at('old', desktop), ['preview', 'preview', 'preview']);
  assert.deepEqual(at('old', apk), ['preview', 'preview', 'preview']);
  // No list held: checked as Stabil, the stored value stays.
  assert.deepEqual(at('next', null), ['stable', 'stable', null]);
});

test('an ended channel’s then is followed, and a loop ends on Stabil', () => {
  const chain = parseChannelList(listText([entry('a1', { ended: true, then: 'b1' }), entry('b1', { ended: true, then: 'c1' }), entry('c1')]), 'desktop')!;
  assert.deepEqual(resolveChannel('a1', chain), { id: 'c1', rule: { id: 'c1', keys: ['stable'], manifest: 'c1' }, moveTo: 'c1' });
  const loop = parseChannelList(listText([entry('a1', { ended: true, then: 'b1' }), entry('b1', { ended: true, then: 'a1' })]), 'desktop')!;
  assert.deepEqual(resolveChannel('a1', loop).moveTo, 'stable');
  const toPhone = parseChannelList(listText([entry('a1', { ended: true, then: 'p1' }), entry('p1', { platforms: ['apk'] })]), 'desktop')!;
  assert.deepEqual(resolveChannel('a1', toPhone).moveTo, 'stable', 'a then that is absent here: Stabil');
});

test('the channels the page offers', () => {
  const desktop = verifyChannels(FIXTURE, KEYS, 'desktop')!;
  const apk = verifyChannels(FIXTURE, KEYS, 'apk')!;
  const builtins = [{ id: 'stable', builtin: true, usage: false }, { id: 'preview', builtin: true, usage: true }];
  const api = { id: 'api', builtin: false, usage: false, name: { de: 'API-Test', en: 'API test' }, hint: { de: '', en: '' } };
  assert.deepEqual(offeredChannels(null, 'stable'), builtins, 'no list: the built-ins');
  assert.deepEqual(offeredChannels(desktop, 'stable'), [...builtins, api], 'next hidden, old ended');
  assert.deepEqual(offeredChannels(desktop, 'next').map((c) => c.id), ['stable', 'preview', 'next', 'api'], 'the current one even when hidden');
  assert.deepEqual(offeredChannels(desktop, 'next')[2], {
    id: 'next', builtin: false, usage: true,
    name: { de: 'Next', en: 'Next' },
    hint: { de: 'Vorschau auf die nächste große Version.', en: 'A preview of the next major version.' },
  });
  assert.deepEqual(offeredChannels(desktop, 'old').map((c) => c.id), ['stable', 'preview', 'api'], 'never an ended one');
  assert.deepEqual(offeredChannels(apk, 'preview').map((c) => c.id), ['stable', 'preview', 'api', 'apkonly']);
  assert.deepEqual(offeredChannels(apk, 'next').map((c) => c.id), ['stable', 'preview', 'api', 'apkonly'], 'not on this platform');
});
