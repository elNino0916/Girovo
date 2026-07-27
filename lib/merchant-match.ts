// The company-detection model.
//
// German bank statements name the counterparty in its full legal form, which is
// almost never the brand you'd recognise:
//
//   "PayPal Europe S.a.r.l et Cie S.C.A."  → PayPal
//   "DB Vertrieb GmbH"                     → Deutsche Bahn
//   "REWE Markt GmbH"                      → REWE
//   "AMAZON EU S.A R.L."                   → Amazon
//
// This module turns such a string into an ordered ladder of search candidates
// and scores whatever a lookup returns. It is a deterministic model, not a
// learned one: every decision here is inspectable and every rung carries its own
// acceptance threshold. The bias is heavily towards *not* matching — a wrong
// logo on a bank transaction is worse than no logo, so anything below threshold
// resolves to null and the row keeps its plain avatar.
//
// It is also the privacy gate. Names are only ever sent to an external service
// when they carry a corporate marker, so a transfer from a private person never
// leaves the machine. See lib/merchants.ts for the lookup itself.

/** Fold to a comparable form: lowercase, umlauts transliterated, alphanumeric. */
export function normalize(input: string): string {
  return String(input ?? '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Legal forms and their connectors. Stripped only from the END of a name, as
// whole tokens — German and EU legal forms are always trailing, and a
// trailing-only rule can't damage a brand that merely contains one of these
// (ABB keeps its B, Sanofi keeps its "AS").
const LEGAL_FORMS = new Set([
  'gmbh', 'mbh', 'ag', 'se', 'kg', 'kgaa', 'ohg', 'gbr', 'eg', 'ek', 'ev', 'ug',
  'haftungsbeschraenkt', 'co', 'cie', 'et', 'und', 'and', 'company', 'corp',
  'corporation', 'inc', 'llc', 'ltd', 'limited', 'plc', 'sa', 'sas', 'sarl',
  'sca', 'srl', 'sl', 'spa', 'bv', 'nv', 'ab', 'as', 'aps', 'oy', 'oyj', 'rl',
  'sp', 'zoo', 'dac', 'plc', 'pte', 'pty', 'plcs',
]);

// Legal forms that LEAD instead of trailing. German and EU forms sit at the
// end, but the Dutch foundation that payment institutions collect through does
// not: "Stichting Mollie Payments" and "Stichting Nuvei Escrow Services" carry
// their brand in the middle, so stripping only from the right leaves the
// wrapper and never reaches the name.
const LEADING_FORMS = new Set(['stichting', 'stiftung', 'firma', 'fa', 'vereniging']);

// Trailing words that qualify a brand rather than name it. Removing them yields
// the next rung of the ladder; the unstripped form is always tried first, so
// "DB Vertrieb" gets its shot before falling back to "DB".
const QUALIFIERS = new Set([
  'deutschland', 'germany', 'europe', 'europa', 'international', 'global',
  'de', 'eu', 'ger', 'vertrieb', 'service', 'services', 'dienstleistung',
  'dienstleistungen', 'handel', 'holding', 'holdings', 'group', 'gruppe',
  'payments', 'payment', 'technologies', 'technology', 'solutions', 'systems',
  'digital', 'online', 'retail', 'stores', 'store', 'markt', 'filiale',
  'niederlassung', 'zweigniederlassung', 'zentrale', 'verwaltung', 'kundenservice',
  // What was bought or how, rather than who was paid: "VIMpay Blitz-Aufladung",
  // "Stichting Nuvei Escrow Services", "Netflix Abo".
  'escrow', 'derdengelden', 'treuhand', 'aufladung', 'blitz', 'guthaben',
  'einzahlung', 'abo', 'abonnement', 'collections',
]);

// Words too generic to identify a company on their own. A name that reduces to
// one of these resolves to null however good the string match looks.
const TOO_GENERIC = new Set([
  'bank', 'sparkasse', 'volksbank', 'raiffeisenbank', 'stadtwerke', 'finanzamt',
  'apotheke', 'versicherung', 'markt', 'supermarkt', 'tankstelle', 'restaurant',
  'hotel', 'taxi', 'praxis', 'kanzlei', 'immobilien', 'hausverwaltung', 'miete',
  'gehalt', 'lohn', 'rente', 'beitrag', 'service', 'zahlung', 'ueberweisung',
  'dauerauftrag', 'lastschrift', 'gutschrift', 'kartenzahlung', 'bargeld',
  'geldautomat', 'atm', 'shop', 'store', 'group', 'holding', 'energie', 'strom',
  'gas', 'wasser', 'stadt', 'gemeinde', 'verein', 'kirche', 'schule', 'universitaet',
  'instant', 'transfer', 'instant transfer', 'express', 'checkout', 'payout', 'ref',
  'reference', 'sofort', 'sepa', 'credit', 'debit', 'auszahlung', 'einzahlung',
]);

// Given names, spelled as `normalize` leaves them (lowercase, umlauts
// transliterated). This is the person veto.
//
// It exists because of the ALL-CAPS rule below: plenty of banks write every
// counterparty in capitals, private people included, and "ULF-TORSTEN MUELLER"
// then looks exactly like the shape a card terminal uses for a merchant. The
// name would be sent to a logo service and — because `normalize` splits the
// hyphen — its leading token "ulf" could match some company called Ulf.
//
// Hyphenated compounds are the important case and need no special handling:
// they arrive already split, so listing the halves ("ulf", "torsten",
// "hans", "juergen") covers them.
const GIVEN_NAMES = new Set(
  `
  achim adam adolf adrian agnes alexander alexandra alfred ali alice andre andrea andreas
  angela anja anke anna annegret annett annette anton antje armin arne arno artur
  astrid august axel barbara bastian beate benedikt benjamin bernd bernhard bettina
  birgit bjoern bodo boris brigitte britta burkhard carina carl carmen carola carsten
  caroline charlotte christa christel christian christiane christina christine christoph
  claudia claus clemens conrad cornelia dagmar daniel daniela david dennis detlef diana
  dieter dirk dominik doris dorothea eberhard edgar edith eduard egon elena elfriede
  elisabeth elke ella elmar elsa emil emilia emma erhard erich erik erika ernst erwin
  eva fabian falk felix ferdinand florian frank franz franziska frauke friedrich fritz
  gabriele georg gerald gerd gerda gerhard gernot gertrud gisela grete gudrun guenter
  guenther gunnar gustav hagen hanna hannah hannes hans harald hartmut hedwig heide
  heidi heiko heinrich heinz helena helga helmut henning henriette henrik herbert
  hermann hilde holger horst hubert hugo ilona ines inga inge ingeborg ingo ingrid
  irene iris irmgard isabel jakob james jan jana janina jasmin jena jennifer jens
  jessica joachim jochen johann johanna johannes john jonas joerg josef josefine judith
  julia juliane julian julius juergen jutta kai karin karina karl karsten katharina
  kathrin katja katrin kerstin kevin kirsten klara klaus konrad konstanze kristin kurt
  lara lars laura lena leon leonie lilly linda lisa lothar lotte lucas ludwig luisa
  luise lukas magdalena maike manfred manuel manuela marc marcel marco marcus mareike
  margarete maria marianne marie marina marion marius mark markus marlene marta martin
  martina mathilde matthias max maximilian mehmet meike melanie michael michaela mike
  mirko monika moritz murat nadine nanette natalie nico nicole niklas nils nina nino norbert nora
  olaf olga oskar otto patricia patrick paul paula peter petra philipp pia
  rainer ralf ralph raphael regina reinhard reinhold renate rene richard rita robert
  roland rolf roman ronald rosa rosemarie rudolf ruediger rupert ruth sabine sandra
  sara sarah sascha sebastian sergej siegfried silke silvia simon simone sonja sophia
  sophie stefan stefanie steffen stephan stephanie susanne sven svenja sybille tanja
  thea theo theresa thomas thorsten tim timo tina tobias torben torsten udo ulf ulrich
  ulrike ursula ute uwe valentin vanessa veit vera verena veronika viktor viktoria
  volker waldemar walter waltraud werner wiebke wilhelm willi wolfgang wolfram yvonne 
  `
    .split(/\s+/)
    .filter(Boolean),
);

/** Forms of address that settle the question on their own. */
const PERSON_TITLES = new Set(['herr', 'frau', 'dr', 'prof', 'dipl', 'ing']);

// Words whose presence marks a name as a business rather than a person. Paired
// with the legal-form and ALL-CAPS tests below, this is what keeps private
// counterparties off the wire.
const CORPORATE_WORDS = new Set([
  ...QUALIFIERS,
  'bank', 'versicherung', 'energie', 'stadtwerke', 'verlag', 'apotheke',
  'hotel', 'restaurant', 'reisen', 'logistik', 'transport', 'media', 'telekom',
  'mobil', 'mobility', 'shop', 'market', 'marketplace', 'mktp', 'ecommerce',
]);

// Payment facilitators. A card descriptor routinely names the acquirer that
// processed the payment beside — or instead of — the shop that took it:
//
//   "EBAY BY ADYEN"      the acquirer trails the merchant
//   "PAYPAL *STEAM"      the acquirer leads it, asterisk-separated
//   "SQ *COFFEE ROMA"    Square, abbreviated
//
// Left in place these are worse than noise. "ebay by adyen" matches nothing at
// all, and "paypal steam" matches PayPal — the processor rather than the shop,
// which is a confidently wrong logo.
import { parsePurpose } from './sepa-purpose';

const FACILITATORS = new Set([
  'adyen', 'paypal', 'pp', 'sumup', 'square', 'sq', 'izettle', 'zettle', 'iz',
  'stripe', 'mollie', 'klarna', 'ccv', 'nexi', 'concardis', 'payone', 'unzer',
  'worldline', 'vrpay', 'computop', 'novalnet', 'digistore', 'digistore24',
  'fastspring', 'paddle', 'shopify', 'gocardless', 'ratepay', 'secupay',
  'telecash', 'elavon', 'micropayment', 'wirecard', 'saferpay', 'braintree',
  'smart2pay', 's2p', 'nuvei', 'ppro', 'trustly', 'sofort', 'giropay', 'paydirekt',
  'wero'
]);

const isFacilitator = (part: string) => FACILITATORS.has(normalize(part).split(' ')[0]);

const LEGAL_AND_QUALIFIERS = new Set([...LEGAL_FORMS, ...QUALIFIERS]);

/**
 * The payment provider a counterparty name reduces to, or null.
 *
 * "Stichting Mollie Payments", "PayPal Europe S.a.r.l. et Cie S.C.A." and a
 * bare "PAYPAL" all reduce to the one token that names the provider.
 */
export function facilitatorOf(raw: string): string | null {
  const tokens = tokenize(stripDecoration(raw));
  const stripped = stripLeading(stripTrailing(tokens, LEGAL_AND_QUALIFIERS));
  return stripped.length === 1 && FACILITATORS.has(stripped[0]) ? stripped[0] : null;
}

export function isFacilitatorName(raw: string): boolean {
  return facilitatorOf(raw) !== null;
}

/**
 * Strip the bank's own decoration: some institutes append `//City/DE` to the
 * counterparty, pad with runs of dots, bracket the name in reference codes, or
 * name the payment processor alongside the shop.
 */
function stripDecoration(raw: string): string {
  let s = String(raw ?? '');
  s = s.split('//')[0];                 // "REWE SAGT DANKE.//Koblenz/DE"

  // "EBAY BY ADYEN" → "EBAY". Only a known facilitator is cut, so an ordinary
  // name that happens to contain "by" ("Brot by Anna") survives intact.
  s = s.replace(/\s+(?:by|via)\s+([\p{L}\d.&_-]+)\s*$/iu, (whole, who: string) =>
    isFacilitator(who) ? '' : whole);

  // "PAYPAL *STEAM" → "STEAM". Whichever side is not the processor is the shop;
  // if every part looks like a processor the name is left alone, since it is
  // then the processor itself that was paid ("PayPal Europe S.a.r.l.").
  if (s.includes('*')) {
    const parts = s.split('*').map((p) => p.trim()).filter(Boolean);
    const shop = parts.filter((p) => !isFacilitator(p));
    if (shop.length) s = shop.join(' ');
  }

  s = s.replace(/\s{2,}/g, ' ');
  s = s.replace(/\.{2,}/g, ' ');
  s = s.replace(/[•|;]+/g, ' ');
  return s.trim();
}

/** Tokens of a name with punctuation removed, so "S.a.r.l" becomes "sarl". */
function tokenize(raw: string): string[] {
  const dec = stripDecoration(raw);
  if (!dec) return [];
  const domainMatch = dec.match(/\b(?:www\.)?([a-z0-9-]+\.[a-z]{2,})\b/i);
  if (domainMatch) {
    const host = domainMatch[1].toLowerCase();
    const coreName = host.split('.')[0];
    return [host, coreName];
  }
  return normalize(dec.replace(/\./g, '')).split(' ').filter(Boolean);
}

function stripTrailing(tokens: string[], vocabulary: Set<string>): string[] {
  const out = tokens.slice();
  while (out.length > 1 && vocabulary.has(out[out.length - 1])) out.pop();
  return out;
}

/**
 * Peel the wrapper off the front.
 *
 * "Stichting Derdengelden Klarna" — the Dutch third-party-funds foundation a
 * payment institution collects through — stacks two wrapper words before the
 * only one that names anybody, so this loops rather than dropping a single
 * token.
 */
function stripLeading(tokens: string[]): string[] {
  const out = tokens.slice();
  while (out.length > 1 && (LEADING_FORMS.has(out[0]) || QUALIFIERS.has(out[0]))) out.shift();
  return out;
}

// The legal forms long enough to still be recognisable when the bank cuts them
// off. MT940 name fields are fixed-width, so "rebuy recommerce GmbH" routinely
// arrives as "rebuy recommerce Gmb" — a name that carries a legal form the
// vocabulary above cannot see, and which was therefore never looked up at all.
const TRUNCATABLE = [...LEGAL_FORMS].filter((f) => f.length >= 4);

/** Whether a trailing token is a legal form the bank cut short. */
function isClippedLegalForm(token: string): boolean {
  // Three characters is the floor: shorter stubs ("co", "sa") are real words
  // and real surnames far more often than they are clipped legal forms.
  if (token.length < 3) return false;
  return TRUNCATABLE.some((form) => form.length > token.length && form.startsWith(token));
}

/**
 * A marker that proves a business whatever the casing — a legal form (whole or
 * clipped) or a corporate keyword. This is the only evidence strong enough to
 * override the person veto, which is why "Robert Bosch GmbH" and "Carl Zeiss
 * AG" survive a rule that rejects "Robert Bosch" on its own.
 */
function hasCorporateMarker(tokens: string[]): boolean {
  if (tokens.some((t) => LEGAL_FORMS.has(t))) return true;
  if (tokens.some((t) => CORPORATE_WORDS.has(t))) return true;
  // A form that leads is as much a proof as one that trails: "Stichting …",
  // "Stiftung …" and "Firma …" name an organisation, never a person.
  if (tokens.length > 1 && LEADING_FORMS.has(tokens[0])) return true;
  // Only the last token can be the clipped one — a field is cut at its end.
  return tokens.length > 1 && isClippedLegalForm(tokens[tokens.length - 1]);
}

/**
 * Whether this reads as a private individual rather than a company.
 *
 * A given name plus one to three further words, carrying nothing corporate, is
 * a person: "Ulf-Torsten Müller", "Müller, Hans", "Dr. Anna Beispiel". Length
 * matters — a company can be named after its founder, but it does not stay at
 * two or three words without ever picking up a legal form or a trade word.
 */
function looksPersonal(tokens: string[]): boolean {
  if (tokens.length < 2 || tokens.length > 4) return false;
  if (tokens.some((t) => /\d/.test(t))) return false;
  if (tokens.some((t) => PERSON_TITLES.has(t))) return true;
  return tokens.some((t) => GIVEN_NAMES.has(t));
}

/**
 * Whether this counterparty is a business we may look up externally.
 *
 * Order is the whole design. A corporate marker settles it outright; failing
 * that, anything reading as a person is refused; only then does the ALL-CAPS
 * shape — how card terminals and many banks write merchants — count as
 * evidence. Running the veto before the casing test is what stops a bank that
 * capitalises every counterparty from turning its customers into companies.
 *
 * `businessBooking` lifts the veto, and only the veto. A SEPA direct debit's
 * creditor holds a Gläubiger-ID and a card acceptor holds a merchant
 * agreement, so on those bookings the other side cannot be a private person
 * however much the name looks like one — which is what lets "HUGO BOSS" keep
 * its logo on a card payment.
 */
export function looksCorporate(raw: string, businessBooking = false, purpose?: string): boolean {
  const decorated = stripDecoration(raw);
  if (decorated) {
    if (/\b(?:www\.)?[a-z0-9-]+(?:\.[a-z]{2,})+\b/i.test(decorated)) return true;

    const tokens = tokenize(decorated);
    if (tokens.length) {
      if (hasCorporateMarker(tokens)) return true;
      if (!businessBooking && looksPersonal(tokens)) return false;

      const letters = decorated.replace(/[^A-Za-zÄÖÜäöüß]/g, '');
      if (letters.length >= 3 && letters === letters.toUpperCase()) return true;
    }
  }

  // Reading the purpose is ONLY allowed when the counterparty itself is a
  // payment wrapper (PayPal, Mollie, Smart2Pay). A transfer from a private
  // individual must never have its remittance text mined for a brand — that is
  // free-text somebody wrote, and it is none of a logo service's business.
  if (purpose && isFacilitatorName(raw) && merchantHint(purpose)) return true;

  return businessBooking;
}

// ---------------------------------------------------------------------------
// Bookings whose counterparty cannot be a private person
// ---------------------------------------------------------------------------

// Logos are attempted on every booking type, but these two families carry a
// guarantee the others don't: collecting a SEPA core direct debit requires a
// Gläubiger-ID, and accepting a card requires a merchant agreement. Neither is
// available to a private individual, so on these bookings the person veto can
// be lifted and a shop named after somebody keeps its mark.
const MERCHANT_BOOKINGS = new Set([
  'basislastschrift', 'lastschrift', 'folgelastschrift', 'erstlastschrift', 'einmallastschrift',
  'kartenzahlung', 'kartenverfuegung', 'kartenumsatz', 'girocard', 'debitkarte', 'debitk',
  'karte', 'maestro', 'vpay', 'pos',
]);

// Bookings that contain one of the words above but are not a purchase: the B2B
// scheme, a reversal (whose counterparty is the return, not the shop), and
// cash at a machine.
const NOT_MERCHANT_BOOKINGS = new Set([
  'firmenlastschrift', 'ruecklastschrift', 'lastschriftrueckgabe', 'rueckbelastung',
  'rueckruf', 'ruecküberweisung', 'bargeldauszahlung', 'bargeld', 'geldautomat',
  'kreditkartenabrechnung', 'entgeltabschluss',
]);

/**
 * Whether a booking's counterparty is necessarily a business.
 *
 * Matched on the bank's own booking text rather than the Geschäftsvorfallcode:
 * the code is not portable — one institute sends `105`, another sends `ESCT` —
 * whereas the text is the label the bank itself puts on the booking.
 *
 * A false answer means "not proven", not "private". Those names are still
 * looked up; they simply have to clear the person veto on their own.
 */
export function isBusinessBooking(tx: { bookingText?: string | null }): boolean {
  const tokens = normalize(tx.bookingText ?? '').split(' ').filter(Boolean);
  if (!tokens.length) return false;
  if (tokens.some((t) => NOT_MERCHANT_BOOKINGS.has(t))) return false;
  return tokens.some((t) => MERCHANT_BOOKINGS.has(t));
}

/** One rung of the search ladder. */
export type Candidate = {
  /** The string to search for. */
  query: string;
  /** Normalized form used for scoring. */
  core: string;
  /**
   * How good a name match this rung demands. Shorter, more aggressively
   * stripped cores are riskier, so they require an exact hit.
   */
  minScore: number;
  /**
   * Set when the rung came from the Verwendungszweck rather than the
   * counterparty — the booking names a payment provider and this is the shop
   * behind it. Winning on such a rung is what earns the provider badge.
   */
  fromPurpose?: boolean;
};

// ---------------------------------------------------------------------------
// The shop hiding inside the Verwendungszweck
// ---------------------------------------------------------------------------

// Words that are never a shop: the vocabulary of payment itself, plus the
// scaffolding banks wrap around it.
const HINT_NOISE = new Set([
  'ihr', 'ihre', 'einkauf', 'kauf', 'bestellung', 'zahlung', 'bezahlung', 'auftrag',
  'auftragskonto', 'vom', 'am', 'von', 'fuer', 'ueber', 'bei', 'an', 'the', 'your',
  'sepa', 'instant', 'transfer', 'express', 'checkout', 'payout', 'gutschrift',
  'auszahlung', 'einzahlung', 'sofort', 'sofortueberweisung', 'umbuchung',
  'kontoauszug', 'abrechnung', 'transaktion', 'credit', 'debit', 'order', 'ref',
  'referenz', 'rechnung', 'nr', 'no', 'datum', 'date', 'purchase', 'payment',
]);

// The phrases a payment wrapper uses to introduce the shop it collected for.
// "IHR EINKAUF BEI G2A.com" is the shape this whole feature exists for.
const PURCHASE_LEAD =
  /(?:ihr\s+einkauf\s+bei|einkauf\s+bei|kauf\s+bei|bestellung\s+bei|bestellung\s+vom|zahlung\s+an|bezahlung\s+an|payment\s+to|purchase\s+at)\s+/i;

const DOMAIN_RE = /\b(?:www\.)?((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,})\b/i;

/** "g2a.com" → "g2a"; the part that has to match a brand name. */
const hostCore = (host: string) => host.split('.')[0] || host;

/** Reference codes, order numbers and the wrapper's own name — never the shop. */
function scrubPurpose(text: string): string {
  return text
    .replace(/\bPP\.[A-Z0-9.]+\b/gi, ' ')       // PayPal's own reference block
    .replace(/\b[a-z0-9]*\d{5,}[a-z0-9]*\b/gi, ' ') // order and reference numbers
    .replace(/\b[A-Z0-9]{12,}\b/g, ' ')         // long opaque references
    .replace(/\b\d{1,2}[./]\d{1,2}[./]\d{2,4}\b/g, ' ') // dates
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Whether a extracted string is specific enough to be worth searching for. */
function usableHint(candidate: string): boolean {
  const words = normalize(candidate).split(' ').filter(Boolean);
  if (!words.length) return false;
  if (words.every((w) => HINT_NOISE.has(w) || /^\d+$/.test(w))) return false;
  return normalize(candidate).replace(/\s/g, '').length >= 2;
}

/** Drop leading and trailing noise words, then keep at most three. */
function trimToName(text: string): string {
  let words = text.split(/\s+/).filter(Boolean);
  while (words.length && HINT_NOISE.has(normalize(words[0]))) words.shift();
  // Stop at the first word that is plainly not part of a name.
  const end = words.findIndex((w) => HINT_NOISE.has(normalize(w)) || /\d{3,}/.test(w));
  if (end > 0) words = words.slice(0, end);
  return words.slice(0, 3).join(' ').replace(/[.,;:|/*-]+$/, '').trim();
}

/**
 * The one merchant this purpose names, or null.
 *
 * Deliberately singular. An earlier version returned every 2-to-4 word window
 * of the remittance text as a candidate, which produced seven search terms for
 * a single booking — "bestellung vom", "vom 12062026" among them — each one a
 * metered Brandfetch call, and each able to win before the real name was ever
 * tried. One deterministic answer is both cheaper and more accurate.
 *
 * Priority is by how much the source proves: a structured SEPA field beats a
 * domain, and a domain beats prose.
 */
export function merchantHint(purpose?: string | null): string | null {
  const raw = String(purpose ?? '').trim();
  if (!raw) return null;

  const parsed = parsePurpose(raw);

  // 1. ABWE/ABWA — "abweichender Empfänger/Auftraggeber" is, by definition, the
  //    party behind the one on the booking. Nothing else in the record is as
  //    explicit about who was actually paid.
  for (const field of parsed.fields) {
    if (field.tag !== 'ABWE' && field.tag !== 'ABWA') continue;
    const name = trimToName(scrubPurpose(field.value));
    if (usableHint(name)) return name;
  }

  const text = scrubPurpose(parsed.text || raw);
  if (!text) return null;

  // 2. A domain is unambiguous and needs no search to be understood.
  const domain = text.match(DOMAIN_RE);
  if (domain && !isFacilitator(domain[1].split('.')[0])) return domain[1].toLowerCase();

  // 3. Otherwise the words introduced by a purchase phrase.
  const lead = text.match(PURCHASE_LEAD);
  if (lead && lead.index != null) {
    const name = trimToName(text.slice(lead.index + lead[0].length));
    if (usableHint(name) && !isFacilitator(name)) return name;
  }

  return null;
}

/**
 * The ordered candidates for a counterparty, most specific first.
 *
 * "DB Vertrieb GmbH" yields ["DB Vertrieb", "DB"]: the subsidiary is tried
 * before the ambiguous two-letter core, and the two-letter core is only
 * accepted on an exact label or alias hit.
 */
export function candidates(raw: string, purpose?: string): Candidate[] {
  const rungs: Candidate[] = [];
  const push = (parts: string[], minScore: number, fromPurpose = false) => {
    const core = parts.join(' ').trim();
    if (!core) return;
    if (core.length < 2) return;
    if (TOO_GENERIC.has(core)) return;
    if (rungs.some((r) => r.core === core)) return;
    rungs.push({ query: core, core, minScore: core.length <= 3 ? 1 : minScore, fromPurpose });
  };

  const isFacilitatorWrapper = isFacilitatorName(raw);

  // When the counterparty is only the payment wrapper, the shop's name is in
  // the purpose — and it is a better answer than the wrapper, so it leads.
  // Exactly one hint is taken, which bounds a booking to a handful of searches
  // instead of one per phrase in its remittance text.
  if (isFacilitatorWrapper && purpose) {
    const hint = merchantHint(purpose);
    if (hint) {
      const domain = hint.match(DOMAIN_RE);
      if (domain) {
        // A domain resolves against Brandfetch's CDN directly, so it needs no
        // search at all — see resolveOne in lib/merchants.ts.
        const host = domain[1].toLowerCase();
        rungs.push({ query: host, core: hostCore(host), minScore: 0.85, fromPurpose: true });
      } else {
        for (const r of candidates(hint)) push([r.core], r.minScore, true);
      }
    }
  }

  const tokens = tokenize(raw);
  if (tokens.length) {
    const whole =
      tokens.length > 1 && isClippedLegalForm(tokens[tokens.length - 1]) ? tokens.slice(0, -1) : tokens;

    const afterLegal = stripTrailing(whole, LEGAL_FORMS);
    const afterQualifiers = stripTrailing(afterLegal, QUALIFIERS);
    const afterLeading = stripLeading(afterQualifiers);

    push(afterLegal, 0.85);
    push(afterQualifiers, 0.85);
    push(afterLeading, 0.85);

    if (
      !isFacilitatorWrapper
      && hasCorporateMarker(tokens)
      && afterLeading.length > 1
      && afterLeading[0].length >= 3
      && !GIVEN_NAMES.has(afterLeading[0])
    ) {
      push([afterLeading[0]], 1);
    }
  }

  return rungs;
}

/**
 * How well a label or alias returned by the lookup matches the candidate core.
 *
 *   1.00  the names are the same
 *   0.85  the core starts with the whole label ("paypal europe" ← "paypal")
 *   0.85  the label starts with the whole core ("rebuy recommerce" → "reBuy
 *         Recommerce GmbH", where the lookup answers with the full legal name)
 *   0.70  the label appears as a whole word inside the core
 *   0     no usable relationship
 */
export function nameScore(core: string, label: string): number {
  const a = normalize(core);
  const b = normalize(label);
  if (!a || !b) return 0;
  if (a === b) return 1;
  // "g2a com" and "g2acom" are the same name written two ways.
  if (a.replace(/\s+/g, '') === b.replace(/\s+/g, '')) return 1;
  // The length floors are what keep a short prefix from being evidence. At two
  // characters "IHR" scored 0.85 against "ihr g2a com", which is how noise
  // words from a remittance text were winning against real brands.
  if (b.length >= 4 && a.startsWith(`${b} `)) return 0.85;
  // The symmetric case. Without it a lookup that returns a company's full legal
  // name scores zero against the shorter core the statement carries, which is
  // the more specific and better match of the two.
  if (a.length >= 4 && b.startsWith(`${a} `)) return 0.85;
  if (b.length >= 5 && new RegExp(`(^| )${escapeRegExp(b)}( |$)`).test(a)) return 0.7;
  if (a.length >= 5 && new RegExp(`(^| )${escapeRegExp(a)}( |$)`).test(b)) return 0.7;
  return 0;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The best score across every name a lookup result is known by. */
export function bestScore(core: string, labels: Iterable<string>): number {
  let best = 0;
  for (const l of labels) {
    const s = nameScore(core, l);
    if (s > best) best = s;
    if (best === 1) break;
  }
  return best;
}

/**
 * The identity a resolved logo is cached under.
 *
 * Keyed on the *hint*, never on the raw purpose. Two G2A purchases through
 * PayPal carry different order numbers, so keying on the remittance text gave
 * every single booking its own key — nothing was ever a cache hit, on the
 * client or the server, and a statement of sixty transactions turned into
 * hundreds of metered lookups that mostly ended in a rate-limit. Keying on
 * "paypal europe::g2a.com" collapses them back to one.
 *
 * Names that are not payment wrappers key on the name alone, exactly as before.
 */
export function getMerchantKey(item: { remoteName?: string | null; purpose?: string | null }): string {
  const name = String(item.remoteName ?? '').trim();
  if (!name) return '';
  if (!item.purpose || !isFacilitatorName(name)) return name;
  const hint = merchantHint(item.purpose);
  return hint ? `${name}::${normalize(hint)}` : name;
}
