import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GUESSABLE } from './category-guess.ts';
import {
  EXAMPLE_MIN, NANO_CATEGORY_LIST, NANO_SYSTEM, exampleFor, nameSimilarity, nameWords, nanoBookingText, parseNanoAnswer,
} from './nano-categories.ts';

test('parseNanoAnswer: one id, NONE, and what is not an answer', () => {
  assert.equal(parseNanoAnswer('groceries'), 'groceries');
  assert.equal(parseNanoAnswer('  Health. '), 'health');
  assert.equal(parseNanoAnswer('Kategorie-ID: mobility'), 'mobility');
  assert.equal(parseNanoAnswer('NONE'), null);
  assert.equal(parseNanoAnswer('none – eine Privatperson'), null);
  assert.equal(parseNanoAnswer(''), null);
  assert.equal(parseNanoAnswer(null), null);
  assert.equal(parseNanoAnswer('Sonstiges'), null);
  // A word that only contains an id is not that id.
  assert.equal(parseNanoAnswer('rehousing'), null);
  // Two ids: the one named first.
  assert.equal(parseNanoAnswer('insurance, not health'), 'insurance');
});

test('the prompt names every guessable category and NONE', () => {
  for (const id of GUESSABLE) {
    assert.ok(NANO_SYSTEM.includes(id), `system names ${id}`);
    assert.ok(NANO_CATEGORY_LIST.includes(`- ${id}:`), `list explains ${id}`);
  }
  assert.ok(NANO_SYSTEM.includes('NONE'));
});

test('nanoBookingText: as the calibration sent it', () => {
  assert.equal(nanoBookingText('REWE Markt GmbH', ''), '\nEmpfänger: REWE Markt GmbH\nVerwendungszweck: –\nKategorie-ID:');
  assert.equal(nanoBookingText(' Stadtwerke Bonn ', ' Abschlag Strom '), '\nEmpfänger: Stadtwerke Bonn\nVerwendungszweck: Abschlag Strom\nKategorie-ID:');
  assert.equal(nanoBookingText('Jonas Weber', null), '\nEmpfänger: Jonas Weber\nVerwendungszweck: –\nKategorie-ID:');
});

test('nameWords: folded, without legal forms, numbers or single letters', () => {
  assert.deepEqual(nameWords('HORNBACH BAUMARKT AG FIL. 0815'), ['hornbach', 'baumarkt']);
  assert.deepEqual(nameWords('Getränke Wolf e.K.'), ['getraenke', 'wolf']);
  assert.deepEqual(nameWords('Amazon Payments Europe S.C.A.'), ['amazon', 'payments', 'europe']);
});

const examples = [
  { name: 'Hornbach Baumarkt AG', category: 'housing' as const },
  { name: 'Getränke Wolf', category: 'leisure' as const },
  { name: 'ADAC e.V.', category: 'insurance' as const },
  { name: 'Fahrschule Becker', category: 'mobility' as const },
  { name: 'Hetzner Online GmbH', category: 'media' as const },
];

test('exampleFor: another spelling of a shop the user filed takes its category', () => {
  assert.equal(exampleFor('HORNBACH BAUMARKT AG FIL. 0815', examples)?.category, 'housing');
  assert.equal(exampleFor('Hornbach Baumarkt Koblenz', examples)?.category, 'housing');
  assert.equal(exampleFor('GETRAENKE WOLF GMBH', examples)?.category, 'leisure');
  assert.equal(exampleFor('ADAC Mitgliedschaft', examples)?.category, 'insurance');
  assert.equal(exampleFor('Fahrschule Becker GbR', examples)?.category, 'mobility');
});

test('exampleFor: a name that only looks alike is not that shop', () => {
  // The look-alikes Nano copied when the examples were in its prompt.
  assert.equal(exampleFor('Getränke Hoffmann', examples), null);
  assert.equal(exampleFor('Anna Becker', examples), null);
  assert.equal(exampleFor('Wolf Parkhaus GmbH', examples), null);
  assert.equal(exampleFor('Becker Getränkemarkt', examples), null);
  assert.equal(exampleFor('Hornberger Fleischerei', examples), null);
  assert.equal(exampleFor('Bäckerei Hetzel', examples), null);
  assert.ok(nameSimilarity('GETRAENKE QUELLE', 'Getränke Wolf') < EXAMPLE_MIN);
  assert.equal(exampleFor('Hornbach', []), null);
});
