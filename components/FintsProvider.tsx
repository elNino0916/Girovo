'use client';

// The whole client-side state machine.
//
// Every read on the bank may need its own SCA approval, so operations are
// strictly serialized behind `busy`. A single statement query yields both the
// transactions AND the balance, which is why the dashboard path never asks
// for a balance on its own — that would cost a second approval. The balance
// enquiry (loadBalance) runs only on request: for an account without Umsätze,
// and for "Alle Salden abrufen".
//
// Around that core sits everything the browser keeps for itself: the applied
// date range, the session clock that logs an unattended dashboard out, the
// encrypted personal-data vault (aliases, templates, categories), the bank's
// messages and this session's own record of what it sent. None of it talks to
// the bank; all of it is reset by a logout, except the user's preferences.
//
// Async rule of thumb: every continuation after an `await` first checks that
// the session (and, for the TAN poll, the wait) it was started for is still
// the current one. A logout, an expiry or a cancelled approval can land while
// a request is out, and its answer must then go nowhere.

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { ApiError, SESSION_EXPIRED_EVENT, get, post, store, type SessionExpiredDetail } from '@/lib/client-api';
import { bankAnswerLines } from '@/lib/bank-answer';
import { bookingKind, categorize } from '@/lib/categorize';
import { counterpartyKey, counterpartyName, isCategoryId, rawCounterparty, txKey, type CategoryId, type CategoryResult } from '@/lib/categories';
import { parseCardAcceptor } from '@/lib/card-purpose';
import {
  dayKey, fmtDate, ibanValid, isoDate, parseAmount, presetRange, repairBankText, toLocalDate, translateType,
  fmtRange,
  type RangePreset,
} from '@/lib/format';
import { getMerchantKey, isBusinessBooking } from '@/lib/merchant-match';
import { ORDER_UNANSWERED_STATUS } from '@/lib/fints-order';
import { acceptsBalance, balanceQueue, failureSentence } from '@/lib/balances';
import { unbookedPending } from '@/lib/pending';
import { recordSentOrder, sanitizeSentOrders, type SentOrder } from '@/lib/sent-orders';
import { idleLogoutNotice, logoutNotice, unclearTransfers } from '@/lib/session-log';
import { sepaSanitize } from '@/lib/sepa-text';
import {
  EMPTY_FILTER, EMPTY_VAULT,
  type ActivityEntry, type DashboardTab, type DateRange, type InboxMessage, type SharePrefill,
  type StatementInfo, type TransferPrefill, type TransferTemplate, type TxFilter, type VaultData,
  type VaultGetResponse, type VaultPutResponse, type VaultStatus,
} from '@/lib/app-types';
import type { AnalysisPeriod, AnalysisScope } from '@/lib/app-types';
import type {
  BalanceResponse, BankMessage, ConnectResponse, Merchant, MerchantsResponse, MetaResponse, PendingResponse,
  SelectTanResponse, SerializedAccount, SerializedBalance, SerializedTanMethod,
  SerializedTransaction, SerializedVop, TanPollResponse, TransactionsResponse,
  TransferResponse,
} from '@/lib/fints-types';
import type { PopularBank } from '@/lib/banks';

export type ChosenBank = {
  blz: string;
  name: string;
  brand: string;
  bic?: string | null;
  location?: string;
};

export type BankSearchHit = {
  blz: string; name: string; location: string; bic: string; brand: string;
};

export type ToastTone = 'info' | 'error' | 'success';
export type ToastAction = { label: string; run: () => void };
/**
 * A toast as the provider hands it out. The provider never removes one by
 * itself: components/Toasts.tsx owns the timers (so it can pause them on hover
 * and focus) and calls `dismissToast(id)` when `ms` has run out.
 */
export type Toast = { id: number; message: string; tone: ToastTone; ms: number; action?: ToastAction };

export type View = 'login' | 'tanmethod' | 'dashboard';

/** `cancelled`: the login's own approval was called off, so the half-open session goes. */
export type LogoutReason = 'user' | 'idle' | 'expired' | 'cancelled';

/** The idle limits the user can choose from, in minutes. */
export const IDLE_MINUTE_CHOICES = [5, 10, 15, 30] as const;
export type IdleMinutes = (typeof IDLE_MINUTE_CHOICES)[number];

/**
 * The user's answer to "Firmenlogos anzeigen?". No name goes to the logo
 * service until it is 'on'. Kept per machine, with the other preferences.
 */
export type LogoConsent = 'unasked' | 'on' | 'off';

/** A snapshot of what to render on the print-only Kontoauszug/receipt sheet. */
export type PrintJob =
  | {
      kind: 'statement';
      account: SerializedAccount;
      bank: ChosenBank | null;
      transactions: SerializedTransaction[];
      balance: SerializedBalance | null;
      from?: string;
      to?: string;
      /**
       * The bank's statement blocks from the fetch the rows came from: their
       * opening balance is what the printed "Alter Kontostand" is checked
       * against (lib/print-doc.ts).
       */
      blocks?: StatementInfo['blocks'] | null;
    }
  | {
      kind: 'transaction';
      account: SerializedAccount;
      bank: ChosenBank | null;
      tx: SerializedTransaction;
      /** A Vormerkposten: authorised, not yet booked. The receipt must say so. */
      pending: boolean;
    };

/** When an account's Vorgemerkt list was fetched, and how it stands against the statement. */
export type PendingInfo = {
  /** epoch ms */
  loadedAt: number;
  /**
   * A statement was loaded after the list. Whatever it shows as booked has
   * left `pendingCache`; the rest may have been booked too, under another
   * date or reference — the list is older than the bookings beside it.
   */
  behindStatement: boolean;
  /** How many of the fetched items that statement already shows as booked. */
  booked: number;
};

/**
 * Why an account's last read failed, in the bank's (or the app's) words, and
 * when. Kept per account until a read of that account starts again, so a
 * failure is still a failure after another account was opened.
 */
export type LoadError = { message: string; at: number };

/** How a read ended, for a caller that goes on with the next one (loadAllBalances). */
export type LoadOutcome = 'applied' | 'failed' | 'cancelled' | 'busy' | 'skipped';

/** `onSettled` of a read: how it ended, and the reason when it failed. */
export type LoadSettled = (outcome: LoadOutcome, error?: string) => void;

/**
 * waiting → confirmed, or one of: error (the status could not be read),
 * ended (the bank closed the dialog first), refused (the bank's answer refuses
 * it — see lib/bank-answer.ts).
 */
type WaitPhase = 'waiting' | 'confirmed' | 'error' | 'ended' | 'refused';

/** What an approval is for — the overlay asks before abandoning a transfer. */
export type WaitKind = 'login' | 'statements' | 'pending' | 'balance' | 'transfer';

/**
 * The transfer an approval is for, as the bank received it (name rewritten to
 * the SEPA character set), for the user to compare with their banking app.
 */
export type WaitOrder = { amount: number; name: string; iban: string; instant: boolean };

export type WaitState = {
  open: boolean;
  kind: WaitKind | null;
  title: string;
  text: string;
  challenge: string | null;
  phase: WaitPhase;
  /** What went wrong: the bank's answer as it came (codes included), or the app's own message. */
  error: string | null;
  /** A way to ask again exists. The overlay offers it once the wait is over — or overdue — never while it runs. */
  canRetry: boolean;
  /**
   * When the approval was requested (epoch ms). The overlay counts the
   * seconds from it on its own clock — a counter ticking in this state would
   * re-render every consumer of the provider once a second, for as long as
   * the user is busy with their phone.
   */
  startedAt: number;
  /** When it stopped waiting (confirmed, failed, ended): the count freezes there. Null while waiting. */
  settledAt: number | null;
  /**
   * A Namensabgleich the bank ran on this order. Present when the challenge
   * survived the check, so the result has to travel with the approval prompt
   * rather than getting its own screen.
   */
  vop: SerializedVop | null;
  /**
   * The device the approval was sent to ("iPhone von Nino"), as the bank
   * named it in the challenge — or, failing that, the method's only active
   * medium. Null when it is not known: with two phones registered, guessing
   * would send the user to the wrong one.
   */
  tanMediaName: string | null;
  /** For a transfer: what is being approved, in the app's own words. */
  order: WaitOrder | null;
  /** A line of context, e.g. that this is the second approval right after the login. */
  note: string | null;
};

const IDLE_WAIT: WaitState = {
  open: false, kind: null, title: '', text: '', challenge: null,
  phase: 'waiting', error: null, canRetry: false, startedAt: 0, settledAt: null, vop: null, tanMediaName: null,
  order: null, note: null,
};

/** What each kind of approval asks the user to confirm, as the object of "bestätige …". */
const WAIT_SUBJECT: Record<WaitKind, string> = {
  login: 'die Anmeldung',
  statements: 'den Umsatzabruf',
  pending: 'den Abruf der vorgemerkten Umsätze',
  balance: 'die Saldoabfrage',
  transfer: 'die Überweisung',
};

type TanGate = { needsTan?: boolean; tanChallenge?: string | null; tanMediaName?: string | null; vop?: SerializedVop };

type WaitCallbacks = {
  onDone?: (r: TanPollResponse & { status: 'done' }) => void;
  retry?: (() => void) | null;
  onDialogEnded?: ((r: TanPollResponse) => void) | null;
  /** The user pressed Abbrechen in the overlay. */
  onCancelled?: (() => void) | null;
  /**
   * The bank answered the approval with an error ('refused' or 'unclear', see
   * TanPollResponse). Without a handler the overlay shows it.
   */
  onAnswer?: ((status: 'refused' | 'unclear', bankAnswers: string) => void) | null;
};

/** What the transfer form submits; the server parses `amount` itself. */
export type TransferPayload = {
  accountNumber: string; recipientName: string; iban: string;
  amount: string; purpose: string; instant: boolean;
};

export type TransferHandlers = {
  onExecuted: (bankAnswers?: string) => void;
  /**
   * The order reached the bank but its fate is unknown: the dialog ended
   * before the approval was confirmed, the approval was abandoned, the
   * connection broke mid-request, or the bank answered with an error that
   * does not refuse the order. Never to be presented as a failure — the
   * money may have moved. `bankAnswers`: the bank's words, when it said any.
   */
  onUnknown: (bankAnswers?: string) => void;
  /**
   * The bank refused the order — before the approval or after it — and said
   * nothing else (lib/bank-answer.ts). Nothing was executed; the order may be
   * corrected and sent again.
   */
  onRefused: (bankAnswers: string) => void;
  /** Not sent, or not accepted for processing (validation, busy, a check still running): may be retried. */
  onError: (message: string) => void;
  onTanStarted: () => void;
  /** The bank checked the payee name and wants an explicit go-ahead. */
  onVop: (vop: SerializedVop) => void;
};

// ---------------------------------------------------------------------------
// Tunables

const DEFAULT_IDLE_MINUTES: IdleMinutes = 10;
/** What counts as the user being there. Pointer movement alone does not. */
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
/** The server forgets a session after 30 idle minutes; one ping a minute while active is plenty. */
const KEEPALIVE_EVERY_MS = 60_000;
/** idleDeadline is state, and state re-renders: publish it at most this often while far away. */
const DEADLINE_PUBLISH_MS = 10_000;
/** SessionGuard asks "Möchtest du angemeldet bleiben?" inside this window. */
const WARNING_WINDOW_MS = 60_000;
const VAULT_SAVE_DELAY_MS = 800;
const LOGOUT_FLUSH_TIMEOUT_MS = 2000;
/** How long "Freigabe bestätigt" stays up before the overlay leaves. */
const CONFIRMED_LINGER_MS = 700;
/** A statement approval this soon after the login's own is "the second one" (startDecoupledWait). */
const SECOND_APPROVAL_MS = 30_000;
const DEFAULT_RANGE_PRESET: RangePreset = '90d';
const MAX_TOASTS = 4; // = Toasts.tsx MAX_VISIBLE: a queued toast nobody can see would expire unseen
const MAX_ACTIVITY = 50;
const MAX_TEMPLATES = 200;
const MAX_ALIAS = 60;
/** The idle logout happens while nobody is looking; the notice has to outlast the absence. */
const IDLE_NOTICE_MS = 10 * 60_000;
/** A wait, not a failure: toasted as a notice, never in the error's red. */
const BUSY_MESSAGE = 'Bitte warten — ein anderer Vorgang läuft noch.';

// ---------------------------------------------------------------------------
// Pure helpers

const isIdleChoice = (n: unknown): n is IdleMinutes =>
  (IDLE_MINUTE_CHOICES as readonly unknown[]).includes(n);

/** The statement cache's key: the range actually asked for. */
const rangeKey = (r: DateRange) => `${r.from}|${r.to}`;

/**
 * What an applied range that ended today was: the day it meant by "today",
 * and the preset it was, if any — "Letzte 90 Tage" stays ninety days long
 * after midnight, "Dieses Jahr" follows the calendar.
 */
type RangeAnchor = { to: string; preset: RangePreset | null };

/** The presets that run up to today, and so move with it. */
const ROLLING_PRESETS: readonly RangePreset[] = ['30d', '90d', '365d', 'thisMonth', 'thisYear'];

/** `r` as the anchor it sets, or null for a range that does not end today. */
function anchorOf(r: DateRange, now = new Date()): RangeAnchor | null {
  if (r.to !== isoDate(now)) return null;
  const preset = ROLLING_PRESETS.find((id) => {
    const p = presetRange(id, now);
    return p.from === r.from && p.to === r.to;
  });
  return { to: r.to, preset: preset ?? null };
}

/**
 * The range a load uses now. One that ended "today" when it was applied
 * (`anchor`) keeps meaning "until today" after midnight. A preset moves as a
 * whole: a rolling window keeps its length — ninety days stay inside the
 * window most banks serve without an approval, and "90 Tage" stays the
 * preset that is ticked. A hand-picked start date stays where the user put
 * it. The same object when nothing moved.
 */
function rangeForLoad(r: DateRange, anchor: RangeAnchor | null, now = new Date()): DateRange {
  const today = isoDate(now);
  if (!anchor || r.to >= today || r.to !== anchor.to) return r;
  return anchor.preset ? presetRange(anchor.preset, now) : { from: r.from, to: today };
}

/**
 * Marks a part of the page where input does not count as being there: the
 * auto-logout warning. A key or a press inside it is someone deciding, and
 * only its own buttons (and Escape, and the backdrop) may decide — were a
 * pointerdown on "Abmelden" to extend the session, the dialog would be gone
 * before the click arrived, and the logout with it.
 */
export const IDLE_NEUTRAL_ATTR = 'data-idle-neutral';

/** Whether an input event counts as the user being there (see IDLE_NEUTRAL_ATTR). */
export function countsAsActivity(e: Event): boolean {
  const t = e.target;
  return !(t instanceof Element && t.closest(`[${IDLE_NEUTRAL_ATTR}]`));
}

/**
 * An approval being waited for holds the session clock; one that failed or
 * ended is a dialog waiting for someone, and does not. One rule for the
 * provider's clock and for SessionGuard, so the warning stays away exactly as
 * long as the clock is held — never while an auto-logout can still happen.
 */
export const waitHoldsSession = (w: WaitState) => w.open && (w.phase === 'waiting' || w.phase === 'confirmed');

/**
 * The last ninety days up to today — the very range of the "90 Tage" preset,
 * so the period control recognises the default as one.
 */
function defaultRange(now = new Date()): DateRange {
  return presetRange(DEFAULT_RANGE_PRESET, now);
}

/** A yyyy-mm-dd that names a real day — "2026-02-31" does not. */
function isRealDay(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

/**
 * A range as the bank may be asked for it: both ends real days, in order, and
 * none after today (a statement cannot hold bookings that have not happened).
 * Null for anything that is not a date at all.
 */
function normalizeRange(r: DateRange, today = isoDate(new Date())): DateRange | null {
  if (!r || !isRealDay(r.from) || !isRealDay(r.to)) return null;
  let { from, to } = r;
  if (from > to) [from, to] = [to, from];
  if (to > today) to = today;
  if (from > today) from = today;
  return { from, to };
}

const normIban = (iban: string | null | undefined) => String(iban ?? '').replace(/\s+/g, '').toUpperCase();

/** An id for a template or a log entry. */
function newId(): string {
  const c = globalThis.crypto;
  if (typeof c.randomUUID === 'function') return c.randomUUID();
  // randomUUID exists only in secure contexts — the app reached over a LAN
  // address in a plain browser is not one. Same shape, from the same RNG.
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * An amount as typed into the transfer form ("1.000,50", "12,5", "12.50"),
 * for the session's activity log. The server parses the same string for the
 * actual order; this only has to describe it.
 */
function typedAmount(raw: string): number {
  return Math.abs(parseAmount(raw) ?? 0);
}

/** A submitted order as the vault's two-week log keeps it (lib/sent-orders.ts), or null without amount or IBAN. */
function sentOrderOf(p: TransferPayload, outcome: SentOrder['outcome'], at: string): SentOrder | null {
  const cents = Math.round(typedAmount(p.amount) * 100);
  const iban = normIban(p.iban);
  return cents > 0 && iban ? { at, accountNumber: p.accountNumber, iban, cents, outcome } : null;
}

/** One login message as an inbox entry, or null when the bank sent nothing readable. */
function toInboxMessage(m: BankMessage, receivedAt: string): InboxMessage | null {
  const text = repairBankText(String(m?.text ?? '').trim());
  let subject = repairBankText(String(m?.subject ?? '').trim());
  if (!subject && !text) return null;
  if (!subject) {
    const first = text.split(/\r?\n/)[0].trim();
    subject = first.length > 80 ? `${first.slice(0, 79)}…` : first;
  }
  return { id: newId(), subject, text, receivedAt, read: false };
}

/** Removes `key` from a record without mutating it; the same object when it is absent. */
function without<V>(rec: Record<string, V>, key: string): Record<string, V> {
  if (!Object.prototype.hasOwnProperty.call(rec, key)) return rec;
  const next = { ...rec };
  delete next[key];
  return next;
}

/**
 * The vault as the client may rely on it, whatever the file held. The server
 * sanitises too; this guards against an older shape or a hand-edited field
 * taking the dashboard down with it.
 */
function normalizeVault(raw: VaultData | null | undefined): VaultData {
  if (!raw || typeof raw !== 'object') return EMPTY_VAULT;
  const record = (v: unknown): Record<string, unknown> =>
    v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const categories = (v: unknown): Record<string, CategoryId> => {
    const out: Record<string, CategoryId> = {};
    for (const [k, id] of Object.entries(record(v))) if (isCategoryId(id)) out[k] = id;
    return out;
  };
  const aliases: Record<string, string> = {};
  for (const [k, a] of Object.entries(record(raw.aliases))) if (typeof a === 'string' && a.trim()) aliases[k] = a;
  return {
    version: 1,
    templates: Array.isArray(raw.templates)
      ? raw.templates.filter((t): t is TransferTemplate => !!t && typeof t.id === 'string' && typeof t.iban === 'string')
      : [],
    aliases,
    categoryRules: categories(raw.categoryRules),
    txCategories: categories(raw.txCategories),
    dismissedRecurring: Array.isArray(raw.dismissedRecurring)
      ? raw.dismissedRecurring.filter((id): id is string => typeof id === 'string')
      : [],
    sentOrders: sanitizeSentOrders(raw.sentOrders),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : EMPTY_VAULT.updatedAt,
  };
}

/**
 * The bank's own closing balance at the end of a fetched range: the latest
 * statement block that carries one. Null when the bank sent none — a printed
 * statement then says so rather than borrowing today's balance.
 */
function closingBalanceOf(info: StatementInfo, fallbackCurrency: string): SerializedBalance | null {
  let best: StatementInfo['blocks'][number] | null = null;
  for (const b of info.blocks) {
    if (b.closingBalance == null) continue;
    if (!best || (b.closingDate ?? '') >= (best.closingDate ?? '')) best = b;
  }
  if (!best || best.closingBalance == null) return null;
  return {
    balance: best.closingBalance,
    currency: best.currency || fallbackCurrency,
    date: best.closingDate ?? info.to,
    availableAmount: null,
  };
}

/**
 * The newest local day a statement actually covers: its latest closing
 * balance or booking day. Null when it carries neither.
 */
function deliveredEnd(txs: readonly SerializedTransaction[], blocks: StatementInfo['blocks']): string | null {
  let end = '';
  for (const b of blocks) {
    const d = dayKey(b.closingDate);
    if (d > end) end = d;
  }
  for (const t of txs) {
    const d = dayKey(t.entryDate);
    if (d > end) end = d;
  }
  return end || null;
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A login's id, so "Abbrechen" can name it to the server. Random, never derived from the user. */
const newAttemptId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

// ---------------------------------------------------------------------------

function useFintsState() {
  const [view, setView] = useState<View>('login');
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [popularBanks, setPopularBanks] = useState<PopularBank[]>([]);
  const [logoFiles, setLogoFiles] = useState<Record<string, string>>({});

  const [bank, setBank] = useState<ChosenBank | null>(null);
  /** Until the bank remembered from last time is confirmed against the list. */
  const [bankChecking, setBankChecking] = useState(true);
  /** That remembered bank, when the list no longer has it (merged, renumbered). */
  const [staleBank, setStaleBank] = useState<ChosenBank | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [userId, setUserId] = useState('');

  const [tanMethods, setTanMethods] = useState<SerializedTanMethod[]>([]);
  const [selectedMethod, setSelectedMethod] = useState<SerializedTanMethod | null>(null);
  const [mediaChoice, setMediaChoice] = useState<string[] | null>(null);
  const [tanMethodError, setTanMethodError] = useState<string | null>(null);

  const [accounts, setAccounts] = useState<SerializedAccount[]>([]);
  const [activeAccount, setActiveAccount] = useState<SerializedAccount | null>(null);
  const [balances, setBalances] = useState<Record<string, SerializedBalance>>({});
  const [txCache, setTxCache] = useState<Record<string, { key: string; txs: SerializedTransaction[] }>>({});
  /** Vorgemerkte as the bank listed them, with the moment it did (see `pendingCache` below). */
  const [pendingFetched, setPendingFetched] = useState<Record<string, { txs: SerializedTransaction[]; loadedAt: number }>>({});
  const [statementInfo, setStatementInfo] = useState<Record<string, StatementInfo>>({});
  /** Per account: why its last statement load failed (see LoadError). */
  const [txErrors, setTxErrors] = useState<Record<string, LoadError>>({});
  /** Per account: why its last balance enquiry failed. */
  const [balanceErrors, setBalanceErrors] = useState<Record<string, LoadError>>({});
  /** The account whose balance alone is being asked for (loadBalance) — not a statement load. */
  const [balanceLoading, setBalanceLoading] = useState<string | null>(null);
  /** "Alle Salden abrufen" is working through the accounts. */
  const [loadingAllBalances, setLoadingAllBalances] = useState(false);

  /** Counterparty name → company, or null once we know there's no match. */
  const [merchants, setMerchants] = useState<Record<string, Merchant | null>>({});

  const [busy, setBusyState] = useState(false);
  const [loadingAccount, setLoadingAccount] = useState<string | null>(null);
  const [pendingLoading, setPendingLoading] = useState<string | null>(null);
  /** Per account: why its last Vorgemerkt fetch failed — the panel says so, not only a toast. */
  const [pendingErrors, setPendingErrors] = useState<Record<string, LoadError>>({});
  const [deviceRemembered, setDeviceRemembered] = useState(false);

  const [wait, setWait] = useState<WaitState>(IDLE_WAIT);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [printJob, setPrintJob] = useState<PrintJob | null>(null);

  // Preferences — the only state a logout keeps.
  const [privacy, setPrivacy] = useState(false);
  const [idleMinutes, setIdleMinutesState] = useState<IdleMinutes>(DEFAULT_IDLE_MINUTES);
  /** Shortcuts on one unmodified key (/, ?, N, B, G, 1–9). On unless turned off. */
  const [singleKeyShortcuts, setSingleKeyShortcutsState] = useState(true);
  /** Company logos: off until the user answers the dashboard's one-time question. */
  const [logoConsent, setLogoConsentState] = useState<LogoConsent>('unasked');

  // Session clock.
  const [sessionStartedAt, setSessionStartedAt] = useState<number | null>(null);
  const [idleDeadline, setIdleDeadline] = useState<number | null>(null);

  // Navigation and the launchers any view can open.
  const [tab, setTabState] = useState<DashboardTab>('overview');
  const [txFilter, setTxFilter] = useState<TxFilter>(EMPTY_FILTER);
  const [txFocusNonce, setTxFocusNonce] = useState(0);
  // The Umsatzanalyse's month (null: not chosen yet) and accounts — kept here
  // rather than in the tab, so a look at the Umsätze and back keeps them.
  const [analysisPeriod, setAnalysisPeriod] = useState<AnalysisPeriod | null>(null);
  const [analysisScope, setAnalysisScope] = useState<AnalysisScope>('account');
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferPrefill, setTransferPrefill] = useState<TransferPrefill | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [sharePrefill, setSharePrefill] = useState<SharePrefill | null>(null);
  const [inboxOpen, setInboxOpenState] = useState(false);
  const [paletteOpen, setPaletteOpenState] = useState(false);
  const [shortcutsOpen, setShortcutsOpenState] = useState(false);
  /** "Trotzdem abmelden?" — asked only while the session log holds a transfer whose status is unclear. */
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);

  // The applied statement range — what every load asks the bank for.
  const [range, setRange] = useState<DateRange>(() => defaultRange());

  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);

  const [vault, setVault] = useState<VaultData | null>(null);
  const [vaultStatus, setVaultStatus] = useState<VaultStatus>('idle');

  // Refs mirror the state the async loops read, so a long-running approval
  // never closes over a stale render.
  const sessionRef = useRef<string | null>(null);
  /** Written together with `busy` (see setBusy), never from a render — the gate must hold within one tick. */
  const busyRef = useRef(false);
  const accountsRef = useRef<SerializedAccount[]>([]);
  const activeAccountRef = useRef<SerializedAccount | null>(null);
  /**
   * The TAN method in use, written together with its state (see
   * setSelectedMethodBoth). Approvals read it from here: a login continues
   * straight into its first statement load from inside the render that
   * started it, where the state would still say "none chosen".
   */
  const selectedMethodRef = useRef<SerializedTanMethod | null>(null);
  const tanMethodsRef = useRef<SerializedTanMethod[]>([]);
  const balancesRef = useRef(balances);
  /** What an account is called on screen (alias or bank name), for a toast written after an await. */
  const accountLabelRef = useRef((a: SerializedAccount) => a.product?.trim() || translateType(a.accountType));
  const txCacheRef = useRef(txCache);
  const metaRef = useRef<MetaResponse | null>(null);
  const waitRef = useRef<WaitState>(IDLE_WAIT);
  /** Names already sent for logo lookup — each is attempted once per session. */
  const merchantsAsked = useRef<Set<string>>(new Set());
  const logoConsentRef = useRef<LogoConsent>('unasked');
  /** The Vorgemerkt lists, for the logo lookup that catches up after a yes. */
  const pendingFetchedRef = useRef(pendingFetched);
  pendingFetchedRef.current = pendingFetched;
  const waitCbRef = useRef<WaitCallbacks>({});
  /**
   * Bumped whenever a wait starts, closes or the session ends. A poll that
   * comes back under an older number belongs to an approval nobody is looking
   * at any more, and is dropped.
   */
  const waitGenRef = useRef(0);
  /** The last approval that came through: what it was for, under which generation, when. */
  const lastConfirmedRef = useRef<{ kind: WaitKind; gen: number; at: number } | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastId = useRef(0);

  const rangeRef = useRef<DateRange>(range);
  /** What `range` meant when it was applied, if it ended today (see rangeForLoad). */
  const rangeAnchorRef = useRef<RangeAnchor | null>({ to: range.to, preset: DEFAULT_RANGE_PRESET });

  const privacyRef = useRef(false);
  const idleMsRef = useRef(DEFAULT_IDLE_MINUTES * 60_000);
  /** The exact auto-logout moment; `idleDeadline` is its throttled, renderable copy. */
  const idleDeadlineRef = useRef<number | null>(null);
  const shownDeadlineRef = useRef<{ value: number | null; at: number }>({ value: null, at: 0 });
  const lastActivityRef = useRef(0);
  const lastKeepaliveRef = useRef(0);

  const messagesRef = useRef<InboxMessage[]>([]);
  /** The session log, for a logout that has to say what it is about to drop. */
  const activityRef = useRef<ActivityEntry[]>([]);
  activityRef.current = activity;
  const lastTransferRef = useRef<TransferPayload | null>(null);

  const vaultRef = useRef<VaultData | null>(null);
  const vaultStatusRef = useRef<VaultStatus>('idle');
  /** Changes not yet on disk. */
  const vaultDirtyRef = useRef(false);
  const vaultTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Saves run strictly one after another, so an older PUT can never land last. */
  const vaultChainRef = useRef<Promise<void>>(Promise.resolve());
  /** Updates made while the vault was still loading, replayed onto what arrives. */
  const vaultQueueRef = useRef<Array<(v: VaultData) => VaultData>>([]);
  /** One failure toast per streak of failed saves, not one per keystroke. */
  const vaultFailedRef = useRef(false);
  const vaultLoadGenRef = useRef(0);
  /** The session whose dashboard has been opened. */
  const readySidRef = useRef<string | null>(null);

  const logoutRef = useRef<(reason?: LogoutReason) => Promise<void>>(async () => {});
  /** For the "Gerät gemerkt" toast, which is set up before forgetDevice exists. */
  const forgetDeviceRef = useRef<() => Promise<void>>(async () => {});

  sessionRef.current = sessionId;
  accountsRef.current = accounts;
  activeAccountRef.current = activeAccount;
  balancesRef.current = balances;
  txCacheRef.current = txCache;
  metaRef.current = meta;
  waitRef.current = wait;

  const isCurrent = useCallback((sid: string | null) => sid !== null && sessionRef.current === sid, []);

  const setBusy = useCallback((b: boolean) => {
    busyRef.current = b;
    setBusyState(b);
  }, []);

  const setSelectedMethodBoth = useCallback((m: SerializedTanMethod | null) => {
    selectedMethodRef.current = m;
    setSelectedMethod(m);
  }, []);

  const setTanMethodsBoth = useCallback((list: SerializedTanMethod[]) => {
    tanMethodsRef.current = list;
    setTanMethods(list);
  }, []);

  // ---- toasts -------------------------------------------------------------
  // How long one stays is decided in Toasts.tsx (lib/toast-time.ts): `ms` is
  // the least the caller asks for, and reading time or an action lengthen it.
  const toast = useCallback((message: string, tone: ToastTone = 'info', ms?: number, action?: ToastAction): number => {
    const id = ++toastId.current;
    const entry: Toast = {
      id, message, tone, ms: ms ?? (tone === 'error' ? 10_000 : 4200), ...(action ? { action } : {}),
    };
    // The same message again replaces the earlier one (and restarts its time)
    // rather than stacking — "Bitte warten" five times says nothing new.
    setToasts((list) => [...list.filter((t) => t.message !== message || t.tone !== tone), entry].slice(-MAX_TOASTS));
    return id;
  }, []);

  /** Rewords a toast still on screen, its time running on — for a fact that is only confirmed later. */
  const rewordToast = useCallback((id: number, message: string) => {
    setToasts((list) => list.map((t) => (t.id === id ? { ...t, message } : t)));
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  // ---- boot ---------------------------------------------------------------
  useEffect(() => {
    get<MetaResponse>('/api/meta').then(setMeta).catch(() => { /* surfaces on connect */ });

    get<string[]>('/api/logos')
      .then((files) => {
        const map: Record<string, string> = {};
        for (const f of files) {
          const brand = f.replace(/\.(svg|png)$/i, '');
          // prefer svg over png when both exist
          if (!map[brand] || /\.svg$/i.test(f)) map[brand] = f;
        }
        setLogoFiles(map);
      })
      .catch(() => { /* fall back to monogram chips */ });

    get<PopularBank[]>('/api/banks').then(setPopularBanks).catch(() => setPopularBanks([]));

    // The bank picked last time, once the list confirms it is still there —
    // before the credentials form shows, so nobody types a PIN for a bank
    // that has since merged away.
    let last: ChosenBank | null = null;
    try { last = JSON.parse(store.get('fints.lastBank') ?? 'null') as ChosenBank | null; } catch { /* stale value */ }
    if (last?.blz) {
      const remembered = last;
      get<{ bank: BankSearchHit | null }>(`/api/banks?blz=${encodeURIComponent(remembered.blz)}`)
        .then(({ bank: listed }) => {
          if (listed) {
            setBank({ blz: listed.blz, name: listed.name, location: listed.location, brand: listed.brand, bic: listed.bic });
          } else {
            setStaleBank(remembered);
          }
        })
        // The check itself failed: keep the bank. A login would say if it is gone.
        .catch(() => setBank(remembered))
        .finally(() => setBankChecking(false));
    } else {
      setBankChecking(false);
    }

    // Read after mount rather than in the initial state: the server render has
    // no store, and both only matter once a dashboard is open anyway.
    if (store.get('fints.privacy') === '1') {
      privacyRef.current = true;
      setPrivacy(true);
    }
    const idle = Number(store.get('fints.idleMinutes'));
    if (isIdleChoice(idle)) {
      idleMsRef.current = idle * 60_000;
      setIdleMinutesState(idle);
    }
    if (store.get('fints.singleKeys') === '0') setSingleKeyShortcutsState(false);
    const logos = store.get('fints.merchantLogos');
    if (logos === 'on' || logos === 'off') {
      logoConsentRef.current = logos;
      setLogoConsentState(logos);
    }
  }, []);

  // Once a bank is chosen, the note about the one that left the list has done its job.
  useEffect(() => {
    if (bank) setStaleBank(null);
  }, [bank]);

  useEffect(() => () => {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    if (vaultTimerRef.current) clearTimeout(vaultTimerRef.current);
  }, []);

  // ---- applied range ------------------------------------------------------
  const setAppliedRange = useCallback((r: DateRange) => {
    rangeRef.current = r;
    rangeAnchorRef.current = anchorOf(r);
    setRange(r);
  }, []);

  /**
   * The range a load should use now. One that ended "today" when it was
   * applied keeps meaning "until today" after midnight — otherwise a session
   * running past 0:00 would quietly stop fetching today's bookings and stop
   * updating the balance (see the balances rule in loadTransactions).
   */
  const resolveRange = useCallback((): DateRange => {
    const r = rangeRef.current;
    const next = rangeForLoad(r, rangeAnchorRef.current);
    if (next !== r) setAppliedRange(next);
    return next;
  }, [setAppliedRange]);

  /**
   * Whether switching to this account is answered from the cache — its
   * bookings are loaded for the very range a load would ask for now (after
   * midnight too) — or would ask the bank again, perhaps for a TAN. Read at
   * the moment of a click; nothing is applied.
   */
  const isLoadedForAppliedRange = useCallback((accountNumber: string): boolean => (
    txCacheRef.current[accountNumber]?.key === rangeKey(rangeForLoad(rangeRef.current, rangeAnchorRef.current))
  ), []);

  // ---- decoupled TAN wait -------------------------------------------------
  const stopTimers = useCallback(() => {
    if (pollTimer.current) { clearTimeout(pollTimer.current); pollTimer.current = null; }
  }, []);

  const startDecoupledWait = useCallback((
    method: SerializedTanMethod | null,
    data: TanGate,
    cbs: WaitCallbacks,
    opts: {
      kind?: WaitKind;
      /** What the user confirms, as the object of "bestätige …": "den Abruf der Umsätze von …". */
      subject?: string;
      order?: WaitOrder | null;
    } = {},
  ) => {
    stopTimers();
    const kind = opts.kind ?? 'statements';
    // Right after the login's own approval, a statement that asks for one
    // more looks like the first request again. Said once, so it is not
    // mistaken for that one having failed.
    const prev = lastConfirmedRef.current;
    lastConfirmedRef.current = null;
    const second = kind === 'statements' && prev?.kind === 'login' && prev.gen === waitGenRef.current
      && Date.now() - prev.at < SECOND_APPROVAL_MS;
    const gen = ++waitGenRef.current;
    const sid = sessionRef.current;
    waitCbRef.current = cbs;
    const subject = opts.subject || WAIT_SUBJECT[kind];
    setWait({
      open: true,
      kind,
      // The overlay names each kind of approval itself (TanWaitOverlay.tsx).
      title: '',
      text: method?.isDecoupled
        ? `Öffne „${method.name}“ und bestätige ${subject}.`
        : `Bestätige ${subject} in deiner Banking-App.`,
      challenge: data.tanChallenge || null,
      phase: 'waiting',
      error: null,
      canRetry: !!cbs.retry,
      startedAt: Date.now(),
      settledAt: null,
      vop: data.vop || null,
      tanMediaName: data.tanMediaName?.trim()
        || (method?.activeTanMedia?.length === 1 ? method.activeTanMedia[0] : null)
        || null,
      order: opts.order ?? null,
      note: second ? 'Die Anmeldung ist freigegeben – für die Umsätze fragt deine Bank ein zweites Mal.' : null,
    });

    const interval = Math.max(1500, (method?.decoupled?.waitBetween || 2) * 1000);
    const firstDelay = Math.max(1000, (method?.decoupled?.waitBeforeFirst || 1) * 1000);

    const poll = async () => {
      pollTimer.current = null;
      if (gen !== waitGenRef.current) return;
      try {
        const r = await post<TanPollResponse>('/api/tan-poll', { sessionId: sid });
        // Cancelled, superseded or logged out while the request was out.
        if (gen !== waitGenRef.current) return;
        if (r.status === 'pending') {
          pollTimer.current = setTimeout(poll, interval);
          return;
        }
        if (r.status === 'dialog_ended') {
          stopTimers();
          const handler = waitCbRef.current.onDialogEnded;
          if (handler) { handler(r); return; }
          setWait((w) => ({
            ...w,
            phase: 'ended',
            settledAt: Date.now(),
            title: 'Freigabe nicht rechtzeitig angekommen',
            // The bank's timeout, not the user's: no "zügig" (critique auth #6).
            text: 'Deine Bank hat die Anfrage beendet. Sende sie neu und bestätige sie in der App.',
            canRetry: !!waitCbRef.current.retry,
          }));
          return;
        }
        if (r.status === 'refused' || r.status === 'unclear') {
          // The bank's own answer — never mistaken for a lost connection.
          stopTimers();
          const handler = waitCbRef.current.onAnswer;
          if (handler) { handler(r.status, r.bankAnswers); return; }
          setWait((w) => ({
            ...w,
            phase: r.status === 'refused' ? 'refused' : 'error',
            settledAt: Date.now(),
            error: r.bankAnswers || 'Deine Bank hat die Freigabe nicht bestätigt.',
            canRetry: !!waitCbRef.current.retry,
          }));
          return;
        }
        stopTimers();
        lastConfirmedRef.current = { kind, gen, at: Date.now() };
        setWait((w) => ({ ...w, phase: 'confirmed', settledAt: Date.now() }));
        // Only closes *this* wait: onDone may already have started the next
        // one (a statement that needs its own approval right after login).
        setTimeout(() => { if (gen === waitGenRef.current) setWait(IDLE_WAIT); }, CONFIRMED_LINGER_MS);
        waitCbRef.current.onDone?.(r);
      } catch (err) {
        // A 401 has already logged out (and bumped the generation) by now.
        // Anything else — the bank unreachable, "Kein offener Vorgang" — says
        // nothing about the approval: the overlay calls it unverifiable.
        if (gen !== waitGenRef.current) return;
        stopTimers();
        setWait((w) => ({
          ...w,
          phase: 'error',
          settledAt: Date.now(),
          error: (err as Error).message,
          canRetry: !!waitCbRef.current.retry,
        }));
      }
    };

    pollTimer.current = setTimeout(poll, firstDelay);
  }, [stopTimers]);

  const closeWait = useCallback(() => {
    waitGenRef.current++;
    stopTimers();
    setWait(IDLE_WAIT);
  }, [stopTimers]);

  const retryWait = useCallback(() => {
    const retry = waitCbRef.current.retry;
    closeWait();
    retry?.();
  }, [closeWait]);

  const cancelWait = useCallback(async () => {
    const { onCancelled } = waitCbRef.current;
    waitCbRef.current = {};
    closeWait();
    // Cancelling the very first approval (the login sync) leaves nothing to
    // show — go back to the login screen rather than an empty dashboard. As a
    // logout, so the half-open session (and the PIN it holds in the server's
    // memory) is dropped now rather than by the 30-minute sweep.
    if (!accountsRef.current.length) {
      void logoutRef.current('cancelled');
      return;
    }
    setBusy(false);
    setLoadingAccount(null);
    setPendingLoading(null);
    onCancelled?.();
    try { await post('/api/cancel-pending', { sessionId: sessionRef.current }); } catch { /* best effort */ }
  }, [closeWait, setBusy]);

  /**
   * The method a mid-session approval should be attributed to — and polled
   * at the pace of: its HITANS timing says how long to wait before the first
   * status request and between them, and the bank counts the requests.
   * Read from refs, because the callers are often closures from an earlier
   * render (the first statement right after the login).
   */
  const decoupledMethod = useCallback(() => {
    // Never a typed-TAN method as a stand-in: an app-approval wait cannot
    // succeed on one. Without a decoupled method the wait says only "in
    // deiner Banking-App" and polls at the default pace.
    return selectedMethodRef.current || tanMethodsRef.current.find((m) => m.isDecoupled) || null;
  }, []);

  /** An account as an approval names it — the user's own name for it first (read from the ref: see above). */
  const approvalAccountName = useCallback((a: SerializedAccount) => (
    vaultRef.current?.aliases?.[a.accountNumber] || a.product?.trim() || translateType(a.accountType)
  ), []);

  // ---- company logos ------------------------------------------------------
  // Decoration, so it runs outside the `busy` gate that serialises bank calls
  // and never blocks or fails a statement. Each counterparty is asked about
  // once per session; the server caches misses too.
  //
  // Names leave the machine for Brandfetch only once the user has said yes:
  // until then every lookup is held (not queued — setLogoConsent catches up
  // on what is loaded by then), and a build without the feature never asks.
  const resolveMerchants = useCallback(async (txs: SerializedTransaction[]) => {
    if (!metaRef.current?.merchantLogos || logoConsentRef.current !== 'on') return;
    const sid = sessionRef.current;
    // Every counterparty is offered, whatever the booking type — a salary from
    // a named employer deserves its mark too. What the booking decides is only
    // how much benefit of the doubt the name gets: a direct debit or a card
    // payment cannot have a private person on the other side, so those names
    // are flagged and may skip the person veto.
    const business = new Set(
      txs.filter((t) => isBusinessBooking(t) || bookingKind(t) === 'karte').map((t) => counterpartyName(t)).filter(Boolean),
    );
    const items = txs
      .map((t) => {
        const name = counterpartyName(t);
        const purpose = (t.purpose || '').trim();
        const key = getMerchantKey(t);
        // A name cut from a card terminal's descriptor is matched exactly or
        // not at all (see MerchantItem.strict in lib/merchants.ts).
        const strict = parseCardAcceptor(rawCounterparty(t)) !== null;
        return { name, purpose, key, strict };
      })
      .filter((item) => item.name && !merchantsAsked.current.has(item.key));

    if (!items.length) return;
    items.forEach((item) => merchantsAsked.current.add(item.key));

    try {
      const found = await post<MerchantsResponse>('/api/merchants', {
        sessionId: sid, items, businessNames: [...business],
      });
      // Switched off while the lookup ran: its logos stay unshown.
      if (!isCurrent(sid) || logoConsentRef.current !== 'on') return;
      setMerchants((m) => ({ ...m, ...found }));
    } catch { /* a missing logo is not worth surfacing */ }
  }, [isCurrent]);

  // ---- vault --------------------------------------------------------------
  // Personal data that must survive a restart without sitting in plaintext:
  // the server encrypts it with a key derived from the PIN (lib/vault.ts).
  // Edits apply at once in memory and reach the disk 800 ms after the last one.
  const setVaultStatusBoth = useCallback((s: VaultStatus) => {
    vaultStatusRef.current = s;
    setVaultStatus(s);
  }, []);

  /**
   * Starts saving what is unsaved, and resolves once every save so far has
   * settled. Session and data are captured *now*, synchronously — logout calls
   * this and then resets the state, and the save must still carry both.
   */
  const flushVault = useCallback((): Promise<void> => {
    if (vaultTimerRef.current) { clearTimeout(vaultTimerRef.current); vaultTimerRef.current = null; }
    const sid = sessionRef.current;
    const data = vaultRef.current;
    if (vaultDirtyRef.current && sid && data && vaultStatusRef.current === 'ready') {
      vaultDirtyRef.current = false;
      vaultChainRef.current = vaultChainRef.current.then(async () => {
        try {
          await post<VaultPutResponse>('/api/vault', { sessionId: sid, op: 'put', data });
          vaultFailedRef.current = false;
        } catch (err) {
          // Logged out or expired meanwhile: there is nothing left to save to.
          if (!isCurrent(sid)) return;
          // Still unsaved — the next change (or the logout flush) tries again.
          vaultDirtyRef.current = true;
          if (!vaultFailedRef.current) {
            vaultFailedRef.current = true;
            // A 4xx refusal says what to do about it ("Zu viele gespeicherte
            // Einträge …"); anything else gets the plain statement.
            const refused = err instanceof ApiError && err.status >= 400 && err.status < 500;
            toast(refused ? err.message : 'Deine persönlichen Einstellungen konnten nicht gespeichert werden.', 'error');
          }
        }
      });
    }
    return vaultChainRef.current;
  }, [isCurrent, toast]);

  const scheduleVaultSave = useCallback(() => {
    if (vaultTimerRef.current) clearTimeout(vaultTimerRef.current);
    vaultTimerRef.current = setTimeout(() => {
      vaultTimerRef.current = null;
      void flushVault();
    }, VAULT_SAVE_DELAY_MS);
  }, [flushVault]);

  const adoptVault = useCallback((base: VaultData, status: VaultStatus) => {
    let next = base;
    const queued = vaultQueueRef.current;
    vaultQueueRef.current = [];
    for (const fn of queued) next = fn(next);
    if (queued.length) {
      next = { ...next, updatedAt: new Date().toISOString() };
      vaultDirtyRef.current = true;
    }
    vaultRef.current = next;
    setVault(next);
    setVaultStatusBoth(status);
    if (status === 'ready' && vaultDirtyRef.current) scheduleVaultSave();
  }, [setVaultStatusBoth, scheduleVaultSave]);

  const loadVault = useCallback(async (sid: string | null) => {
    if (!sid) return;
    // Only the latest load may land — two in flight can answer out of order.
    const gen = ++vaultLoadGenRef.current;
    const stale = () => !isCurrent(sid) || gen !== vaultLoadGenRef.current;
    setVaultStatusBoth('loading');
    try {
      const res = await post<VaultGetResponse>('/api/vault', { sessionId: sid, op: 'get' });
      if (stale()) return;
      if (res.status === 'ready') adoptVault(normalizeVault(res.data), 'ready');
      // The file is there but this PIN cannot open it (changed at the bank).
      // Work on an empty vault in memory — never overwrite the file unasked;
      // resetVault is the explicit way out.
      else adoptVault(EMPTY_VAULT, 'error');
    } catch {
      if (stale()) return;
      // Same in-memory fallback: renaming an account should still work for
      // this session, it just will not be remembered.
      adoptVault(EMPTY_VAULT, 'unavailable');
    }
  }, [isCurrent, adoptVault, setVaultStatusBoth]);

  const updateVault = useCallback((fn: (v: VaultData) => VaultData) => {
    const status = vaultStatusRef.current;
    if (status === 'idle') return; // no session to attach it to
    if (status === 'loading') { vaultQueueRef.current.push(fn); return; }
    const base = vaultRef.current ?? EMPTY_VAULT;
    const changed = fn(base);
    if (changed === base) return;
    const next = { ...changed, updatedAt: new Date().toISOString() };
    vaultRef.current = next;
    setVault(next);
    vaultDirtyRef.current = true;
    // In 'error' and 'unavailable' the edit lives in memory only.
    if (status === 'ready') scheduleVaultSave();
  }, [scheduleVaultSave]);

  const resetVault = useCallback(async () => {
    const sid = sessionRef.current;
    if (!sid) return;
    try {
      await post('/api/vault', { sessionId: sid, op: 'reset' });
      if (!isCurrent(sid)) return;
      setVaultStatusBoth('ready');
      // What was changed in memory while the vault was unreadable is kept —
      // and now, for the first time, saved.
      if (vaultDirtyRef.current) scheduleVaultSave();
      toast('Persönliche Daten zurückgesetzt. Änderungen werden wieder gespeichert.', 'success');
    } catch (err) {
      if (!isCurrent(sid)) return;
      toast((err as Error).message, 'error');
    }
  }, [isCurrent, setVaultStatusBoth, scheduleVaultSave, toast]);

  /**
   * Has the server delete the vault file and every backup of it (`request` is
   * "Gerät vergessen" with the box ticked, or the vault route on its own).
   * First every way this session could write the file again is shut — the
   * save timer, a load still in flight, saving at all (updateVault and
   * flushVault only write in 'ready') — and a save already on its way is
   * waited for. Afterwards the session goes on with an empty vault in memory
   * that is never written, and the login name this machine remembers for the
   * bank is forgotten too. Resolves whether it worked; failures are toasted.
   */
  const wipeVaultWith = useCallback(async (request: (sid: string) => Promise<unknown>): Promise<boolean> => {
    const sid = sessionRef.current;
    if (!sid) return false;
    const before = vaultStatusRef.current;
    if (vaultTimerRef.current) { clearTimeout(vaultTimerRef.current); vaultTimerRef.current = null; }
    if (before === 'loading') vaultLoadGenRef.current++;
    vaultStatusRef.current = 'unavailable';
    await vaultChainRef.current;
    try {
      await request(sid);
    } catch (err) {
      if (!isCurrent(sid)) return false;
      // Nothing was deleted, or not all of it: carry on as before.
      if (before === 'loading') void loadVault(sid);
      else {
        setVaultStatusBoth(before);
        if (before === 'ready' && vaultDirtyRef.current) scheduleVaultSave();
      }
      toast((err as Error).message, 'error');
      return false;
    }
    if (!isCurrent(sid)) return false;
    vaultQueueRef.current = [];
    vaultDirtyRef.current = false;
    vaultFailedRef.current = false;
    vaultRef.current = EMPTY_VAULT;
    setVault(EMPTY_VAULT);
    setVaultStatusBoth('unavailable');
    if (bank) {
      store.del(`fints.userId.${bank.blz}`);
      try {
        const last = JSON.parse(store.get('fints.lastBank') ?? 'null') as ChosenBank | null;
        if (last?.blz === bank.blz) store.del('fints.lastBank');
      } catch { /* unreadable — nothing of ours to remove */ }
    }
    return true;
  }, [bank, isCurrent, loadVault, setVaultStatusBoth, scheduleVaultSave, toast]);

  /** Deletes the saved personal data from this machine, the device registration untouched. */
  const wipeVault = useCallback(async () => {
    if (await wipeVaultWith((sid) => post('/api/vault', { sessionId: sid, op: 'wipe' }))) {
      toast('Deine gespeicherten Daten sind von diesem Rechner gelöscht. Bis zum Abmelden wird nichts mehr gespeichert.', 'success', 8000);
    }
  }, [wipeVaultWith, toast]);

  // ---- transactions -------------------------------------------------------
  /**
   * Fetches one account's statement. `from`/`to` default to the applied range;
   * the cache is keyed by the range actually asked for.
   *
   * Balances rule: a statement's balance is the balance *now*, so it is only
   * taken when the range runs up to today. A past range leaves the known
   * balance alone; its own closing figure stays in `statementInfo[…].blocks`.
   * Nor does a statement ever move a known balance back in time: banks cap
   * long statements and answer with the *oldest* slice (see
   * app/api/transactions/route.ts), whose closing balance is months old. Such
   * a statement keeps the newer balance and is recorded for the span it
   * actually covers.
   *
   * `onNotApplied` runs when no statement lands: the bank refused, the
   * request failed, or its approval was cancelled or ran out. `onSettled`
   * says which of these it was (or that it landed). A failure is kept for the
   * account (txErrors) and announced in a toast, unless `quiet` leaves that
   * to the caller.
   */
  const loadTransactions = useCallback(async (
    account: SerializedAccount,
    from?: string,
    to?: string,
    opts: { force?: boolean; onNotApplied?: () => void; quiet?: boolean; onSettled?: LoadSettled } = {},
  ) => {
    const applied = resolveRange();
    const span = { from: from || applied.from, to: to || applied.to };
    const cacheKey = rangeKey(span);
    const acct = account.accountNumber;
    const notApplied = (outcome: LoadOutcome, error?: string) => {
      opts.onNotApplied?.();
      opts.onSettled?.(outcome, error);
    };

    // No Umsätze over FinTS for this account (a Depot, most often): asking
    // would only bring back the library's refusal, in English.
    if (!account.canStatements) { notApplied('skipped'); return; }
    if (!opts.force) {
      const cached = txCacheRef.current[acct];
      if (cached && cached.key === cacheKey) { opts.onSettled?.('applied'); return; }
    }
    if (busyRef.current) { notApplied('busy'); return; }

    const sid = sessionRef.current;
    setTxErrors((e) => without(e, acct));
    setBusy(true);
    setLoadingAccount(acct);

    const finish = () => { setBusy(false); setLoadingAccount(null); };
    const apply = (
      txs: SerializedTransaction[],
      balance: SerializedBalance | null,
      blocks: StatementInfo['blocks'] | undefined,
    ) => {
      const list = txs || [];
      let coveredTo = span.to;
      if (balance && span.to >= isoDate(new Date())) {
        const known = balancesRef.current[acct];
        const day = dayKey(balance.date);
        const knownDay = known ? dayKey(known.date) : '';
        if (day && knownDay && day < knownDay) {
          // Cut short: the statement ends before a balance this session
          // already holds. Never just "an old closing date" — a quiet
          // account's :62F: carries the day of its last booking, and the
          // first load has nothing newer to compare with.
          const end = deliveredEnd(list, blocks ?? []);
          if (end && end < span.to) coveredTo = end > span.from ? end : span.from;
        } else {
          balancesRef.current = { ...balancesRef.current, [acct]: balance };
          setBalances((b) => ({ ...b, [acct]: balance }));
          setBalanceErrors((e) => without(e, acct));
        }
      }
      setTxCache((c) => ({ ...c, [acct]: { key: cacheKey, txs: list } }));
      setStatementInfo((s) => ({
        ...s, [acct]: { from: span.from, to: coveredTo, blocks: blocks ?? [], loadedAt: Date.now() },
      }));
      if (coveredTo !== span.to) {
        // The list, the Kontoverlauf and a printed statement all go by the
        // span recorded above; this says why it is shorter than asked for.
        toast(
          `Deine Bank hat nur Umsätze bis ${fmtDate(toLocalDate(coveredTo))} geliefert. Der Kontostand bleibt der zuletzt abgerufene.`,
          'info',
          8000,
        );
      }
      void resolveMerchants(list);
      opts.onSettled?.('applied');
    };

    try {
      // A range up to today goes out open-ended, as the login load always
      // did: banks date weekend and holiday bookings — and the interim
      // closing balance — to the next Buchungstag (see isFutureDate), and a
      // Bis-Datum of today would make one that filters by booking date leave
      // them out. The cache and statementInfo still name the span asked for.
      const openEnd = span.to >= isoDate(new Date());
      const data = await post<TransactionsResponse>('/api/transactions', {
        sessionId: sid, accountNumber: acct, from: span.from, ...(openEnd ? {} : { to: span.to }),
      });
      if (!isCurrent(sid)) return;
      if (data.needsTan) {
        startDecoupledWait(decoupledMethod(), data, {
          onDone: (r) => {
            finish();
            if (r.kind === 'statements') apply(r.transactions, r.balance, r.blocks);
            else notApplied('failed');
          },
          retry: () => {
            finish();
            void loadTransactions(account, span.from, span.to, { ...opts, force: true });
          },
          // "Abbrechen" while waiting, "Schließen" once it failed or ran out.
          onCancelled: () => notApplied('cancelled'),
        }, {
          kind: 'statements',
          subject: `den Abruf der Umsätze von ${approvalAccountName(account)} ab ${fmtDate(toLocalDate(span.from))}`,
        });
      } else {
        finish();
        apply(data.transactions, data.balance, data.blocks);
      }
    } catch (err) {
      if (!isCurrent(sid)) return;
      finish();
      // Where the figure would be, the hero and the account's row now say
      // that it failed and why; the toast is the one announcement of it.
      const message = (err as Error).message;
      setTxErrors((e) => ({ ...e, [acct]: { message, at: Date.now() } }));
      if (!opts.quiet) toast(failureSentence([{ name: accountLabelRef.current(account), message }])!, 'error');
      notApplied('failed', message);
    }
  }, [resolveRange, setBusy, isCurrent, startDecoupledWait, decoupledMethod, approvalAccountName, resolveMerchants, toast]);

  // ---- balances -----------------------------------------------------------
  /**
   * Asks the bank for one account's balance alone (HKSAL). For an account
   * without Umsätze to read the balance from, and for "Alle Salden abrufen",
   * which completes the Gesamtsaldo without loading — and switching to —
   * every account's statement. Never on its own: like any read it can cost an
   * approval. A known balance is only replaced by one at least as new
   * (acceptsBalance). `quiet` and `onSettled` as for loadTransactions.
   */
  const loadBalance = useCallback(async (
    account: SerializedAccount,
    opts: { quiet?: boolean; onSettled?: LoadSettled } = {},
  ) => {
    const acct = account.accountNumber;
    const settle: LoadSettled = (outcome, error) => opts.onSettled?.(outcome, error);
    if (!account.canBalance) { settle('skipped'); return; }
    if (busyRef.current) {
      if (!opts.quiet) toast(BUSY_MESSAGE, 'info');
      settle('busy');
      return;
    }
    const sid = sessionRef.current;
    setBalanceErrors((e) => without(e, acct));
    setBusy(true);
    setBalanceLoading(acct);

    const finish = () => { setBusy(false); setBalanceLoading(null); };
    const fail = (message: string) => {
      setBalanceErrors((e) => ({ ...e, [acct]: { message, at: Date.now() } }));
      if (!opts.quiet) toast(failureSentence([{ name: accountLabelRef.current(account), message }])!, 'error');
      settle('failed', message);
    };
    const apply = (balance: SerializedBalance | null) => {
      // An answer without a balance is not a zero balance.
      if (!balance) { fail('Deine Bank hat für dieses Konto keinen Saldo gemeldet.'); return; }
      if (acceptsBalance(balancesRef.current[acct], balance)) {
        balancesRef.current = { ...balancesRef.current, [acct]: balance };
        setBalances((b) => ({ ...b, [acct]: balance }));
      }
      settle('applied');
    };

    try {
      const data = await post<BalanceResponse>('/api/balance', { sessionId: sid, accountNumber: acct });
      if (!isCurrent(sid)) return;
      if (data.needsTan) {
        startDecoupledWait(decoupledMethod(), data, {
          onDone: (r) => {
            finish();
            if (r.kind === 'balance') apply(r.balance);
            else fail('Die Antwort deiner Bank passte nicht zur Saldoabfrage.');
          },
          retry: () => { finish(); void loadBalance(account, opts); },
          onCancelled: () => { finish(); settle('cancelled'); },
        }, { kind: 'balance', subject: `die Saldoabfrage für ${approvalAccountName(account)}` });
      } else {
        finish();
        apply(data.balance);
      }
    } catch (err) {
      if (!isCurrent(sid)) return;
      finish();
      fail((err as Error).message);
    }
  }, [setBusy, isCurrent, startDecoupledWait, decoupledMethod, approvalAccountName, toast]);

  /**
   * "Alle Salden abrufen": every balance this session does not know yet, one
   * account after the other behind `busy` (lib/balances.ts balanceQueue). The
   * active account stays the active one. Stops when an approval is
   * cancelled; what failed is said once, at the end. Never started on its
   * own — each read can cost an approval.
   */
  const loadAllBalances = useCallback(() => {
    if (busyRef.current) {
      toast(BUSY_MESSAGE, 'info');
      return;
    }
    const sid = sessionRef.current;
    const queue = balanceQueue(accountsRef.current, balancesRef.current, resolveRange().to >= isoDate(new Date()));
    if (!queue.length) {
      // Only accounts whose statement is the way to their balance are left,
      // and the applied range ends before today.
      if (accountsRef.current.some((a) => a.canStatements && !balancesRef.current[a.accountNumber])) {
        toast('Diese Konten melden ihren Saldo nur mit den Umsätzen. Wähle bei den Umsätzen einen Zeitraum bis heute.', 'info', 8000);
      }
      return;
    }

    const failed: Array<{ name: string; message: string }> = [];
    setLoadingAllBalances(true);
    const done = () => {
      setLoadingAllBalances(false);
      const sentence = failureSentence(failed);
      if (sentence) toast(sentence, 'error');
    };
    const next = () => {
      // Logged out meanwhile: resetSession has already put everything back.
      if (!isCurrent(sid)) return;
      const step = queue.shift();
      if (!step) { done(); return; }
      const { account } = step;
      const onSettled: LoadSettled = (outcome, error) => {
        if (outcome === 'failed') failed.push({ name: accountLabelRef.current(account), message: error ?? '' });
        // Cancelled: the user said no to an approval, so no further ones are asked for.
        if (outcome === 'cancelled' || outcome === 'busy') done();
        else next();
      };
      if (step.via === 'balance') void loadBalance(account, { quiet: true, onSettled });
      else void loadTransactions(account, undefined, undefined, { quiet: true, onSettled });
    };
    next();
  }, [toast, resolveRange, isCurrent, loadBalance, loadTransactions]);

  const selectAccount = useCallback((a: SerializedAccount) => {
    if (busyRef.current) return; // don't interrupt an in-flight approval
    setActiveAccount(a);
    activeAccountRef.current = a;
    void loadTransactions(a);
    // No Umsätze to read its balance from: ask for the balance alone.
    if (!a.canStatements && a.canBalance && !balancesRef.current[a.accountNumber]) void loadBalance(a);
  }, [loadTransactions, loadBalance]);

  /** Drop the cache for one account and re-read it from the bank. */
  const refreshAccount = useCallback((account: SerializedAccount, from?: string, to?: string) => {
    void loadTransactions(account, from, to, { force: true });
  }, [loadTransactions]);

  /**
   * Applies `next` and reads `account` with it. The range is applied at
   * once, so the list can say which span it is fetching — but it is kept only
   * if that statement arrives. A cancelled approval or a refusal by the bank
   * puts the previous range back: otherwise every later account switch or
   * refresh would quietly ask for a span nobody has seen, perhaps with a TAN
   * of its own, while the screen still names the one that is loaded.
   */
  const applyAndLoad = useCallback((account: SerializedAccount, next: DateRange) => {
    const prev = rangeRef.current;
    const prevAnchor = rangeAnchorRef.current;
    setAppliedRange(next);
    void loadTransactions(account, next.from, next.to, {
      force: true,
      onNotApplied: () => {
        // Applied over meanwhile (another pick, or midnight): leave that be.
        if (rangeRef.current !== next) return;
        rangeRef.current = prev;
        rangeAnchorRef.current = prevAnchor;
        setRange(prev);
      },
      // A failure says so in its own toast. An approval that was not given
      // closes without a word — so this says what the screen still shows.
      onSettled: (outcome) => {
        if (outcome !== 'cancelled' || rangeRef.current !== prev) return;
        const span = fmtRange(prev.from, prev.to);
        toast(
          next.from < prev.from
            ? `Ältere Umsätze wurden nicht abgerufen – es bleibt beim Zeitraum ${span}.`
            : `Der neue Zeitraum wurde nicht abgerufen – es bleibt bei ${span}.`,
          'info',
          8000,
        );
      },
    });
  }, [setAppliedRange, loadTransactions, toast]);

  /**
   * Makes `r` the range every statement load uses, and re-reads the active
   * account with it. Refused while another operation runs, so the applied
   * range never names something that is not being fetched — and undone if
   * the fetch does not land (applyAndLoad).
   */
  const applyRange = useCallback((r: DateRange) => {
    const next = normalizeRange(r);
    if (!next) {
      toast('Bitte einen gültigen Zeitraum wählen.', 'error');
      return;
    }
    if (busyRef.current) {
      toast(BUSY_MESSAGE, 'info');
      return;
    }
    const account = activeAccountRef.current;
    if (account) applyAndLoad(account, next);
    else setAppliedRange(next);
  }, [toast, setAppliedRange, applyAndLoad]);

  /**
   * "Umsätze aktualisieren" after a transfer: shows the account the money
   * left, re-read up to today. An applied range that ended before today
   * cannot hold the new booking (nor update the balance), so it is carried
   * forward to today — keeping its start, but no further back than the
   * default window, which most banks serve without an extra approval. The
   * applied range moves with it, so it never names something not fetched,
   * and moves back if that fetch does not land.
   */
  const refreshAfterTransfer = useCallback((account: SerializedAccount) => {
    if (busyRef.current) {
      toast(BUSY_MESSAGE, 'info');
      return;
    }
    const today = isoDate(new Date());
    const r = resolveRange();
    setActiveAccount(account);
    activeAccountRef.current = account;
    if (r.to < today) {
      const floor = defaultRange().from;
      applyAndLoad(account, { from: r.from > floor ? r.from : floor, to: today });
    } else {
      void loadTransactions(account, r.from, r.to, { force: true });
    }
  }, [toast, resolveRange, applyAndLoad, loadTransactions]);

  // ---- vorgemerkte Umsätze ------------------------------------------------
  const loadPending = useCallback(async (account: SerializedAccount) => {
    if (busyRef.current) {
      toast(BUSY_MESSAGE, 'info');
      return;
    }
    const sid = sessionRef.current;
    setPendingErrors((e) => without(e, account.accountNumber));
    setBusy(true);
    setPendingLoading(account.accountNumber);

    const finish = () => { setBusy(false); setPendingLoading(null); };
    const apply = (txs: SerializedTransaction[]) => {
      setPendingFetched((c) => ({ ...c, [account.accountNumber]: { txs: txs || [], loadedAt: Date.now() } }));
      void resolveMerchants(txs || []);
    };

    try {
      const data = await post<PendingResponse>('/api/pending', {
        sessionId: sid, accountNumber: account.accountNumber,
      });
      if (!isCurrent(sid)) return;
      if (data.needsTan) {
        startDecoupledWait(decoupledMethod(), data, {
          onDone: (r) => { finish(); if (r.kind === 'pending') apply(r.pending); },
          retry: () => { finish(); void loadPending(account); },
        }, { kind: 'pending', subject: `den Abruf der vorgemerkten Umsätze von ${approvalAccountName(account)}` });
      } else {
        finish();
        apply(data.pending);
      }
    } catch (err) {
      if (!isCurrent(sid)) return;
      finish();
      // The Vorgemerkt panel keeps the reason (and the way to try again);
      // the toast is the one announcement of it.
      const message = (err as Error).message;
      setPendingErrors((e) => ({ ...e, [account.accountNumber]: { message, at: Date.now() } }));
      toast(`Abruf der vorgemerkten Umsätze für „${accountLabelRef.current(account)}“ fehlgeschlagen: ${message}`, 'error');
    }
  }, [setBusy, isCurrent, startDecoupledWait, decoupledMethod, approvalAccountName, toast, resolveMerchants]);

  // ---- session clock ------------------------------------------------------
  // The dashboard logs itself out after `idleMinutes` without input. The exact
  // moment lives in a ref; `idleDeadline` is published for the countdown UI at
  // most every ~10 s — except near the warning window, where a stale value
  // would show a countdown that is not real.
  const publishDeadline = useCallback((force = false) => {
    const deadline = idleDeadlineRef.current;
    const shown = shownDeadlineRef.current;
    if (deadline === shown.value) return;
    const now = Date.now();
    const urgent = shown.value == null || deadline == null
      || shown.value - now <= WARNING_WINDOW_MS + DEADLINE_PUBLISH_MS;
    if (!force && !urgent && now - shown.at < DEADLINE_PUBLISH_MS) return;
    shownDeadlineRef.current = { value: deadline, at: now };
    setIdleDeadline(deadline);
  }, []);

  /** Keeps the server's 30-minute session alive. No bank traffic. */
  const sendKeepalive = useCallback(() => {
    const sid = sessionRef.current;
    if (!sid) return;
    lastKeepaliveRef.current = Date.now();
    // A 401 logs out through SESSION_EXPIRED_EVENT; anything else is retried
    // with the next activity.
    post('/api/keepalive', { sessionId: sid }).catch(() => {});
  }, []);

  /**
   * An approval being waited for, or a bank call on the wire, counts as the
   * user being there: logging out under a TAN or a transfer would abandon it
   * half-way. A wait that already failed or ended is not in flight — it is a
   * dialog waiting for someone, and must not hold the session open forever if
   * nobody comes back.
   */
  const inFlight = useCallback(() => {
    const w = waitRef.current;
    return w.open ? waitHoldsSession(w) : busyRef.current;
  }, []);

  /** The deadline has passed with nothing in flight — the session is over. */
  const idleOverdue = useCallback((now: number) => (
    idleDeadlineRef.current != null && now >= idleDeadlineRef.current && !inFlight()
  ), [inFlight]);

  const markActivity = useCallback((opts: { keepalive?: 'throttled' | 'now'; publish?: boolean } = {}) => {
    if (!sessionRef.current) return;
    const now = Date.now();
    // Input after the deadline does not revive the session. The click that
    // wakes a laptop from sleep can arrive before the first timer tick does.
    if (idleOverdue(now)) {
      void logoutRef.current('idle');
      return;
    }
    lastActivityRef.current = now;
    idleDeadlineRef.current = now + idleMsRef.current;
    publishDeadline(opts.publish);
    if (opts.keepalive === 'now' || now - lastKeepaliveRef.current >= KEEPALIVE_EVERY_MS) sendKeepalive();
  }, [idleOverdue, publishDeadline, sendKeepalive]);

  /** Once a second while the dashboard is open. */
  const checkIdle = useCallback(() => {
    if (!sessionRef.current) return;
    const now = Date.now();
    if (idleOverdue(now)) {
      void logoutRef.current('idle');
      return;
    }
    if (inFlight()) {
      idleDeadlineRef.current = Math.max(idleDeadlineRef.current ?? 0, now + idleMsRef.current);
    }
    // The trailing edge of the keepalive throttle: activity since the last
    // ping means the server's clock must catch up with ours, or it would
    // expire a session we still consider live.
    if (lastActivityRef.current > lastKeepaliveRef.current && now - lastKeepaliveRef.current >= KEEPALIVE_EVERY_MS) {
      sendKeepalive();
    }
    publishDeadline();
  }, [idleOverdue, inFlight, publishDeadline, sendKeepalive]);

  const startSessionClock = useCallback((now: number) => {
    lastActivityRef.current = now;
    // Logging in just touched the server session.
    lastKeepaliveRef.current = now;
    idleDeadlineRef.current = now + idleMsRef.current;
    shownDeadlineRef.current = { value: null, at: 0 };
    publishDeadline(true);
  }, [publishDeadline]);

  /** "Angemeldet bleiben": a fresh idle period, and the server told so at once. */
  const stayLoggedIn = useCallback(() => {
    markActivity({ keepalive: 'now', publish: true });
  }, [markActivity]);

  const setIdleMinutes = useCallback((n: IdleMinutes) => {
    if (!isIdleChoice(n)) return;
    idleMsRef.current = n * 60_000;
    setIdleMinutesState(n);
    store.set('fints.idleMinutes', String(n));
    // Choosing a limit is itself activity; the new limit counts from now.
    markActivity({ publish: true });
  }, [markActivity]);

  const togglePrivacy = useCallback(() => {
    const next = !privacyRef.current;
    privacyRef.current = next;
    setPrivacy(next);
    store.set('fints.privacy', next ? '1' : '0');
  }, []);

  /**
   * Single-key shortcuts can be switched off: a dictated word or an
   * unsteady hand must not toggle the amounts or switch accounts (WCAG
   * 2.1.4). Strg/⌘+K and Alt+1…3 stay on either way.
   */
  const setSingleKeyShortcuts = useCallback((on: boolean) => {
    setSingleKeyShortcutsState(on);
    store.set('fints.singleKeys', on ? '1' : '0');
  }, []);

  /**
   * The answer to "Firmenlogos anzeigen?" (the dashboard asks once), or the
   * Sitzung panel's switch. Yes looks up what is loaded already. No drops
   * every logo of this session at once, so the logo proxy is not asked for
   * one again either.
   */
  const setLogoConsent = useCallback((on: boolean) => {
    const next: LogoConsent = on ? 'on' : 'off';
    logoConsentRef.current = next;
    setLogoConsentState(next);
    store.set('fints.merchantLogos', next);
    if (on) {
      void resolveMerchants([
        ...Object.values(txCacheRef.current).flatMap((c) => c.txs),
        ...Object.values(pendingFetchedRef.current).flatMap((p) => p.txs),
      ]);
    } else {
      setMerchants({});
      merchantsAsked.current.clear();
    }
  }, [resolveMerchants]);

  // ---- navigation & launchers ---------------------------------------------
  const setTab = useCallback((t: DashboardTab) => setTabState(t), []);
  const setInboxOpen = useCallback((b: boolean) => setInboxOpenState(b), []);
  const setPaletteOpen = useCallback((b: boolean) => setPaletteOpenState(b), []);
  const setShortcutsOpen = useCallback((b: boolean) => setShortcutsOpenState(b), []);

  /**
   * Deep link into the Umsätze list. A given filter replaces the current one
   * rather than narrowing it further: "Alle Umsätze mit REWE" under a leftover
   * "Eingänge" chip would show nothing and look like a bug.
   */
  const showTransactions = useCallback((f?: Partial<TxFilter>) => {
    setTabState('overview');
    if (f) setTxFilter({ ...EMPTY_FILTER, ...f });
    setPaletteOpenState(false);
    setInboxOpenState(false);
    setTxFocusNonce((n) => n + 1);
  }, []);

  /** The launchers are modal; a new one replaces whatever transient surface was up. */
  const clearTransients = useCallback(() => {
    setPaletteOpenState(false);
    setShortcutsOpenState(false);
    setInboxOpenState(false);
  }, []);

  const openTransfer = useCallback((p?: TransferPrefill) => {
    // A transfer in progress is never replaced by a launcher — its draft (or
    // its pending approval) would be lost.
    if (transferOpen) return;
    const eligible = accounts.filter((a) => a.canTransfer);
    if (!eligible.length) {
      toast('Kein Konto unterstützt Überweisungen über FinTS.', 'error');
      return;
    }
    const accountNumber =
      (p?.accountNumber && eligible.some((a) => a.accountNumber === p.accountNumber) && p.accountNumber)
      || (activeAccount?.canTransfer ? activeAccount.accountNumber : eligible[0].accountNumber);
    clearTransients();
    setShareOpen(false);
    setSharePrefill(null);
    setTransferPrefill({ ...p, accountNumber });
    setTransferOpen(true);
  }, [transferOpen, accounts, activeAccount, toast, clearTransients]);

  const closeTransfer = useCallback(() => {
    setTransferOpen(false);
    setTransferPrefill(null);
  }, []);

  const openShare = useCallback((p?: SharePrefill) => {
    if (transferOpen || shareOpen) return;
    const eligible = accounts.filter((a) => a.iban);
    if (!eligible.length) {
      toast('Für keines deiner Konten liegt eine IBAN vor.', 'error');
      return;
    }
    const accountNumber =
      (p?.accountNumber && eligible.some((a) => a.accountNumber === p.accountNumber) && p.accountNumber)
      || (activeAccount?.iban ? activeAccount.accountNumber : eligible[0].accountNumber);
    clearTransients();
    setSharePrefill({ ...p, accountNumber });
    setShareOpen(true);
  }, [transferOpen, shareOpen, accounts, activeAccount, toast, clearTransients]);

  const closeShare = useCallback(() => {
    setShareOpen(false);
    setSharePrefill(null);
  }, []);

  // ---- bank messages ------------------------------------------------------
  const markAllRead = useCallback(() => {
    if (!messagesRef.current.some((m) => !m.read)) return;
    const next = messagesRef.current.map((m) => (m.read ? m : { ...m, read: true }));
    messagesRef.current = next;
    setMessages(next);
  }, []);

  // ---- login --------------------------------------------------------------
  const afterAccountsReady = useCallback((list: SerializedAccount[]) => {
    const sid = sessionRef.current;
    // Once per session: a method pick that fired twice (auto-pick plus a
    // click) must not restart the clock, reload and announce everything again.
    if (!sid || readySidRef.current === sid) return;
    readySidRef.current = sid;
    const now = Date.now();
    setAccounts(list);
    accountsRef.current = list;
    setSessionStartedAt(now);
    startSessionClock(now);
    // Fresh per login: a window left on the login screen overnight must not
    // start the next session with yesterday's "today".
    setAppliedRange(defaultRange());
    setView('dashboard');
    // The bank's messages are announced by the masthead's bell and the
    // Übersicht's Mitteilungen tile, both of which stay until they are read —
    // not by a toast as well (components/shell/MessagesTeaser.tsx).

    if (list[0]) {
      setActiveAccount(list[0]);
      activeAccountRef.current = list[0];
      void loadTransactions(list[0]);
    }
    // Not a bank call: it runs beside the first statement, outside `busy`.
    void loadVault(sid);
  }, [startSessionClock, setAppliedRange, loadTransactions, loadVault]);

  // Said after the fact, so the way back is right there: on a shared
  // computer "Gerät vergessen" is one press, not a trip to the Sitzung panel.
  const notifyDeviceSaved = useCallback(() => {
    setDeviceRemembered(true);
    toast('Gerät gemerkt — künftige Anmeldungen brauchen seltener eine TAN.', 'info', 10_000, {
      label: 'Gerät vergessen',
      run: () => void forgetDeviceRef.current(),
    });
  }, [toast]);

  /** The login the bank is being asked for right now, so it can be called off. */
  const connectAttemptRef = useRef<{ id: string; ctrl: AbortController } | null>(null);

  const connect = useCallback(async (chosen: ChosenBank, login: string, pin: string) => {
    // "Zurück zur Anmeldung" from the TAN-method screen leaves the half-open
    // session behind; a new login replaces it.
    const previous = sessionRef.current;
    const attempt = { id: newAttemptId(), ctrl: new AbortController() };
    connectAttemptRef.current = attempt;
    let data: ConnectResponse;
    try {
      data = await post<ConnectResponse>('/api/connect', {
        blz: chosen.blz, userId: login, pin, attemptId: attempt.id,
      }, { signal: attempt.ctrl.signal });
    } finally {
      if (connectAttemptRef.current === attempt) connectAttemptRef.current = null;
    }
    // Called off while the answer was on its way: it goes nowhere.
    if (attempt.ctrl.signal.aborted) throw new DOMException('Die Anmeldung wurde abgebrochen.', 'AbortError');

    store.set('fints.lastBank', JSON.stringify(chosen));
    store.set(`fints.userId.${chosen.blz}`, login);

    setSessionId(data.sessionId);
    sessionRef.current = data.sessionId;
    if (previous && previous !== data.sessionId) {
      // Only drops it from the server's memory (and the PIN with it) — no bank traffic.
      post('/api/logout', { sessionId: previous }).catch(() => {});
    }
    setBank({ ...chosen, name: data.bank.bankName || chosen.name, brand: data.bank.brand, bic: data.bank.bic });
    setUserId(login);

    // The bank's notices arrive with the login synchronisation only; a
    // remembered device skips that round trip and so has none to show.
    const receivedAt = new Date().toISOString();
    const seen = new Set<string>();
    const inbox = ('bankMessages' in data ? data.bankMessages || [] : [])
      .map((m) => toInboxMessage(m, receivedAt))
      .filter((m): m is InboxMessage => {
        if (!m) return false;
        const key = `${m.subject}\n${m.text}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    messagesRef.current = inbox;
    setMessages(inbox);

    if ('restored' in data && data.restored) {
      // Remembered device: cached accounts + TAN method, no sync SCA. Set
      // before the accounts: the first statement load starts right away and
      // paces its approval by this method.
      setSelectedMethodBoth(data.selectedTanMethod);
      setTanMethodsBoth(data.selectedTanMethod ? [data.selectedTanMethod] : []);
      setDeviceRemembered(true);
      toast('Gerät erkannt — ohne neue TAN angemeldet.');
      afterAccountsReady(data.accounts || []);
    } else if ('tanMethods' in data) {
      setTanMethodsBoth(data.tanMethods || []);
      setSelectedMethodBoth(null);
      setMediaChoice(null);
      setTanMethodError(data.tanMethods?.length ? null : 'Die Bank bietet keine TAN-Verfahren für diesen Zugang an.');
      setView('tanmethod');
    }
  }, [afterAccountsReady, toast, setSelectedMethodBoth, setTanMethodsBoth]);

  /**
   * "Abbrechen" while the bank is being asked for the login: its answer is
   * dropped here, and the server ends the bank request and drops whatever
   * the attempt already holds — the PIN with it (app/api/connect/cancel).
   */
  const cancelConnect = useCallback(() => {
    const attempt = connectAttemptRef.current;
    if (!attempt) return;
    connectAttemptRef.current = null;
    attempt.ctrl.abort();
    post('/api/connect/cancel', { attemptId: attempt.id }).catch(() => { /* the 30-minute sweep remains */ });
  }, []);

  const chooseTanMethod = useCallback(async (method: SerializedTanMethod, tanMediaName?: string) => {
    const sid = sessionRef.current;
    setSelectedMethodBoth(method);
    setTanMethodError(null);
    // A device list belongs to the request that produced it. This pick either
    // answers it or replaces it; if the bank wants a device again, it says so
    // in its answer and the list comes back.
    setMediaChoice(null);
    const media = tanMediaName
      || (method.activeTanMedia?.length === 1 ? method.activeTanMedia[0] : undefined);
    try {
      const data = await post<SelectTanResponse>('/api/select-tan', {
        sessionId: sid, tanMethodId: method.id, tanMediaName: media,
      });
      if (!isCurrent(sid)) return;

      if ('chooseTanMedia' in data) {
        setMediaChoice(data.chooseTanMedia);
        return;
      }
      if ('needsTan' in data && data.needsTan) {
        // The device the user just picked is the one being asked, even when
        // the bank's answer does not repeat its name.
        startDecoupledWait(method, { ...data, tanMediaName: data.tanMediaName || media || null }, {
          onDone: (r) => {
            if (r.kind !== 'accounts') return;
            if (r.deviceSaved) notifyDeviceSaved();
            afterAccountsReady(r.accounts || []);
          },
          retry: () => void chooseTanMethod(method, media),
        }, { kind: 'login' });
        return;
      }
      if ('accounts' in data) {
        if (data.deviceSaved) notifyDeviceSaved();
        afterAccountsReady(data.accounts || []);
      }
    } catch (err) {
      if (!isCurrent(sid)) return;
      setTanMethodError((err as Error).message);
    }
  }, [isCurrent, startDecoupledWait, afterAccountsReady, notifyDeviceSaved, setSelectedMethodBoth]);

  /** "Anderes Verfahren wählen" from the device list: back to the methods. */
  const clearMediaChoice = useCallback(() => setMediaChoice(null), []);

  // ---- device + session ---------------------------------------------------
  /**
   * `wipeData`: delete the saved personal data from this machine as well —
   * what someone handing the computer on wants (wipeVaultWith).
   */
  const forgetDevice = useCallback(async (opts?: { wipeData?: boolean }) => {
    if (opts?.wipeData === true) {
      if (await wipeVaultWith((sid) => post('/api/forget-device', { sessionId: sid, wipeData: true }))) {
        setDeviceRemembered(false);
        toast('Gerät vergessen und deine gespeicherten Daten von diesem Rechner gelöscht. Bis zum Abmelden wird nichts mehr gespeichert.', 'success', 8000);
      }
      return;
    }
    try {
      await post('/api/forget-device', { sessionId: sessionRef.current });
      setDeviceRemembered(false);
      toast('Gerät vergessen — bei der nächsten Anmeldung wird wieder eine TAN angefragt.', 'info', 6000);
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }, [toast, wipeVaultWith]);
  forgetDeviceRef.current = forgetDevice;

  /** Everything a session owns, back to its pre-login state. Preferences stay. */
  const resetSession = useCallback(() => {
    waitGenRef.current++;
    waitCbRef.current = {};
    stopTimers();
    if (vaultTimerRef.current) { clearTimeout(vaultTimerRef.current); vaultTimerRef.current = null; }

    sessionRef.current = null;
    readySidRef.current = null;
    setSessionId(null);
    accountsRef.current = [];
    setAccounts([]);
    activeAccountRef.current = null;
    setActiveAccount(null);
    balancesRef.current = {};
    setBalances({});
    txCacheRef.current = {};
    setTxCache({});
    setPendingFetched({});
    setStatementInfo({});
    setMerchants({});
    merchantsAsked.current.clear();
    setSelectedMethodBoth(null);
    setTanMethodsBoth([]);
    setMediaChoice(null);
    setTanMethodError(null);
    setBusy(false);
    setLoadingAccount(null);
    setPendingLoading(null);
    setPendingErrors({});
    setDeviceRemembered(false);
    setTxErrors({});
    setBalanceErrors({});
    setBalanceLoading(null);
    setLoadingAllBalances(false);
    setWait(IDLE_WAIT);
    setPrintJob(null);

    idleDeadlineRef.current = null;
    shownDeadlineRef.current = { value: null, at: 0 };
    lastActivityRef.current = 0;
    lastKeepaliveRef.current = 0;
    setIdleDeadline(null);
    setSessionStartedAt(null);

    setTabState('overview');
    setTxFilter(EMPTY_FILTER);
    setTxFocusNonce(0);
    setAnalysisPeriod(null);
    setAnalysisScope('account');
    setTransferOpen(false);
    setTransferPrefill(null);
    setShareOpen(false);
    setSharePrefill(null);
    setInboxOpenState(false);
    setPaletteOpenState(false);
    setShortcutsOpenState(false);
    setLogoutConfirmOpen(false);
    setAppliedRange(defaultRange());

    messagesRef.current = [];
    setMessages([]);
    setActivity([]);
    lastTransferRef.current = null;

    vaultRef.current = null;
    vaultDirtyRef.current = false;
    vaultQueueRef.current = [];
    vaultFailedRef.current = false;
    setVault(null);
    setVaultStatusBoth('idle');

    // A toast's action points into the session that just ended.
    setToasts((list) => list.filter((t) => !t.action));
    setView('login');
  }, [stopTimers, setBusy, setAppliedRange, setVaultStatusBoth, setSelectedMethodBoth, setTanMethodsBoth]);

  /**
   * Ends the session. The screen is cleared at once; the network work
   * follows: an unsaved vault edit is flushed first (up to ~2 s — it needs the
   * session the logout is about to drop), then the server forgets the session.
   * Logout clears the session only; the remembered device stays (use "Gerät
   * vergessen" to wipe it).
   *
   * Every logout is said on the login screen it lands on. A user's says that
   * the PIN is gone only once the server confirmed it dropped the session —
   * the session object is what held it (lib/session-log.ts logoutNotice).
   */
  const logout = useCallback(async (reason: LogoutReason = 'user') => {
    // `onClick={logout}` hands over a click event; that is a user logout too.
    if (reason !== 'idle' && reason !== 'expired' && reason !== 'cancelled') reason = 'user';
    const sid = sessionRef.current;
    if (!sid) {
      // A straggling idle tick or 401 after the session already ended, or a
      // second press on "Abmelden": nothing is left to end or to announce.
      if (reason === 'user' || reason === 'cancelled') resetSession();
      return;
    }

    // Captured before the reset below empties the vault. An expired session
    // cannot take a save any more, so that one is not attempted.
    const saved = reason === 'expired' ? Promise.resolve() : flushVault();
    // What the reset below takes with it, and the notice therefore has to
    // name, or the user, back at the login screen, sends it again: transfers
    // whose outcome is unclear — those in the session log, and an approval
    // whose status check failed (it no longer holds the session, see
    // inFlight, but the order may have gone through).
    const w = waitRef.current;
    const unclear = unclearTransfers(activityRef.current).map((e) => e.name);
    if (w.open && w.kind === 'transfer' && !waitHoldsSession(w)) {
      unclear.unshift(lastTransferRef.current?.recipientName.trim() ?? '');
    }
    resetSession();

    let notice: number | null = null;
    if (reason === 'idle') {
      toast(idleLogoutNotice(unclear, unclear.length), 'info', IDLE_NOTICE_MS);
    } else if (reason === 'expired') {
      toast('Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.', 'error');
    } else {
      notice = toast(logoutNotice(reason, false), 'info', 6000);
    }

    await Promise.race([saved, delay(LOGOUT_FLUSH_TIMEOUT_MS)]);
    let dropped = false;
    try {
      await post('/api/logout', { sessionId: sid });
      dropped = true;
    } catch { /* best effort — the server's 30-minute sweep remains */ }
    if (notice != null && dropped && (reason === 'user' || reason === 'cancelled')) {
      rewordToast(notice, logoutNotice(reason, true));
    }
  }, [flushVault, resetSession, toast, rewordToast]);

  logoutRef.current = logout;

  /**
   * "Abmelden" from the Sitzung panel or the palette. Asks first only when
   * the session log holds a transfer whose status is unclear: the logout
   * clears that log, and with it the only record in the app of an order
   * that may have moved money. Otherwise it logs out at once.
   */
  const requestLogout = useCallback(() => {
    if (unclearTransfers(activityRef.current).length) {
      setLogoutConfirmOpen(true);
      return;
    }
    void logoutRef.current('user');
  }, []);

  const closeLogoutConfirm = useCallback(() => setLogoutConfirmOpen(false), []);

  // Any session-bound call that came back 401 (lib/client-api.ts).
  useEffect(() => {
    const onExpired = (e: Event) => {
      const refused = (e as CustomEvent<SessionExpiredDetail>).detail?.sessionId;
      if (!sessionRef.current || (refused && refused !== sessionRef.current)) return;
      void logoutRef.current('expired');
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  // Activity tracking and the idle check — only while a dashboard is open.
  useEffect(() => {
    if (view !== 'dashboard') return;
    const onActivity = (e: Event) => { if (countsAsActivity(e)) markActivity(); };
    // Timers are throttled in a hidden window; coming back is when an overdue
    // logout must happen, before the dashboard is on screen for a second.
    const onVisible = () => { if (document.visibilityState === 'visible') checkIdle(); };
    const opts: AddEventListenerOptions = { capture: true, passive: true };
    for (const ev of ACTIVITY_EVENTS) window.addEventListener(ev, onActivity, opts);
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(checkIdle, 1000);
    return () => {
      for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, onActivity, opts);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
    };
  }, [view, markActivity, checkIdle]);

  // ---- transfer -----------------------------------------------------------
  /**
   * The order whose approval is under way: already in the vault's log as
   * unclear (see handleTransferAnswer), to be settled by its outcome.
   */
  const sentOrderRef = useRef<SentOrder | null>(null);

  /**
   * The vault's two-week log of sent orders, which the duplicate check reads
   * after a logout (lib/sent-orders.ts): `next` goes in, `replaces` — the same
   * order logged earlier — comes out. Written at once rather than with the
   * next debounced save: an unclear order is exactly what must not be
   * forgotten, not even by a window closed a second later.
   */
  const logSentOrder = useCallback((next: SentOrder | null, replaces: SentOrder | null) => {
    updateVault((v) => {
      const kept = replaces
        ? v.sentOrders.filter((o) => !(o.at === replaces.at && o.iban === replaces.iban && o.cents === replaces.cents))
        : v.sentOrders;
      return { ...v, sentOrders: next ? recordSentOrder(kept, next) : kept };
    });
    void flushVault();
  }, [updateVault, flushVault]);

  /**
   * Appends the outcome of the last submitted order to this session's log —
   * and settles it in the vault's: executed and unclear orders stay there for
   * two weeks, a refused one (it moved no money) leaves it.
   */
  const logTransfer = useCallback((outcome: ActivityEntry['outcome'], message?: string) => {
    const p = lastTransferRef.current;
    if (!p) return;
    // The bank's sentences without their return codes (lib/bank-answer.ts);
    // repairing is idempotent on repaired text.
    const text = message ? bankAnswerLines(repairBankText(message)).join('\n') : '';
    const entry: ActivityEntry = {
      id: newId(),
      at: new Date().toISOString(),
      kind: 'transfer',
      outcome,
      accountNumber: p.accountNumber,
      name: p.recipientName.trim(),
      iban: normIban(p.iban),
      amount: typedAmount(p.amount),
      instant: p.instant,
      ...(text ? { message: text } : {}),
    };
    setActivity((list) => [entry, ...list].slice(0, MAX_ACTIVITY));
    const inFlight = sentOrderRef.current;
    sentOrderRef.current = null;
    if (outcome === 'failed') {
      if (inFlight) logSentOrder(null, inFlight);
    } else {
      logSentOrder(sentOrderOf(p, outcome, inFlight?.at ?? entry.at), inFlight);
    }
  }, [logSentOrder]);

  const withActivity = useCallback((h: TransferHandlers): TransferHandlers => ({
    ...h,
    onExecuted: (answers) => {
      // The bank's own words, shown verbatim on the done step — repaired once
      // here so the sheet and the log say the same thing.
      const text = answers ? repairBankText(answers) : answers;
      logTransfer('executed', text);
      h.onExecuted(text);
    },
    onUnknown: (answers) => {
      const text = answers ? repairBankText(answers) : answers;
      logTransfer('unknown', text);
      h.onUnknown(text);
    },
    onRefused: (answers) => {
      const text = repairBankText(answers);
      logTransfer('failed', text);
      h.onRefused(text);
    },
    onError: (message) => { logTransfer('failed', message); h.onError(message); },
  }), [logTransfer]);

  /** Shared tail of /api/transfer and /api/vop-confirm — the answers match. */
  const handleTransferAnswer = useCallback((data: TransferResponse, handlers: TransferHandlers) => {
    if ('needsVop' in data) {
      setBusy(false);
      handlers.onVop(data.vop);
      return;
    }
    if ('outcome' in data) {
      // The bank answered the order with an error before any approval.
      setBusy(false);
      if (data.outcome === 'refused') handlers.onRefused(data.bankAnswers);
      else handlers.onUnknown(data.bankAnswers);
      return;
    }
    if ('needsTan' in data && data.needsTan) {
      handlers.onTanStarted();
      const p = lastTransferRef.current;
      // From here the bank holds the order: approved in the app, it executes
      // whether or not this window is still open to hear about it. So it is
      // logged as unclear now, and settled by its outcome.
      const sent = p ? sentOrderOf(p, 'unknown', new Date().toISOString()) : null;
      sentOrderRef.current = sent;
      if (sent) logSentOrder(sent, null);
      startDecoupledWait(decoupledMethod(), data, {
        onDone: (r) => {
          setBusy(false);
          handlers.onExecuted(r.kind === 'transfer' ? r.bankAnswers : undefined);
        },
        retry: null,
        onDialogEnded: () => {
          setBusy(false);
          closeWait();
          handlers.onUnknown();
        },
        // A refusal in the app (or by the bank after it) has its own screen
        // in the sheet; anything less certain is "Status unklar".
        onAnswer: (status, answers) => {
          setBusy(false);
          closeWait();
          if (status === 'refused') handlers.onRefused(answers);
          else handlers.onUnknown(answers);
        },
        // The order is with the bank and can still be approved in the app
        // after we stop asking — abandoning the wait does not cancel it.
        onCancelled: () => handlers.onUnknown(),
      }, {
        kind: 'transfer',
        order: p
          ? { amount: typedAmount(p.amount), name: sepaSanitize(p.recipientName), iban: normIban(p.iban), instant: p.instant }
          : null,
      });
      return;
    }
    // Executed without an approval. Unconditional, so an answer missing its
    // bank texts cannot leave `busy` stuck on.
    setBusy(false);
    handlers.onExecuted(data.bankAnswers);
  }, [setBusy, startDecoupledWait, decoupledMethod, closeWait, logSentOrder]);

  /**
   * A request that never got an answer may still have reached the bank: the
   * connection to the local server broke, not necessarily before the order
   * went out (status 0) — or the server lost the bank connection after the
   * order had gone out (502, see lib/fints-order.ts). That is "unknown",
   * never "failed" — a user told it failed sends it again.
   */
  const settleTransferError = useCallback((err: unknown, handlers: TransferHandlers) => {
    setBusy(false);
    if (err instanceof ApiError && (err.status === 0 || err.status === ORDER_UNANSWERED_STATUS)) handlers.onUnknown();
    else handlers.onError((err as Error).message);
  }, [setBusy]);

  const submitTransfer = useCallback(async (payload: TransferPayload, handlers: TransferHandlers) => {
    if (busyRef.current) {
      handlers.onError(BUSY_MESSAGE); // never sent, so not logged
      return;
    }
    const sid = sessionRef.current;
    lastTransferRef.current = payload;
    sentOrderRef.current = null;
    const h = withActivity(handlers);
    setBusy(true);
    try {
      const data = await post<TransferResponse>('/api/transfer', {
        sessionId: sid, ...payload,
      });
      if (!isCurrent(sid)) return;
      handleTransferAnswer(data, h);
    } catch (err) {
      if (!isCurrent(sid)) return;
      settleTransferError(err, h);
    }
  }, [withActivity, setBusy, isCurrent, handleTransferAnswer, settleTransferError]);

  /**
   * "Send it anyway" after a Namensabgleich flagged the payee name. The server
   * still holds the original order and replays it with the bank's VOP-ID; the
   * bank then issues a fresh challenge, so this lands back in the TAN wait.
   */
  const confirmVop = useCallback(async (handlers: TransferHandlers) => {
    if (busyRef.current) {
      handlers.onError(BUSY_MESSAGE);
      return;
    }
    const sid = sessionRef.current;
    const h = withActivity(handlers);
    setBusy(true);
    try {
      const data = await post<TransferResponse>('/api/vop-confirm', { sessionId: sid });
      if (!isCurrent(sid)) return;
      handleTransferAnswer(data, h);
    } catch (err) {
      if (!isCurrent(sid)) return;
      settleTransferError(err, h);
    }
  }, [withActivity, setBusy, isCurrent, handleTransferAnswer, settleTransferError]);

  /** Drop a transfer the user decided not to send after seeing the check. */
  const abandonVop = useCallback(async () => {
    setBusy(false);
    try { await post('/api/cancel-pending', { sessionId: sessionRef.current }); } catch { /* best effort */ }
  }, [setBusy]);

  // ---- derived data -------------------------------------------------------
  const transactions = activeAccount ? txCache[activeAccount.accountNumber]?.txs ?? null : null;
  /** Why the active account's last statement load failed — txErrors for the account on screen. */
  const txError = activeAccount ? txErrors[activeAccount.accountNumber]?.message ?? null : null;

  const txByAccount = useMemo(() => {
    const out: Record<string, SerializedTransaction[]> = {};
    for (const [acct, entry] of Object.entries(txCache)) out[acct] = entry.txs;
    return out;
  }, [txCache]);

  /**
   * Vorgemerkte per account, as they stand against the newest statement.
   * The list is fetched on request only (it can take a TAN), so it is never
   * re-read behind the user's back; but a statement loaded after it — and
   * reaching the day it was fetched — may already list some of its items as
   * booked. Those leave here: kept, they would be counted once inside the
   * Kontostand and once more as "Vorgemerkt". `pendingInfo` says when the
   * list was fetched and whether it is older than the bookings beside it.
   */
  const { pendingCache, pendingInfo } = useMemo(() => {
    const cache: Record<string, SerializedTransaction[]> = {};
    const info: Record<string, PendingInfo> = {};
    for (const [acct, entry] of Object.entries(pendingFetched)) {
      const st = statementInfo[acct];
      const booked = txCache[acct]?.txs;
      const behindStatement = !!st && !!booked && st.loadedAt > entry.loadedAt
        && st.to >= isoDate(new Date(entry.loadedAt));
      const live = behindStatement ? unbookedPending(entry.txs, booked) : entry.txs;
      cache[acct] = live as SerializedTransaction[];
      info[acct] = { loadedAt: entry.loadedAt, behindStatement, booked: entry.txs.length - live.length };
    }
    return { pendingCache: cache, pendingInfo: info };
  }, [pendingFetched, statementInfo, txCache]);

  const ownIbans = useMemo(
    () => [...new Set(accounts.map((a) => normIban(a.iban)).filter(Boolean))],
    [accounts],
  );

  const unreadCount = useMemo(() => messages.filter((m) => !m.read).length, [messages]);

  const categoryRules = vault?.categoryRules;
  const txCategories = vault?.txCategories;

  /**
   * The category of a booking. Its identity changes only when a rule, an
   * override, a logo match or the own-account list does — analysis code can
   * memoise on it. Results are cached per booking object for that lifetime.
   */
  const categoryOf = useMemo(() => {
    const own = new Set(ownIbans);
    const memo = new WeakMap<SerializedTransaction, CategoryResult>();
    return (tx: SerializedTransaction): CategoryResult => {
      const hit = memo.get(tx);
      if (hit) return hit;
      const merchant = merchants[getMerchantKey(tx)] ?? merchants[counterpartyName(tx)] ?? null;
      let result: CategoryResult;
      try {
        result = categorize(tx, {
          ownIbans: own, rules: categoryRules, overrides: txCategories, merchantLabel: merchant?.label ?? null,
        });
      } catch {
        // A guess gone wrong must not take the dashboard down with it.
        result = { id: tx.amount >= 0 ? 'otherIn' : 'other', source: 'auto' };
      }
      memo.set(tx, result);
      return result;
    };
  }, [ownIbans, categoryRules, txCategories, merchants]);

  const aliases = vault?.aliases;
  const accountLabel = useCallback(
    (a: SerializedAccount) => aliases?.[a.accountNumber] || a.product?.trim() || translateType(a.accountType),
    [aliases],
  );
  accountLabelRef.current = accountLabel;

  // ---- vault-backed actions -----------------------------------------------
  const renameAccount = useCallback((accountNumber: string, alias: string | null) => {
    const clean = (alias ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_ALIAS);
    updateVault((v) => {
      if (!clean) {
        const aliasesNext = without(v.aliases, accountNumber);
        return aliasesNext === v.aliases ? v : { ...v, aliases: aliasesNext };
      }
      return v.aliases[accountNumber] === clean ? v : { ...v, aliases: { ...v.aliases, [accountNumber]: clean } };
    });
  }, [updateVault]);

  const saveTemplate = useCallback((t: Omit<TransferTemplate, 'id' | 'createdAt'>) => {
    // The same limits lib/vault.ts enforces on the way in — applied here too,
    // so what the user sees now is what comes back after the next login
    // instead of a template the server quietly clipped or dropped.
    const clip = (s: string | undefined, n: number) => (s == null ? undefined : [...s.trim()].slice(0, n).join(''));
    const iban = normIban(t.iban);
    if (!t.name.trim() || !ibanValid(iban)) {
      toast('Vorlage nicht gespeichert: Name oder IBAN ist ungültig.', 'error');
      return;
    }
    const amount = clip(t.amount, 20);
    const template: TransferTemplate = {
      ...t,
      id: newId(),
      label: clip(t.label || t.name, 60)!,
      name: clip(t.name, 70)!,
      iban,
      purpose: clip(t.purpose, 140),
      amount: amount && /\d/.test(amount) ? amount : undefined,
      createdAt: new Date().toISOString(),
    };
    updateVault((v) => ({ ...v, templates: [template, ...v.templates].slice(0, MAX_TEMPLATES) }));
  }, [updateVault, toast]);

  const deleteTemplate = useCallback((id: string) => {
    updateVault((v) => (v.templates.some((t) => t.id === id)
      ? { ...v, templates: v.templates.filter((t) => t.id !== id) }
      : v));
  }, [updateVault]);

  const touchTemplate = useCallback((id: string) => {
    const at = new Date().toISOString();
    updateVault((v) => (v.templates.some((t) => t.id === id)
      ? { ...v, templates: v.templates.map((t) => (t.id === id ? { ...t, lastUsedAt: at } : t)) }
      : v));
  }, [updateVault]);

  const dismissRecurring = useCallback((id: string) => {
    updateVault((v) => (v.dismissedRecurring.includes(id)
      ? v
      : { ...v, dismissedRecurring: [...v.dismissedRecurring, id] }));
  }, [updateVault]);

  const restoreRecurring = useCallback((id: string) => {
    updateVault((v) => (v.dismissedRecurring.includes(id)
      ? { ...v, dismissedRecurring: v.dismissedRecurring.filter((x) => x !== id) }
      : v));
  }, [updateVault]);

  /**
   * Files a booking under `id` — just this one, or (`rule`) every booking with
   * the same counterparty. A rule also lifts the single-booking overrides that
   * loaded bookings of that counterparty carry: "für alle übernehmen" would
   * otherwise leave exactly the ones the user already touched behind.
   * `null` undoes a choice for this one booking: it goes back to what a rule
   * or the automatic guess says.
   */
  const setCategory = useCallback((tx: SerializedTransaction, id: CategoryId | null, opts: { rule?: boolean } = {}) => {
    const key = txKey(tx);
    if (id === null) {
      updateVault((v) => {
        const overrides = without(v.txCategories, key);
        return overrides === v.txCategories ? v : { ...v, txCategories: overrides };
      });
      return;
    }
    if (!isCategoryId(id)) return;
    const who = counterpartyKey(tx);
    // A counterparty with neither IBAN, creditor ID nor name cannot carry a rule.
    if (opts.rule && who !== 'name:?') {
      const stale = new Set([key]);
      const loaded = [...Object.values(txCache).flatMap((e) => e.txs), ...Object.values(pendingFetched).flatMap((e) => e.txs)];
      for (const t of loaded) if (counterpartyKey(t) === who) stale.add(txKey(t));
      updateVault((v) => {
        let overrides = v.txCategories;
        for (const k of stale) overrides = without(overrides, k);
        if (v.categoryRules[who] === id && overrides === v.txCategories) return v;
        return { ...v, categoryRules: { ...v.categoryRules, [who]: id }, txCategories: overrides };
      });
      return;
    }
    updateVault((v) => (v.txCategories[key] === id
      ? v
      : { ...v, txCategories: { ...v.txCategories, [key]: id } }));
  }, [txCache, pendingFetched, updateVault]);

  /** Drops the user's rule for one counterparty (a counterpartyKey); its bookings go back to the automatic guess. */
  const removeCategoryRule = useCallback((who: string) => {
    updateVault((v) => {
      const rules = without(v.categoryRules, who);
      return rules === v.categoryRules ? v : { ...v, categoryRules: rules };
    });
  }, [updateVault]);

  // ---- printable Kontoauszug / transaction receipt ------------------------
  // A print job just snapshots what's already on screen (no extra bank call,
  // no PDF library): Statement.tsx renders it print-only, and the browser's
  // own "Save as PDF" print target is the actual PDF generator.
  const printStatement = useCallback((from?: string, to?: string) => {
    if (!activeAccount) return;
    const acct = activeAccount.accountNumber;
    const info = statementInfo[acct];
    // The document states the period its rows were fetched for — a control
    // showing another range must not relabel them. And its closing balance
    // belongs to that period: today's balance under a past range would make
    // the printed arithmetic (opening = closing − bookings) false.
    const past = !!info && info.to < isoDate(new Date());
    setPrintJob({
      kind: 'statement',
      account: activeAccount,
      bank,
      transactions: transactions ?? [],
      balance: past ? closingBalanceOf(info, activeAccount.currency) : balances[acct] ?? null,
      from: info?.from ?? from,
      to: info?.to ?? to,
      blocks: info?.blocks ?? null,
    });
    // The desktop shell exports the PDF directly to a native save dialog (see
    // Statement.tsx); only the browser's own print dialog needs this nudge.
    if (typeof window === 'undefined' || !window.electronPDF) {
      toast('Im Druckdialog „Als PDF speichern“ wählen.', 'info', 6000);
    }
  }, [activeAccount, statementInfo, bank, transactions, balances, toast]);

  const printTransaction = useCallback((tx: SerializedTransaction, pending = false) => {
    if (!activeAccount) return;
    setPrintJob({
      kind: 'transaction',
      account: activeAccount,
      bank,
      tx,
      pending,
    });
    if (typeof window === 'undefined' || !window.electronPDF) {
      toast('Im Druckdialog „Als PDF speichern“ wählen.', 'info', 6000);
    }
  }, [activeAccount, bank, toast]);

  const closePrintJob = useCallback(() => setPrintJob(null), []);

  return {
    // data
    view, meta, popularBanks, logoFiles, bank, sessionId, userId,
    bankChecking, staleBank,
    tanMethods, selectedMethod, mediaChoice, tanMethodError,
    accounts, activeAccount, balances, transactions, pendingCache, pendingInfo, txError, merchants,
    txErrors, balanceErrors, balanceLoading, loadingAllBalances,
    busy, loadingAccount, pendingLoading, deviceRemembered, wait, toasts, printJob,
    pendingErrors,
    range, statementInfo, txByAccount, ownIbans,
    messages, unreadCount, activity,
    vault, vaultStatus,
    // prefs
    privacy, idleMinutes, singleKeyShortcuts,
    logoConsent,
    // session
    sessionStartedAt, idleDeadline,
    // navigation & launchers
    tab, txFilter, txFocusNonce,
    analysisPeriod, analysisScope,
    transferOpen, transferPrefill, shareOpen, sharePrefill,
    inboxOpen, paletteOpen, shortcutsOpen,
    logoutConfirmOpen,
    // actions
    setView, setBank, connect, chooseTanMethod, clearMediaChoice, selectAccount, loadTransactions,
    cancelConnect,
    loadBalance, loadAllBalances,
    isLoadedForAppliedRange,
    refreshAccount, refreshAfterTransfer, applyRange, loadPending, submitTransfer, confirmVop, abandonVop,
    forgetDevice, logout, stayLoggedIn, toast, dismissToast,
    requestLogout, closeLogoutConfirm,
    retryWait, cancelWait, closeWait, printStatement, printTransaction, closePrintJob,
    togglePrivacy, setIdleMinutes, setSingleKeyShortcuts,
    setLogoConsent,
    setTab, setTxFilter, showTransactions,
    setAnalysisPeriod, setAnalysisScope,
    openTransfer, closeTransfer, openShare, closeShare,
    setInboxOpen, setPaletteOpen, setShortcutsOpen,
    markAllRead,
    updateVault, resetVault, wipeVault, accountLabel, renameAccount,
    saveTemplate, deleteTemplate, touchTemplate, dismissRecurring, restoreRecurring,
    categoryOf, setCategory,
    removeCategoryRule,
  };
}

export type FintsApi = ReturnType<typeof useFintsState>;

export const FintsContext = createContext<FintsApi | null>(null);

export function FintsProvider({ children }: { children: React.ReactNode }) {
  const value = useFintsState();
  return <FintsContext.Provider value={value}>{children}</FintsContext.Provider>;
}

export function useFints(): FintsApi {
  const ctx = useContext(FintsContext);
  if (!ctx) throw new Error('useFints must be used inside <FintsProvider>');
  return ctx;
}

/**
 * The brand behind a booking, if one was resolved.
 *
 * The single lookup path, so every surface — list row, detail drawer, printed
 * receipt — asks the same question the same way.
 */
export function useMerchant(tx: SerializedTransaction): Merchant | null {
  const { merchants } = useFints();
  const key = useMemo(() => getMerchantKey(tx), [tx]);
  return useMemo(() => merchants[key] ?? merchants[counterpartyName(tx)] ?? null, [merchants, key, tx]);
}

/** Convenience: the logo filename for a brand, or undefined for a monogram. */
export function useLogoFile(brand: string | undefined): string | undefined {
  const { logoFiles } = useFints();
  return useMemo(() => (brand ? logoFiles[brand] : undefined), [logoFiles, brand]);
}
