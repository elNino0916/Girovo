import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SettingsTarget } from './app-types.ts';
import { de, en } from './i18n/messages/settings.ts';
import { PAGE_CLUSTERS, PAGE_OF, PAGE_ORDER, hasUpdateRows, isSettingsPage, pageFrom } from './settings-pages.ts';

// Every setting the search can open (lib/app-types.ts SettingsTarget), spelled
// out: a new target without a page fails to compile in PAGE_OF, one missing here fails below.
const TARGETS: readonly SettingsTarget[] = [
  'language', 'theme', 'black', 'idle', 'categories', 'logos', 'usage', 'device', 'data', 'keep', 'backup', 'updates',
  'channel', 'early', 'fromFile', 'loginBalances', 'loginBookings', 'keepBalances', 'alerts', 'ask', 'publisher',
];

test('every setting the search opens lives on a page that exists', () => {
  assert.deepEqual(Object.keys(PAGE_OF).sort(), [...TARGETS].sort());
  for (const target of TARGETS) assert.ok(PAGE_ORDER.includes(PAGE_OF[target]), `${target} → ${PAGE_OF[target]}`);
});

test('the pages come in four clusters, each page once', () => {
  assert.deepEqual(PAGE_CLUSTERS.map((c) => [...c]), [
    ['ask', 'api'],
    ['security', 'notifications'],
    ['accounts', 'devices'],
    ['appearance', 'updates', 'about'],
  ]);
  assert.equal(new Set(PAGE_ORDER).size, PAGE_ORDER.length);
});

test('every page has a name and a short name in both languages', () => {
  for (const page of PAGE_ORDER) {
    for (const words of [de, en]) {
      assert.ok(words.pages[page], `${page}: name`);
      assert.ok(words.pagesShort[page], `${page}: short name`);
    }
  }
});

test('the old Datenschutz page is gone: its switches and its id lead to Sicherheit & Datenschutz', () => {
  assert.equal(PAGE_OF.logos, 'security');
  assert.equal(PAGE_OF.usage, 'security');
  assert.equal(isSettingsPage('privacy'), false);
  assert.equal(pageFrom('privacy'), 'security');
});

test('a page is read from a link as it is, anything else as none', () => {
  assert.equal(pageFrom('updates'), 'updates');
  assert.equal(pageFrom('api'), 'api');
  assert.equal(pageFrom('toString'), null);
  assert.equal(pageFrom('nope'), null);
  assert.equal(pageFrom(undefined), null);
});

test('the update rows live on Updates, the check stays in Über Girovo', () => {
  assert.equal(PAGE_OF.channel, 'updates');
  assert.equal(PAGE_OF.early, 'updates');
  assert.equal(PAGE_OF.fromFile, 'updates');
  assert.equal(PAGE_OF.updates, 'about');
});

test('Updates shows only with the updater or Google Play\'s newer version', () => {
  assert.equal(hasUpdateRows({ updater: true, playUpdate: false }), true);
  assert.equal(hasUpdateRows({ updater: false, playUpdate: true }), true);
  // F-Droid, the Play build with nothing new, the web demo without a shell.
  assert.equal(hasUpdateRows({ updater: false, playUpdate: false }), false);
});
