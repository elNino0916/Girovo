// The booking categories — the app's fixed set plus the ones the user made —
// and the two keys a category decision is remembered by.
//
// Pure and dependency-free on purpose: it is shared by the browser, by the
// analysis code and by the `node --test` suite, which runs these files with
// Node's own type stripping (so: no enums, `import type` for types, and any
// runtime import of a sibling module spelled with its `.ts` extension).

import type { SerializedTransaction } from './fints-types';
import { cleanMerchantName } from './card-purpose.ts';
import { bankDay } from './format.ts';
import { msgs } from './i18n/index.ts';

/** The app's own categories: translated, with a glyph each, known to the model and the keywords. */
export type BuiltinCategoryId =
  | 'income'
  | 'otherIn'
  | 'transfer'
  | 'housing'
  | 'groceries'
  | 'mobility'
  | 'shopping'
  | 'dining'
  | 'leisure'
  | 'media'
  | 'health'
  | 'insurance'
  | 'taxes'
  | 'cash'
  | 'fees'
  | 'savings'
  | 'other';

/**
 * A category the user made ("Spenden", "Handwerker", "Hund"): `c_` and a
 * random part, never a word, so renaming it changes nothing it is keyed by.
 */
export type CustomCategoryId = `c_${string}`;

export type CategoryId = BuiltinCategoryId | CustomCategoryId;

/**
 * A category of the user's own, as the vault keeps it. Its name is the
 * user's text and is shown as typed, in either language. Only money going
 * one way fits one: spending ("out") or income ("in").
 */
export type CustomCategory = {
  id: CustomCategoryId;
  name: string;
  direction: 'in' | 'out';
};

export type CategoryDef = {
  id: CategoryId;
  /**
   * Shown in lists, filters and the analysis, in the language speaking right
   * now (lib/i18n/messages/categories.ts) — read it where it is shown, never
   * keep a copy.
   */
  label: string;
  /**
   * Which way money moves in this category. `both` is for the two buckets a
   * booking of either sign can land in.
   */
  direction: 'in' | 'out' | 'both';
  /**
   * Excluded from income/expense totals. Moving money between your own
   * accounts is neither — counting it would inflate both sides.
   */
  neutral?: boolean;
  /** One of the user's own (CustomCategory). */
  custom?: boolean;
};

const ROWS: readonly (Omit<CategoryDef, 'label' | 'id'> & { id: BuiltinCategoryId })[] = [
  { id: 'income', direction: 'in' },
  { id: 'otherIn', direction: 'in' },
  { id: 'transfer', direction: 'both', neutral: true },
  { id: 'housing', direction: 'out' },
  { id: 'groceries', direction: 'out' },
  { id: 'mobility', direction: 'out' },
  { id: 'shopping', direction: 'out' },
  // Since 5.9.0 apart from Freizeit: "Restaurants im August" must not bring up Steam.
  { id: 'dining', direction: 'out' },
  { id: 'leisure', direction: 'out' },
  { id: 'media', direction: 'out' },
  { id: 'health', direction: 'out' },
  { id: 'insurance', direction: 'out' },
  { id: 'taxes', direction: 'out' },
  { id: 'cash', direction: 'out' },
  { id: 'fees', direction: 'both' },
  { id: 'savings', direction: 'out' },
  { id: 'other', direction: 'both' },
];

/** The app's own categories, their labels read when they are read — so a change of language reaches every list. */
export const CATEGORIES: readonly CategoryDef[] = ROWS.map((row) => ({
  ...row,
  get label() {
    return msgs().categories[row.id];
  },
}));

const BY_ID = new Map<CategoryId, CategoryDef>(CATEGORIES.map((c) => [c.id, c]));

export const isBuiltinCategoryId = (v: unknown): v is BuiltinCategoryId =>
  typeof v === 'string' && BY_ID.has(v as CategoryId);

/** How a custom category's id is spelled — the vault refuses any other. */
export const CUSTOM_ID = /^c_[a-z0-9]{6,24}$/;
export const isCustomCategoryId = (v: unknown): v is CustomCategoryId => typeof v === 'string' && CUSTOM_ID.test(v);

// The user's own categories, as the vault on screen holds them. One list for
// the whole page: the provider registers it whenever the vault changes
// (setCustomCategories), before anything below it renders, so a label, a
// filter or a sum asked for anywhere sees the same set. The server never
// relies on this — its vault code checks ids against the file's own list.
let customDefs = new Map<CategoryId, CategoryDef>();
let customList: readonly CategoryDef[] = [];

/** Makes `list` the user's own categories for every lookup below. */
export function setCustomCategories(list: readonly CustomCategory[]): void {
  const defs = list.map((c): CategoryDef => ({ id: c.id, label: c.name, direction: c.direction, custom: true }));
  customList = defs;
  customDefs = new Map(defs.map((d) => [d.id, d]));
}

/** The user's own categories as they stand now, in the order they were made. */
export const customCategoryDefs = (): readonly CategoryDef[] => customList;

/** Every category a booking can be filed under: the app's own, then the user's. */
export const allCategories = (): readonly CategoryDef[] => (customList.length ? [...CATEGORIES, ...customList] : CATEGORIES);

/** A category's definition. An id nobody knows (a deleted category of the user's) reads as "Sonstiges". */
export const categoryDef = (id: CategoryId): CategoryDef => BY_ID.get(id) ?? customDefs.get(id) ?? BY_ID.get('other')!;
export const categoryLabel = (id: CategoryId): string => categoryDef(id).label;
export const isCategoryId = (v: unknown): v is CategoryId =>
  typeof v === 'string' && (BY_ID.has(v as CategoryId) || customDefs.has(v as CategoryId));

/** How a booking got its category — shown so a wrong guess is visibly a guess. */
export type CategorySource = 'manual' | 'rule' | 'auto';

/** One share of a booking the user split up (lib/splits.ts): signed like the booking, in its currency. */
export type CategoryPart = { id: CategoryId; amount: number };

export type CategoryResult = {
  /** The category the booking is shown under — for a split one, its largest share's. */
  id: CategoryId;
  source: CategorySource;
  /**
   * Set only for a booking the user split across categories: the shares,
   * largest first, summing exactly to the booking's amount. Every sum counts
   * these instead of `id`.
   */
  parts?: readonly CategoryPart[];
};

const squash = (s: string | null | undefined) =>
  String(s ?? '')
    .toUpperCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();

/** The SEPA creditor identifier (CRED+…) a direct debit carries in its purpose. */
export function creditorId(purpose: string | null | undefined): string | null {
  // Lazy, and stopped by the next SEPA tag (`SVWZ+`, `EREF+`, …) or a space:
  // banks often run the tags together with no separator at all.
  const m = /CRED\+\s*([A-Z]{2}\d{2}[A-Z0-9]{3,31}?)(?=[A-Z]{4}\+|\s|$)/.exec(String(purpose ?? '').toUpperCase());
  return m ? m[1].toUpperCase() : null;
}

type Parties = { remoteName?: string | null; ultimateName?: string | null };

/**
 * Who a booking is really with.
 *
 * Card payments and payment services name an intermediary as the account
 * holder — every Visa Debit payment of a Sparkasse customer goes to
 * "Landesbank Hessen-Thüringen" — and the shop as the "abweichender
 * Empfänger" (for money coming in, the "abweichender Auftraggeber"). The
 * bank's own app shows the shop, so this app does too: in the list, for logos,
 * categories, search and recurring payments.
 */
export function counterpartyName(tx: Parties): string {
  // A card terminal's descriptor ("WL .Steam Purchase//425-889-9642/US/3")
  // is reduced to the shop; any ordinary name comes back as it is.
  return cleanMerchantName(rawCounterparty(tx));
}

/** The counterparty exactly as the bank sent it — descriptor, location and all. */
export function rawCounterparty(tx: Parties): string {
  return String(tx.ultimateName ?? '').trim() || String(tx.remoteName ?? '').trim();
}

/**
 * The intermediary a booking went through, when a different party stands
 * behind it — shown as "Abgewickelt über …", because the IBAN on the booking
 * is the intermediary's, not the shop's. Null when there is no such split.
 */
export function intermediaryName(tx: Parties): string | null {
  const ultimate = String(tx.ultimateName ?? '').trim();
  const holder = String(tx.remoteName ?? '').trim();
  if (!ultimate || !holder || squash(ultimate) === squash(holder)) return null;
  return holder;
}

/** A creditor ID has check digits in places three and four, where a BIC has letters. */
const CREDITOR_SHAPE = /^[A-Z]{2}\d{2}[A-Z0-9]{4,31}$/;

/**
 * The SEPA creditor identifier of a booking, wherever the format put it: the
 * separate field MT940 statements fill (lib/serialize.ts `creditorId`), the
 * CRED+ tag CAMT leaves inside the purpose, or — for data serialized before
 * that field existed — remoteBic, which once carried it.
 */
export function txCreditorId(
  tx: Pick<SerializedTransaction, 'purpose'> & { remoteBic?: string; creditorId?: string },
): string | null {
  const own = String(tx.creditorId ?? '').replace(/\s+/g, '').toUpperCase();
  if (CREDITOR_SHAPE.test(own)) return own;
  const fromPurpose = creditorId(tx.purpose);
  if (fromPurpose) return fromPurpose;
  const legacy = String(tx.remoteBic ?? '').replace(/\s+/g, '').toUpperCase();
  return CREDITOR_SHAPE.test(legacy) ? legacy : null;
}

/** The counterparty's BIC, or '' when the field holds something else (a creditor ID). */
export function txBic(tx: { remoteBic?: string }): string {
  const bic = String(tx.remoteBic ?? '').replace(/\s+/g, '').toUpperCase();
  return bic && !CREDITOR_SHAPE.test(bic) ? bic : '';
}

/**
 * Who is on the other side of a booking, as one stable string — the key a
 * user's "always put X in Y" rule is stored under. A direct debit's creditor
 * ID beats the IBAN (one creditor collects through several), the IBAN beats
 * the name (names arrive truncated and re-cased).
 */
export function counterpartyKey(
  tx: Pick<SerializedTransaction, 'purpose' | 'remoteIban' | 'remoteName'> & { remoteBic?: string; creditorId?: string; ultimateName?: string },
): string {
  // Behind an intermediary the IBAN and creditor ID are the intermediary's —
  // keyed on those, "Amazon → Shopping" would file every Visa Debit payment
  // as Shopping. The shop's own name is the only thing that tells them apart.
  if (intermediaryName(tx)) {
    const shop = nameKey(counterpartyName(tx));
    if (shop) return `name:${shop}`;
  }
  // The same key for the same creditor, whether the statement came as MT940
  // (separate field) or CAMT (inside the purpose).
  const cred = txCreditorId(tx);
  if (cred) return `cred:${cred}`;
  const iban = String(tx.remoteIban ?? '').replace(/\s+/g, '').toUpperCase();
  if (/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return `iban:${iban}`;
  // The shop, not its descriptor: one rule for every REWE, whichever branch's
  // street and town the terminal appended.
  const name = nameKey(counterpartyName(tx));
  return `name:${name || '?'}`;
}

/** A name as counterpartyKey() keys it: squashed, a branch's or terminal's numbers gone. */
const nameKey = (name: string) => squash(name).replace(/\b\d+\b/g, '').replace(/\s+/g, ' ').trim();

/** How many letter pairs of one name are read both ways; a name with more is tried spelled out and dotless only. */
const SPELLING_SPOTS = 5;

/**
 * The other keys the same payee's name could be stored under, by how its
 * umlauts were written.
 *
 * A key drops an umlaut's dots ("Bäckerei Müller" → BACKEREI MULLER) and
 * keeps one the bank spelled out (MT940's "BAECKEREI MUELLER"), so one baker
 * has two keys — and a stored key cannot change: the user's rules live under
 * it. So the lookup reads the name both ways instead. Every AE, OE and UE of
 * the spelled-out name may be an umlaut or two plain letters, and the bank
 * may have written each either way: each combination is a key ("Baeckerei
 * Müller" has four). A UE after A, E or Q is never an umlaut — "Bauer" is
 * not "Baur", "Quelle" not "Qülle", "neue" not "neü".
 *
 * Only for a key made from the name: an IBAN or a creditor ID has one spelling.
 */
function otherSpellings(tx: Parameters<typeof counterpartyKey>[0], key: string): string[] {
  if (!key.startsWith('name:') || key === 'name:?') return [];
  const spelled = nameKey(
    counterpartyName(tx).normalize('NFC').toUpperCase().replace(/Ä/g, 'AE').replace(/Ö/g, 'OE').replace(/Ü/g, 'UE'),
  );
  const spots = [...spelled.matchAll(/AE|OE|(?<![AEQ])UE/g)].map((m) => m.index);
  if (!spots.length) return [];
  // The E of each chosen pair taken out again, from the back so the earlier places stay put.
  const dotless = (mask: number) => {
    let out = spelled;
    for (let i = spots.length - 1; i >= 0; i--) if (mask & (1 << i)) out = out.slice(0, spots[i] + 1) + out.slice(spots[i] + 2);
    return `name:${out}`;
  };
  const all = (1 << spots.length) - 1;
  const masks = spots.length > SPELLING_SPOTS ? [0, all] : Array.from({ length: all + 1 }, (_, mask) => mask);
  return [...new Set(masks.map(dotless))].filter((k) => k !== key);
}

/**
 * The key the rule for a booking's counterparty is stored under: its own
 * counterpartyKey() where a rule has that one, else the same name with its
 * umlauts written the other way (otherSpellings). Null when no rule is its.
 * A rule is set, changed and removed under this key, so one payee keeps one.
 */
export function counterpartyRuleKey(
  rules: Readonly<Record<string, unknown>> | null | undefined,
  tx: Parameters<typeof counterpartyKey>[0],
): string | null {
  if (!rules) return null;
  const key = counterpartyKey(tx);
  if (rules[key] != null) return key;
  return otherSpellings(tx, key).find((k) => rules[k] != null) ?? null;
}

/**
 * The key a rule for a booking's counterparty is set, changed and removed
 * under: the key of the rule that files it now — its own, or the one found
 * through the other spelling — else its own counterpartyKey(). Removing by
 * the booking's own key would leave the rule that matched standing, and
 * setting by it would put a second rule beside that one.
 */
export function ruleKeyFor(
  rules: Readonly<Record<string, unknown>> | null | undefined,
  tx: Parameters<typeof counterpartyKey>[0],
): string {
  return counterpartyRuleKey(rules, tx) ?? counterpartyKey(tx);
}

/** The user's rule for a booking's counterparty — "always file X under Y" — whichever way the name's umlauts are written. */
export function counterpartyRule<T>(
  rules: Readonly<Record<string, T>> | null | undefined,
  tx: Parameters<typeof counterpartyKey>[0],
): T | undefined {
  const key = counterpartyRuleKey(rules, tx);
  return key == null ? undefined : rules![key];
}

/** What a booking's key is built from. */
export type KeyedBooking = Pick<
  SerializedTransaction,
  'bankDay' | 'entryDate' | 'valueDate' | 'amount' | 'remoteIban' | 'remoteName' | 'e2eReference' | 'bankReference'
>;

/** A booking's key on `day`: the amount, the counterparty and the strongest reference after it. */
function keyOn(day: string, tx: KeyedBooking): string {
  const ref = (tx.e2eReference && tx.e2eReference !== 'NOTPROVIDED' ? tx.e2eReference : '') || tx.bankReference || '';
  const who = String(tx.remoteIban || '').replace(/\s+/g, '') || squash(tx.remoteName);
  return `${day}|${Number(tx.amount).toFixed(2)}|${who}|${ref}`;
}

/**
 * One booking, as a key that survives a re-fetch of the same statement: what
 * the user files for a single booking hangs on it — its category, its split,
 * its note, its receipts. Built from what the bank does not re-issue: the
 * day, the amount, the counterparty and the strongest reference.
 *
 * The day is the bank's Buchungstag (lib/format.ts bankDay), so the key is
 * the same whichever statement format brought the booking and wherever the
 * device was that fetched or reads it. In front goes KEY_MARK: a key from
 * before (legacyTxKey) starts with a yyyy-mm-dd or, undated, with '|', so it
 * never looks like one of now — what was filed under one is moved, once and
 * without guessing whose it was (lib/booking-keys.ts).
 *
 *   d2|2026-11-01|-12.90|DE02120300000000202051|E1
 */
export function txKey(tx: KeyedBooking): string {
  return KEY_MARK + keyOn(bankDay(tx), tx);
}

/** What a booking's key starts with since it goes by the bank's day; no key from before does. */
export const KEY_MARK = 'd2|';

/**
 * The key as it was built before bookings went by the bank's day: on the
 * first ten characters of the moment the fetching device made of the day —
 * its UTC date, so the day before for an MT940 booking fetched on German
 * time. Only for moving what was filed under it (lib/booking-keys.ts).
 */
export function legacyTxKey(tx: KeyedBooking): string {
  return keyOn(String(tx.entryDate || tx.valueDate || '').slice(0, 10), tx);
}
