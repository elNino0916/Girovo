import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fuzzyScore } from './fuzzy.ts';
import {
  LAST_RESORT_MIN_QUERY, answersLastResort, isAmountQuery, paletteResults, scoreEntry, type PaletteEntry,
} from './palette.ts';

type E = PaletteEntry & { id: string };

// The palette's actions as CommandPalette.tsx lists them (the parts that rank).
const ACTIONS: E[] = [
  { id: 'transfer', label: 'Überweisen', featured: true, keywords: ['überweisung', 'geld senden', 'zahlen', 'bezahlen', 'echtzeit', 'sepa'] },
  { id: 'share', label: 'Geld anfordern', featured: true, keywords: ['girocode', 'qr', 'code', 'empfangen', 'kontodaten', 'iban teilen'] },
  { id: 'search', label: 'Umsätze durchsuchen', keywords: ['suche', 'filter', 'finden', 'buchungen'] },
  { id: 'statement', label: 'Kontoauszug als PDF', featured: true, keywords: ['pdf', 'drucken', 'auszug', 'beleg', 'dokument'] },
  { id: 'privacy', label: 'Beträge ausblenden', featured: true, keywords: ['privat', 'verbergen', 'verstecken', 'datenschutz', 'bildschirm teilen', 'beträge', 'einblenden'] },
  { id: 'inbox', label: 'Mitteilungen', featured: true, keywords: ['nachrichten', 'bank', 'vorgänge', 'hinweise', 'inbox'] },
  { id: 'tab-contracts', label: 'Verträge & Abos', keywords: ['abos', 'abonnements', 'fixkosten', 'wiederkehrend', 'daueraufträge', 'verträge'] },
  { id: 'logout', label: 'Abmelden', featured: true, lastResort: true, keywords: ['logout', 'ausloggen', 'abmeldung', 'sitzung beenden'] },
];

const ACCOUNTS: E[] = [
  { id: 'giro', label: 'GiroKomfort', keywords: ['Girokonto'], ids: ['DE62 3706 0193 0105 5932 71', '0105593271'] },
  { id: 'tg', label: 'Notgroschen', keywords: ['Tagesgeld'], ids: ['DE13 3706 0193 0105 5932 80', '0105593280'] },
];

const ids = (list: E[]) => list.map((e) => e.id);
const results = (q: string) => paletteResults(ACTIONS, ACCOUNTS, q);

test('before anything is typed: the featured actions, every account, and Abmelden on its own at the end', () => {
  const r = results('');
  assert.deepEqual(ids(r.actions), ['transfer', 'share', 'statement', 'privacy', 'inbox']);
  assert.deepEqual(ids(r.accounts), ['giro', 'tg']);
  assert.deepEqual(ids(r.last), ['logout']);
});

test('one or two letters never reach Abmelden — "ab", "lo", "me", "si", "l" used to preselect it', () => {
  for (const q of ['a', 'ab', 'l', 'lo', 'me', 'si', 'Ab', ' ab ']) {
    const r = results(q);
    assert.deepEqual(ids(r.last), [], q);
    assert.ok(!ids(r.actions).includes('logout'), q);
  }
  // "ab" still finds what someone looking for Abos means.
  assert.deepEqual(ids(results('ab').actions), ['tab-contracts']);
});

test('from three letters on, Abmelden answers — after every other action and account', () => {
  assert.equal(LAST_RESORT_MIN_QUERY, 3);
  for (const q of ['abm', 'abmelden', 'logout', 'ausloggen', 'Abmeldung']) {
    const r = results(q);
    assert.deepEqual(ids(r.last), ['logout'], q);
    assert.ok(!ids(r.actions).includes('logout'), q);
  }
  // "abo": Verträge & Abos, never Abmelden.
  assert.deepEqual(ids(results('abo').actions), ['tab-contracts']);
  assert.deepEqual(ids(results('abo').last), []);
  // A word of its keywords finds it too, still last.
  assert.deepEqual(ids(results('sitzung').last), ['logout']);
});

test('Abmelden never answers a fuzzy hit: inside its name, or the mere start of a keyword', () => {
  // Each of these left Abmelden alone and preselected when nothing else
  // matched ("logo" for the Firmenlogos switch, "med" for a shop outside the
  // loaded range), so one Enter logged out.
  for (const q of ['med', 'den', 'mel', 'meld', 'ende', 'logo', 'logou', 'aus', 'ausl', 'sitz', 'beend']) {
    assert.deepEqual(ids(results(q).last), [], q);
    assert.ok(!answersLastResort(ACTIONS[ACTIONS.length - 1], q), q);
  }
  // The start of its own name, or a word of it typed out, still does.
  for (const q of ['abm', 'ABME', 'abmelden', 'logout', 'ausloggen', 'abmeldung', 'sitzung', 'sitzung beenden']) {
    assert.deepEqual(ids(results(q).last), ['logout'], q);
  }
});

test('ordinary ranking is unchanged: a prefix outranks a keyword, umlauts fold either way', () => {
  assert.deepEqual(ids(results('über').actions).slice(0, 1), ['transfer']);
  assert.deepEqual(ids(results('uber').actions).slice(0, 1), ['transfer']);
  assert.deepEqual(ids(results('pdf').actions), ['statement']);
  assert.deepEqual(ids(results('kap').actions), ['statement']);
});

test('accounts by name or by four or more characters of their IBAN, spaces or not', () => {
  assert.deepEqual(ids(results('notg').accounts), ['tg']);
  assert.deepEqual(ids(results('5932 80').accounts), ['tg']);
  assert.deepEqual(ids(results('593271').accounts), ['giro']);
  assert.deepEqual(ids(results('593').accounts), []);
});

test('an amount is for the bookings alone', () => {
  assert.ok(isAmountQuery('12,99'));
  assert.ok(isAmountQuery('-49,90 €'));
  assert.ok(isAmountQuery('>100'));
  assert.ok(!isAmountQuery('rewe 12'));
  const r = results('12,99');
  assert.deepEqual([...r.actions, ...r.accounts, ...r.last], []);
  assert.equal(scoreEntry(ACCOUNTS[0], '3706'), 70);
});

test('fuzzyScore: prefix 100, word start 85, initials 75, inside 60, keyword at 0.8', () => {
  assert.equal(fuzzyScore('Abmelden', 'ab'), 100);
  assert.equal(fuzzyScore('Verträge & Abos', 'abo'), 85);
  assert.equal(fuzzyScore('Kontoauszug als PDF', 'kap'), 75);
  assert.equal(fuzzyScore('Abmelden', 'mel'), 60);
  assert.equal(fuzzyScore('Abmelden', 'log', ['logout']), 80);
  assert.equal(fuzzyScore('Abmelden', 'xyz'), 0);
});
