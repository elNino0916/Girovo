import { test } from 'node:test';
import assert from 'node:assert/strict';
import { intentOf } from './ask-intents.ts';

test('Verträge & Abos', () => {
  for (const q of ['welche abos habe ich', 'Welche Verträge habe ich?', 'Was für Abos zahle ich?', 'Which subscriptions do I have?', 'Zeig meine Fixkosten']) {
    assert.deepEqual(intentOf(q), { kind: 'contracts' }, q);
  }
});

test('changing the theme, privacy and language', () => {
  assert.deepEqual(intentOf('enable white mode'), { kind: 'set', setting: 'theme', value: 'light' });
  assert.deepEqual(intentOf('Mach den hellen Modus an'), { kind: 'set', setting: 'theme', value: 'light' });
  assert.deepEqual(intentOf('Dunkles Design bitte'), { kind: 'set', setting: 'theme', value: 'dark' });
  assert.deepEqual(intentOf('Darkmode an'), { kind: 'set', setting: 'theme', value: 'dark' });
  assert.deepEqual(intentOf('Design wie das System'), { kind: 'set', setting: 'theme', value: 'system' });
  assert.deepEqual(intentOf('Beträge ausblenden'), { kind: 'set', setting: 'privacy', value: true });
  assert.deepEqual(intentOf('Zeig die Beträge wieder an'), { kind: 'set', setting: 'privacy', value: false });
  assert.deepEqual(intentOf('Stell die Sprache auf Englisch'), { kind: 'set', setting: 'language', value: 'en' });
  assert.deepEqual(intentOf('switch to German'), { kind: 'set', setting: 'language', value: 'de' });
});

test('refreshing every account', () => {
  for (const q of ['refresh all accounts', 'Aktualisiere alle Konten', 'Alle Salden abrufen', 'Lade die Konten neu']) {
    assert.deepEqual(intentOf(q), { kind: 'refresh' }, q);
  }
});

test('reading settings', () => {
  assert.deepEqual(intentOf('Ist der dunkle Modus an?'), { kind: 'read', setting: 'theme' });
  assert.deepEqual(intentOf('Welche Sprache ist eingestellt?'), { kind: 'read', setting: 'language' });
  assert.deepEqual(intentOf('Sind die Beträge ausgeblendet?'), { kind: 'read', setting: 'privacy' });
  assert.deepEqual(intentOf('Wie lange bis zum Abmelden?'), { kind: 'read', setting: 'idle' });
  assert.deepEqual(intentOf('Welche Einstellungen habe ich?'), { kind: 'read', setting: 'all' });
});

test('questions about the bookings are none of these', () => {
  for (const q of ['Wie viel ging im Oktober an Rewe?', 'Was habe ich für Lebensmittel ausgegeben?', 'Und im September?', 'Wo war ich essen?', 'Hallo']) {
    assert.equal(intentOf(q), null, q);
  }
});
