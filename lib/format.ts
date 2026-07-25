// Presentation helpers. German locale throughout — this app only talks to
// German banks, so there is no locale to negotiate.

export const fmtMoney = (v: number | null | undefined, cur = 'EUR') =>
  new Intl.NumberFormat('de-DE', { style: 'currency', currency: cur }).format(v ?? 0);

export const fmtDate = (d: Date | string | null | undefined) =>
  d ? new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(d)) : '';

export const fmtIban = (iban: string | null | undefined) =>
  iban ? String(iban).replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim() : '';

/** Splits a formatted amount so euros can be set large and cents small. */
export function splitMoney(v: number | null | undefined, cur = 'EUR') {
  const parts = new Intl.NumberFormat('de-DE', { style: 'currency', currency: cur }).formatToParts(v ?? 0);
  let euros = '';
  let cents = '';
  let suffix = '';
  let inFraction = false;
  for (const p of parts) {
    if (p.type === 'decimal') { inFraction = true; cents += p.value; continue; }
    if (p.type === 'fraction') { cents += p.value; continue; }
    if (p.type === 'currency') { suffix = p.value; continue; }
    if (p.type === 'literal' && inFraction) continue;
    euros += p.value;
  }
  return { euros: euros.trim(), cents, suffix };
}

export const txTime = (t: { entryDate?: Date | string; valueDate?: Date | string }) => {
  const d = new Date(t.entryDate || t.valueDate || 0);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
};

const startOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

/** Whole days between a date and today. Negative means the date is ahead. */
export function daysFromToday(d: Date | string | null | undefined): number | null {
  if (!d) return null;
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return null;
  return Math.round((startOfDay(new Date()).getTime() - startOfDay(date).getTime()) / 86400000);
}

/**
 * Whether a date is still ahead of us.
 *
 * Banks routinely stamp a weekend transfer with the *next business day* as its
 * Buchungstag while value-dating it immediately, and date the closing balance
 * of an interim report to that same day — so a statement fetched on Saturday
 * legitimately contains dates in the future. They must never be presented as
 * though they had already happened.
 */
export const isFutureDate = (d: Date | string | null | undefined): boolean => {
  const n = daysFromToday(d);
  return n != null && n < 0;
};

/** "Heute", "Gestern", "Morgen", a weekday for this week, else a written date. */
export function groupLabel(d: Date | string | null | undefined): string {
  const diff = daysFromToday(d);
  if (diff == null) return 'Ohne Datum';
  const date = new Date(d as Date | string);
  if (diff === 0) return 'Heute';
  if (diff === 1) return 'Gestern';
  if (diff === -1) return 'Morgen';
  // A bare weekday is only unambiguous looking backwards — "Montag" for a date
  // still to come would read as the Monday that just passed.
  if (diff > 1 && diff < 7) return new Intl.DateTimeFormat('de-DE', { weekday: 'long' }).format(date);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return new Intl.DateTimeFormat('de-DE', {
    day: 'numeric',
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(date);
}

export function initials(name: string): string {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '•';
  const first = parts[0][0] || '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

const ACCOUNT_TYPES: Record<string, string> = {
  CheckingAccount: 'Girokonto',
  SavingsAccount: 'Sparkonto',
  FixedDepositAccount: 'Festgeld',
  SecuritiesAccount: 'Depot',
  LoanMortgageAccount: 'Kredit',
  CreditCardAccount: 'Kreditkarte',
  HomeSavingsContract: 'Bausparvertrag',
  InsurancePolicy: 'Versicherung',
  InvestmentCompanyFund: 'Fonds',
  Miscellaneous: 'Konto',
};

export const translateType = (t: string) => ACCOUNT_TYPES[t] || 'Konto';

/** Local ISO date (yyyy-mm-dd) for <input type="date"> — never UTC-shifted. */
export function isoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Mirrors the server's ISO 13616 mod-97 check so the form can validate live. */
export function ibanValid(input: string): boolean {
  const iban = String(input || '').replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  if (iban.startsWith('DE') && iban.length !== 22) return false;
  const re = iban.slice(4) + iban.slice(0, 4);
  let rem = 0;
  for (const ch of re) {
    const v = ch >= '0' && ch <= '9' ? ch : (ch.charCodeAt(0) - 55).toString();
    for (const d of v) rem = (rem * 10 + (d.charCodeAt(0) - 48)) % 97;
  }
  return rem === 1;
}
