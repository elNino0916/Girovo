// node --test: the desktop shell's bridge (src-tauri/src/bridge.js) hands the
// page's calls to the Tauri commands unchanged where the shell decides. Run in
// a sandbox with a fake Tauri that records what it is asked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../src-tauri/src/bridge.js', import.meta.url), 'utf8');

/** The window the bridge leaves behind, and the commands it sent. */
function load() {
  const calls = [];
  const noop = () => {};
  const element = { addEventListener: noop, removeEventListener: noop, setAttribute: noop, style: {}, classList: { add: noop, remove: noop, toggle: noop } };
  const window = {
    __GIROVO_BOOT__: {},
    __TAURI_INTERNALS__: {
      invoke: (cmd, args) => {
        calls.push([cmd, args]);
        return Promise.resolve(null);
      },
      transformCallback: () => 0,
    },
    addEventListener: noop,
    removeEventListener: noop,
    matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }),
    setTimeout,
    clearTimeout,
  };
  window.window = window;
  const document = { documentElement: element, addEventListener: noop, removeEventListener: noop, readyState: 'complete', querySelector: () => null, createElement: () => element, body: element };
  vm.runInNewContext(source, { window, document, navigator: { userAgent: 'test' }, console, Promise, Object, JSON, setTimeout, clearTimeout });
  return { window, calls };
}

test('a channel of girovo.de’s list reaches the updater as it is (Girovo Next fell back to Stabil)', async () => {
  const { window, calls } = load();
  for (const id of ['next', 'preview', 'stable']) await window.electronUpdater.setChannel(id);
  await window.electronUpdater.setChannel(42);
  const sent = calls.filter(([cmd]) => cmd === 'updater_set_channel').map(([, args]) => args.channel);
  assert.deepEqual(sent, ['next', 'preview', 'stable', 'stable']);
});

test('the Girovo API: a reply goes to api_reply as a result or an error, never both', async () => {
  const { window, calls } = load();
  const api = window.electronGirovoApi;
  await api.setEnabled('yes');
  await api.setEnabled(true);
  await api.reply('a', { result: { granted: ['accounts.read'] } });
  await api.reply('b', { result: { x: 1 }, error: { code: 'not_permitted', message: 'Nicht erlaubt', data: { permission: 'accounts.read' } } });
  await api.reply('c', {});
  await api.reply(7, { error: { message: 'kaputt' } });
  assert.deepEqual(calls.filter(([cmd]) => cmd === 'api_set_enabled').map(([, args]) => args.on), [false, true]);
  // Through JSON, as Tauri sends them (and the sandbox's objects have its own prototypes).
  assert.deepEqual(JSON.parse(JSON.stringify(calls.filter(([cmd]) => cmd === 'api_reply').map(([, args]) => args))), [
    { id: 'a', result: { granted: ['accounts.read'] } },
    { id: 'b', error: { code: 'not_permitted', message: 'Nicht erlaubt', data: { permission: 'accounts.read' } } },
    { id: 'c', result: null },
    { id: '7', error: { code: 'internal', message: 'kaputt' } },
  ]);
  assert.equal(await api.icon(null).then(() => calls.at(-1)[1].exe), '');
  assert.equal(typeof api.onCall(() => {}), 'function');
  assert.equal(typeof api.onClosed(() => {}), 'function');
});

test('the Girovo API: notify goes to api_notify with its three arguments, focus to api_focus_window', async () => {
  const { window, calls } = load();
  const api = window.electronGirovoApi;
  await api.notify('conn-1', 'girovo.event', { kind: 'booking' });
  await api.notify('conn-1', 'girovo.ping');
  await api.notify(7, 'girovo.event', [1]);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.filter(([cmd]) => cmd === 'api_notify').map(([, args]) => args))), [
    { connection: 'conn-1', method: 'girovo.event', params: { kind: 'booking' } },
    { connection: 'conn-1', method: 'girovo.ping', params: null },
    { connection: '7', method: 'girovo.event', params: [1] },
  ]);
  await api.focus();
  assert.deepEqual(calls.at(-1)[0], 'api_focus_window');
});

test('the Girovo API: notify and focus answer false when the shell throws', async () => {
  const { window } = load();
  // A shell from before these commands: Tauri rejects the unknown command.
  window.__TAURI_INTERNALS__.invoke = () => Promise.reject(new Error('no such command'));
  assert.equal(await window.electronGirovoApi.notify('c', 'girovo.event', {}), false);
  assert.equal(await window.electronGirovoApi.focus(), false);
});
