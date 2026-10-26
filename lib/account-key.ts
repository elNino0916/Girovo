// Which account an account key means.
//
// FinTS names an account by its number *and* its sub-account id
// (Unterkontomerkmal), and some banks use that: a Girokonto and the Depot
// that settles through it share one number and differ only in the
// sub-account id (#20). Girovo keys an account by its number everywhere — in
// the page's state, the vault's names and notes, the kept Umsätze — so a key
// is the number alone wherever that is unique, which keeps every key that
// already exists, and the number with the sub-account id after a colon only
// where the bank lists that number more than once.
//
// The page and the route handlers pass keys; every request to the bank
// turns its key back into the UPD's own entry (bankAccountOf), so lib-fints
// is told the very account and never has to guess from a number.

import type { BankAccount, FinTSConfig } from 'lib-fints';

const SUB = ':';

type Numbered = Pick<BankAccount, 'accountNumber' | 'subAccountId'>;

/** The key of `account` among `all`, the accounts of its UPD. */
export function accountKeyOf(account: Numbered, all: readonly Numbered[]): string {
  const shared = all.filter((a) => a.accountNumber === account.accountNumber).length > 1;
  return shared && account.subAccountId ? `${account.accountNumber}${SUB}${account.subAccountId}` : account.accountNumber;
}

/** The bank's own account number in a key — what a screen or a statement shows. */
export function bankNumberOf(key: string): string {
  const at = key.indexOf(SUB);
  return at < 0 ? key : key.slice(0, at);
}

/** The UPD's account behind a key, or undefined where the UPD has none by that key. */
export function findBankAccount(config: FinTSConfig, key: string): BankAccount | undefined {
  const accounts = config.bankingInformation?.upd?.bankAccounts ?? [];
  return accounts.find((a) => accountKeyOf(a, accounts) === key);
}

/**
 * The UPD's account behind a key, sub-account id included — what lib-fints
 * takes in place of a number. A key no account has reads as a number, so the
 * library says what it always said: not found, or not unique.
 */
export function bankAccountOf(config: FinTSConfig, key: string): BankAccount {
  return findBankAccount(config, key) ?? config.getBankAccount(key);
}
