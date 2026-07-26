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
]);

// Words whose presence marks a name as a business rather than a person. Paired
// with the legal-form and ALL-CAPS tests below, this is what keeps private
// counterparties off the wire.
const CORPORATE_WORDS = new Set([
  ...QUALIFIERS,
  'bank', 'versicherung', 'energie', 'stadtwerke', 'verlag', 'apotheke',
  'hotel', 'restaurant', 'reisen', 'logistik', 'transport', 'media', 'telekom',
  'mobil', 'mobility', 'shop', 'market', 'marketplace', 'mktp', 'ecommerce',
]);

/**
 * Strip the bank's own decoration: some institutes append `//City/DE` to the
 * counterparty, pad with runs of dots, or bracket the name in reference codes.
 */
function stripDecoration(raw: string): string {
  let s = String(raw ?? '');
  s = s.split('//')[0];                 // "REWE SAGT DANKE.//Koblenz/DE"
  s = s.replace(/\s{2,}/g, ' ');
  s = s.replace(/\.{2,}/g, ' ');
  s = s.replace(/[•|;]+/g, ' ');
  return s.trim();
}

/** Tokens of a name with punctuation removed, so "S.a.r.l" becomes "sarl". */
function tokenize(raw: string): string[] {
  return normalize(stripDecoration(raw).replace(/\./g, '')).split(' ').filter(Boolean);
}

function stripTrailing(tokens: string[], vocabulary: Set<string>): string[] {
  const out = tokens.slice();
  while (out.length > 1 && vocabulary.has(out[out.length - 1])) out.pop();
  return out;
}

/**
 * Whether this counterparty is a business we may look up externally.
 *
 * Requires a positive signal — a trailing legal form, a mostly-uppercase name
 * (how card acquirers write merchants), or a corporate keyword. A name like
 * "Anna Beispiel" has none of these and is never queried.
 */
export function looksCorporate(raw: string): boolean {
  const decorated = stripDecoration(raw);
  if (!decorated) return false;

  const tokens = tokenize(decorated);
  if (!tokens.length) return false;

  if (tokens.some((t) => LEGAL_FORMS.has(t))) return true;
  if (tokens.some((t) => CORPORATE_WORDS.has(t))) return true;

  // ALL CAPS across at least two words, or a single all-caps token — the shape
  // card terminals and many banks use for merchants.
  const letters = decorated.replace(/[^A-Za-zÄÖÜäöüß]/g, '');
  if (letters.length >= 3 && letters === letters.toUpperCase()) return true;

  return false;
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
};

/**
 * The ordered candidates for a counterparty, most specific first.
 *
 * "DB Vertrieb GmbH" yields ["DB Vertrieb", "DB"]: the subsidiary is tried
 * before the ambiguous two-letter core, and the two-letter core is only
 * accepted on an exact label or alias hit.
 */
export function candidates(raw: string): Candidate[] {
  const tokens = tokenize(raw);
  if (!tokens.length) return [];

  const afterLegal = stripTrailing(tokens, LEGAL_FORMS);
  const afterQualifiers = stripTrailing(afterLegal, QUALIFIERS);

  const rungs: Candidate[] = [];
  const push = (parts: string[], minScore: number) => {
    const core = parts.join(' ').trim();
    if (!core) return;
    if (core.length < 2) return;
    if (TOO_GENERIC.has(core)) return;
    if (rungs.some((r) => r.core === core)) return;
    // A two-letter core ("DB") is only ever safe on an exact hit.
    rungs.push({ query: core, core, minScore: core.length <= 3 ? 1 : minScore });
  };

  push(afterLegal, 0.85);
  push(afterQualifiers, 0.85);
  // Last resort: the leading token alone, and only on an exact hit — this is
  // what turns "AMZN Mktp" into "AMZN".
  if (afterQualifiers.length > 1 && afterQualifiers[0].length >= 3) {
    push([afterQualifiers[0]], 1);
  }

  return rungs;
}

/**
 * How well a label or alias returned by the lookup matches the candidate core.
 *
 *   1.00  the names are the same
 *   0.85  the core starts with the whole label ("paypal europe" ← "paypal")
 *   0.70  the label appears as a whole word inside the core
 *   0     no usable relationship
 */
export function nameScore(core: string, label: string): number {
  const a = normalize(core);
  const b = normalize(label);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (b.length >= 4 && a.startsWith(`${b} `)) return 0.85;
  if (b.length >= 5 && new RegExp(`(^| )${escapeRegExp(b)}( |$)`).test(a)) return 0.7;
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
