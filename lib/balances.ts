// Balances across accounts: which ones a Gesamtsaldo adds up, whether it is
// complete, how a card's balance is read, and when a newly fetched balance may
// replace the one this session already knows.
//
// Pure and dependency-free apart from sibling lib modules, so the
// `node --test` suite can run it under Node's own type stripping.

import { dayKey } from './format.ts';
import type { SerializedAccount, SerializedBalance } from './fints-types';
import { intlLocale, msgs } from './i18n/index.ts';

type Capabilities = Pick<SerializedAccount, 'canStatements' | 'canBalance'>;

/**
 * Whether the bank answers balance questions for this account over FinTS at
 * all: through a statement (which carries the closing balance) or a balance
 * enquiry. A Depot usually does neither, and never will in this session.
 */
export const canReportBalance = (a: Capabilities): boolean => a.canStatements || a.canBalance;

/**
 * A credit card account. Its balance is negative by nature (money spent,
 * settled later from the Girokonto), so it is not shown as a problem, and its
 * limit is a Kreditrahmen, not a Dispositionsrahmen.
 *
 * Decided by the FinTS Kontoart alone, as lib-fints names it (or the bare
 * number, 50–59), never by the product name: "Giro mit Visa" is a Girokonto,
 * and reading it as a card would hide its overdraft.
 */
export function isCardAccount(a: Pick<SerializedAccount, 'accountType'>): boolean {
  const t = String(a.accountType ?? '').trim();
  return t === 'CreditCardAccount' || /^5\d$/.test(t);
}

type Countable = Pick<SerializedAccount, 'accountNumber' | 'currency'> & Capabilities;
type KnownBalance = Pick<SerializedBalance, 'balance' | 'currency'>;

export type TotalBalance<A> = {
  /** The accounts a Gesamtsaldo is about: in euros, and able to report a balance. */
  counted: A[];
  /** Accounts that never count, and why: no balance over FinTS, or another currency. */
  excluded: Array<{ account: A; reason: 'unsupported' | 'currency'; currency: string }>;
  /** Counted accounts whose balance this session does not know yet. */
  missing: A[];
  /**
   * The sum in cents. Only once every counted balance is known — a total of
   * some accounts is a different number, and "Gesamtsaldo" means all of them.
   */
  cents: number | null;
};

/**
 * The Gesamtsaldo over `accounts`, or what keeps it from being one.
 *
 * Only euros are added (currencies are never mixed), only accounts that can
 * report a balance are expected (a Depot would keep the sum open for good),
 * and a balance that was never fetched is not zero. Summed in cents, so four
 * balances cannot drift by one.
 */
export function totalBalance<A extends Countable>(
  accounts: readonly A[],
  balances: Readonly<Record<string, KnownBalance | null | undefined>>,
): TotalBalance<A> {
  const counted: A[] = [];
  const excluded: TotalBalance<A>['excluded'] = [];
  const missing: A[] = [];
  let cents = 0;
  for (const a of accounts) {
    const b = balances[a.accountNumber];
    const currency = (b?.currency || a.currency || 'EUR').toUpperCase();
    if (!b && !canReportBalance(a)) {
      excluded.push({ account: a, reason: 'unsupported', currency });
      continue;
    }
    if (currency !== 'EUR') {
      excluded.push({ account: a, reason: 'currency', currency });
      continue;
    }
    counted.push(a);
    if (b) cents += Math.round(b.balance * 100);
    else missing.push(a);
  }
  return { counted, excluded, missing, cents: missing.length ? null : cents };
}

/**
 * Whether `incoming` may replace the balance this session already knows.
 *
 * A balance never moves back in time. Banks cap long statements and answer
 * with the oldest slice, whose closing balance is months old; a balance
 * enquiry answered from a stale core system can lag a statement fetched a
 * minute earlier. Either would quietly turn today's figure into an old one.
 * On the same day the newer answer wins; an undated one is taken as it is.
 */
export function acceptsBalance(
  known: Pick<SerializedBalance, 'date'> | null | undefined,
  incoming: Pick<SerializedBalance, 'date'>,
): boolean {
  if (!known) return true;
  const day = dayKey(incoming.date);
  const knownDay = dayKey(known.date);
  return !(day && knownDay && day < knownDay);
}

/**
 * What "Alle Salden abrufen" asks the bank for, in list order: every account
 * whose balance is not known yet and can be — by the balance enquiry where
 * the account offers one, by its statement where that is the only way and
 * the statement reaches today (only then does it carry today's balance).
 * Accounts in other currencies too: the label promises all balances, even if
 * the Gesamtsaldo adds only the euros.
 */
export function balanceQueue<A extends Pick<SerializedAccount, 'accountNumber'> & Capabilities>(
  accounts: readonly A[],
  balances: Readonly<Record<string, unknown>>,
  statementReachesToday: boolean,
): Array<{ account: A; via: 'balance' | 'statement' }> {
  const queue: Array<{ account: A; via: 'balance' | 'statement' }> = [];
  for (const account of accounts) {
    if (balances[account.accountNumber]) continue;
    if (account.canBalance) queue.push({ account, via: 'balance' });
    else if (account.canStatements && statementReachesToday) queue.push({ account, via: 'statement' });
  }
  return queue;
}

/** One list format per Intl locale, made on first use. */
const LISTS = new Map<string, Intl.ListFormat>();

/**
 * "Tagesgeld", "Tagesgeld und Depot", "Giro, Tagesgeld und Depot" — joined
 * the way the language speaking right now joins a list ("Giro, Tagesgeld and
 * Depot").
 */
export function namesList(names: readonly string[]): string {
  const locale = intlLocale();
  let list = LISTS.get(locale);
  if (!list) LISTS.set(locale, (list = new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' })));
  return list.format(names.filter((n) => n.trim()));
}

/**
 * One sentence for reads that failed: which accounts, and the reason as the
 * bank (or the app) put it when they share one. Null when nothing failed.
 */
export function failureSentence(failed: ReadonlyArray<{ name: string; message: string }>): string | null {
  if (!failed.length) return null;
  const words = msgs().insights.balances;
  const names = namesList(failed.map((f) => words.quoted(f.name)));
  const reasons = [...new Set(failed.map((f) => f.message.trim()).filter(Boolean))];
  return words.fetchFailed(names, reasons.length === 1 ? reasons[0] : null);
}
