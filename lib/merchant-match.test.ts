import { test } from 'node:test';
import assert from 'node:assert/strict';
import { knownInstitution, nameScore } from './merchant-match.ts';

test('the Sparkassen card processor is Helaba, however the bank spells it', () => {
  for (const n of [
    'Landesbank Hessen-Thüringen', 'LANDESBANK HESSEN-THUERINGEN', 'Landesbank Hessen-ThA.ringen',
    'Landesbank Hessen-Thüringen Girozentrale', 'HELABA',
  ]) {
    assert.deepEqual(knownInstitution(n), { domain: 'helaba.com', label: 'Helaba' }, n);
  }
  assert.equal(knownInstitution('Landesbank Baden-Württemberg'), null);
  assert.equal(knownInstitution('REWE Markt GmbH'), null);
});

test('a bare place name is never partial evidence for a brand', () => {
  // The hit that put the Hessian state crest on card payments.
  assert.equal(nameScore('hessen tha ringen hessen tha', 'hessen'), 0);
  assert.equal(nameScore('hessen thueringen', 'Staatskanzlei Hessen'), 0);
  assert.equal(nameScore('hessen', 'hessen'), 1, 'an exact match still counts');
  // Ordinary prefix matches keep working.
  assert.equal(nameScore('amazon prime', 'amazon'), 0.85);
});

// Hit lists as Brandfetch returned them on 2026-10-04 (scored as lib/merchants.ts does).
const hit = (domain: string, score: number) => ({ hit: { domain }, score });

test('a name several unrelated companies share gets no logo', async () => {
  const { unambiguous } = await import('./merchant-match.ts');
  // "The Ridge": a wallet maker, a golf course, a South African venue, a UK pub.
  const ridge = [
    hit('theridge.co.za', 1), hit('theridgealabama.com', 1), hit('ridgewv.com', 1), hit('the-ridge.org.uk', 1),
  ];
  assert.equal(unambiguous(ridge, 'the ridge'), null);
  // Steam answers to three domains of its own — still not provable from a search.
  assert.equal(unambiguous([hit('steampowered.com', 0.85), hit('steamgames.com', 0.85), hit('steamchina.com', 0.85)], 'steam purchase'), null);
});

test('one brand on several domains is fine when exactly one domain is the name', async () => {
  const { unambiguous } = await import('./merchant-match.ts');
  const ikea = [hit('ikea.com', 1), hit('seeacareerwithus.com', 1), hit('ikeamuseum.com', 0.85)];
  assert.equal(unambiguous(ikea, 'ikea')?.hit.domain, 'ikea.com');
  assert.equal(unambiguous([hit('dhl.com', 1), hit('dhlexpress.fr', 0.85)], 'dhl')?.hit.domain, 'dhl.com');
  assert.equal(unambiguous([], 'x'), null);
});

test('a lookup is never cut down to an article', async () => {
  const { candidates } = await import('./merchant-match.ts');
  const cores = candidates('The Ridge EU').map((c) => c.core);
  assert.ok(!cores.includes('the'), cores.join(' | '));
});

test('namesakes are told apart by the full name, never by the first word', async () => {
  const { knownInstitution } = await import('./merchant-match.ts');
  assert.deepEqual(knownInstitution('Netto Marken-Discou'), { domain: 'netto-online.de', label: 'Netto Marken-Discount' });
  assert.deepEqual(knownInstitution('NETTO MARKEN-DISCOUNT'), { domain: 'netto-online.de', label: 'Netto Marken-Discount' });
  assert.deepEqual(knownInstitution('Netto ApS & Co. KG'), { domain: 'netto.dk', label: 'Netto' });
  assert.equal(knownInstitution('Netto'), null, 'which Netto? — no logo rather than a guess');
  assert.deepEqual(knownInstitution('The Ridge EU'), { domain: 'ridge.com', label: 'Ridge' });
  assert.equal(knownInstitution('The Ridge'), null);
});
