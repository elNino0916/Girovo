// The fixed set of booking categories, and the two keys a category decision
// is remembered by.
//
// Pure and dependency-free on purpose: it is shared by the browser, by the
// analysis code and by the `node --test` suite, which runs these files with
// Node's own type stripping (so: no enums, `import type` for types, and any
// runtime import of a sibling module spelled with its `.ts` extension).

import type { SerializedTransaction } from './fints-types';

export type CategoryId =
  | 'income'
  | 'otherIn'
  | 'transfer'
  | 'housing'
  | 'groceries'
  | 'mobility'
  | 'shopping'
  | 'leisure'
  | 'media'
  | 'health'
  | 'insurance'
  | 'taxes'
  | 'cash'
  | 'fees'
  | 'savings'
  | 'other';

export type CategoryDef = {
  id: CategoryId;
  /** Shown in lists, filters and the analysis. Sentence case, German. */
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
};

export const CATEGORIES: readonly CategoryDef[] = [
  { id: 'income', label: 'Einkommen', direction: 'in' },
  { id: 'otherIn', label: 'Sonstige Eingänge', direction: 'in' },
  { id: 'transfer', label: 'Umbuchung', direction: 'both', neutral: true },
  { id: 'housing', label: 'Wohnen & Energie', direction: 'out' },
  { id: 'groceries', label: 'Lebensmittel & Drogerie', direction: 'out' },
  { id: 'mobility', label: 'Mobilität', direction: 'out' },
  { id: 'shopping', label: 'Shopping', direction: 'out' },
  { id: 'leisure', label: 'Freizeit & Gastronomie', direction: 'out' },
  { id: 'media', label: 'Abos & Medien', direction: 'out' },
  { id: 'health', label: 'Gesundheit', direction: 'out' },
  { id: 'insurance', label: 'Versicherungen', direction: 'out' },
  { id: 'taxes', label: 'Steuern & Abgaben', direction: 'out' },
  { id: 'cash', label: 'Bargeld', direction: 'out' },
  { id: 'fees', label: 'Bankentgelte & Zinsen', direction: 'both' },
  { id: 'savings', label: 'Sparen & Anlegen', direction: 'out' },
  { id: 'other', label: 'Sonstiges', direction: 'both' },
];

const BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

export const categoryDef = (id: CategoryId): CategoryDef => BY_ID.get(id) ?? BY_ID.get('other')!;
export const categoryLabel = (id: CategoryId): string => categoryDef(id).label;
export const isCategoryId = (v: unknown): v is CategoryId => typeof v === 'string' && BY_ID.has(v as CategoryId);

/** How a booking got its category — shown so a wrong guess is visibly a guess. */
export type CategorySource = 'manual' | 'rule' | 'auto';
export type CategoryResult = { id: CategoryId; source: CategorySource };

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
  tx: Pick<SerializedTransaction, 'purpose' | 'remoteIban' | 'remoteName'> & { remoteBic?: string; creditorId?: string },
): string {
  // The same key for the same creditor, whether the statement came as MT940
  // (separate field) or CAMT (inside the purpose).
  const cred = txCreditorId(tx);
  if (cred) return `cred:${cred}`;
  const iban = String(tx.remoteIban ?? '').replace(/\s+/g, '').toUpperCase();
  if (/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return `iban:${iban}`;
  const name = squash(tx.remoteName).replace(/\b\d+\b/g, '').replace(/\s+/g, ' ').trim();
  return `name:${name || '?'}`;
}

/**
 * One booking, as a key that survives a re-fetch of the same statement. Used
 * for a per-booking category override. Built from what the bank does not
 * re-issue: the day, the amount, the counterparty and the strongest reference.
 */
export function txKey(
  tx: Pick<SerializedTransaction, 'entryDate' | 'valueDate' | 'amount' | 'remoteIban' | 'remoteName' | 'e2eReference' | 'bankReference'>,
): string {
  const day = String(tx.entryDate || tx.valueDate || '').slice(0, 10);
  const ref = (tx.e2eReference && tx.e2eReference !== 'NOTPROVIDED' ? tx.e2eReference : '') || tx.bankReference || '';
  const who = String(tx.remoteIban || '').replace(/\s+/g, '') || squash(tx.remoteName);
  return `${day}|${Number(tx.amount).toFixed(2)}|${who}|${ref}`;
}
