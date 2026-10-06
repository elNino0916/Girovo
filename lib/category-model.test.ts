import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_THRESHOLDS, GUESSABLE, bookingText, guessCategories, modelAvailable, modelThresholds, pickCategory, readable, releaseModel,
  type CategoryScores,
} from './category-model.ts';

const scores = (top: Partial<CategoryScores>, rest = 0.7): CategoryScores =>
  ({ ...Object.fromEntries([...GUESSABLE, 'private'].map((c) => [c, rest])), ...top }) as CategoryScores;

test('pickCategory: a clear winner is the guess', () => {
  assert.equal(pickCategory(scores({ groceries: 0.86, leisure: 0.84 }), null), 'groceries');
});

test('pickCategory: too far from every category, or too close a race, is no guess', () => {
  assert.equal(pickCategory(scores({ groceries: DEFAULT_THRESHOLDS.minScore - 0.01 }), null), null);
  assert.equal(pickCategory(scores({ groceries: 0.86, leisure: 0.86 - DEFAULT_THRESHOLDS.minMargin / 2 }), null), null);
});

test('pickCategory: closest to money between people means no category', () => {
  assert.equal(pickCategory(scores({ shopping: 0.85, private: 0.87 }), null), null);
  // …and a category only just ahead of it is still too close a race.
  assert.equal(pickCategory(scores({ shopping: 0.85, private: 0.845 }), null), null);
});

test('pickCategory: a near-identical counterparty the user filed decides', () => {
  assert.equal(pickCategory(scores({ leisure: 0.9 }), { category: 'groceries', score: 0.95 }), 'groceries');
  // A merely similar one does not.
  assert.equal(pickCategory(scores({ leisure: 0.9 }), { category: 'groceries', score: 0.9 }), 'leisure');
});

test('bookingText: the name, and the purpose when there is one', () => {
  assert.equal(bookingText('Hausverwaltung Kraemer', '  Miete   Oktober '), 'query: Hausverwaltung Krämer – Miete Oktober');
  assert.equal(bookingText('Bäckerei Hoefer', ''), 'query: Bäckerei Hoefer');
  assert.equal(bookingText('X', 'y'.repeat(300)).length, 'query: X – '.length + 140);
});

// The real model, where scripts/fetch-model.mjs has put it.
test('guessCategories: real bookings, a private transfer, a user example', { skip: !modelAvailable() && 'model not fetched' }, async () => {
  const got = await guessCategories([
    { key: 'a', name: 'Physiotherapie am Park' },
    { key: 'b', name: 'Hausverwaltung Kraemer', purpose: 'Miete Oktober' },
    { key: 'c', name: 'Erika Musterfrau', purpose: 'Danke!' },
    { key: 'd', name: 'Pizzeria Da Mario Filiale 2' },
  ], [{ name: 'Pizzeria Da Mario', category: 'groceries' }]);
  assert.deepEqual(got, { a: 'health', b: 'housing', c: null, d: 'groceries' });
  await releaseModel();
});

test('readable: what statements write, as the model can read it', () => {
  // Capitals and written-out umlauts: one shop, one text, however it was booked.
  assert.equal(readable('SCHAEFER DEIN BAECKER GMBH'), 'Schäfer Dein Bäcker Gmbh');
  assert.equal(readable('Schaefer Dein Baecker 0415'), 'Schäfer Dein Bäcker');
  assert.equal(readable('GETRAENKE QUELLE'), 'Getränke Quelle');
  assert.equal(readable('Loewen-Apotheke Koeln'), 'Löwen-Apotheke Köln');
  // Numbers say nothing about what was paid for; a single digit can be a name.
  assert.equal(readable('R0024173385 Rechnung Kundennummer K0815'), 'Rechnung Kundennummer');
  assert.equal(readable('O2 Germany'), 'O2 Germany');
  // Short acronyms stay; words that only look like a transliteration are left alone.
  assert.equal(readable('DB VERTRIEB GMBH'), 'DB Vertrieb Gmbh');
  assert.equal(readable('Michael Steuer'), 'Michael Steuer');
  assert.equal(readable('Feuerwehr Israel Aero'), 'Feuerwehr Israel Aero');
});

test('modelThresholds: the calibration beside the model, and only numbers that can be one', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'girovo-model-'));
  const was = process.env.GIROVO_MODEL_DIR;
  process.env.GIROVO_MODEL_DIR = dir;
  try {
    assert.deepEqual(modelThresholds(), DEFAULT_THRESHOLDS, 'no model.json');
    fs.writeFileSync(path.join(dir, 'model.json'), JSON.stringify({ model: 'x', thresholds: { minScore: 0.83, minMargin: 0.002, exampleScore: 0.94 } }));
    assert.deepEqual(modelThresholds(), { minScore: 0.83, minMargin: 0.002, exampleScore: 0.94 });
    fs.writeFileSync(path.join(dir, 'model.json'), JSON.stringify({ thresholds: { minScore: '0.5', minMargin: -1, exampleScore: 0.95 } }));
    assert.deepEqual(modelThresholds(), { ...DEFAULT_THRESHOLDS, exampleScore: 0.95 }, 'the bad ones keep their default');
    fs.writeFileSync(path.join(dir, 'model.json'), '{ not json');
    assert.deepEqual(modelThresholds(), DEFAULT_THRESHOLDS, 'a damaged file');
  } finally {
    if (was === undefined) delete process.env.GIROVO_MODEL_DIR;
    else process.env.GIROVO_MODEL_DIR = was;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
