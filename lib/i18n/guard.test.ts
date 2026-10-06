// Holds the line lib/i18n/README.md draws: every text on screen lives in
// lib/i18n/messages, in German and English, and English says it in English.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanKnown, scanSource } from './scan.ts';
import { SCANNED_FILES } from './scope.ts';
import { MESSAGES } from './messages/index.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Stands in for any argument a message function takes: a name, a count, a
 * render callback. As text it reads "X"; called, it hands back what it got.
 */
const ANY = Object.assign((s: unknown) => s, { toString: () => 'X', valueOf: () => 2 });

/** Every text a message tree can produce, with the key it came from. */
function texts(node: unknown, at: string, out: [string, string][]): [string, string][] {
  if (typeof node === 'string') out.push([at, node]);
  else if (Array.isArray(node)) node.forEach((n, i) => texts(n, `${at}[${i}]`, out));
  else if (typeof node === 'function') {
    try {
      texts((node as (...a: unknown[]) => unknown)(ANY, ANY, ANY, ANY), `${at}()`, out);
    } catch {
      /* a function that needs real arguments: read in review, not here */
    }
  } else if (node && typeof node === 'object' && !('$$typeof' in node)) {
    for (const [k, v] of Object.entries(node)) texts(v, at ? `${at}.${k}` : k, out);
  }
  return out;
}

/**
 * The German texts that differ from their English ones: a literal equal to
 * one of them was left behind. Only what reads as a word or a phrase on
 * screen — capitalised, in mixed case, five letters or more — so an id that
 * happens to spell a German word ("start", "echtzeit", "BLZ") is no match.
 */
function knownGerman(): Set<string> {
  const de = new Map(texts(MESSAGES.de, '', []));
  const en = new Map(texts(MESSAGES.en, '', []));
  const out = new Set<string>();
  for (const [key, raw] of de) {
    const text = raw.replace(/\s+/g, ' ').trim();
    if (en.get(key) === raw || text.includes('X')) continue;
    if (text.length >= 5 && /^\p{Lu}/u.test(text) && /\p{Ll}/u.test(text)) out.add(text);
  }
  return out;
}

test('every interface text lives in lib/i18n/messages', () => {
  const known = knownGerman();
  const found: string[] = [];
  for (const file of SCANNED_FILES(ROOT)) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const lines = new Set<number>();
    for (const f of [...scanSource(src), ...scanKnown(src, known)]) {
      if (lines.has(f.line)) continue;
      lines.add(f.line);
      found.push(`${file}:${f.line}  ${f.text}`);
    }
  }
  assert.deepEqual(found, [], `Move these into lib/i18n/messages, or mark them as bank data (lib/i18n/scan.ts):\n${found.join('\n')}`);
});

/** German that has no business in an English sentence. */
const GERMAN_WORD = /[äöüÄÖÜß]|\b(?:der|und|nicht|ist|eine?|mit|für|auf|oder|bitte|Bitte|wird|werden|wurde|du|dein|deine|dich|dir|Sie|Ihre?|kein|keine|noch|schon)\b/;

/**
 * German words English keeps on purpose — the names of things as the user's
 * bank or its app calls them. Each one is a whole word.
 */
const KEPT = /\b(?:Namensabgleich|Zugangsnummer|Teilnehmernummer|Verwendungszweck|Girokonto|Tagesgeld|Gläubiger-ID|Sparkasse|Volksbank|Raiffeisenbank|Postbank|Commerzbank|GiroCode|S-pushTAN|pushTAN|SecureGo|chipTAN|Brandfetch|Primanota|Deutsch)\b/g;

/** How a transfer writes German letters out — "ä → ae" — said in English too. */
const TRANSLITERATION = /[äöüÄÖÜß] → \w+/g;

test('English says it in English', () => {
  const german = texts(MESSAGES.en, '', [])
    .filter(([, s]) => GERMAN_WORD.test(s.replace(KEPT, '').replace(TRANSLITERATION, '')));
  assert.deepEqual(german.map(([k, s]) => `${k}: ${s}`), []);
});

test('German and English carry the same keys', () => {
  const keys = (node: unknown, at = ''): string[] =>
    node && typeof node === 'object' && !Array.isArray(node)
      ? Object.entries(node).flatMap(([k, v]) => keys(v, at ? `${at}.${k}` : k))
      : [at];
  assert.deepEqual(keys(MESSAGES.en), keys(MESSAGES.de));
});
