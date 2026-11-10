// What FintsProvider.tsx hands out and works with, apart from the hook
// itself: the types of its context (banks, waits, toasts, print jobs, the
// transfer's payload), its constants, and the pure helpers its hook calls —
// the date range, the inbox, the vault's shape. FintsProvider re-exports the
// public names, so screens keep importing them from there.

import {
  type DateRange, EMPTY_VAULT, type InboxMessage, type StatementInfo, type TransferTemplate, type VaultData,
} from '@/lib/app-types';
import { isGrouping, sanitizeAccountOrder } from '@/lib/account-overview';
import { isAvatarChoice, isAvatarImage, OWN_PICTURE } from '@/lib/avatars';
import { sanitizeBudgets } from '@/lib/budgets';
import { sanitizeContractNames, sanitizeNoticed, sanitizeReminders } from '@/lib/contract-watch';
import { sanitizeManual, sanitizeManualDays } from '@/lib/manual-contracts';
import type { CategoryId } from '@/lib/categories';
import { post } from '@/lib/client-api';
import type { KeptDoc } from '@/lib/docs';
import type {
  BankMessage, BankStatementsAnswer, SerializedAccount, SerializedBalance, SerializedBankOrder, SerializedTanMethod,
  SerializedTransaction, SerializedVop, TanPollResponse,
} from '@/lib/fints-types';
import { compactIban, dayKey, isoDate, parseAmount, presetRange, type RangePreset, repairBankText } from '@/lib/format';
import { type HistoryData, historyView } from '@/lib/history';
import { sanitizeKeptBalances, sanitizeNetWorth } from '@/lib/kept-balances';
import { type Messages, MESSAGES } from '@/lib/i18n';
import { type LinkedBankRef, sanitizeLinkedBanks } from '@/lib/linked-banks';
import { sanitizeNotes } from '@/lib/notes';
import type { OrderSchedule } from '@/lib/order-schedule';
import { sanitizeGoals } from '@/lib/savings-goal';
import { sanitizeSentOrders, type SentOrder } from '@/lib/sent-orders';
import { categoryValidator, nameKey, sanitizeCustomCategories, sanitizeSplits } from '@/lib/splits';
import type { TaxYear } from '@/lib/tax-year';

/** What /api/history-import says an export file holds (inspect). */
export type ImportInfo = {
  format: 'csv' | 'mt940' | 'camt';
  bookings: number;
  skipped: number;
  from: string | null;
  to: string | null;
  /** The view's account the file names, if it names one this login has. */
  account: string | null;
  /** The file names an account this login does not have. */
  foreign: boolean;
};

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

/**
 * A further bank in the view ("Weitere Bank anmelden"): a login of its own
 * on the server, beside the primary one (lib/linked-banks.ts).
 */
export type LinkedLogin = {
  /** The browser's own id for it, never derived from the login. */
  id: string;
  bank: ChosenBank;
  userId: string;
  /** Null once its session has ended: its accounts stay, marked logged out, until it logs in again. */
  sessionId: string | null;
  /** The accounts this login brought, in the bank's order. */
  accountNumbers: string[];
  /** The approval method of this login, for the pace and the words of its approvals. */
  method: SerializedTanMethod | null;
  deviceRemembered: boolean;
};

/** One bank of the view, as the account list and the Sitzung panel show it. */
export type BankEntry = {
  /** 'primary', a LinkedLogin's id, or `remembered:…` for a linked bank not logged in now. */
  key: string;
  bank: ChosenBank;
  state: 'primary' | 'active' | 'loggedOut' | 'remembered';
  /** What the vault keeps about a linked bank (null for the primary). */
  ref: LinkedBankRef | null;
  deviceRemembered: boolean;
};

/**
 * "Weitere Bank anmelden" while its sheet is open: the login's own steps,
 * for a session beside the primary one. The Freigabe is the usual overlay.
 */
export type AddBankState = {
  step: 'bank' | 'credentials' | 'method';
  bank: ChosenBank | null;
  /** The login name the form starts with, for this BLZ: a remembered bank's, or the one that logged out. */
  prefill: { blz: string; userId: string } | null;
  tanMethods: SerializedTanMethod[];
  selectedMethod: SerializedTanMethod | null;
  mediaChoice: string[] | null;
  error: string | null;
  /** Android: this login's PIN, which the first login's fingerprint opened — the form tries it at once. */
  openedPin: string | null;
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

/**
 * `cancelled`: the login's own approval was called off, so the half-open
 * session goes. `hidden`: the desktop's window closed into the notification
 * area (src-tauri/src/background.rs).
 */
export type LogoutReason = 'user' | 'idle' | 'expired' | 'cancelled' | 'hidden';

/** The idle limits the user can choose from, in minutes. */
export const IDLE_MINUTE_CHOICES = [5, 10, 15, 30] as const;
export type IdleMinutes = (typeof IDLE_MINUTE_CHOICES)[number];

/**
 * The user's answer to "Firmenlogos anzeigen?". No name goes to the logo
 * service until it is 'on'. Kept per machine, with the other preferences.
 */
export type LogoConsent = 'unasked' | 'on' | 'off';

/** A snapshot of what to render on the print-only Kontoauszug, receipt or message sheet. */
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
    }
  | {
      kind: 'message';
      bank: ChosenBank | null;
      /** As the inbox holds it: the bank's subject and text, and when this session received them. */
      message: InboxMessage;
    }
  | {
      /** The Steuer-Jahresübersicht (lib/tax-year.ts): one year in the categories the user picked. */
      kind: 'taxYear';
      summary: TaxYear;
      /** The account holder, as the banks name them. */
      holder: string;
      /** The accounts in scope, as the sheet lists them. */
      accounts: { accountNumber: string; iban: string; label: string; bank: string }[];
    };

/** When an account's Vorgemerkt list was fetched, and how it stands against the statement. */
export type PendingInfo = {
  /** epoch ms — how fresh the rows shown are (the "Stand"). */
  loadedAt: number;
  /**
   * A statement was loaded after the list. Whatever it shows as booked has
   * left `pendingCache`; the rest may have been booked too, under another
   * date or reference — the list is older than the bookings beside it.
   */
  behindStatement: boolean;
  /** How many of the fetched items that statement already shows as booked. */
  booked: number;
  /**
   * epoch ms — when a Vorgemerkt list for the account was last read, on
   * request or with the Umsätze, whether or not it added rows: whether a
   * read has landed (TransferSheet's check).
   */
  readAt: number;
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

/**
 * Approvals around the orders a bank keeps for later (lib/fints-orders.ts):
 * placing a Dauerauftrag or a terminierte Überweisung, reading the bank's
 * list of them, deleting one. Their words are in lib/i18n/messages/orders.ts.
 */
export type OrderWaitKind = 'standingOrder' | 'datedTransfer' | 'bankOrders' | 'orderDelete' | 'orderChange';

/** What an approval is for — the overlay asks before abandoning an order. */
export type WaitKind = 'login' | 'statements' | 'pending' | 'balance' | 'portfolio' | 'bankStatements' | 'transfer' | OrderWaitKind;

const ORDER_WAIT_KINDS: readonly string[] = ['standingOrder', 'datedTransfer', 'bankOrders', 'orderDelete', 'orderChange'];
export const isOrderWaitKind = (k: WaitKind | null | undefined): k is OrderWaitKind => !!k && ORDER_WAIT_KINDS.includes(k);

/** An approval for an order that may move money: a transfer, a terminierte Überweisung, a Dauerauftrag. */
export const placesOrder = (k: WaitKind | null | undefined) => k === 'transfer' || k === 'standingOrder' || k === 'datedTransfer';

/**
 * An approval for an order of any kind — one that may move money, or delete
 * an order: never offered again behind the user's back, and leaving it is
 * asked first, because the bank holds it either way.
 */
export const isOrderWait = (k: WaitKind | null | undefined) => placesOrder(k) || k === 'orderDelete' || k === 'orderChange';

/** What an approval asks the user to confirm, as the object of "bestätige …", in `m`'s language. */
export const waitSubject = (m: Messages, kind: WaitKind): string =>
  (isOrderWaitKind(kind) ? m.orders.wait.subject[kind] : m.provider.wait.subject[kind]);

/** The approval a submitted order waits for: a transfer's, a Dauerauftrag's or a terminierte Überweisung's. */
export const orderWaitKind = (schedule: OrderSchedule | null | undefined): WaitKind =>
  (schedule?.kind === 'standing' ? 'standingOrder' : schedule?.kind === 'dated' ? 'datedTransfer' : 'transfer');

/**
 * The order an approval is for, as the bank received it (name rewritten to
 * the SEPA character set), for the user to compare with their banking app —
 * with when it runs, for one the bank keeps for later.
 */
export type WaitOrder = { amount: number; name: string; iban: string; instant: boolean; schedule?: OrderSchedule | null };

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
  /** Which bank asks — named once more than one bank is in the view, null otherwise. */
  bank: { name: string; brand: string } | null;
  /** The method this approval runs on: that of the login it belongs to. */
  method: SerializedTanMethod | null;
  /** A typed TAN instead of an app approval; null for an approval in the bank's app. */
  entry: TanEntry | null;
};

/** A kept document as the view lists it: with the login (session) it is kept under. */
export type ListedDoc = KeptDoc & { sid: string };

/** The last fetch of an account's Kontoauszüge from the bank: what it brought, or why it failed. */
export type StatementFetch = { at: number; answer: BankStatementsAnswer | null; error: string | null };

/** What a typed TAN is entered from, and how far it got. */
export type TanEntry = {
  /** photoTAN or chipTAN QR: the graphic to scan, a data URL. */
  image: string | null;
  /** chipTAN optisch: the code the flicker graphic shows (lib/flicker.ts). */
  flicker: string | null;
  /** The longest TAN the bank takes, and whether it is digits only, where the method says. */
  maxLength: number | null;
  numeric: boolean | null;
  /** The TAN is with the bank; its answer is awaited. */
  sending: boolean;
  /** The bank asked for another TAN after one was sent. */
  again: boolean;
};

/**
 * A text the provider keeps for a screen to show later. The app's own words
 * are kept unwritten — a function of the texts — and written in the language
 * on screen each time they are shown, so a change of language reaches them;
 * what the bank or the server said is kept as it came.
 */
export type OwnText = (m: Messages) => string;
export type KeptText = string | OwnText;
export const written = (k: KeptText, m: Messages): string => (typeof k === 'function' ? k(m) : k);

/** WaitState as the provider keeps it: its own words unwritten until shown (shownWait). */
export type KeptWait = Omit<WaitState, 'title' | 'text' | 'error' | 'note'> & {
  title: OwnText | null;
  text: OwnText | null;
  error: KeptText | null;
  note: OwnText | null;
};

export const IDLE_WAIT: KeptWait = {
  open: false, kind: null, title: null, text: null, challenge: null,
  phase: 'waiting', error: null, canRetry: false, startedAt: 0, settledAt: null, vop: null, tanMediaName: null,
  order: null, note: null, bank: null, method: null, entry: null,
};

/** AddBankState as the provider keeps it: its error perhaps unwritten, and the login under way. */
export type KeptAddBank = Omit<AddBankState, 'error'> & {
  error: KeptText | null;
  /** The new login's session, once the bank answered — dropped if the flow does not finish. */
  sessionId: string | null;
  /** The login name it was opened with, as typed. */
  login: string;
  /** What the bank said at that login, added to Mitteilungen once the bank joins the view. */
  messages: BankMessage[];
  /** Android: its PIN came from behind the fingerprint, so it is sealed already. */
  sealed: boolean;
  /** Android: logged in on its own after the first login's fingerprint, not by the user's hand. */
  auto: boolean;
};

/** The wait as TanWaitOverlay reads it, in the language on screen. */
export function shownWait(w: KeptWait, m: Messages): WaitState {
  return {
    ...w,
    title: w.title ? w.title(m) : '',
    text: w.text ? w.text(m) : '',
    error: w.error === null ? null : written(w.error, m),
    note: w.note ? w.note(m) : null,
  };
}

/** A failed read as the provider keeps it (LoadError, its message perhaps unwritten). */
export type KeptLoadError = { message: KeptText; at: number };

export type TanGate = {
  needsTan?: boolean;
  /** False: the TAN is typed (TanRequired). Left out, the method decides. */
  decoupled?: boolean;
  tanChallenge?: string | null;
  tanMediaName?: string | null;
  tanImage?: string | null;
  flicker?: string | null;
  vop?: SerializedVop;
};

export type WaitCallbacks = {
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

/**
 * What the transfer form submits; the server parses `amount` itself.
 * `schedule`: a terminierte Überweisung or a Dauerauftrag instead of a
 * transfer carried out now (never with `instant`).
 */
export type TransferPayload = {
  accountNumber: string; recipientName: string; iban: string;
  amount: string; purpose: string; instant: boolean;
  schedule?: OrderSchedule;
  /**
   * Changes the bank-held order of this handle (SerializedBankOrder.ref)
   * instead of placing a new one (HKCSA/HKCDN). Not logged for the duplicate
   * check: it is no new order.
   */
  change?: string;
};

/** One kind of the bank's orders for an account, as last read (loadBankOrders). */
export type BankOrdersInfo = {
  orders: SerializedBankOrder[];
  /** False when the bank had more to send than the read collected. */
  complete: boolean;
  /** Orders the bank listed that the app could not read. */
  unreadable: number;
  /** epoch ms */
  loadedAt: number;
};

/** What became of a deletion asked for in this session, by the order's handle (SerializedBankOrder.ref). */
export type OrderDeletion = {
  status: 'deleted' | 'refused' | 'unclear';
  /** The bank's answer, codes included (shown without). */
  answers?: string;
  /** epoch ms */
  at: number;
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

export const DEFAULT_IDLE_MINUTES: IdleMinutes = 10;
/** What counts as the user being there. Pointer movement alone does not. */
export const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
/** The server forgets a session after 30 idle minutes; one ping a minute while active is plenty. */
export const KEEPALIVE_EVERY_MS = 60_000;
/** idleDeadline is state, and state re-renders: publish it at most this often while far away. */
export const DEADLINE_PUBLISH_MS = 10_000;
/** SessionGuard asks "Möchtest du angemeldet bleiben?" inside this window. */
export const WARNING_WINDOW_MS = 60_000;
export const VAULT_SAVE_DELAY_MS = 800;
export const LOGOUT_FLUSH_TIMEOUT_MS = 2000;
/** How long "Freigabe bestätigt" stays up before the overlay leaves. */
export const CONFIRMED_LINGER_MS = 700;
/** A statement approval this soon after the login's own is "the second one" (startApproval). */
export const SECOND_APPROVAL_MS = 30_000;
export const DEFAULT_RANGE_PRESET: RangePreset = '90d';
export const MAX_TOASTS = 4; // = Toasts.tsx MAX_VISIBLE: a queued toast nobody can see would expire unseen
export const MAX_ACTIVITY = 50;
export const MAX_TEMPLATES = 200;
export const MAX_ALIAS = 60;
/** The idle logout happens while nobody is looking; the notice has to outlast the absence. */
export const IDLE_NOTICE_MS = 10 * 60_000;
// Another operation still running (msgs().provider.busy) is a wait, not a
// failure: toasted as a notice, never in the error's red.

// ---------------------------------------------------------------------------
// Pure helpers

export const isIdleChoice = (n: unknown): n is IdleMinutes =>
  (IDLE_MINUTE_CHOICES as readonly unknown[]).includes(n);

/** The statement cache's key: the range actually asked for. */
export const rangeKey = (r: DateRange) => `${r.from}|${r.to}`;

/**
 * What an applied range that ended today was: the day it meant by "today",
 * and the preset it was, if any — "Letzte 90 Tage" stays ninety days long
 * after midnight, "Dieses Jahr" follows the calendar.
 */
export type RangeAnchor = { to: string; preset: RangePreset | null };

/** The presets that run up to today, and so move with it. */
const ROLLING_PRESETS: readonly RangePreset[] = ['30d', '90d', '365d', 'thisMonth', 'thisYear'];

/** `r` as the anchor it sets, or null for a range that does not end today. */
export function anchorOf(r: DateRange, now = new Date()): RangeAnchor | null {
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
export function rangeForLoad(r: DateRange, anchor: RangeAnchor | null, now = new Date()): DateRange {
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
export function defaultRange(now = new Date()): DateRange {
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
export function normalizeRange(r: DateRange, today = isoDate(new Date())): DateRange | null {
  if (!r || !isRealDay(r.from) || !isRealDay(r.to)) return null;
  let { from, to } = r;
  if (from > to) [from, to] = [to, from];
  if (to > today) to = today;
  if (from > today) from = today;
  return { from, to };
}

/** An id for a template or a log entry. */
export function newId(): string {
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
export function typedAmount(raw: string): number {
  return Math.abs(parseAmount(raw) ?? 0);
}

/**
 * A submitted order as the vault's two-week log keeps it (lib/sent-orders.ts),
 * or null without amount or IBAN. One the bank keeps for later says so, with
 * its first date: it moves no money today.
 */
export function sentOrderOf(p: TransferPayload, outcome: SentOrder['outcome'], at: string): SentOrder | null {
  const cents = Math.round(typedAmount(p.amount) * 100);
  const iban = compactIban(p.iban);
  const s = p.schedule;
  const later = s ? { kind: s.kind, due: s.kind === 'dated' ? s.date : s.first } : {};
  return cents > 0 && iban ? { at, accountNumber: p.accountNumber, iban, cents, outcome, ...later } : null;
}

/** One login message as an inbox entry, or null when the bank sent nothing readable. */
function toInboxMessage(m: BankMessage, receivedAt: string, bank?: string): InboxMessage | null {
  const text = repairBankText(String(m?.text ?? '').trim());
  let subject = repairBankText(String(m?.subject ?? '').trim());
  if (!subject && !text) return null;
  if (!subject) {
    const first = text.split(/\r?\n/)[0].trim();
    subject = first.length > 80 ? `${first.slice(0, 79)}…` : first;
  }
  return { id: newId(), subject, text, receivedAt, read: false, ...(bank ? { bank } : {}) };
}

/** A login's messages as inbox entries, each one once. */
export function inboxOf(list: readonly BankMessage[], receivedAt: string, bank: string): InboxMessage[] {
  const seen = new Set<string>();
  return list
    .map((m) => toInboxMessage(m, receivedAt, bank))
    .filter((m): m is InboxMessage => {
      if (!m) return false;
      const key = `${m.subject}\n${m.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/**
 * Whether a category of that name exists already: one of the user's own, or
 * one of the app's in either language ("Shopping" is both) — two rows of the
 * same name in a menu could not be told apart.
 */
export function categoryNameTaken(name: string, own: readonly { name: string }[]): boolean {
  const key = nameKey(name);
  if (own.some((c) => nameKey(c.name) === key)) return true;
  const builtin = [...Object.values(MESSAGES.de.categories), ...Object.values(MESSAGES.en.categories)];
  return builtin.some((label) => nameKey(label) === key);
}

/** Removes `key` from a record without mutating it; the same object when it is absent. */
export function without<V>(rec: Record<string, V>, key: string): Record<string, V> {
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
export function normalizeVault(raw: VaultData | null | undefined): VaultData {
  if (!raw || typeof raw !== 'object') return EMPTY_VAULT;
  const record = (v: unknown): Record<string, unknown> =>
    v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  // Checked against this vault's own categories, not the ones registered for
  // the page — those belong to the vault this one replaces.
  const customCategories = sanitizeCustomCategories(raw.customCategories);
  const known = categoryValidator(customCategories);
  const categories = (v: unknown): Record<string, CategoryId> => {
    const out: Record<string, CategoryId> = {};
    for (const [k, id] of Object.entries(record(v))) if (known(id)) out[k] = id;
    return out;
  };
  const aliases: Record<string, string> = {};
  for (const [k, a] of Object.entries(record(raw.aliases))) if (typeof a === 'string' && a.trim()) aliases[k] = a;
  // Kept, or the next save would forget the linked banks.
  const linkedBanks = sanitizeLinkedBanks(raw.linkedBanks);
  const goals = sanitizeGoals(raw.goals);
  const accountOrder = sanitizeAccountOrder(raw.accountOrder);
  const accountsHidden = sanitizeAccountOrder(raw.accountsHidden);
  // As the vault does (lib/vault.ts sanitizeVault): switched off, none are kept.
  const keepBalances = raw.keepBalances !== false;
  const keptBalances = keepBalances ? sanitizeKeptBalances(raw.keptBalances) : {};
  const netWorth = keepBalances ? sanitizeNetWorth(raw.netWorth) : [];
  return {
    version: 1,
    templates: Array.isArray(raw.templates)
      ? raw.templates.filter((t): t is TransferTemplate => !!t && typeof t.id === 'string' && typeof t.iban === 'string')
      : [],
    aliases,
    categoryRules: categories(raw.categoryRules),
    txCategories: categories(raw.txCategories),
    customCategories,
    splits: sanitizeSplits(raw.splits, known),
    dismissedRecurring: Array.isArray(raw.dismissedRecurring)
      ? raw.dismissedRecurring.filter((id): id is string => typeof id === 'string')
      : [],
    ...(sanitizeReminders(raw.contractReminders) ? { contractReminders: sanitizeReminders(raw.contractReminders) } : {}),
    // Kept too, or a login (and every sync round) would put the bank's names back and the next round delete them everywhere.
    ...(sanitizeContractNames(raw.contractNames) ? { contractNames: sanitizeContractNames(raw.contractNames) } : {}),
    ...(sanitizeManual(raw.manualContracts) ? { manualContracts: sanitizeManual(raw.manualContracts) } : {}),
    ...(sanitizeManualDays(raw.manualDays) ? { manualDays: sanitizeManualDays(raw.manualDays) } : {}),
    ...(sanitizeNoticed(raw.noticedContracts) ? { noticedContracts: sanitizeNoticed(raw.noticedContracts) } : {}),
    // The same rules the vault applies (lib/budgets.ts, lib/notes.ts) — and
    // an older vault without either reads as one without any.
    budgets: sanitizeBudgets(raw.budgets, customCategories),
    notes: sanitizeNotes(raw.notes),
    sentOrders: sanitizeSentOrders(raw.sentOrders),
    ...(isAvatarChoice(raw.avatar) && (raw.avatar !== OWN_PICTURE || isAvatarImage(raw.avatarImage))
      ? { avatar: raw.avatar }
      : {}),
    ...(isAvatarImage(raw.avatarImage) ? { avatarImage: raw.avatarImage } : {}),
    ...(linkedBanks.length ? { linkedBanks } : {}),
    // Kept too, or the login would read "Umsätze behalten" as off: the kept
    // Umsätze would not load, and the next save would switch it off for good.
    ...(raw.keepBookings === true ? { keepBookings: true as const } : {}),
    // Kept too, or the next save would drop the Sparziele.
    ...(goals.length ? { goals } : {}),
    // Kept too, or the next save would forget Konten anordnen, the last
    // balances and the Gesamtsaldo's days, and read "Letzte Salden behalten"
    // as on again after it was switched off.
    ...(accountOrder.length ? { accountOrder } : {}),
    ...(isGrouping(raw.accountGrouping) ? { accountGrouping: raw.accountGrouping } : {}),
    ...(accountsHidden.length ? { accountsHidden } : {}),
    ...(Object.keys(keptBalances).length ? { keptBalances } : {}),
    ...(netWorth.length ? { netWorth } : {}),
    ...(keepBalances ? {} : { keepBalances: false as const }),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : EMPTY_VAULT.updatedAt,
  };
}

/** The vault with `list` as its linked banks — the key gone with the last one. */
export function withLinkedBanks(v: VaultData, list: LinkedBankRef[]): VaultData {
  if (list.length) return { ...v, linkedBanks: list };
  if (!v.linkedBanks) return v;
  const { linkedBanks: _gone, ...rest } = v;
  return rest as VaultData;
}

/**
 * The bank's own closing balance at the end of a fetched range: the latest
 * statement block that carries one. Null when the bank sent none — a printed
 * statement then says so rather than borrowing today's balance.
 */
export function closingBalanceOf(info: StatementInfo, fallbackCurrency: string): SerializedBalance | null {
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
export function deliveredEnd(txs: readonly SerializedTransaction[], blocks: StatementInfo['blocks']): string | null {
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

/** One account's last answer from the bank, and the span the list made of it shows. */
export type AccountFetch = {
  /** The span the list was asked to show (its cache key, rangeKey). */
  span: DateRange;
  /** The last day the answer covers — `span.to`, or earlier when the bank cut it short. */
  coveredTo: string;
  /** Where the bank was asked from (at `span.from`, or later with kept Umsätze before it); null: not asked at all. */
  fetchFrom: string | null;
  /** The bank's booked Umsätze exactly as it sent them. */
  txs: SerializedTransaction[];
  blocks: StatementInfo['blocks'];
  /** epoch ms */
  loadedAt: number;
};

/**
 * The lists every view reads, made from the bank's answers and the kept
 * Umsätze (lib/history.ts historyView): per account the bank's answer for
 * what it was asked, the kept days before it. Without the kept days (not
 * loaded, or switched off since), a list is the bank's answer alone and says
 * so — its `from` is where the bank was asked from — and one that was made of
 * kept days alone is gone.
 */
export function listsOf(fetches: Record<string, AccountFetch>, kept: HistoryData | null) {
  const txCache: Record<string, { key: string; txs: SerializedTransaction[] }> = {};
  const statementInfo: Record<string, StatementInfo> = {};
  for (const [acct, f] of Object.entries(fetches)) {
    const view = historyView({
      span: { from: f.span.from, to: f.coveredTo }, fetchFrom: f.fetchFrom, fetched: f.txs, history: kept?.accounts[acct],
    });
    if (!view.saved && f.fetchFrom == null) continue;
    const from = view.saved || f.fetchFrom == null ? f.span.from : f.fetchFrom;
    txCache[acct] = { key: rangeKey({ from, to: f.span.to }), txs: view.txs };
    statementInfo[acct] = {
      from, to: f.coveredTo, blocks: f.blocks, loadedAt: f.loadedAt, ...(view.saved ? { saved: view.saved } : {}),
    };
  }
  return { txCache, statementInfo };
}

export const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A login's id, so "Abbrechen" can name it to the server. Random, never derived from the user. */
export const newAttemptId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

/** Has the server forget a login's session — and the PIN it holds. No bank traffic. */
export function dropSession(sid: string | null | undefined): void {
  if (sid) post('/api/logout', { sessionId: sid }).catch(() => { /* the 30-minute sweep remains */ });
}
