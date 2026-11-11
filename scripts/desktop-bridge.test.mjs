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
