import './__fixtures__/tz.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SerializedTransaction } from './fints-types';
import { cardBills, readsLikeCardBill, withoutCardBills } from './card-bills.ts';
import { cardStatements } from './fints-cards.ts';
import { IBAN, camt } from './__fixtures__/transactions.ts';

const GIRO = { accountNumber: '1001', accountType: 'CheckingAccount' };
const CARD = { accountNumber: '4001', accountType: 'CreditCardAccount' };

/** The bookings paired, as the test names them. */
const paired = (giro: SerializedTransaction[], card: SerializedTransaction[], more: Record<string, SerializedTransaction[]> = {}, accounts: { accountNumber: string; accountType: string }[] = [GIRO, CARD]) =>
  cardBills(accounts, { '1001': giro, '4001': card, ...more });

/** The bill on the current account, and its credit on the card as the reviewer's bank wrote it. */
const bill = (day: string, amount = -612.4, text = 'KREDITKARTENABRECHNUNG') => camt({ day, amount, text, ref: `B${day}${amount}` });
const settle = (day: string, amount = 612.4, text = 'AUSGLEICH KREDITKARTE') => camt({ day, amount, text, ref: `S${day}${amount}` });

test('the bill and its credit on the card pair, and nothing else does', () => {
  const b = bill('2026-10-28');
  const s = settle('2026-10-29');
  assert.deepEqual([...paired([b], [s])], [b, s]);
  // Six days apart (a statement date against the debit date): both worded, so up to ten days.
  assert.equal(paired([bill('2026-11-03')], [settle('2026-10-28')]).size, 2);
  assert.equal(paired([bill('2026-11-07')], [settle('2026-10-28')]).size, 2);
  assert.equal(paired([bill('2026-11-08')], [settle('2026-10-28')]).size, 0, 'eleven days');
  // A credit that says nothing at all (no name, no wording): five days.
  const quiet = (day: string) => camt({ day, amount: 612.4, text: 'Gutschrift', ref: `Q${day}` });
  assert.equal(paired([b], [quiet('2026-11-02')]).size, 2);
  assert.equal(paired([b], [quiet('2026-11-03')]).size, 0);
  // The short forms banks print: "KK-Abrechnung 10/26" against a nameless "Lastschrifteinzug".
  assert.equal(paired([camt({ day: '2026-10-28', amount: -612.4, text: 'Lastschrift', purpose: 'KK-Abrechnung 10/26' })], [camt({ day: '2026-10-28', amount: 612.4, text: 'Lastschrifteinzug' })]).size, 2);
  // To the cent, in the same currency, debit on the current account and credit on the card.
  assert.equal(paired([b], [settle('2026-10-28', 612.41)]).size, 0);
  assert.equal(paired([b], [{ ...settle('2026-10-28', 655.1), currency: 'USD' }]).size, 0);
  assert.equal(paired([{ ...b, currency: 'USD' }], [settle('2026-10-28')]).size, 0);
  assert.equal(paired([settle('2026-10-28')], [bill('2026-10-28')]).size, 0);
  // Only between a card account and another account.
  assert.equal(paired([b], [s], {}, [GIRO, { accountNumber: '4001', accountType: 'CheckingAccount' }]).size, 0);
  assert.equal(paired([b], [s], {}, [{ accountNumber: '1001', accountType: '1' }, { accountNumber: '4001', accountType: '50' }]).size, 2);
});

test('the reviewer’s false pairs: none of them pairs', () => {
  const cases: [string, SerializedTransaction[], SerializedTransaction[], Record<string, SerializedTransaction[]>?, { accountNumber: string; accountType: string }[]?][] = [
    ['a craftsman paid "Ausgleich Rechnung 4711", a Zalando refund on the card',
      [camt({ day: '2026-10-12', amount: -180, text: 'Überweisung', purpose: 'Ausgleich Rechnung 4711', name: 'Malermeister Schmidt', iban: IBAN.employer })],
      [camt({ day: '2026-10-14', amount: 180, code: 'CCRD', text: 'Gutschrift', name: 'ZALANDO SE' })]],
    ['a Nebenkostenabrechnung "Ausgleichszahlung", a Booking.com refund',
      [camt({ day: '2026-10-12', amount: -250, code: 'ESDD', text: 'SEPA-Basislastschrift', purpose: 'Nebenkostenabrechnung 2025 Ausgleichszahlung', name: 'Hausverwaltung Meier', mref: 'M1' })],
      [camt({ day: '2026-10-15', amount: 250, code: 'CCRD', text: 'Gutschrift', name: 'BOOKING.COM' })]],
    ['a friend paid "Ausgleich Pizza", cashback on the card',
      [camt({ day: '2026-10-20', amount: -20, text: 'Überweisung', purpose: 'Ausgleich Pizza', name: 'Lena', iban: IBAN.employer })],
      [camt({ day: '2026-10-21', amount: 20, code: 'CCRD', text: 'Gutschrift Cashback', name: 'PAYBACK' })]],
    ['another bank’s card bill (Amex, not loaded), an Amazon refund on the loaded card',
      [camt({ day: '2026-10-20', amount: -99, code: 'ESDD', text: 'SEPA-Basislastschrift', purpose: 'Kreditkartenabrechnung 10/2026', name: 'American Express Europe', mref: 'AX' })],
      [camt({ day: '2026-10-22', amount: 99, code: 'CCRD', text: 'Gutschrift', name: 'AMAZON EU' })]],
    ['a card refund the bank calls "GUTSCHRIFT KREDITKARTE", a Zalando debit',
      [camt({ day: '2026-10-12', amount: -49.99, code: 'ESDD', text: 'SEPA-Basislastschrift', name: 'Zalando SE', mref: 'Z-1' })],
      [camt({ day: '2026-10-14', amount: 49.99, text: 'GUTSCHRIFT KREDITKARTE', name: 'HOTEL ADLON' })]],
    ['"AUSGLEICH KREDITKARTE" paid from an account not loaded, a garage standing order',
      [camt({ day: '2026-10-27', amount: -500, text: 'Dauerauftrag', purpose: 'Miete Garage + Stellplatz', name: 'Vermieter', iban: IBAN.employer })],
      [settle('2026-10-28', 500)]],
    ['a Tagesgeld transfer to a travel agency, the card’s settlement',
      [], [settle('2026-10-28', 300)],
      { '2001': [camt({ day: '2026-10-27', amount: -300, text: 'Überweisung', purpose: 'Urlaubskasse', name: 'Reisebuero Sonne', iban: IBAN.employer })] },
      [GIRO, CARD, { accountNumber: '2001', accountType: 'SavingsAccount' }]],
    ['cash from a machine, a deposit refund on the card',
      [camt({ day: '2026-10-28', amount: -50, code: 'ATMW', text: 'Bargeldauszahlung', purpose: 'Kreditkartenabrechnung' })],
      [camt({ day: '2026-10-28', amount: 50, text: 'Gutschrift' })]],
  ];
  for (const [name, giro, card, more, accounts] of cases) assert.equal(paired(giro, card, more, accounts).size, 0, name);
});

test('only a strong card-bill wording on the debit makes it one', () => {
  const yes = [
    'KREDITKARTENABRECHNUNG', 'Kreditkartenabrechnung 10/2026', 'Kreditkarten-Abrechnung', 'Kartenabrechnung', 'Kartenabr. 10/26', 'KK-Abrechnung',
    'KK Abr 10/26', 'KKABR', 'Kreditkartenausgleich', 'VISA Abrechnung', 'Visa Card Abr. 10/26', 'Mastercard 5232XXXXXXXX1234 Abrechnung 2026-10',
    'MasterCard-Abrechnung', 'Master Card Abrechnung', 'Amex Abrechnung', 'Abrechnung Ihrer Mastercard', 'Abrechnung Kreditkarte',
    'Ausgleich Kreditkarte', 'AUSGLEICH VISA 4000', 'Ausgleich Karte 1234', 'Umsatzabrechnung Kreditkarte', 'Card Settlement',
    'Credit card settlement 10/26',
  ];
  const no = [
    // Ausgleich alone, and the words that hold it.
    'Ausgleich', 'Ausgleich Rechnung 123', 'Ausgleichszahlung', 'Kontoausgleich', 'Rechnungsausgleich', 'Saldoausgleich', 'Schadensausgleich Versicherung',
    'Lohnsteuerjahresausgleich', 'Finanzausgleich', 'Ausgleichsbetrag Stadtwerke',
    // A card named, but no bill.
    'Kreditkartenzahlung REWE', 'Zahlung per Kreditkarte', 'Gutschrift Kreditkarte', 'Erstattung auf Kreditkarte', 'Entgelt Kreditkarte Gold',
    'Kreditkartenentgelt', 'Jahrespreis Kreditkarte', 'DKB VISACARD 4998XXXXXXXX1234', 'VISA 4000 12XX XXXX 1234', 'Lastschrift Kartenkonto',
    'Belastung Kartenumsaetze', 'Sammelabrechnung Karte', 'Umsatzabrechnung',
    // Another word with "Abrechnung" or a card in it.
    'VISA Deutschland Abrechnungskonto', 'Mastercard Gutschrift Jahresabrechnung Strom', 'Nebenkostenabrechnung Visastr. 3', 'Abrechnung Barclays',
    'Monatsabrechnung', 'Einzug Fahrkarte', 'Einzug Monatskarte BVG', 'Einzug Tankkarte Shell',
    // Girovo's own label for a card booking read over DKKKU, in both languages.
    'Kreditkartenumsatz', 'Credit card transaction', 'Kreditkartenumsätze',
  ];
  const reads = (text: string) => readsLikeCardBill({ bookingText: text, purpose: '', remoteName: '' });
  assert.deepEqual(yes.filter((t) => !reads(t)), []);
  assert.deepEqual(no.filter(reads), []);
  // As the purpose or the payee name, too.
  assert.equal(readsLikeCardBill({ bookingText: 'Lastschrift', purpose: 'Kreditkartenabrechnung 10/2026', remoteName: '' }), true);
  assert.equal(readsLikeCardBill({ bookingText: 'Lastschrift', purpose: '', remoteName: 'Musterbank Kreditkartenabrechnung' }), true);
});

test('the credit on the card has no shop or payee of its own', () => {
  const b = bill('2026-10-28');
  const credit = (name: string, text = 'Gutschrift', purpose = '') => camt({ day: '2026-10-29', amount: 612.4, text, name, purpose, ref: name });
  // Payment words where a name would be are no name.
  for (const name of ['', 'ZAHLUNG DANKE', 'Zahlungseingang', 'PAYMENT RECEIVED - THANK YOU', 'Einzahlung', 'Ausgleich Kreditkarte']) {
    assert.equal(paired([b], [credit(name)]).size, 2, JSON.stringify(name));
  }
  for (const name of ['AMAZON EU', 'HOTEL ADLON', 'Sparkasse Musterstadt', 'Nino Muster']) assert.equal(paired([b], [credit(name)]).size, 0, name);
  // A nameless refund says it is one.
  assert.equal(paired([b], [credit('', 'Gutschrift', 'Erstattung Bestellung 4711')]).size, 0);
  assert.equal(paired([b], [credit('', 'Storno')]).size, 0);
});

test('a Sparkasse card read over DKKKU: its refunds carry Girovo’s own label and are never a bill’s credit', () => {
  const raw = (day: string, amount: string, cd: 'C' | 'D', shop: string, ref: string) => `1:${day}:${day}:${ref}:::::${amount}:EUR:${cd}:${shop}:BERLIN`;
  const { statements } = cardStatements([{ accountNumber: '4001', transactions: [
    raw('20261003', '400,00', 'D', 'HOTEL ADLON', 'R1'),
    raw('20261014', '49,99', 'C', 'ZALANDO SE', 'R2'),
    raw('20261020', '20,00', 'C', 'AMAZON EU', 'R3'),
  ] } as never]);
  // As lib/serialize.ts hands them on: the label as the booking text, the shop as the payee.
  const card = statements[0].transactions.map((t) => ({
    valueDate: t.valueDate.toISOString(), entryDate: t.entryDate.toISOString(), amount: t.amount, currency: 'EUR', purpose: t.purpose || '',
    bookingText: t.bookingText || '', remoteName: t.remoteName || '', remoteIban: '', e2eReference: '', bankReference: t.bankReference || '', transactionCode: '',
  }) as unknown as SerializedTransaction);
  assert.deepEqual(card.map((t) => [t.amount, t.bookingText]), [[-400, 'Kreditkartenumsatz'], [49.99, 'Kreditkartenumsatz'], [20, 'Kreditkartenumsatz']]);
  const giro = [
    camt({ day: '2026-10-12', amount: -49.99, code: 'ESDD', text: 'SEPA-Basislastschrift', name: 'Vodafone GmbH', purpose: 'Rechnung 10/2026', mref: 'V-1' }),
    camt({ day: '2026-10-22', amount: -20, text: 'Überweisung', name: 'Lena Beispiel', purpose: 'Kino', iban: IBAN.employer }),
    // Even a real card bill of the same sum: the refund has its shop.
    bill('2026-10-15', -49.99),
  ];
  assert.equal(paired(giro, card).size, 0);
});

test('one booking pairs once, by the booking itself: two nameless 50 € credits on one day, one bill', () => {
  const b = bill('2026-10-28', -50);
  const one = camt({ day: '2026-10-28', amount: 50, text: 'Gutschrift' });
  const two = camt({ day: '2026-10-28', amount: 50, text: 'Gutschrift' });
  const set = paired([b], [one, two]);
  assert.equal(set.size, 2);
  assert.ok(set.has(b));
  assert.equal(+set.has(one) + +set.has(two), 1, 'one of the twins, not both');
  // The one that says it settles the card goes first, then the nearer.
  const worded = settle('2026-10-31', 50);
  assert.deepEqual(paired([b], [one, worded]), new Set([b, worded]));
  const near = camt({ day: '2026-10-29', amount: 50, text: 'Gutschrift', ref: 'n' });
  const far = camt({ day: '2026-10-31', amount: 50, text: 'Gutschrift', ref: 'f' });
  assert.ok(paired([b], [far, near]).has(near));
  // Two bills of one sum and two credits: one each.
  const b2 = bill('2026-11-27', -50);
  const s1 = settle('2026-10-29', 50);
  const s2 = settle('2026-11-28', 50);
  assert.deepEqual(new Set(paired([b, b2], [s2, s1])), new Set([b, b2, s1, s2]));
});

test('withoutCardBills: what the accounts add up to together, each bill and its credit on the card left out', () => {
  const giro = [camt({ day: '2026-10-30', amount: 2500, code: 'SALA', text: 'Lohn/Gehalt', name: 'ACME GmbH', iban: IBAN.employer }), bill('2026-10-28')];
  const card = [
    camt({ day: '2026-10-03', amount: -400, code: 'CCRD', text: 'Kartenumsatz', name: 'HOTEL ADLON' }),
    camt({ day: '2026-10-11', amount: -212.4, code: 'CCRD', text: 'Kartenumsatz', name: 'DB FERNVERKEHR' }),
    settle('2026-10-28'),
  ];
  const { txs, left } = withoutCardBills([GIRO, CARD], { '1001': giro, '4001': card });
  assert.deepEqual(txs, [giro[0], card[0], card[1]]);
  assert.deepEqual(left, [giro[1], card[2]]);
  // One account, or no card among them: everything stays.
  assert.equal(withoutCardBills([GIRO], { '1001': giro, '4001': card }).left.length, 0);
  assert.equal(withoutCardBills([GIRO], { '1001': giro }).txs.length, 2);
});
