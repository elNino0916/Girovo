// The card-payment record German banks write into a Verwendungszweck.
//
// A Visa/Mastercard debit or credit card payment arrives with a purpose that
// is not prose at all but the terminal's and the card system's bookkeeping:
//
//   2026-08-18T10:12 Debitk.0 2030-12 Einsatzentgelt 1,00 EUR Zahl.System VISA Debit
//   2026-08-31T09:01 Debitk.0 2030-12 Original 9,85 USD 1 Euro=1,1563 USD Einsatzentgelt 0,15 EUR …
//
// That is: when it happened, which card (sequence number and expiry), the
// amount in the original currency and the rate, the fee the bank added for
// using the card ("Einsatzentgelt", abroad "Auslandseinsatzentgelt"), and the
// card scheme. None of it says *what was bought* — and read as words it is
// actively misleading: "…entgelt" is the German for a fee, which is how a
// 9,99 € purchase used to be filed under "Bankentgelte".
//
// Pure and dependency-free, like the other lib modules the tests run directly.

export type CardPurpose = {
  /** "2026-08-18T10:12" as the bank wrote it, or null. */
  at: string | null;
  card: 'debit' | 'credit' | null;
  /** The card scheme as written ("VISA Debit", "Mastercard"), or null. */
  scheme: string | null;
  /** The amount in the currency the merchant charged, for a foreign-currency payment. */
  original: { amount: number; currency: string; rate: number | null } | null;
  /** The card-usage fee included in the booking, in EUR. */
  fee: number | null;
  /** Whatever the record leaves once its known parts are taken out — sometimes a note ("Teillieferung(Final)"). */
  rest: string;
};

const TIMESTAMP = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?\b/;
// "Debitk.0 2030-12": the card's sequence number and its expiry.
const CARD = /\b(Debitk|Kreditk)\.?\s?\d{1,2}\s+\d{4}-\d{2}\b/i;
// A card refund names neither card type nor scheme: the timestamp, a bare
// sequence number and the expiry ("2026-09-12T08:15 000 2030-12 /VID-K…
// +ARN74…"), then the scheme's and the acquirer's references for the refund.
const CARD_BARE = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?\s+\d{1,4}\s+\d{4}-\d{2}\b/;
const SEQ_EXPIRY = /(?:^|\s)\d{1,4}\s+\d{4}-\d{2}(?=\s|$)/;
// A girocard terminal's record: the card's sequence number ("Kartenfolgenummer")
// and its expiry ("Verfalljahr", YYMM) — "… 2026-10-04T08:12:40 KFN 1 VJ 2912".
const GIROCARD = /\bKFN\s?\d{1,2}\s+VJ\s?\d{4}\b/i;
const CARD_REFS = /(?:\/VID-\S*|\+ARN\S*)/i;
const SCHEME = /\bZahl\.?\s?System\s+(VISA\s+Debit|Visa|Mastercard(?:\s+Debit)?|Maestro|V\s?PAY|girocard)\b/i;
const ORIGINAL = /\bOriginal\s+([\d.,]+)\s+([A-Z]{3})(?:\s+1\s+Euro\s*=\s*([\d.,]+)\s+[A-Z]{3})?/i;
const FEE = /\b(?:Auslandseinsatz|Einsatz|Fremdw(?:ae|ä)hrungs?|Kursaufschlag\s?)entgelt\s+([\d.,]+)\s*EUR\b/i;

/** "1.234,56" / "9,85" / "1,1563" → number (German decimals as banks write them). */
function decimal(s: string): number | null {
  const t = s.trim();
  const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  return Number.isFinite(n) ? n : null;
}

/** Whether a purpose is a card system's record rather than prose. */
export function isCardPurpose(text: string | null | undefined): boolean {
  const s = String(text ?? '');
  return CARD.test(s) || SCHEME.test(s) || CARD_BARE.test(s) || GIROCARD.test(s);
}

/** The parts of a card record, or null when the purpose isn't one. */
export function parseCardPurpose(text: string | null | undefined): CardPurpose | null {
  const s = String(text ?? '');
  if (!isCardPurpose(s)) return null;

  const card = CARD.exec(s);
  const scheme = SCHEME.exec(s);
  const girocard = GIROCARD.test(s);
  const original = ORIGINAL.exec(s);
  const fee = FEE.exec(s);
  const origAmount = original ? decimal(original[1]) : null;

  return {
    at: TIMESTAMP.exec(s)?.[0] ?? null,
    card: card ? (/^debit/i.test(card[1]) ? 'debit' : 'credit') : girocard ? 'debit' : null,
    scheme: scheme ? scheme[1].replace(/\s+/g, ' ') : girocard ? 'girocard' : null,
    original: original && origAmount != null
      ? { amount: origAmount, currency: original[2].toUpperCase(), rate: original[3] ? decimal(original[3]) : null }
      : null,
    fee: fee ? decimal(fee[1]) : null,
    rest: stripCardBoilerplate(s),
  };
}

/**
 * The purpose with the card record taken out — what is left for a reader or a
 * keyword table to work with. A purpose that isn't a card record comes back
 * untouched.
 */
export function stripCardBoilerplate(text: string | null | undefined): string {
  const s = String(text ?? '');
  if (!isCardPurpose(s)) return s;
  return [TIMESTAMP, CARD, SCHEME, ORIGINAL, FEE, CARD_REFS, GIROCARD, SEQ_EXPIRY]
    .reduce((acc, re) => acc.replace(new RegExp(re.source, 'gi'), ' '), s)
    .replace(/\s+/g, ' ')
    .replace(/^[\s·,;:/+-]+|[\s·,;:/+-]+$/g, '')
    .trim();
}

// ---------------------------------------------------------------------------
// The merchant descriptor
//
// What a card terminal sends as the shop's name is the scheme's "card acceptor"
// record — name, street, city, country and a trailing indicator, slash
// separated, each cut to the scheme's field length:
//
//   LS Caf Nova Deutzer F/Frankenwerft 1/Kln/DE
//   WL .Steam Purchase//425-889-9642/US/3
//   SP the Ridge EU//Amsterdam-Dui/NL/1
//   DHL.4158584457//Bonn/DE/0
//
// The name often carries the payment provider's prefix in front of the shop
// ("SP" Shopify, "SQ" Square, "WL" Worldline, "LS" Lightspeed — with a "*"
// that SWIFT's character set turns into "."), or a reference behind it
// ("DHL*4158584457"). Characters outside SWIFT's set are dropped, not
// replaced: "Köln" arrives as "Kln", "Café" as "Caf".
// ---------------------------------------------------------------------------

export type CardAcceptor = {
  /** The shop, as a person would name it: "Steam Purchase", "Café Nova Deutzer F". */
  merchant: string;
  /** Street and number, when the terminal sent one. */
  street: string | null;
  /** The town — null when the slot holds a phone number or a web address instead (online shops). */
  city: string | null;
  /** ISO 3166 alpha-2, upper case. */
  country: string | null;
};

// Payment providers that put their own short code in front of the shop,
// separated by "*" (or the "." SWIFT makes of it).
const PROVIDER_PREFIX = new Set(['SP', 'SQ', 'LS', 'WL', 'IZ', 'ZTL', 'PP', 'TST', 'CKO', 'SUMUP', 'PAYPAL', 'STRIPE', 'PADDLE']);
// The few that also appear with a bare space ("SP the Ridge EU") — kept
// short, because a shop may well be called "PP Autoteile".
const SPACED_PREFIX = new Set(['SP', 'SQ', 'LS', 'WL', 'IZ']);

const ALPHA3: Record<string, string> = {
  DEU: 'DE', AUT: 'AT', CHE: 'CH', NLD: 'NL', BEL: 'BE', LUX: 'LU', FRA: 'FR', ITA: 'IT', ESP: 'ES',
  GBR: 'GB', IRL: 'IE', USA: 'US', DNK: 'DK', SWE: 'SE', NOR: 'NO', POL: 'PL', CZE: 'CZ', PRT: 'PT',
};

// Towns with an umlaut or ß, by the forms a terminal leaves of them: the
// letter dropped ("Kln") or spelled out ("Koeln").
const TOWNS = `
  Köln München Düsseldorf Nürnberg Würzburg Göttingen Lübeck Saarbrücken Osnabrück Tübingen
  Fürth Lüneburg Mönchengladbach Gütersloh Mülheim Zürich Bückeburg Königswinter Jülich Düren
  Büdingen Lüdenscheid Gmünd Wörth Fürstenfeldbruck Günzburg Böblingen Göppingen Lörrach
  Völklingen Plön Bünde Dülmen Lünen Grünwald Weißenfels Gießen Neuötting Altötting Wülfrath
  Zülpich Würselen Rüsselsheim Königsbrunn Mühlheim Füssen Kühlungsborn Tönning Nördlingen
  Höxter Bürstadt Pößneck Sömmerda Gröbenzell Glücksburg Lüdinghausen
`.split(/\s+/).filter(Boolean);

const fold = (s: string) => s.toLowerCase();
const dropUmlauts = (s: string) => fold(s).replace(/[äöüß]/g, '');
const spellUmlauts = (s: string) =>
  fold(s).replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
const TOWN_BY_FORM = new Map<string, string>();
for (const t of TOWNS) {
  TOWN_BY_FORM.set(dropUmlauts(t), t);
  TOWN_BY_FORM.set(spellUmlauts(t), t);
}

/** "KOELN" / "Kln" → "Köln"; any other town re-cased only when it arrived in capitals. */
function townName(raw: string): string {
  return raw
    .split('-')
    .map((part) => {
      const known = TOWN_BY_FORM.get(fold(part));
      if (known) return known;
      return part === part.toUpperCase() && part.length > 2 ? part[0] + part.slice(1).toLowerCase() : part;
    })
    .join('-');
}

// A slot that holds something other than a place: a phone number (online
// shops put their hotline there) or a web address.
const NOT_A_PLACE = /\d{3,}|www\.|\.(?:com|de|net|org|eu|io)\b|https?:/i;

/** The shop's name from a descriptor's first slot. */
function shopName(raw: string): string {
  let s = raw.trim().replace(/[.\s]+$/, '');
  // "WL *Steam Purchase" (arriving as "WL .Steam Purchase"), "SQ *Coffee".
  let m = /^([A-Za-z0-9]{2,6})\s*[*.]\s*(.+)$/.exec(s);
  if (m && PROVIDER_PREFIX.has(m[1].toUpperCase())) s = m[2];
  // "DHL*4158584457": a reference behind the shop, not part of it.
  else if (m && /\d{4}/.test(m[2]) && /^[A-Za-z0-9-]+$/.test(m[2])) s = m[1];
  // "SP the Ridge EU", "LS Caf Nova": the provider code without a separator.
  m = /^([A-Z]{2,6})\s+(.{3,})$/.exec(s);
  if (m && SPACED_PREFIX.has(m[1])) s = m[2];
  // "Amazon Mktp DE*2X3Y4Z": a trailing order reference.
  s = s.replace(/\s*[*.]\s*(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{5,}$/, '');
  // The accent the scheme's character set dropped, where the word is certain.
  s = s.replace(/\bCaf\b/g, 'Café').replace(/\bCAF\b/g, 'CAFÉ');
  // A name that starts lower case ("the Ridge") is a cut-off sentence start.
  return s.replace(/^\p{Ll}/u, (c) => c.toUpperCase()).trim();
}

/**
 * The parts of a card terminal's merchant descriptor, or null when a name is
 * not one — an ordinary name is never touched.
 */
export function parseCardAcceptor(raw: string | null | undefined): CardAcceptor | null {
  const s = String(raw ?? '').trim();
  if (!s.includes('/')) return null;

  let name: string;
  let street = '';
  let tail: string[];
  const empty = s.indexOf('//');
  if (empty > 0) {
    // "Shop//Town/CC/n": no street. Everything up to the country is the town
    // slot — online shops put a web address there, slashes and all.
    name = s.slice(0, empty);
    tail = s.slice(empty + 2).split('/');
  } else {
    // "Shop/Street/Town/CC": one slot each.
    const parts = s.split('/');
    if (parts.length < 3) return null;
    name = parts.shift() ?? '';
    tail = parts;
  }
  if (tail.length > 1 && /^\d$/.test(tail[tail.length - 1])) tail.pop(); // the trailing indicator
  const cc = tail.pop() ?? '';
  if (!/^[A-Za-z]{2,3}$/.test(cc)) return null;
  const country = cc.length === 3 ? ALPHA3[cc.toUpperCase()] ?? null : cc.toUpperCase();
  if (empty <= 0) {
    // "Shop/Town/CC" or "Shop/Street/Town/CC" — anything longer is not a descriptor.
    if (tail.length === 2) street = (tail.shift() ?? '').trim();
    else if (tail.length !== 1) return null;
  }
  const citySlot = tail.join('/').trim();
  const merchant = shopName(name);
  if (!merchant) return null;
  return {
    merchant,
    street: street || null,
    city: citySlot && !NOT_A_PLACE.test(citySlot) ? townName(citySlot) : null,
    country,
  };
}

/** A counterparty name with a merchant descriptor reduced to the shop; any other name unchanged. */
export function cleanMerchantName(raw: string | null | undefined): string {
  const s = String(raw ?? '').trim();
  return parseCardAcceptor(s)?.merchant ?? s;
}
