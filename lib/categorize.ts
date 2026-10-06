// Which category a booking belongs to, and how that was decided.
//
// The decision is a ladder, strongest evidence first:
//
//   1. the user filed this very booking            (manual — txKey)
//   2. the user filed this counterparty            (rule — counterpartyKey)
//   3. the other side is one of the user's own accounts   → Umbuchung
//   4. the bank's own booking code says what it is (salary, cash, fees)
//   5. the counterparty's name, the resolved merchant and the remittance
//      text match a known German company or a telling word
//   6. nothing matched: a credit is "Sonstige Eingänge", a debit "Sonstiges"
//
// Everything from rung 3 down is a guess, and is labelled as one (source
// 'auto') so the UI can say "automatisch erkannt" rather than pass it off as
// fact. A wrong category is cheap to fix — one tap, or one rule for every
// booking with that counterparty — so rung 5 errs towards recognising things,
// but never at the price of filing a private person as a shop: short or
// ambiguous brand words only count in the counterparty's name, some only on
// card payments and direct debits, where the other side cannot be a person.
//
// Pure and node-test-safe: no path aliases, and runtime imports of sibling
// modules carry their .ts extension.

import type { SerializedTransaction } from './fints-types';
import type { CategoryId, CategoryResult } from './categories';
import { categoryDef, counterpartyKey, counterpartyName, isCategoryId, txCreditorId, txKey } from './categories.ts';
import { isCardPurpose, stripCardBoilerplate } from './card-purpose.ts';
import { isFacilitatorName } from './merchant-match.ts';
import { parsePurpose } from './sepa-purpose.ts';

export type { CategoryResult };

export type CategorizeContext = {
  /** The session's own account IBANs. Normalised or not — both are accepted. */
  ownIbans: ReadonlySet<string> | readonly string[];
  /** counterpartyKey() → category: the user's "always file X under Y". */
  rules?: Record<string, CategoryId> | null;
  /** txKey() → category: the user's choice for one booking. */
  overrides?: Record<string, CategoryId> | null;
  /** The company the logo lookup resolved this counterparty to, if any. */
  merchantLabel?: string | null;
  /**
   * counterpartyKey() → the on-device model's guess (lib/category-model.ts),
   * for the outgoing bookings no keyword matched.
   */
  modelGuesses?: Readonly<Record<string, CategoryId>> | null;
};

// ---------------------------------------------------------------------------
// Text folding
// ---------------------------------------------------------------------------

/**
 * Text reduced to what matching needs: uppercase, umlauts spelled out the way
 * MT940 already spells them (Ä → AE), accents dropped, every run of anything
 * else a single space. "Müller-Lüdenscheidt" and "MUELLER LUEDENSCHEIDT" fold
 * to the same string, which is the point.
 */
export function foldText(input: string | null | undefined): string {
  return String(input ?? '')
    .toUpperCase()
    .replace(/Ä/g, 'AE')
    .replace(/Ö/g, 'OE')
    .replace(/Ü/g, 'UE')
    .replace(/ẞ/g, 'SS')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

const normIban = (s: string | null | undefined) => String(s ?? '').replace(/\s+/g, '').toUpperCase();

/** Whether the counterparty IBAN is one of the user's own accounts. */
export function isOwnAccount(
  remoteIban: string | null | undefined,
  ownIbans: ReadonlySet<string> | readonly string[] | null | undefined,
): boolean {
  const iban = normIban(remoteIban);
  if (!iban || !ownIbans) return false;
  if (ownIbans instanceof Set && ownIbans.has(iban)) return true;
  for (const own of ownIbans) if (normIban(own) === iban) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Booking kind — what sort of booking this is, in words
// ---------------------------------------------------------------------------

export type BookingKind =
  | 'lastschrift'
  | 'karte'
  | 'gutschrift'
  | 'ueberweisung'
  | 'echtzeit'
  | 'dauerauftrag'
  | 'bargeld'
  | 'entgelt'
  | 'zinsen'
  | 'ruecklastschrift'
  | 'gehalt'
  | 'sonstige';

const KIND_LABELS: Record<BookingKind, string> = {
  lastschrift: 'Lastschrift',
  karte: 'Kartenzahlung',
  gutschrift: 'Gutschrift',
  ueberweisung: 'Überweisung',
  echtzeit: 'Echtzeitüberweisung',
  dauerauftrag: 'Dauerauftrag',
  bargeld: 'Bargeld',
  entgelt: 'Entgelt',
  zinsen: 'Zinsen',
  ruecklastschrift: 'Rücklastschrift',
  gehalt: 'Gehalt/Rente',
  sonstige: 'Buchung',
};

/** The words for a booking kind, as a tag shows them. */
export const bookingKindLabel = (kind: BookingKind): string => KIND_LABELS[kind] ?? KIND_LABELS.sonstige;

// MT940 carries the Geschäftsvorfallcode (GVC) of the DK standard — three
// digits at the head of :86:. Only codes whose meaning does not depend on the
// bank are listed; anything else falls through to the booking text, which is
// the bank's own label for the same thing.
const GVC_KIND: Record<string, BookingKind> = {
  // Lastschriften (004/005 pre-SEPA, 104 B2B, 105 SEPA-Basislastschrift)
  '004': 'lastschrift', '005': 'lastschrift', '104': 'lastschrift', '105': 'lastschrift',
  // Card clearing and the direct debit a card terminal generates
  '106': 'karte', '107': 'karte',
  '008': 'dauerauftrag', '117': 'dauerauftrag',
  '020': 'ueberweisung', '116': 'ueberweisung', '119': 'ueberweisung', '191': 'ueberweisung',
  '051': 'gutschrift', '052': 'gutschrift', '054': 'gutschrift', '056': 'gutschrift', '058': 'gutschrift',
  '059': 'gutschrift', '070': 'gutschrift', '071': 'gutschrift', '152': 'gutschrift', '154': 'gutschrift',
  '155': 'gutschrift', '156': 'gutschrift', '159': 'gutschrift', '166': 'gutschrift', '167': 'gutschrift',
  '169': 'gutschrift', '171': 'gutschrift', '174': 'gutschrift', '192': 'gutschrift',
  // Lohn-, Gehalts-, Rentengutschrift
  '053': 'gehalt', '153': 'gehalt',
  // Bareinzahlung / Barauszahlung
  '082': 'bargeld', '083': 'bargeld',
  // Abschluss, Entgelte, Gebühren
  '805': 'entgelt', '806': 'entgelt', '807': 'entgelt', '808': 'entgelt', '809': 'entgelt', '810': 'entgelt',
};

/**
 * CAMT carries an ISO 20022 bank transaction code instead; lib-fints hands
 * over its sub-family. Several are only meaningful together with the sign:
 * ESCT is an Überweisung going out and a Gutschrift coming in.
 */
function isoKind(code: string, credit: boolean): BookingKind | null {
  switch (code) {
    case 'ESDD': case 'BBDD': case 'PMDD': case 'OODD': case 'PADD': case 'XBDD':
      return credit ? 'gutschrift' : 'lastschrift';
    case 'UPDD': case 'RCDD': case 'PRDD':
      return 'ruecklastschrift';
    case 'POSD': case 'POSC': case 'SMRT': case 'CCRD': case 'DCRD':
      return 'karte';
    case 'CWDL': case 'XBCW': case 'CDPT':
      return 'bargeld';
    case 'SALA': case 'PENS':
      return credit ? 'gehalt' : 'ueberweisung';
    case 'STDO':
      return credit ? 'gutschrift' : 'dauerauftrag';
    case 'ESCT': case 'DMCT': case 'XBCT': case 'BOOK': case 'AUTT': case 'SDVA':
      return credit ? 'gutschrift' : 'ueberweisung';
    case 'RRTN': case 'RPCR':
      return credit ? 'gutschrift' : null;
    case 'FEES': case 'CHRG': case 'COMM': case 'COMT':
      return 'entgelt';
    case 'INTR':
      return 'zinsen';
    default:
      return null;
  }
}

/** The GVC and/or ISO sub-family a transaction code carries. */
function bookingCodes(raw: string | null | undefined): { gvc: string | null; iso: string | null } {
  const s = String(raw ?? '').trim().toUpperCase();
  if (/^\d{3}$/.test(s)) return { gvc: s, iso: null };
  let gvc: string | null = null;
  let iso: string | null = null;
  // "PMNT-RCDT-ESCT" or a DK proprietary "NTRF+166+…": take what is recognisable.
  for (const part of s.split(/[^A-Z0-9]+/)) {
    if (!gvc && /^\d{3}$/.test(part)) gvc = part;
    else if (/^[A-Z]{4}$/.test(part)) iso = part;
  }
  return { gvc, iso };
}

const has = (text: string, ...needles: string[]) => needles.some((n) => text.includes(n));

/**
 * What sort of booking this is — Lastschrift, Kartenzahlung, Gutschrift … —
 * for the status tags and for the logic that must treat, say, a direct debit
 * differently from a transfer.
 *
 * MT940 and CAMT describe the same thing differently (a three-digit GVC vs an
 * ISO sub-family code), and both carry the bank's own booking text. A specific
 * word in that text wins outright — when the bank itself writes
 * "Echtzeitüberweisung" or "Rücklastschrift", that is what it is. Then the
 * codes, then the generic words ("Überweisung", "Gutschrift"), then the sign.
 */
export function bookingKind(
  tx: Pick<SerializedTransaction, 'transactionCode' | 'bookingText' | 'amount'> & { purpose?: string | null },
): BookingKind {
  const credit = Number(tx.amount) > 0;
  const text = foldText(tx.bookingText);

  if (text) {
    if (has(text, 'RUECKLASTSCHRIFT', 'LASTSCHRIFTRUECKGABE', 'RUECKBELASTUNG', 'LASTSCHRIFT RUECKGABE', 'RUECKGABE LASTSCHRIFT')) {
      return 'ruecklastschrift';
    }
    if (has(text, 'ECHTZEIT', 'INSTANT')) return 'echtzeit';
    if (has(text, 'DAUERAUFTRAG')) return credit ? 'gutschrift' : 'dauerauftrag';
    if (credit && /(^| )(LOHN|GEHALT|RENTE|BEZUEGE|BESOLDUNG|PENSION)/.test(text)) return 'gehalt';
    if (/KARTENZAHLUNG|KARTENUMSATZ|KARTENVERFUEGUNG|GIROCARD|DEBITK|MAESTRO|VPAY|V PAY|APPLE PAY|GOOGLE PAY|(^| )KARTE( |$)|(^| )POS( |$)/.test(text)) {
      return 'karte';
    }
    if (has(text, 'BARGELD', 'GELDAUTOMAT', 'BARAUSZAHLUNG', 'BAREINZAHLUNG', 'AUSZAHLUNG GA')) return 'bargeld';
    // Word-initial only: "Finanzinstitut" has "ZINS" in it too.
    if (/(^| )(SOLL|HABEN|DISPO|UEBERZIEHUNGS|KREDIT|GUTHABEN)?ZINS/.test(text)) return 'zinsen';
    if (has(text, 'ENTGELT', 'GEBUEHR', 'KONTOFUEHRUNG') || /(^| )(ABSCHLUSS|PROVISION|SPESEN)( |$)/.test(text)) {
      // A credit "Abschluss" is the quarter's interest, not a fee.
      return credit && /(^| )ABSCHLUSS( |$)/.test(text) ? 'zinsen' : 'entgelt';
    }
  }

  // A Visa/Mastercard debit payment can arrive with a booking text and code
  // that say nothing about a card (Sparkassen route them through their card
  // processor, Landesbank Hessen-Thüringen); the purpose is the card system's
  // own record ("Debitk.0 2030-12 … Zahl.System VISA Debit") and says so.
  // After the booking text, so a fee the bank books on its own ("Entgelt") is
  // still a fee even when its purpose names the card.
  if (isCardPurpose(tx.purpose)) return 'karte';

  const { gvc, iso } = bookingCodes(tx.transactionCode);
  if (gvc) {
    const k = GVC_KIND[gvc];
    // A code that only exists on the credit side cannot describe a debit.
    if (k && !(k === 'gutschrift' && !credit) && !(k === 'gehalt' && !credit)) {
      return k === 'entgelt' && credit && gvc === '805' ? 'zinsen' : k;
    }
  }
  if (iso) {
    const k = isoKind(iso, credit);
    if (k) return k;
  }

  if (text) {
    if (has(text, 'LASTSCHRIFT')) return credit ? 'gutschrift' : 'lastschrift';
    if (has(text, 'UEBERWEISUNG', 'UEBERW', 'UEBERTRAG', 'UMBUCHUNG', 'AUFTRAG')) return credit ? 'gutschrift' : 'ueberweisung';
    if (has(text, 'GUTSCHRIFT', 'GUTSCHR')) return 'gutschrift';
  }
  return credit ? 'gutschrift' : 'sonstige';
}

/**
 * Whether the account's own bank made this booking — the Abschluss, a fee,
 * interest: booked as one, with no account on the other side. A fee or
 * interest that came from elsewhere (a provider's direct debit, another
 * bank's interest transferred in) carries that account's IBAN and is not.
 */
export function isBankOwnBooking(
  tx: Pick<SerializedTransaction, 'transactionCode' | 'bookingText' | 'amount' | 'remoteIban'> & { purpose?: string | null },
): boolean {
  const kind = bookingKind(tx);
  return (kind === 'entgelt' || kind === 'zinsen') && !String(tx.remoteIban ?? '').trim();
}

// ---------------------------------------------------------------------------
// Keyword dictionaries
//
// Each entry is a word or phrase as it appears in German statements, matched
// on folded text at word boundaries ("REWE" matches "REWE SAGT DANKE", not
// "BREWERY"). Markers, in front:
//   @  only in the counterparty name or the resolved merchant, never in the
//      free remittance text — for words that also occur in ordinary prose
//   ^  at the very start of the name (implies @) — for card terminals that
//      lead with the brand ("JET 1234 BERLIN")
//   !  only on a card payment or direct debit, where the other side is a
//      business by construction — for brands that are also surnames
//   ~  never on a card payment
//   ?  weak: wins only when nothing else matched (payment wrappers)
// and `*` at either end lets the word continue (German compounds:
// "*MIETE" covers KALTMIETE and WARMMIETE).
//
// When several entries match, the longest wins, with a small bonus for the
// stronger source (merchant > name > remittance text): "AMAZON PRIME" in the
// text beats "AMAZON" in the name, "UBER EATS" beats "UBER".
// ---------------------------------------------------------------------------

const KEYWORDS: readonly (readonly [CategoryId, readonly string[]])[] = [
  ['income', [
    'LOHN*', 'GEHALT*', '*GEHALT', '*BEZUEGE', 'BEZUEGE*', 'RENTE*', 'DRV', 'DRV BUND', 'DEUTSCHE RENTENVERSICHERUNG',
    'RENTENVERSICHERUNG', 'BUNDESAGENTUR*', 'AGENTUR FUER ARBEIT', 'JOBCENTER', 'KINDERGELD', 'FAMILIENKASSE',
    'ELTERNGELD', 'BAFOEG', 'PENSION*', 'BESOLDUNG', 'ARBEITSENTGELT', 'KRANKENGELD', 'ARBEITSLOSENGELD',
    'WOHNGELD', 'MUTTERSCHAFTSGELD', 'SALARY', 'PAYROLL', 'VERGUETUNG',
  ]],
  ['housing', [
    'STADTWERKE*', '@EON', '@E ON', 'VATTENFALL', 'ENBW', '@RWE', '*MIETE', 'MIETZAHLUNG', 'MIETZINS',
    'HAUSVERWALTUNG*', 'WOHNUNGSBAU*', 'NEBENKOSTEN*', 'WOHNUNGSGENOSSENSCHAFT', 'BAUGENOSSENSCHAFT',
    'WOHNUNGSUNTERNEHMEN', 'VONOVIA', 'DEUTSCHE WOHNEN', 'LEG IMMOBILIEN', 'VIVAWEST', 'GEWOBAG', 'HOWOGE',
    'DEGEWO', 'HAUSGELD', 'STROM', '*STROM', 'STROMABSCHLAG', 'STROMKOSTEN', 'STROMRECHNUNG', 'ERDGAS', '@GAS',
    'GASAG', 'ABSCHLAG*', 'WASSERVERSORGUNG', 'WASSERWERK*', 'WASSERGELD', 'ABWASSER*', 'FERNWAERME',
    'HEIZKOSTEN*', 'ISTA', 'TECHEM', 'MINOL', 'BRUNATA',
    'ENERGIEVERSORGUNG', 'MAINOVA', 'N ERGIE', 'LICHTBLICK', 'TIBBER', 'OSTROM', 'OCTOPUS ENERGY',
    'NATURSTROM', 'YELLO', 'EPRIMO', 'MVV ENERGIE', 'RHEINENERGIE', 'EWE AG', 'SWM', 'ENTEGA', 'ENERCITY',
  ]],
  ['groceries', [
    'REWE', 'EDEKA', 'ALDI', 'LIDL', '^NETTO', 'NETTO MARKEN DISCOUNT', '^PENNY', 'PENNY MARKT', 'KAUFLAND',
    '^DM', 'DM DROGERIE*', 'ROSSMANN', 'MUELLER DROGERIE', 'DROGERIE MUELLER', 'MUELLER HANDELS', '!^MUELLER',
    '!^NORMA', 'TEGUT', 'GLOBUS', 'MARKTKAUF', 'FAMILA', 'NAH UND GUT', 'DENNS', 'ALNATURA', 'BIO COMPANY',
    'BUDNI*', 'PICNIC', '@FLINK', 'KNUSPR', '*BAECKEREI', 'BAECKEREI*', '!BAECKER', 'BACKSTUBE*', '*BACKSTUBE',
    '*METZGEREI', 'METZGEREI*',
    'WOCHENMARKT', '*SUPERMARKT', 'SUPERMARKT*', 'LEBENSMITTEL*', 'GETRAENKEMARKT', 'GETRAENKE*',
    'DROGERIE*',
  ]],
  ['mobility', [
    'ARAL', '@SHELL', '@ESSO', '^TOTAL', 'TOTALENERGIES', '^JET', '@DB', 'DEUTSCHE BAHN', 'DB VERTRIEB',
    'DB FERNVERKEHR', 'BAHN*', 'BVG', 'MVV', 'MVG', 'HVV', 'HOCHBAHN', 'RMV', 'VRR', 'VBB', 'VVS', 'KVB',
    'RHEINBAHN', 'UESTRA', 'FLIXBUS', 'FLIXTRAIN', '^FLIX', '^TIER', '^LIME', 'NEUTRON HOLDINGS', '@UBER',
    '@SIXT', 'ADAC', '*TANKSTELLE*', 'AGIP', 'AVIA', '@HEM', '@OMV', 'PARKHAUS*', '*PARKHAUS', 'PARKGEBUEHR*',
    'PARKEN', 'EASYPARK', 'PAYBYPHONE', 'PARKSTER', 'SHARE NOW', 'MILES MOBILITY', '@BOLT', 'FREE NOW',
    'LUFTHANSA', 'EUROWINGS', 'RYANAIR', 'EASYJET', 'CONDOR', 'FLUGHAFEN*', 'DEUTSCHLANDTICKET',
    'DEUTSCHLAND TICKET', 'BAHNTICKET', 'FAHRKARTE*', 'MONATSKARTE', '@TUEV', 'DEKRA', 'AUTOWERKSTATT',
    'KFZ WERKSTATT', 'WASCHSTRASSE', 'AUTOWASCH*',
  ]],
  ['media', [
    'NETFLIX', 'SPOTIFY', 'DISNEY*', 'AMAZON PRIME', 'PRIME VIDEO', 'AMAZON DIGITAL', 'APPLE COM BILL',
    'APPLE SERVICES', 'ITUNES', '@GOOGLE', 'YOUTUBE', 'DAZN', '@SKY', 'SKY DEUTSCHLAND', 'AUDIBLE',
    'TELEKOM*', 'DEUTSCHE TELEKOM', 'VODAFONE', '@O2', 'TELEFONICA', '@1 1', '1 1 TELECOM', 'CONGSTAR',
    'KABEL DEUTSCHLAND', 'PYUR', 'FREENET', 'MOBILCOM', 'KLARMOBIL', 'ALDI TALK', 'LIDL CONNECT', 'WINSIM',
    'SIMYO', '@BLAU', '@FRAENK', 'NETCOLOGNE', 'M NET', 'WAIPU', 'JOYN', '@RTL', 'PARAMOUNT', 'CRUNCHYROLL',
    'DEEZER', '@TIDAL', 'MICROSOFT', 'ADOBE', 'DROPBOX', 'OPENAI', 'CHATGPT', 'PATREON', 'EWE TEL',
    // Web hosting, servers and domains.
    '@HETZNER', '@IONOS', '@STRATO', '@NETCUP', 'ALL INKL', '@HOSTINGER', 'DIGITALOCEAN', 'HOST EUROPE',
    'DOMAINFACTORY', '@GITHUB',
  ]],
  ['insurance', [
    'ALLIANZ', 'HUK', 'HUK24', 'HUK COBURG', 'AXA', '@ERGO', 'DEVK', 'GENERALI', '@R V', 'DEBEKA', 'HANSEMERKUR',
    '@TECHNIKER', 'TECHNIKER KRANKENKASSE', '@TK', 'AOK', 'BARMER', 'DAK', 'DAK GESUNDHEIT', 'IKK*', 'BKK*',
    '*KRANKENKASSE*', '*VERSICHERUNG*', 'HAFTPFLICHT*', 'HAUSRAT*', 'VHV', 'CONTINENTALE', 'SIGNAL IDUNA',
    'GOTHAER', 'WUERTTEMBERGISCHE', 'ZURICH', 'LVM', 'PROVINZIAL', 'BARMENIA', 'NUERNBERGER', 'COSMOSDIREKT',
    'HANNOVERSCHE', 'ARAG', 'ROLAND RECHTSSCHUTZ', 'MECKLENBURGISCHE', 'SPARKASSENVERSICHERUNG',
  ]],
  ['taxes', [
    'FINANZAMT', 'RUNDFUNK*', 'ARD ZDF', 'BEITRAGSSERVICE', 'KFZ STEUER', 'KRAFTFAHRZEUGSTEUER', 'BUNDESKASSE',
    'STADTKASSE', 'GEZ', '*STEUER', 'GEMEINDEKASSE', 'KREISKASSE', 'AMTSKASSE', 'LANDESHAUPTKASSE',
    'LANDESOBERKASSE', 'HAUPTZOLLAMT', 'STADTVERWALTUNG', 'BUSSGELD*', 'VERWARNUNGSGELD', 'GERICHTSKASSE',
  ]],
  ['health', [
    '*APOTHEKE', 'APOTHEKE*', 'DOCMORRIS', '*ARZT', 'ZAHNARZT*', '*PRAXIS', 'PRAXIS*', '*KLINIK*',
    'KRANKENHAUS', 'FIELMANN', 'APOLLO OPTIK', '*OPTIK', 'PHYSIO*', '*THERAPIE', 'HEILPRAKTIKER', 'DR MED',
    '@MVZ', 'HOERGERAETE*', 'ZAHNKLINIK', 'LABORARZT*', 'SANITAETSHAUS',
  ]],
  ['savings', [
    '~DEPOT', '*SPARPLAN*', 'TRADE REPUBLIC', 'SCALABLE*', 'COMDIRECT SPARPLAN', 'BAUSPAR*', 'SCHWAEBISCH HALL',
    'WUESTENROT', '@LBS', 'WERTPAPIER*', 'ETF', 'SMARTBROKER', 'FLATEX', 'UNION INVESTMENT', 'DEKA*', '@DWS',
    'BITPANDA', 'COINBASE', 'TAGESGELD*', 'FESTGELD*', 'SPARKONTO', 'SPARBUCH', 'SPARRATE', 'SPAREN',
    'VERMOEGENSWIRKSAME*', 'FONDSSPARPLAN', 'ALTERSVORSORGE', 'RIESTER*',
  ]],
  ['shopping', [
    'AMAZON', '@AMZN', 'ZALANDO', 'OTTO GMBH', 'OTTO VERSAND', 'OTTO DE', 'EBAY', 'IKEA', 'MEDIAMARKT',
    'MEDIA MARKT', '@SATURN', '@H M', '!@ZARA', 'DECATHLON', '?PAYPAL', '?KLARNA', 'ABOUT YOU', 'TEMU', 'SHEIN',
    'ALIEXPRESS', 'GALERIA', 'PRIMARK', '@C A', 'TK MAXX', 'DOUGLAS', 'THALIA', 'HUGENDUBEL', '@OBI',
    'BAUHAUS', 'HORNBACH', 'TOOM', 'HAGEBAU', '@TEDI', '@KIK', 'NKD', 'DEICHMANN', 'APPLE STORE',
    'CYBERPORT', 'NOTEBOOKSBILLIGER', 'CONRAD ELECTRONIC', '@POCO', 'XXXLUTZ', '*MOEBEL', 'MOEBEL*', '@ACTION',
    'TCHIBO', 'INTERSPORT', 'SPORTSCHECK', 'SNIPES', 'BREUNINGER', 'ETSY', 'VINTED', 'KLEINANZEIGEN',
    'BESTSECRET', 'JYSK', 'DEPOT GRIES', 'GRIES DECO',
  ]],
  ['leisure', [
    'LIEFERANDO', 'MCDONALDS', 'MC DONALDS', 'MCDONALD S', 'MC DONALD S', 'BURGER KING', 'STARBUCKS',
    '*RESTAURANT*', 'CAFE', '*CAFE', 'KINO*', '*KINO', 'EVENTIM', 'STEAM*', 'VALVE', 'PLAYSTATION',
    'SONY INTERACTIVE', 'NINTENDO', 'XBOX', 'EPIC GAMES', 'BLIZZARD', 'UBER EATS', '@WOLT', 'DOMINOS',
    'PIZZA*', '*PIZZA', 'PIZZERIA', 'KFC', '@SUBWAY', 'VAPIANO', 'NORDSEE', 'BACKWERK', 'BISTRO*',
    'GASTSTAETTE', 'BIERGARTEN', 'IMBISS', '*DOENER', 'DOENER*', 'SUSHI*', 'TICKETMASTER', 'CINEMAXX',
    'CINESTAR', 'KINOWELT', 'FITNESS*', '*FITNESS', 'MCFIT', 'FITX', 'URBAN SPORTS', 'CLEVER FIT', 'JOHN REED',
    'HOTEL*', 'BOOKING COM', 'AIRBNB', 'MUSEUM', '*THEATER', 'EXPEDIA', '@TUI', 'SCHWIMMBAD', 'FREIZEITPARK',
  ]],
  ['cash', ['GELDAUTOMAT', 'BARGELD*', 'BARAUSZAHLUNG', 'BAREINZAHLUNG', '@ATM']],
  ['fees', [
    'ENTGELT*', '*ENTGELT', 'ABSCHLUSS', '*ZINSEN', 'ZINSEN*', 'KONTOFUEHRUNG*', 'KONTOFUHRUNG*', 'KARTENGEBUEHR',
    'JAHRESGEBUEHR', 'KONTOPAKET',
  ]],
];

type Entry = {
  cat: CategoryId;
  /** Literal characters matched — the length that ranks competing matches. */
  len: number;
  /** A plain single word: a token-set lookup is enough. */
  word: string | null;
  /** The literal core; a cheap substring test before the regex runs. */
  needle: string;
  re: RegExp | null;
  nameOnly: boolean;
  business: boolean;
  notCard: boolean;
  weak: boolean;
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function compile(cat: CategoryId, spec: string): Entry {
  let s = spec;
  let nameOnly = false;
  let start = false;
  let business = false;
  let notCard = false;
  let weak = false;
  for (;;) {
    const f = s[0];
    if (f === '@') nameOnly = true;
    else if (f === '^') start = nameOnly = true;
    else if (f === '!') business = true;
    else if (f === '~') notCard = true;
    else if (f === '?') weak = true;
    else break;
    s = s.slice(1);
  }
  const lead = s.startsWith('*');
  const trail = s.endsWith('*');
  const core = foldText(s.replace(/^\*|\*$/g, ''));
  const plain = !lead && !trail && !start && !core.includes(' ');
  const body = `${lead ? '[A-Z0-9]*' : ''}${escapeRe(core)}${trail ? '[A-Z0-9]*' : ''}`;
  return {
    cat,
    len: core.length,
    word: plain ? core : null,
    needle: core,
    re: plain ? null : new RegExp(`${start ? '^' : '(?:^| )'}${body}(?= |$)`),
    nameOnly,
    business,
    notCard,
    weak,
  };
}

const ENTRIES: readonly Entry[] = KEYWORDS.flatMap(([cat, specs]) => specs.map((s) => compile(cat, s)));

type Source = { text: string; words: Set<string>; bonus: number; prose: boolean };

const source = (raw: string | null | undefined, bonus: number, prose: boolean): Source | null => {
  const text = foldText(raw);
  return text ? { text, words: new Set(text.split(' ')), bonus, prose } : null;
};

/**
 * The category the dictionaries suggest for a booking, or null.
 *
 * A credit only takes an expense category from the counterparty itself (a
 * refund from the shop); the remittance text of a credit — "Miete Oktober"
 * from a tenant — says nothing about the user's own spending. Income words in
 * turn only count on credits: "Gehalt" in a transfer to a nanny is not income.
 */
export function keywordCategory(
  tx: Pick<SerializedTransaction, 'amount' | 'remoteName' | 'purpose' | 'bookingText' | 'transactionCode'> & { ultimateName?: string },
  merchantLabel?: string | null,
  kind: BookingKind = bookingKind(tx),
): CategoryId | null {
  const credit = Number(tx.amount) > 0;
  const sources = [
    source(merchantLabel, 6, false),
    // The shop behind a card processor, not the processor (see counterpartyName).
    source(counterpartyName(tx), 3, false),
    // A card record says how it was paid, not what was bought — and its
    // "Einsatzentgelt" would read as a bank fee. Only what it leaves counts.
    source(stripCardBoilerplate(parsePurpose(tx.purpose).text), 0, true),
  ].filter((s): s is Source => s !== null);
  if (!sources.length) return null;

  const businessBooking = kind === 'karte' || kind === 'lastschrift';
  let best: CategoryId | null = null;
  let bestScore = -Infinity;

  for (const e of ENTRIES) {
    if (e.business && !businessBooking) continue;
    if (e.notCard && kind === 'karte') continue;
    const dir = categoryDef(e.cat).direction;
    if (dir === 'in' && !credit) continue;
    for (const src of sources) {
      if (src.prose && (e.nameOnly || (credit && dir === 'out'))) continue;
      const hit = e.word !== null ? src.words.has(e.word) : src.text.includes(e.needle) && e.re!.test(src.text);
      if (!hit) continue;
      const score = (e.weak ? -100 : e.len) + src.bonus;
      if (score > bestScore) {
        bestScore = score;
        best = e.cat;
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// The ladder
// ---------------------------------------------------------------------------

/**
 * The automatic guess alone — rungs 3 to 6, without the user's rules. Used
 * where a user decision must not leak in, such as telling a grocery card
 * payment from a subscription in the recurring-payment detection.
 */
export function guessCategory(
  tx: SerializedTransaction,
  ctx: Pick<CategorizeContext, 'merchantLabel' | 'modelGuesses'> & { ownIbans?: ReadonlySet<string> | readonly string[] | null } = {},
): CategoryId {
  if (isOwnAccount(tx.remoteIban, ctx.ownIbans)) return 'transfer';

  const credit = Number(tx.amount) > 0;
  const kind = bookingKind(tx);
  if (kind === 'bargeld') return 'cash';
  if (kind === 'entgelt' || kind === 'zinsen') return 'fees';
  if (kind === 'gehalt' && credit) return 'income';
  // "Umbuchung" is the banks' own word for moving money between one
  // customer's accounts — an own account this session just doesn't list.
  if (/(^| )UMBUCHUNG/.test(foldText(tx.bookingText))) return 'transfer';

  const keyword = keywordCategory(tx, ctx.merchantLabel, kind);
  if (keyword) return keyword;
  // What the keywords missed, the on-device model may know — money going out
  // only (see lib/category-model.ts), and only a spending category.
  if (!credit && ctx.modelGuesses) {
    const guess = ctx.modelGuesses[counterpartyKey(tx)];
    if (isCategoryId(guess) && categoryDef(guess).direction === 'out') return guess;
  }
  return credit ? 'otherIn' : 'other';
}

// A credit that is itself a refund or a reversal, in the payer's words. In
// the bank's booking text "Gutschrift" is only the word for money coming in,
// so there it does not count.
const REFUND_PURPOSE = /(^| )((RUECK)?ERSTATTUNG|RUECKSENDUNG|RETOURE|GUTSCHRIFT|REFUND|STORNO)/;
const REFUND_BOOKING_TEXT = /(^| )((RUECK)?ERSTATTUNG|RUECKSENDUNG|RETOURE|REFUND|STORNO)/;

/**
 * Whether a credit came from a business rather than a person: a refund or a
 * reversal, money from a creditor (it carries a Gläubiger-ID) or through a
 * payment service, or a credit filed under a spending category or as an
 * Umbuchung (`category`, as the user sees it). Nobody sends such money back,
 * so "Zurücküberweisen" is never offered for it.
 */
export function isBusinessCredit(
  tx: Pick<SerializedTransaction, 'amount' | 'purpose' | 'bookingText' | 'remoteName'> & {
    ultimateName?: string; remoteBic?: string; creditorId?: string;
  },
  category?: CategoryId | null,
): boolean {
  if (category) {
    const def = categoryDef(category);
    if (def.direction === 'out' || def.neutral) return true;
  }
  if (txCreditorId(tx)) return true;
  if (isFacilitatorName(counterpartyName(tx))) return true;
  return REFUND_PURPOSE.test(foldText(parsePurpose(tx.purpose).text)) || REFUND_BOOKING_TEXT.test(foldText(tx.bookingText));
}

/** A booking's category: the user's choice if there is one, else a labelled guess. */
export function categorize(tx: SerializedTransaction, ctx: CategorizeContext): CategoryResult {
  if (ctx.overrides) {
    const manual = ctx.overrides[txKey(tx)];
    if (isCategoryId(manual)) return { id: manual, source: 'manual' };
  }
  if (ctx.rules) {
    const ruled = ctx.rules[counterpartyKey(tx)];
    if (isCategoryId(ruled)) return { id: ruled, source: 'rule' };
  }
  return { id: guessCategory(tx, ctx), source: 'auto' };
}
