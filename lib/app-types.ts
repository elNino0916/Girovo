// Client-side shapes shared between the provider and the views.
//
// The wire contract with the route handlers lives in fints-types.ts; this file
// is everything the browser invents on top of it — navigation, launchers,
// the encrypted personal-data vault, the inbox. One place, so a view and the
// provider can never disagree about a shape.

import type { CategoryId } from './categories';
import type { SerializedTransaction, StatementBlock } from './fints-types';
import type { SentOrder } from './sent-orders';

export type { CategoryId };

/** The second-level navigation under the institute bar. */
export type DashboardTab = 'overview' | 'analysis' | 'contracts';

/** A date range as `<input type="date">` speaks it: local yyyy-mm-dd. */
export type DateRange = { from: string; to: string };

/** What was actually fetched for one account — never what a control shows. */
export type StatementInfo = {
  from: string;
  to: string;
  blocks: StatementBlock[];
  /** epoch ms */
  loadedAt: number;
};

/** The Umsätze list's narrowing. Lives in the provider so other views can deep-link into it. */
export type TxFilter = {
  dir: 'all' | 'in' | 'out';
  category: CategoryId | null;
  query: string;
  /**
   * The first and last Buchungstag shown (local yyyy-mm-dd, both included).
   * A view of what is already loaded, never a fetch: loading another period
   * is the Zeitraum control's job. Empty or absent means open.
   */
  from?: string;
  to?: string;
  /**
   * Set by a deep link from a figure over every account with Umsätze (the
   * Analyse's "Alle Konten"): the list holds one account, and says so. Any
   * edit in the filter bar drops it.
   */
  acrossAccounts?: boolean;
  /**
   * Set by a "show me" about one account's bookings (a palette hit, a look at
   * a transfer whose status is unclear — useShowOnAccount). The list says when
   * it shows another account, because switching would have asked the bank,
   * and, with `sentAt` (epoch ms, when the transfer went out), when it was
   * fetched before that transfer and so cannot hold it yet. Any edit in the
   * filter bar drops it.
   */
  lookup?: { accountNumber: string; sentAt?: number };
};

export const EMPTY_FILTER: TxFilter = { dir: 'all', category: null, query: '' };

/** Which accounts the Umsatzanalyse adds up: the active one, or every one with Umsätze in its currency. */
export type AnalysisScope = 'account' | 'all';

/**
 * The Umsatzanalyse's period: 'all' (the whole loaded range) or a yyyy-mm
 * month. Null until the user picks one — the analysis then opens on the last
 * complete month.
 */
export type AnalysisPeriod = string;

/** A message the bank sent with the login synchronisation (HIRMG/HIRMS texts). */
export type InboxMessage = {
  id: string;
  subject: string;
  /** Plain text, already passed through repairBankText. Never render as HTML. */
  text: string;
  /** ISO timestamp of when this session received it. */
  receivedAt: string;
  read: boolean;
};

/** Something this session did that the user may want to look back at. */
export type ActivityEntry = {
  id: string;
  /** ISO timestamp */
  at: string;
  kind: 'transfer';
  outcome: 'executed' | 'unknown' | 'failed';
  accountNumber: string;
  name: string;
  iban: string;
  amount: number;
  instant: boolean;
  /** The bank's own answer text, when it gave one. */
  message?: string;
};

/** Seeds the transfer form. Every field optional; the review step always follows. */
export type TransferPrefill = {
  accountNumber?: string;
  name?: string;
  iban?: string;
  /** As the user would type it: "12,50". */
  amount?: string;
  purpose?: string;
  instant?: boolean;
  /** Where the values came from — the form says so ("Aus GiroCode übernommen"). */
  source?: 'repeat' | 'refund' | 'template' | 'recent' | 'girocode';
};

/** Seeds the "Geld anfordern" GiroCode sheet. */
export type SharePrefill = {
  accountNumber?: string;
  amount?: string;
  purpose?: string;
};

export type TransferTemplate = {
  id: string;
  label: string;
  name: string;
  iban: string;
  amount?: string;
  purpose?: string;
  instant?: boolean;
  /** ISO */
  createdAt: string;
  /** ISO */
  lastUsedAt?: string;
};

/**
 * Personal data that must survive a restart but must not sit in plaintext:
 * IBANs of people you pay, what you call your accounts, how you file your
 * bookings. Encrypted server-side with a key derived from the PIN (see
 * lib/vault.ts) — so it only exists while you are logged in.
 */
export type VaultData = {
  version: 1;
  templates: TransferTemplate[];
  /** accountNumber → the name the user gave it. */
  aliases: Record<string, string>;
  /** counterpartyKey() → category, applied to every booking with that counterparty. */
  categoryRules: Record<string, CategoryId>;
  /** txKey() → category, for a single booking. Beats a rule. */
  txCategories: Record<string, CategoryId>;
  /** recurring-series ids the user said are not a contract. */
  dismissedRecurring: string[];
  /** Executed and unclear transfers of the last 14 days, for the duplicate check (lib/sent-orders.ts). */
  sentOrders: SentOrder[];
  /** ISO */
  updatedAt: string;
};

export const EMPTY_VAULT: VaultData = {
  version: 1,
  templates: [],
  aliases: {},
  categoryRules: {},
  txCategories: {},
  dismissedRecurring: [],
  sentOrders: [],
  updatedAt: new Date(0).toISOString(),
};

/**
 * idle      — not logged in yet
 * loading   — fetching after login
 * ready     — `vault` holds the decrypted data (possibly EMPTY_VAULT for a first use)
 * unavailable — no PIN in this session (cannot happen today) or the server refused
 * error     — the file exists but could not be decrypted (PIN changed at the bank);
 *             the app keeps working with an in-memory EMPTY_VAULT and offers a reset
 */
export type VaultStatus = 'idle' | 'loading' | 'ready' | 'unavailable' | 'error';

/** The /api/vault wire shapes. */
export type VaultGetResponse =
  | { status: 'ready'; data: VaultData | null }
  | { status: 'error'; reason: 'decrypt' | 'corrupt' };

export type VaultPutResponse = { ok: true; updatedAt: string };

/** Re-exported so views can import every client shape from one module. */
export type { SerializedTransaction };
