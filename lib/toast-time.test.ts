import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MIN_ACTION_MS, MIN_ERROR_ACTION_MS, MIN_MS, toastLifetime } from './toast-time.ts';

test('a short notice keeps the time the provider asked for', () => {
  assert.equal(toastLifetime({ tone: 'success', ms: 4200, message: 'CSV exportiert.', hasAction: false }), 4200);
  assert.equal(toastLifetime({ tone: 'info', ms: 8000, message: 'Gerät erkannt.', hasAction: false }), 8000);
});

test('the ten-minute notice after an idle logout is never shortened', () => {
  const ms = 10 * 60_000;
  assert.equal(toastLifetime({ tone: 'info', ms, message: 'Du wurdest aus Sicherheitsgründen abgemeldet.', hasAction: false }), ms);
});

test('an error stays at least ten seconds, longer when the bank wrote two sentences', () => {
  assert.equal(toastLifetime({ tone: 'error', ms: 9000, message: 'Fehler.', hasAction: false }), MIN_MS.error);
  const one = 'Abruf für „GiroKomfort“ fehlgeschlagen: Die Verbindung zur Bank wurde unterbrochen (Zeitüberschreitung).';
  assert.equal(toastLifetime({ tone: 'error', ms: 9000, message: one, hasAction: false }), MIN_MS.error);
  const two = 'Abruf für „GiroKomfort“ fehlgeschlagen: Der Auftrag wurde nicht ausgeführt. Die angeforderte Funktion steht '
    + 'für dieses Konto derzeit nicht zur Verfügung. Bitte wenden Sie sich an Ihre Filiale.';
  const t = toastLifetime({ tone: 'error', ms: 9000, message: two, hasAction: false });
  assert.ok(t > MIN_MS.error, `${t}`);
  assert.ok(t < 16_000, `${t}`);
});

test('a toast with an action lasts long enough to reach it; an error with one longer still', () => {
  assert.equal(toastLifetime({ tone: 'info', ms: 8000, message: '2 Mitteilungen deiner Bank', hasAction: true }), MIN_ACTION_MS);
  assert.equal(toastLifetime({ tone: 'error', ms: 9000, message: 'Update nicht abgeschlossen.', hasAction: true }), MIN_ERROR_ACTION_MS);
  assert.ok(MIN_ERROR_ACTION_MS > MIN_ACTION_MS && MIN_ACTION_MS > MIN_MS.error);
});

test('a nonsense duration falls back to the floor', () => {
  assert.equal(toastLifetime({ tone: 'info', ms: Number.NaN, message: 'Hi', hasAction: false }), MIN_MS.info);
});
