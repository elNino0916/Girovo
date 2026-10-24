// Client-side shapes shared between the provider and the views.
//
// The wire contract with the route handlers lives in fints-types.ts; this file
// is everything the browser invents on top of it — navigation, launchers,
// the encrypted personal-data vault, the inbox. One place, so a view and the
// provider can never disagree about a shape.

import type { CategoryId, CustomCategory } from './categories';
import type { SavingsGoal } from './savings-goal';
import type { SerializedTransaction, StatementBlock } from './fints-types';
import type { SavedPart } from './history';
import type { OrderSchedule } from './order-schedule';
import type { SentOrder } from './sent-orders';
import type { AvatarChoice } from './avatars';
import type { Budgets } from './budgets';
import type { LinkedBankRef } from './linked-banks';
import type { SplitPart } from './splits';

export type { CategoryId };

/** The second-level navigation under the institute bar. */
export type DashboardTab = 'overview' | 'analysis' | 'contracts' | 'settings';

/** A setting the search can bring the user to on the Einstellungen page (components/settings). */
export type SettingsTarget =
  | 'language' | 'theme' | 'idle' | 'categories' | 'logos' | 'usage' | 'device' | 'data' | 'keep' | 'backup' | 'updates';

/** A date range as `<input type="date">` speaks it: local yyyy-mm-dd. */
export type DateRange = { from: string; to: string };

/**
 * What one account's list actually holds — never what a control shows: the
 * bank's answer, and, with "Umsätze auf diesem Rechner behalten", the kept
 * Umsätze before it (`saved`).
 */
export type StatementInfo = {
  from: string;
  to: string;
  /** The bank's statement blocks of the answer the list holds (none when the bank was not asked). */
  blocks: StatementBlock[];
  /** epoch ms — when the bank answered, or the kept Umsätze were read for the list. */
  loadedAt: number;
  /**
   * The start of the list, `from` to `saved.to`, came from this computer
   * (lib/history.ts historyView); absent when the list is the bank's answer
   * alone.
   */
  saved?: SavedPart;
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
  /** The bank that sent it, as named at its login — shown once more than one bank is in the view. */
  bank?: string;
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
  /** A terminierte Überweisung or a Dauerauftrag: placed now, carried out later. */
  schedule?: OrderSchedule;
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
  source?: 'repeat' | 'refund' | 'template' | 'recent' | 'girocode' | 'invoice';
  /**
   * Android: a GiroCode still to read when the sheet opens — an invoice
   * shared with the app, or the camera from the "GiroCode scannen" shortcut
   * (components/android/useLaunches.ts).
   */
  girocode?: { file?: File; scan?: boolean; docScan?: boolean };
};

/** Seeds the "Geld anfordern" GiroCode sheet. */
export type SharePrefill = {
  accountNumber?: string;
  amount?: string;
  purpose?: string;
  /** Aufteilen: the person this request is for, and where it stands in the row of requests. */
  forName?: string;
  step?: { at: number; of: number; next?: string };
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
 * bookings, what you budget and note. Encrypted server-side with a key derived from the PIN (see
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
  /** The user's own categories (lib/splits.ts), in the order they were made. */
  customCategories: CustomCategory[];
  /**
   * txKey() → the shares of a booking the user split across categories
   * (lib/splits.ts), whole cents each. Beats a single category and a rule.
   */
  splits: Record<string, SplitPart[]>;
  /** recurring-series ids the user said are not a contract. */
  dismissedRecurring: string[];
  /** Spending category → the monthly budget in whole cents (lib/budgets.ts). */
  budgets: Budgets;
  /** txKey() → the user's own note on that booking, one line (lib/notes.ts). */
  notes: Record<string, string>;
  /** Executed and unclear transfers of the last 14 days, for the duplicate check (lib/sent-orders.ts). */
  sentOrders: SentOrder[];
  /** What the profile chip shows (lib/avatars.ts): a line icon or 'own'; absent, the initials. */
  avatar?: AvatarChoice;
  /** The user's own picture, a small data URL — kept while another choice is shown, until removed. */
  avatarImage?: string;
  /**
   * Further banks shown beside this login's (lib/linked-banks.ts): BLZ, name
   * and login name, so the next login can offer them again. Never a PIN.
   * Absent while there are none.
   */
  linkedBanks?: LinkedBankRef[];
  /**
   * Keep this login's booked Umsätze on this computer (lib/history.ts), sealed
   * with the PIN. Absent means off, the default; only `true` turns it on.
   */
  keepBookings?: true;
  /** Sparziele: one per savings account (lib/savings-goal.ts). Absent while there are none. */
  goals?: SavingsGoal[];
  /** ISO */
  updatedAt: string;
};

export const EMPTY_VAULT: VaultData = {
  version: 1,
  templates: [],
  aliases: {},
  categoryRules: {},
  txCategories: {},
  customCategories: [],
  splits: {},
  dismissedRecurring: [],
  budgets: {},
  notes: {},
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
