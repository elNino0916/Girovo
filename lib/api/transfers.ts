// Girovo API: transfers.request and bank.refresh (docs/girovo-api.md).
//
// transfers.request never sends anything. It checks what the app asks for,
// then Girovo opens its own transfer sheet filled in and marked "Angefragt
// von <app>", in front; the user checks it, may change it, and sends it or
// not, and the bank asks for its Freigabe as always. The call answers
// `pending` with a request id at once; once the user acted, the app hears the
// final state through the notification girovo.transfer.updated, or asks
// transfers.status. It learns the state and the bank's own words, never the
// TAN and never what the user typed in place of its values (only that
// something was changed).
//
// bank.refresh reads new balances and bookings as the app's own reads do
// (the Freigabe, where the bank asks for one, in Girovo's window) and answers
// how many bookings came in per account.
//
// Pure and node-test-safe.

import { ibanValid, compactIban } from '../format.ts';
import { sepaLength, sepaSanitize, SEPA_NAME_MAX, SEPA_PURPOSE_MAX } from '../sepa-text.ts';
import { accountId, bookingIds, findAccount, realDay, type ApiData, type MethodOutcome } from './methods.ts';
import type { TransferState } from './types.ts';

/** The highest amount a request may name, in cents (the form's own field takes no more). */
export const TRANSFER_MAX_CENTS = 99_999_999_99;

/** What the transfer sheet opens with (lib/app-types.ts TransferPrefill, plus the day of a Terminüberweisung). */
export type TransferAsk = {
  accountKey?: string;
  name: string;
  iban: string;
  cents: number;
  purpose: string;
  /** yyyy-mm-dd: a terminierte Überweisung on that day; absent for one now. */
  executeOn?: string;
};

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
// eslint-disable-next-line no-control-regex
const squash = (v: string) => v.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * `{ iban, name, cents, purpose?, executeOn?, account? }` → what the sheet
 * opens with, or the parameter that does not fit: a valid IBAN (checksum),
 * a name and a purpose that fit SEPA's 70 and 140 characters once written in
 * its characters, an amount above zero in whole cents, a day not in the past
 * (today is a transfer now) where the account offers Terminüberweisungen,
 * an account that can send transfers.
 */
export function transferAsk(data: ApiData, params: unknown): { ask: TransferAsk } | { invalid: string; data?: Record<string, unknown> } {
  if (!isRecord(params)) return { invalid: 'params' };
  if (typeof params.iban !== 'string' || params.iban.length > 60) return { invalid: 'iban' };
  const iban = compactIban(params.iban);
  if (!ibanValid(iban)) return { invalid: 'iban' };
  if (typeof params.name !== 'string' || params.name.length > 300) return { invalid: 'name' };
  const name = squash(params.name);
  if (!name || !sepaSanitize(name) || sepaLength(name) > SEPA_NAME_MAX) return { invalid: 'name' };
  const cents = params.cents;
  if (typeof cents !== 'number' || !Number.isInteger(cents) || cents <= 0 || cents > TRANSFER_MAX_CENTS) return { invalid: 'cents' };
  if (params.purpose !== undefined && (typeof params.purpose !== 'string' || params.purpose.length > 500)) return { invalid: 'purpose' };
  const purpose = squash((params.purpose as string | undefined) ?? '');
  if (sepaLength(purpose) > SEPA_PURPOSE_MAX) return { invalid: 'purpose' };
  let accountKey: string | undefined;
  let account = null as ReturnType<typeof findAccount>;
  if (params.account !== undefined) {
    account = findAccount(data, params.account);
    if (!account || !account.account.canTransfer) return { invalid: 'account' };
    if (compactIban(account.account.iban ?? '') === iban) return { invalid: 'iban', data: { reason: 'same_account' } };
    accountKey = account.key;
  }
  let executeOn: string | undefined;
  if (params.executeOn !== undefined && params.executeOn !== null) {
    const day = params.executeOn;
    if (typeof day !== 'string' || !realDay(day) || day < data.today) return { invalid: 'executeOn' };
    if (day > data.today) {
      // A day ahead is a terminierte Überweisung: the account (the one asked for, else every one that sends) must offer it.
      const senders = account ? [account] : data.accounts.filter((a) => a.account.canTransfer);
      const dated = senders.find((a) => a.account.dated?.create);
      if (!dated) return { invalid: 'executeOn', data: { reason: 'not_offered' } };
      // Without an account named, the sheet opens on one that offers it, never on one that would quietly send now.
      if (!accountKey) accountKey = dated.key;
      executeOn = day;
    }
  }
  if (!data.accounts.some((a) => a.account.canTransfer)) return { invalid: 'account', data: { reason: 'none' } };
  return { ask: { ...(accountKey ? { accountKey } : {}), name, iban, cents, purpose, ...(executeOn ? { executeOn } : {}) } };
}

// ---------------------------------------------------------------------------
// The requests' states
// ---------------------------------------------------------------------------

export type TransferRecord = {
  id: string;
  /** The app's grant key (lib/api/grants.ts): only it may ask for the state. */
  app: string;
  /** The connection that asked: the notification goes there while it is open. */
  connection: string;
  state: TransferState;
  /** The bank's own words once it answered (sent, failed, unclear). */
  text?: string;
  /** The user changed what the app asked for before sending it. */
  changed?: boolean;
  /** ISO */
  at: string;
  settledAt?: string;
};

/** How many requests wait at once: an app can't pile up transfer sheets. */
export const TRANSFER_LIMITS = { pendingPerApp: 3, pendingTotal: 10, kept: 100, text: 500 } as const;

/** What the app hears of a request: its id and state, and the bank's words or the "changed" mark where there are any. */
export function transferView(r: TransferRecord) {
  return {
    request: r.id,
    state: r.state,
    ...(r.text ? { text: r.text } : {}),
    ...(r.changed ? { changed: true } : {}),
  };
}

/**
 * The page's requests for as long as it lives: pending until settled once,
 * then final. The oldest final ones go once there are too many.
 */
export class TransferRequests {
  private readonly records = new Map<string, TransferRecord>();
  private next = 1;

  /** A new pending request, or null when the app (or everyone) has too many waiting. */
  create(app: string, connection: string, at: string): TransferRecord | null {
    const pending = [...this.records.values()].filter((r) => r.state === 'pending');
    if (pending.length >= TRANSFER_LIMITS.pendingTotal) return null;
    if (pending.filter((r) => r.app === app).length >= TRANSFER_LIMITS.pendingPerApp) return null;
    const id = `r_${(this.next++).toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const record: TransferRecord = { id, app, connection, state: 'pending', at };
    this.records.set(id, record);
    this.trim();
    return record;
  }

  /** Settles a pending request; a final one stays as it was (null). */
  settle(id: string, state: Exclude<TransferState, 'pending'>, at: string, extra: { text?: string; changed?: boolean } = {}): TransferRecord | null {
    const r = this.records.get(id);
    if (!r || r.state !== 'pending') return null;
    const text = extra.text?.trim().slice(0, TRANSFER_LIMITS.text);
    const next: TransferRecord = { ...r, state, settledAt: at, ...(text ? { text } : {}), ...(extra.changed ? { changed: true } : {}) };
    this.records.set(id, next);
    return next;
  }

  /** The request as its own app may see it; another app's is not there for it. */
  get(id: unknown, app: string): TransferRecord | null {
    if (typeof id !== 'string') return null;
    const r = this.records.get(id);
    return r && r.app === app ? r : null;
  }

  /** Every pending request (the logout settles them). */
  pending(): TransferRecord[] {
    return [...this.records.values()].filter((r) => r.state === 'pending');
  }

  private trim() {
    if (this.records.size <= TRANSFER_LIMITS.kept) return;
    for (const [id, r] of this.records) {
      if (this.records.size <= TRANSFER_LIMITS.kept) break;
      if (r.state !== 'pending') this.records.delete(id);
    }
  }
}

// ---------------------------------------------------------------------------
// bank.refresh
// ---------------------------------------------------------------------------

/** How one account's read went, as the provider's loads settle (FintsProvider LoadOutcome). */
export type RefreshStep = { key: string; outcome: 'applied' | 'failed' | 'cancelled' | 'skipped'; error?: string };

/** The host's report of a refresh: each account it read, in order; it stops at the first approval the user called off. */
export type RefreshReport = { steps: RefreshStep[] };

/** `{ account? }` → the account key to read, or null for every account; or the parameter that does not fit. */
export function refreshTarget(data: ApiData, params: unknown): { key: string | null } | { invalid: string } {
  if (params !== undefined && params !== null && !isRecord(params)) return { invalid: 'params' };
  const id = isRecord(params) ? params.account : undefined;
  if (id === undefined || id === null) return { key: null };
  const a = findAccount(data, id);
  if (!a || !(a.account.canStatements || a.account.canBalance || a.account.canPortfolio)) return { invalid: 'account' };
  return { key: a.key };
}

/**
 * The answer once the reads are done: per account how many bookings came in
 * (new ids since before) and its balance; `refused_by_user` when the user
 * called off the bank's Freigabe before anything was read; `bank_error`
 * with the bank's words when every read failed.
 */
export function refreshAnswer(before: ApiData, after: ApiData, report: RefreshReport): MethodOutcome {
  const steps = report.steps;
  const read = steps.filter((s) => s.outcome === 'applied');
  if (!read.length) {
    if (steps.some((s) => s.outcome === 'cancelled')) return { fail: 'refused_by_user' };
    const failed = steps.find((s) => s.outcome === 'failed');
    if (failed) return { fail: 'bank_error', data: { text: failed.error ?? '' }, message: failed.error || undefined };
  }
  const was = bookingIds(before);
  const now = bookingIds(after);
  let total = 0;
  const accounts = steps.map((s) => {
    const a = after.accounts.find((x) => x.key === s.key);
    const old = was.get(s.key) ?? new Set<string>();
    const added = [...(now.get(s.key) ?? [])].filter((id) => !old.has(id)).length;
    if (s.outcome === 'applied') total += added;
    const balance = a?.balance
      ? { cents: Math.round(a.balance.balance * 100), currency: a.balance.currency || a.account.currency || 'EUR' }
      : null;
    return {
      account: accountId(s.key),
      state: s.outcome === 'applied' ? 'read' : s.outcome,
      ...(s.outcome === 'applied' ? { newBookings: added, balance } : {}),
      ...(s.outcome === 'failed' && s.error ? { text: s.error } : {}),
    };
  });
  return { result: { accounts, newBookings: total, ...(steps.some((s) => s.outcome === 'cancelled') ? { stopped: true } : {}) } };
}
