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

// Ranked as lib/merchants.ts ranks them: score first, then verified first.
const vhit = (domain: string, name: string, score: number, verified: boolean) =>
  ({ hit: { domain, name, verified }, score });

test('a verified brand beats the copycat sites filed under its name', async () => {
  const { unambiguous } = await import('./merchant-match.ts');
  const kaufland = [
    vhit('kaufland.de', 'Kaufland', 0.85, true), vhit('kaufland.bg', 'Kaufland Bulgaria', 0.85, true),
    vhit('kaufland-kundenportal.com', 'Kaufland', 0.85, false), vhit('kaufland-einkaufen.com', 'Kaufland', 0.85, false),
  ];
  assert.equal(unambiguous(kaufland, 'kaufland muelheim')?.hit.domain, 'kaufland.de');
  const openai = [
    vhit('openai.com', 'OpenAI', 0.85, true),
    vhit('chat-gpt-israel.com', 'OpenAI', 0.85, false), vhit('chat-gpt-suomi.fi', 'OpenAI', 0.85, false),
  ];
  assert.equal(unambiguous(openai, 'openai chatgpt subscr')?.hit.domain, 'openai.com');
  const discord = [
    vhit('discord.com', 'Discord', 0.85, true), vhit('discordapp.com', 'Discord', 0.85, true),
    vhit('discordmerch.com', 'Discord', 0.85, false), vhit('dis.gd', 'Discord', 0.85, false),
  ];
  assert.equal(unambiguous(discord, 'discord nitromonthly')?.hit.domain, 'discord.com');
  // Two verified companies that only share a score are still a guess.
  assert.equal(unambiguous([vhit('alpha.com', 'Alpha', 0.85, true), vhit('beta.de', 'Beta', 0.85, true)], 'x y'), null);
});

test('a card descriptor borrows a logo on a prefix only from a verified brand', async () => {
  const { enoughEvidence } = await import('./merchant-match.ts');
  assert.ok(enoughEvidence(0.85, 0.85, true, true), 'Kaufland Muelheim → kaufland.de');
  assert.ok(!enoughEvidence(0.85, 0.85, true, false), 'Café Nova Deutzer F ↛ cafenova.ch');
  assert.ok(enoughEvidence(1, 0.85, true, false), 'an exact name needs no verification');
  assert.ok(enoughEvidence(0.85, 0.85, false, false), 'a transfer keeps the ordinary threshold');
  assert.ok(!enoughEvidence(0.85, 1, true, true), 'a short core still needs an exact hit');
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

test('candidates: a branch town at the end is also tried without it', async () => {
  const { candidates } = await import('./merchant-match.ts');
  const towns = new Set(['aschaffenburg', 'koblenz']);
  const cores = (name: string) => candidates(name, undefined, { towns }).map((r) => r.core);
  assert.deepEqual(cores('Dominos Aschaffenburg'), ['dominos aschaffenburg', 'dominos'], 'the whole name first');
  assert.deepEqual(cores('DOMINOS PIZZA KOBLENZ'), ['dominos pizza koblenz', 'dominos pizza']);
  // What is left must still be a name: a kind of business alone is not.
  assert.deepEqual(cores('Stadtwerke Koblenz'), ['stadtwerke koblenz']);
  // A town that is the whole name stays the name; without a town list nothing changes.
  assert.deepEqual(cores('Koblenz'), ['koblenz']);
  assert.deepEqual(candidates('Dominos Aschaffenburg').map((r) => r.core), ['dominos aschaffenburg']);
});

test('candidates: a card terminal\'s "SAGT DANKE" is no part of the name', async () => {
  const { candidates } = await import('./merchant-match.ts');
  const cores = (name: string) => candidates(name).map((r) => r.core);
  assert.deepEqual(cores('NORMA SAGT DANKE'), ['norma sagt danke', 'norma']);
  assert.deepEqual(cores('REWE SAGT DANKE'), ['rewe sagt danke', 'rewe'], 'the whole name, which REWE answers to, first');
});

test('candidates: the kind of payment is never searched as a shop', async () => {
  const { candidates } = await import('./merchant-match.ts');
  assert.deepEqual(candidates('Ratenzahlung'), []);
  // Behind PayPal with only "Ratenzahlung" as the shop, PayPal is what is left to search.
  const viaPaypal = candidates('PayPal Europe S.a.r.l. et Cie S.C.A', 'PP.4711.PP . Ratenzahlung, Ihr Einkauf bei Ratenzahlung');
  assert.ok(!viaPaypal.some((r) => r.core === 'ratenzahlung'), viaPaypal.map((r) => r.core).join(' | '));
});
