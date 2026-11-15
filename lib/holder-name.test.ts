import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstName, holderName, nameInitials, sessionHolder } from './holder-name.ts';

test('holderName tidies the bank\'s spelling', () => {
  assert.equal(holderName('NINO BORNEMANN'), 'Nino Bornemann');
  assert.equal(holderName('BORNEMANN, NINO'), 'Nino Bornemann');
  assert.equal(holderName('  Max   Mustermann '), 'Max Mustermann');
});

test('a joint account cut at 27 characters keeps its first person (issue #22: "NU" initials)', () => {
  // holder1 cut mid-way, holder2 the rest, joined with a comma by lib/serialize.ts
  assert.equal(holderName('Mustermann Max Mustermann und'), 'Mustermann Max Mustermann');
  assert.equal(holderName('Mustermann Max Mustermann und, Erika'), 'Mustermann Max Mustermann');
  assert.equal(holderName('Max Mustermann oder Erika Mus'), 'Max Mustermann');
  assert.equal(holderName('MUSTERMANN, MAX U. ERIKA'), 'Max Mustermann');
  assert.equal(nameInitials('Mustermann Max Mustermann und'), 'MM');
  assert.equal(nameInitials('Max Mustermann und, Erika Mustermann'), 'MM');
});

test('a joint name whose first part is no name alone stays whole', () => {
  assert.equal(holderName('Max und Erika Mustermann'), 'Max und Erika Mustermann');
  assert.equal(nameInitials('Max und Erika Mustermann'), 'MM');
  assert.equal(firstName('Max und Erika Mustermann'), 'Max');
  assert.equal(holderName('Max und'), 'Max');
});

test('titles and "Eheleute" are no name of their own', () => {
  assert.equal(holderName('Herr Max und Frau Erika Mustermann'), 'Herr Max und Frau Erika Mustermann');
  assert.equal(nameInitials('Herr Max und Frau Erika Mustermann'), 'MM');
  assert.equal(holderName('Dr. Max und Erika Mustermann'), 'Dr. Max und Erika Mustermann');
  assert.equal(holderName('Eheleute Max und Erika Mustermann'), 'Eheleute Max und Erika Mustermann');
  assert.equal(firstName('Eheleute Max und Erika Mustermann'), 'Max');
  assert.equal(holderName('Herr Max Mustermann und Frau Erika'), 'Herr Max Mustermann');
});

test('a company is never cut and never greeted', () => {
  assert.equal(holderName('Meier Schulze & Co. KG'), 'Meier Schulze & Co. KG');
  assert.equal(firstName('Meier Schulze & Co. KG'), '');
  assert.equal(firstName('Schmidt Müller und Partner GbR'), '');
  assert.equal(sessionHolder([{ holder: 'Meier Schulze & Co. KG' }, { holder: 'Erika Mustermann' }]), 'Erika Mustermann');
});

test('initials and greeting otherwise as before', () => {
  assert.equal(nameInitials('Herr Dr. Max Mustermann'), 'MM');
  assert.equal(nameInitials('Cher'), 'CH');
  assert.equal(firstName('Mustermann GmbH'), '');
  assert.equal(sessionHolder([{ holder: 'Mustermann GmbH' }, { holder: 'Erika Mustermann' }]), 'Erika Mustermann');
});
