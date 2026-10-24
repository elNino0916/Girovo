'use client';

// A stand-in for <FintsProvider> that never talks to a bank.
//
// It is a real state machine, not a frozen object: selecting an account
// "loads" it, a range beyond 90 days asks for a (simulated) approval, a
// transfer goes through Namensabgleich, TAN and done, the session clock counts
// down and logs out. Every field and action of FintsApi is implemented —
// the value is checked with `satisfies FintsApi`, so a field the real provider
// gains is a compile error here until the mock has it too.
//
// What it simulates, and how long it takes, is deliberately boring and fixed,
// so screenshots are reproducible:
//   statement load        ~700 ms; beyond 90 days a decoupled approval first
//   balance enquiry       ~500 ms, no approval ("Alle Salden abrufen")
//   `fail`                every statement load and balance enquiry fails
//   approval (TAN)        `tanMs` (2.6 s); `tan: 'hold'` keeps it waiting
//   Vormerkposten         always an approval, like most banks
//   transfer              approval, then executed. Payee name …
//                           "Max Musterman"  → Namensabgleich: Close Match
//                           containing "Schmidt" → Namensabgleich: No Match
//                           containing "Kiosk" → Namensabgleich: not possible
//                           containing "Fehler" → the bank refuses the order
//                           containing "Abgelehnt" → refused in the app
//                           containing "Unklar" → the dialog ends: status unknown
//   Termin                "An einem Datum" / "Regelmäßig" go through the same steps as a
//                           transfer, as a Terminüberweisung or a Dauerauftrag
//   bank's orders         three Daueraufträge and a Terminüberweisung on the Girokonto,
//                           none on the Tagesgeld; reading the Daueraufträge asks for an
//                           approval, the Terminüberweisungen follow without; deleting
//                           one asks for an approval (`tan` decides how it ends)
//   `ordersLoaded`        the Girokonto's lists were read before; `noOrders`: the bank
//                           offers neither (the sheet as without the feature)
//   `unclear`             this session's log already holds a "Status unklar" transfer
//   `failPending`         every Vorgemerkt fetch fails once its approval is through
//   logout                "Abmelden" asks first while the log holds an unclear
//                           transfer; the notice's PIN clause follows ~300 ms later
//   login                 user name … "fehler" → wrong PIN, "gesperrt" → access locked,
//                           "wartung" → bank not answering, "langsam" → no answer
//                           until "Abbrechen"; else TAN methods
//   print                 no PDF — a toast says so
//   Weitere Bank anmelden any bank but the first answers with the second bank's
//                           Girokonto (S-pushTAN, one approval); the first bank
//                           under another login name lists the same accounts
//                           again (nothing new); a login name with "doppelt"
//                           brings an account under the Girokonto's number
//                           (refused: collision). `secondBank` starts with
//                           that bank linked, logged out, or only remembered
//   kept Umsätze          `history: 'saved'`: kept from the window's start to three days
//                           ago; the lists open on "Alles Gespeicherte", a longer Zeitraum
//                           asks only for the 90 days, a month before them asks nothing
//
// Nothing here persists: privacy, idle limit and theme stay in memory, so the
// harness can never change the preferences of the real app on the same origin.

import { sanitizeGoals, type SavingsGoal } from '@/lib/savings-goal';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import {
  FintsContext, countsAsActivity, orderWaitKind, waitHoldsSession,
  type AddBankState, type BankEntry, type BankOrdersInfo, type LinkedLogin,
  type ChosenBank, type FintsApi, type IdleMinutes, type LoadError, type LoadOutcome, type LoadSettled,
  type LogoutReason, type OrderDeletion, type PendingInfo, type PrintJob, type Toast,
  type ToastAction, type ToastTone, type TransferHandlers, type TransferPayload, type View, type WaitKind,
  type WaitOrder, type WaitState,
} from '@/components/FintsProvider';
import type { LogoConsent } from '@/components/FintsProvider';
import { acceptsBalance, balanceQueue, failureSentence, namesList } from '@/lib/balances';
import { forgetLinkedBank, joinAccounts, rememberLinkedBank, sameLogin } from '@/lib/linked-banks';
import { MESSAGES, msgs } from '@/lib/i18n';
import { BANK_UNAVAILABLE, bankAnswerLines } from '@/lib/bank-answer';
import { sanitizeBudgets, type Budgets } from '@/lib/budgets';
import { categorize, explainGuess, type CategoryGuess } from '@/lib/categorize';
import { withNote } from '@/lib/notes';
import {
  counterpartyKey, isCategoryId, setCustomCategories, txKey, type CategoryId, type CategoryResult, type CustomCategoryId,
} from '@/lib/categories';
import { bankAllowed, type PlusStatus } from '@/lib/plus';
import {
  categoryValidator, cleanCategoryName, CUSTOM_LIMITS, nameKey, newCustomId, sanitizeSplit, withoutCategory, type SplitPart,
} from '@/lib/splits';
import type { TaxYear } from '@/lib/tax-year';
import type { BackupSummary, RestoreReport } from '@/lib/backup';
import { addDaysKey, fmtDate, fmtRange, ibanValid, isoDate, parseAmount, presetRange, repairBankText, translateType } from '@/lib/format';
import {
  EMPTY_HISTORY, deliveredSpan, historyCoverage as coverageOf, historyView, mergeIntoHistory, planFetch, savedPeriod,
  type HistoryData, type HistoryStatus,
} from '@/lib/history';
import { recordSentOrder } from '@/lib/sent-orders';
import { idleLogoutNotice, logoutNotice, unclearTransfers } from '@/lib/session-log';
import { sepaSanitize } from '@/lib/sepa-text';
import {
  EMPTY_FILTER, EMPTY_VAULT,
  type ActivityEntry, type DashboardTab, type DateRange, type InboxMessage, type SettingsTarget, type ShareAllRequest, type SharePrefill, type StatementInfo,
  type TransferPrefill, type TransferTemplate, type TxFilter, type VaultData, type VaultStatus,
} from '@/lib/app-types';
import type { AnalysisPeriod, AnalysisScope } from '@/lib/app-types';
import type {
  BankOrderKind, Merchant, SerializedAccount, SerializedBalance, SerializedBankOrder, SerializedPortfolio, SerializedTanMethod,
  SerializedTransaction, SerializedVop,
} from '@/lib/fints-types';
import { scheduleSentence } from '@/lib/order-schedule';
import {
  ACCT, MOCK_DEPOT, MOCK_PAYEES, MOCK_TAN_KIND, getMockData, mockPdf, mockPortfolio,
  type MockData, type MockStatement, type MockTanKind,
} from './data';
import type { ListedDoc, StatementFetch } from '@/components/FintsProvider';
import type { AwaitedBooking, KeptDoc } from '@/lib/docs';
import { saveFile } from '@/lib/download';
import { renderFlicker } from '@/lib/flicker';
import { qrMatrix, qrSvgPath } from '@/lib/qr';

export type MockPreset = 'default' | 'empty' | 'past-range' | 'unverified' | 'loading' | 'error';

export type MockOptions = {
  /** The statement range loaded at start. Default '90d', like the real app after login. */
  range?: '90d' | '365d' | 'all';
  /**
   * How a simulated approval ends. 'hold' keeps it waiting (for screenshots of
   * the wait); with a typed TAN it keeps the sent TAN waiting for the bank.
   * 'again': the bank asks for a second TAN after the first, then confirms.
   */
  tan?: 'confirm' | 'hold' | 'ended' | 'error' | 'refused' | 'again';
  /** How long a simulated approval takes before it ends as `tan` says. */
  tanMs?: number;
  /** A held approval that started this long ago — past the bank's limit, for the overdue state. */
  tanElapsedMs?: number;
  /** After the login's approval, the first statement asks for one of its own (and holds it). */
  secondApproval?: boolean;
  /** Puts the first auto-logout this far away (e.g. 45_000 for the warning dialog). */
  idleInMs?: number;
  /** Where the session starts. Default 'dashboard'. */
  view?: View;
  /** With view 'login': the bank is already chosen (the credentials step). */
  bankChosen?: boolean;
  /** With view 'login': the bank remembered from last time has left the list. */
  staleBank?: boolean;
  /** 'typed': the bank offers only methods that need a typed TAN. */
  methods?: 'typed';
  /**
   * The method the session's approvals run on, by kind (data.ts MOCK_TAN_KIND):
   * the app approval by default; a typed TAN asks for one, from a flicker code,
   * a graphic, the challenge's words or an SMS.
   */
  method?: MockTanKind;
  /** The bank lists a Depot too (data.ts MOCK_DEPOT): its holdings in place of Umsätze. */
  depot?: boolean;
  /** A receipt is attached to a booking from the start (the drawer's "Belege"), and two of the bank's statements are kept. */
  docs?: boolean;
  // First-frame navigation. Part of the initial state rather than set from an
  // effect, so nothing (a slow first compile, a hot reload) can race it.
  tab?: DashboardTab;
  /** A launcher open from the start. */
  open?: 'inbox' | 'palette' | 'shortcuts' | 'share' | 'transfer' | 'plus';
  /** The transfer form's prefill with `open: 'transfer'`. */
  transferPrefill?: TransferPrefill;
  privacy?: boolean;
  /**
   * Company logos: the user's answer, or 'unavailable' for a build that does
   * not offer them. Default: not asked yet on the login screens (a first
   * start), answered "no" on the dashboard (logos stay off in the preview).
   */
  logos?: LogoConsent | 'unavailable';
  /** Start on this account (accountNumber), loaded with the start range. */
  account?: string;
  /** Umsätze search text. */
  query?: string;
  /** The bank lists only the Girokonto — the customer with a single account. */
  oneAccount?: boolean;
  /** Every statement load and balance enquiry from now on fails (read live). */
  fail?: boolean;
  /** The Umsätze list's narrowing beyond the search: a month chip, a category. */
  filter?: Partial<TxFilter>;
  /** The Umsatzanalyse's first period (a yyyy-mm month or 'all') and accounts. */
  analysisPeriod?: string;
  analysisScope?: AnalysisScope;
  /** Category rules and single-booking choices in the vault from the start. */
  categoryRules?: VaultData['categoryRules'];
  /** Monthly budgets in the vault from the start (the mock data's set). */
  budgets?: boolean;
  /**
   * Notes on a few bookings, one of them refiled by hand, and a rule — the
   * mock data's `personal` set (the drawer's note, the Kategorie-Check).
   */
  personal?: boolean;
  /**
   * This session's log holds a transfer whose status is unclear (Abmelden asks
   * first): from the Girokonto 12 minutes ago; 'tagesgeld' from the Tagesgeld,
   * whose Umsätze are not loaded; 'recent' from the Girokonto after its list
   * was fetched.
   */
  unclear?: boolean | 'tagesgeld' | 'recent';
  /** Every Vorgemerkt fetch fails once its approval is through (read live). */
  failPending?: boolean;
  /**
   * The Girokonto's bank offers no HKVMK and sends the Vorgemerkte with the
   * Umsätze instead, as Sparkassen do: no fetch of their own, a fresh list
   * with every statement read up to today.
   */
  pendingWithStatements?: boolean;
  /**
   * A second bank in the view from the start (data.second): 'linked' logged in
   * beside the first, 'loggedOut' its session ended during this one,
   * 'remembered' only in the vault — the offer after the next login.
   */
  secondBank?: 'linked' | 'loggedOut' | 'remembered';
  /**
   * Girovo Plus (lib/plus.ts), as the Play build sees it: 'inactive' locks a
   * second bank and the forecast, 'active' is a subscriber, 'unavailable' a
   * phone without Play billing. Default 'free' (desktop, GitHub APK).
   */
  plus?: 'free' | 'active' | 'inactive' | 'unavailable';
  /**
   * "Umsätze auf diesem Rechner behalten" is on. 'saved': every account with
   * Umsätze has them kept from the start of the mock window up to three days
   * ago, and the lists open on "Alles Gespeicherte" — the kept part before
   * the bank's 90 days. 'unreadable': the kept file does not open with this
   * PIN (the Sitzung panel's way out).
   */
  history?: 'saved' | 'unreadable';
  /** The Girokonto's Daueraufträge and Terminüberweisungen were read a few minutes ago. */
  ordersLoaded?: boolean;
  /**
   * The bank offers neither Daueraufträge nor Terminüberweisungen over FinTS:
   * the transfer sheet looks exactly as without the feature, and Verträge &
   * Abos has no list of the bank's.
   */
  noOrders?: boolean;
};

export type MockFintsProviderProps = MockOptions & {
  children: ReactNode;
  preset?: MockPreset;
  /** Merged over the live value last — forces any field for a screenshot. */
  overrides?: Partial<FintsApi>;
  /**
   * Settles every animation at its end state and hides the Next.js dev
   * indicator — for screenshots. Default: on under Electron (the screenshot
   * helper), off in a browser.
   */
  still?: boolean;
};

// ---------------------------------------------------------------------------
// The real provider's constants, mirrored

const IDLE_WAIT: WaitState = {
  open: false, kind: null, title: '', text: '', challenge: null,
  phase: 'waiting', error: null, canRetry: false, startedAt: 0, settledAt: null, vop: null, tanMediaName: null,
  order: null, note: null, bank: null, method: null, entry: null,
};
/** As the provider's WAIT_SUBJECT. */
const WAIT_SUBJECT: Record<WaitKind, string> = {
  login: 'die Anmeldung',
  statements: 'den Umsatzabruf',
  pending: 'den Abruf der vorgemerkten Umsätze',
  balance: 'die Saldoabfrage',
  transfer: 'die Überweisung',
  standingOrder: 'den Dauerauftrag',
  datedTransfer: 'die Terminüberweisung',
  bankOrders: 'den Abruf deiner Aufträge',
  orderDelete: 'das Löschen des Auftrags',
  orderChange: 'die Änderung des Auftrags',
  portfolio: 'die Depotabfrage',
  bankStatements: 'den Abruf der Kontoauszüge',
};
const SECOND_APPROVAL_MS = 30_000;
/** What the mock bank answers when an approval is refused in the app. */
const MOCK_REFUSAL = '9210: Der Auftrag wurde abgelehnt – die Freigabe wurde in der App verweigert. | 9800: Dialog abgebrochen.';
const DEFAULT_IDLE_MINUTES: IdleMinutes = 10;
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
const DEADLINE_PUBLISH_MS = 10_000;
const WARNING_WINDOW_MS = 60_000;
const CONFIRMED_LINGER_MS = 700;
const MAX_TOASTS = 4;
const MAX_ACTIVITY = 50;
const MAX_TEMPLATES = 200;
const MAX_ALIAS = 60;
const IDLE_NOTICE_MS = 10 * 60_000;
const BUSY_MESSAGE = 'Bitte warten – ein anderer Vorgang läuft noch.';
const LOAD_MS = 700;
const BALANCE_MS = 500;
const DEFAULT_TAN_MS = 2600;
/** How long the bank takes over a typed TAN. */
const TYPED_TAN_MS = 900;
/** What a bank answers to a wrong TAN. */
const MOCK_TAN_REFUSAL = '9941: TAN ungültig.';

/** A till receipt, drawn: an image for the drawer's "Belege" (null where there is no canvas). */
async function mockReceiptImage(): Promise<Blob | null> {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 360;
  c.height = 560;
  const g = c.getContext('2d');
  if (!g) return null;
  g.fillStyle = '#fbfaf6';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#222';
  g.textAlign = 'center';
  g.font = 'bold 26px monospace';
  g.fillText('REWE', 180, 60);
  g.font = '15px monospace';
  g.fillText('Markt Musterstadt', 180, 88);
  g.textAlign = 'left';
  const rows: [string, string][] = [['Vollkornbrot', '2,49'], ['Bio-Milch 1 l', '1,39'], ['Äpfel 1 kg', '2,99'], ['Kaffee 500 g', '6,99'], ['Tomaten', '1,79']];
  rows.forEach(([what, eur], i) => {
    g.fillText(what, 30, 150 + i * 30);
    g.textAlign = 'right';
    g.fillText(eur, 330, 150 + i * 30);
    g.textAlign = 'left';
  });
  g.fillRect(30, 310, 300, 2);
  g.font = 'bold 18px monospace';
  g.fillText('SUMME EUR', 30, 345);
  g.textAlign = 'right';
  g.fillText('15,65', 330, 345);
  g.textAlign = 'center';
  g.font = '13px monospace';
  g.fillText('Beispielbeleg der Design-Vorschau', 180, 520);
  return new Promise((resolve) => c.toBlob((b) => resolve(b), 'image/png'));
}

/** The method of a kind among the mock bank's, or its first. */
const methodOfKind = (methods: SerializedTanMethod[], kind: MockTanKind | undefined) =>
  methods.find((m) => MOCK_TAN_KIND[m.id] === (kind ?? 'app')) ?? methods[0];

/**
 * An HHD 1.4 challenge as a bank sends one for chipTAN optisch: one control
 * byte, the start code, the data elements with their lengths.
 */
function hhd14(start: string, elements: string[]): string {
  const body = (0x80 | start.length).toString(16).toUpperCase() + '01' + start
    + elements.map((e) => String(e.length).padStart(2, '0') + e).join('');
  return String(body.length).padStart(3, '0') + body;
}

/** A matrix graphic, as photoTAN and chipTAN QR send one: a QR code here, as an SVG data URL. */
function mockMatrix(text: string): string {
  const { d, size } = qrSvgPath(qrMatrix(text));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">`
    + `<rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/**
 * What the simulated bank asks a typed TAN from, in its own words (German, as
 * banks send them): the challenge text, and the flicker code or graphic the
 * method uses — for an order, with its payee and amount, as a real challenge
 * carries them.
 */
function mockTanRequest(kind: MockTanKind, order: WaitOrder | null | undefined, round: number) {
  const iban = order ? order.iban.replace(/\s+/g, '') : '';
  const amount = order ? order.amount.toFixed(2).replace('.', ',') : '';
  const what = order ? `Überweisung an ${order.name}, IBAN …${iban.slice(-4)}, ${amount} EUR.` : 'Anmeldung im Online-Banking.';
  const start = round ? '2087314' : '1049063';
  switch (kind) {
    case 'flicker':
      return {
        challenge: `${what} Stecken Sie Ihre Karte in den TAN-Generator, halten Sie ihn an die Grafik und prüfen Sie die Anzeige.`,
        image: null,
        flicker: renderFlicker(hhd14(start, order ? [iban.slice(-10), amount] : [])),
      };
    case 'photo':
      return {
        challenge: `${what} Scannen Sie die Grafik mit „Smart-TAN photo“ und prüfen Sie die Anzeige.`,
        image: mockMatrix(`GIROVO-PREVIEW ${start} ${iban} ${amount}`),
        flicker: null,
      };
    case 'manual':
      return {
        challenge: order
          ? `${what}<br>Drücken Sie „TAN“ am TAN-Generator und geben Sie ein: Startcode ${start}, die letzten 10 Ziffern der Empfänger-IBAN (${iban.slice(-10)}) und den Betrag (${amount}).`
          : `Drücken Sie „TAN“ am TAN-Generator und geben Sie den Startcode ${start} ein.`,
        image: null,
        flicker: null,
      };
    default:
      return {
        challenge: `${what} Die TAN wurde per SMS an Ihr Mobiltelefon „Mein Handy“ gesendet.`,
        image: null,
        flicker: null,
      };
  }
}
const MOCK_ERROR = 'Die Verbindung zur Bank wurde unterbrochen (Zeitüberschreitung). Bitte versuche es erneut.';

const normIban = (iban: string | null | undefined) => String(iban ?? '').replace(/\s+/g, '').toUpperCase();

let idSeq = 0;
const newId = () => `mock-${Date.now().toString(36)}-${(++idSeq).toString(36)}`;

function without<V>(rec: Record<string, V>, k: string): Record<string, V> {
  if (!Object.prototype.hasOwnProperty.call(rec, k)) return rec;
  const next = { ...rec };
  delete next[k];
  return next;
}

/** The TAN methods the simulated bank offers for this login. */
function offeredMethods(data: MockData, methods: MockOptions['methods']): SerializedTanMethod[] {
  return methods === 'typed' ? data.tanMethods.filter((m) => !m.isDecoupled) : data.tanMethods;
}

/** The range a preset starts with. */
function startRange(data: MockData, preset: MockPreset, range: MockOptions['range']): DateRange {
  if (preset === 'past-range') {
    // Three whole months that ended last month — a range that does not reach today.
    const [y, m] = data.today.split('-').map(Number);
    const from = new Date(y, m - 4, 1);
    const to = new Date(y, m - 1, 0);
    return { from: isoDate(from), to: isoDate(to) };
  }
  if (range === 'all') return { from: data.windowFrom, to: data.today };
  if (range === '365d') return presetRange('365d');
  return presetRange('90d');
}

type Cache = Record<string, { key: string; txs: SerializedTransaction[] }>;

/**
 * The kept Umsätze a 'saved' preview starts with: every account with Umsätze,
 * from the start of the mock window up to three days ago — the last login.
 */
function keptAtStart(data: MockData): HistoryData {
  let kept = EMPTY_HISTORY;
  const to = addDaysKey(data.today, -3);
  for (const a of data.accounts) {
    if (!a.canStatements) continue;
    const s = data.statement(a.accountNumber, { from: data.windowFrom, to });
    const span = deliveredSpan({ asked: { from: data.windowFrom, to }, txs: s.txs, blocks: s.blocks, today: data.today });
    if (span) kept = mergeIntoHistory(kept, a.accountNumber, { span, txs: s.txs, blocks: s.blocks }, data.today);
  }
  return kept;
}

/**
 * One account's list as the provider makes it (listsOf): the mock bank's
 * answer for what it would be asked (planFetch), the kept Umsätze before it.
 * Without kept Umsätze, exactly the bank's answer for the span.
 */
function mockList(
  data: MockData,
  acct: string,
  span: DateRange,
  kept: HistoryData | null,
  o: { broken?: boolean; empty?: boolean } = {},
): { fetchFrom: string | null; statement: MockStatement | null; txs: SerializedTransaction[]; info: Omit<StatementInfo, 'loadedAt'> } {
  const plan = planFetch(span, kept?.accounts[acct]?.coverage, data.today);
  const fetchFrom = plan ? plan.from : null;
  const statement = fetchFrom ? data.statement(acct, { from: fetchFrom, to: span.to }, o) : null;
  const view = historyView({ span, fetchFrom, fetched: statement?.txs ?? [], history: kept?.accounts[acct] });
  return {
    fetchFrom,
    statement,
    txs: view.txs,
    info: {
      from: view.saved || !fetchFrom ? span.from : fetchFrom,
      to: span.to,
      blocks: statement?.blocks ?? [],
      ...(view.saved ? { saved: view.saved } : {}),
    },
  };
}

/** Everything a preset decides about the first frame. */
function initialState(data: MockData, preset: MockPreset, opts: MockOptions) {
  const range = startRange(data, preset, opts.range);
  const empty = preset === 'empty';
  const broken = preset === 'unverified';
  const balances: Record<string, SerializedBalance> = {};
  const txCache: Cache = {};
  const statementInfo: Record<string, StatementInfo> = {};
  const now = Date.now();
  // Kept Umsätze, and the lists on "Alles Gespeicherte", as after a login that brought them.
  const kept = opts.history === 'saved' && !empty && preset !== 'loading' ? keptAtStart(data) : null;
  const spanOf = (acct: string, r: DateRange) => (kept ? savedPeriod(kept.accounts[acct]?.coverage, data.today) ?? r : r);

  const load = (acct: string, r: DateRange) => {
    const span = spanOf(acct, r);
    const l = mockList(data, acct, span, kept, { broken: broken && acct === ACCT.giro, empty });
    txCache[acct] = { key: `${span.from}|${span.to}`, txs: l.txs };
    statementInfo[acct] = { ...l.info, loadedAt: now - 60_000 };
    if (l.statement?.balance) balances[acct] = l.statement.balance;
  };

  let txErrors: Record<string, LoadError> = {};
  let busy = false;
  let loadingAccount: string | null = null;

  if (preset === 'loading') {
    // The first statement is on the wire — nothing to show yet but skeletons.
    busy = true;
    loadingAccount = ACCT.giro;
  } else if (preset === 'error') {
    // The Girokonto's statement failed a minute ago; the card was opened
    // afterwards and loaded.
    txErrors = { [ACCT.giro]: { message: MOCK_ERROR, at: now - 60_000 } };
    if (!opts.oneAccount) load(ACCT.karte, presetRange('90d'));
  } else {
    load(ACCT.giro, range);
    // A Depot has no statement to load (its holdings are read on their own).
    if (opts.account && opts.account !== ACCT.giro && opts.account !== ACCT.karte && opts.account !== ACCT.depot) load(opts.account, range);
    // The card was looked at earlier in this session (with today's range, so
    // its balance is known); the Tagesgeld was not — "Saldo abrufen".
    if (!opts.oneAccount) load(ACCT.karte, preset === 'past-range' ? presetRange('90d') : range);
    if (preset === 'past-range') {
      // The current balance is known from that earlier load too.
      balances[ACCT.giro] = data.balance(ACCT.giro);
    }
    // The second bank, logged in beside the first: its Girokonto read once.
    if (opts.secondBank === 'linked' || opts.secondBank === 'loggedOut') load(ACCT.spk, range);
  }

  // With failPending the list was never fetched, so its failure has the panel to itself.
  const pendingCache: Record<string, SerializedTransaction[]> = opts.failPending ? {}
    : preset === 'default' || preset === 'unverified' || preset === 'past-range'
      ? { [ACCT.giro]: data.pending[ACCT.giro] }
      : empty ? { [ACCT.giro]: [] } : {};

  const sessionStartedAt = now - 7 * 60_000;
  const linked = opts.secondBank === 'linked' || opts.secondBank === 'loggedOut';
  const received = new Date(sessionStartedAt).toISOString();
  const vault = preset === 'loading' ? null : empty ? EMPTY_VAULT : {
    ...data.vault,
    ...(opts.personal ? data.personal : {}),
    ...(opts.categoryRules ? { categoryRules: opts.categoryRules } : {}),
    ...(opts.budgets ? { budgets: data.budgets } : {}),
  };
  return {
    range: kept ? spanOf(ACCT.giro, range) : range,
    balances, txCache, statementInfo, txErrors, busy, loadingAccount, pendingCache,
    messages: empty ? [] : [...data.messages(received), ...(linked ? data.second.messages(received) : [])],
    activity: empty ? [] : data.activity(now),
    // The primary login's store remembers the second bank (BLZ, name, login
    // name), and the choice to keep the Umsätze on this computer.
    vault: vault && (opts.secondBank || opts.history)
      ? {
        ...vault,
        ...(opts.secondBank ? { linkedBanks: [{ blz: data.second.bank.blz, name: data.second.bank.name, userId: data.second.userId }] } : {}),
        ...(opts.history ? { keepBookings: true as const } : {}),
      }
      : vault,
    vaultStatus: (preset === 'loading' ? 'loading' : 'ready') as VaultStatus,
    sessionStartedAt,
    history: kept,
    historyStatus: (kept ? 'ready' : opts.history === 'unreadable' ? 'error' : 'off') as HistoryStatus,
    savedRange: !!kept,
  };
}

// ---------------------------------------------------------------------------

function useMockFintsState(preset: MockPreset, opts: MockOptions) {
  const data = useMemo(() => getMockData(), []);
  // A preset is the first frame only; after that the mock behaves.
  const [init] = useState(() => initialState(data, preset, opts));
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const [view, setView] = useState<View>(opts.view ?? 'dashboard');
  // Offered, as in a release build — so the screens show the text its users see.
  const [meta] = useState(() => ({ ...data.meta, merchantLogos: opts.logos !== 'unavailable' }));
  const [popularBanks] = useState(data.popularBanks);
  const [logoFiles] = useState(data.logoFiles);

  // The bank picker comes first on a fresh login screen; the credentials view
  // sets the bank itself, as picking one would.
  const [bank, setBank] = useState<ChosenBank | null>(opts.view === 'login' && !opts.bankChosen ? null : data.bank);
  // The mock has no list to check a remembered bank against: never checking,
  // and stale only when asked to be.
  const bankChecking = false;
  const [staleBank, setStaleBank] = useState<ChosenBank | null>(opts.staleBank ? data.bank : null);
  useEffect(() => {
    if (bank) setStaleBank(null);
  }, [bank]);
  // On the TAN-method screen the bank has already answered the login: there
  // is a session, and its messages have arrived (they come with that answer).
  const connected = opts.view !== 'login';
  const [sessionId, setSessionId] = useState<string | null>(connected ? 'mock-session' : null);
  const [userId, setUserId] = useState(data.userId);

  const [tanMethods, setTanMethods] = useState<SerializedTanMethod[]>(() => offeredMethods(data, opts.methods));
  const [selectedMethod, setSelectedMethod] = useState<SerializedTanMethod | null>(
    opts.view === 'tanmethod' || opts.view === 'login' ? null : methodOfKind(data.tanMethods, opts.method),
  );
  const [mediaChoice, setMediaChoice] = useState<string[] | null>(null);
  const [tanMethodError, setTanMethodError] = useState<string | null>(null);

  const loggedIn = !opts.view || opts.view === 'dashboard';
  // What the bank lists for this login; a first-frame option, so fixed per session.
  const [bankAccounts] = useState(() => {
    let listed = opts.oneAccount ? data.accounts.slice(0, 1) : opts.depot ? [...data.accounts, MOCK_DEPOT] : data.accounts;
    if (opts.noOrders) listed = listed.map((a) => ({ ...a, dated: null, standing: null }));
    return opts.pendingWithStatements
      ? listed.map((a) => (a.accountNumber === ACCT.giro ? { ...a, canPending: false } : a))
      : listed;
  });
  const startAccount = bankAccounts.find((a) => a.accountNumber === opts.account) ?? bankAccounts[0];
  const startLinked = loggedIn && (opts.secondBank === 'linked' || opts.secondBank === 'loggedOut');
  const [accounts, setAccounts] = useState<SerializedAccount[]>(
    loggedIn ? [...bankAccounts, ...(startLinked ? data.second.accounts : [])] : [],
  );
  const accountsRef = useRef(accounts);
  accountsRef.current = accounts;
  // More banks: the logins beside the first, as the provider keeps them.
  const [links, setLinksState] = useState<LinkedLogin[]>(() => (startLinked
    ? [{
        id: 'mock-link-second',
        bank: data.second.bank,
        userId: data.second.userId,
        sessionId: opts.secondBank === 'linked' ? 'mock-session-second' : null,
        accountNumbers: data.second.accounts.map((a) => a.accountNumber),
        method: data.second.tanMethods[0],
        deviceRemembered: true,
      }]
    : []));
  const linksRef = useRef(links);
  linksRef.current = links;
  const setLinks = useCallback((list: LinkedLogin[]) => {
    linksRef.current = list;
    setLinksState(list);
  }, []);
  const [addBank, setAddBankState] = useState<AddBankState | null>(null);
  const addBankRef = useRef<AddBankState | null>(null);
  const bankRef = useRef(bank);
  bankRef.current = bank;
  /** The add flow holds `busy` while its bank is asked (as the provider's). */
  const flowBusyRef = useRef(false);
  /** The login the add flow is asking for, once its bank answered. */
  const addLoginRef = useRef<{ bank: ChosenBank; login: string } | null>(null);
  /** The name of the linked bank an account belongs to — when that bank is logged out. */
  const loggedOutBank = useCallback(
    (acct: string) => linksRef.current.find((l) => !l.sessionId && l.accountNumbers.includes(acct))?.bank.name ?? null,
    [],
  );
  const [activeAccount, setActiveAccount] = useState<SerializedAccount | null>(loggedIn ? startAccount : null);
  const [balances, setBalances] = useState<Record<string, SerializedBalance>>(loggedIn ? init.balances : {});
  const [txCache, setTxCache] = useState<Cache>(loggedIn ? init.txCache : {});
  const [pendingCache, setPendingCache] = useState<Record<string, SerializedTransaction[]>>(loggedIn ? init.pendingCache : {});
  // When each Vorgemerkt list was fetched: a preset's after its statement
  // (statementInfo says a minute ago), so none of it counts as superseded.
  const [pendingAt, setPendingAt] = useState<Record<string, number>>(() => (loggedIn
    ? Object.fromEntries(Object.keys(init.pendingCache).map((a) => [a, Date.now() - 30_000]))
    : {}));
  const pendingInfo = useMemo(() => {
    const out: Record<string, PendingInfo> = {};
    for (const [a, at] of Object.entries(pendingAt)) if (pendingCache[a]) out[a] = { loadedAt: at, behindStatement: false, booked: 0, readAt: at };
    return out;
  }, [pendingAt, pendingCache]);
  const [statementInfo, setStatementInfo] = useState<Record<string, StatementInfo>>(loggedIn ? init.statementInfo : {});
  const [txErrors, setTxErrors] = useState<Record<string, LoadError>>(loggedIn ? init.txErrors : {});
  const [balanceErrors, setBalanceErrors] = useState<Record<string, LoadError>>({});
  const [balanceLoading, setBalanceLoading] = useState<string | null>(null);
  const [loadingAllBalances, setLoadingAllBalances] = useState(false);
  // No logos in the preview: the real lookup goes out to a logo service.
  const [merchants] = useState<Record<string, Merchant | null>>({});

  const [busy, setBusyState] = useState(loggedIn && init.busy);
  const [loadingAccount, setLoadingAccount] = useState<string | null>(loggedIn ? init.loadingAccount : null);
  const [pendingLoading, setPendingLoading] = useState<string | null>(null);
  const [pendingErrors, setPendingErrors] = useState<Record<string, LoadError>>({});
  const [bankOrders, setBankOrders] = useState<Record<string, Partial<Record<BankOrderKind, BankOrdersInfo>>>>(() => {
    if (!loggedIn || !opts.ordersLoaded || opts.noOrders) return {} as Record<string, Partial<Record<BankOrderKind, BankOrdersInfo>>>;
    const read = data.bankOrders(ACCT.giro);
    const at = Date.now() - 4 * 60_000;
    const info = (orders: SerializedBankOrder[]): BankOrdersInfo => ({ orders, complete: true, unreadable: 0, loadedAt: at });
    return { [ACCT.giro]: { standing: info(read.standing), dated: info(read.dated) } };
  });
  const [bankOrdersLoading, setBankOrdersLoading] = useState<{ accountNumber: string; kind: BankOrderKind } | null>(null);
  const [bankOrderErrors, setBankOrderErrors] = useState<Record<string, Partial<Record<BankOrderKind, LoadError>>>>({});
  const [orderDeletions, setOrderDeletions] = useState<Record<string, OrderDeletion>>({});
  const [deviceRemembered, setDeviceRemembered] = useState(loggedIn);

  const [wait, setWait] = useState<WaitState>(IDLE_WAIT);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [printJob, setPrintJob] = useState<PrintJob | null>(null);

  const [privacy, setPrivacy] = useState(opts.privacy ?? false);
  const [idleMinutes, setIdleMinutesState] = useState<IdleMinutes>(DEFAULT_IDLE_MINUTES);
  const [singleKeyShortcuts, setSingleKeyShortcuts] = useState(true);
  const [logoConsent, setLogoConsentState] = useState<LogoConsent>(() => (
    opts.logos && opts.logos !== 'unavailable' ? opts.logos : loggedIn ? 'off' : 'unasked'
  ));
  // No logo service here: an answer is only recorded.
  const setLogoConsent = useCallback((on: boolean) => setLogoConsentState(on ? 'on' : 'off'), []);

  const [sessionStartedAt, setSessionStartedAt] = useState<number | null>(loggedIn ? init.sessionStartedAt : null);
  const [idleDeadline, setIdleDeadline] = useState<number | null>(null);

  const [tab, setTabState] = useState<DashboardTab>(opts.tab ?? 'overview');
  const [txFilter, setTxFilter] = useState<TxFilter>({ ...EMPTY_FILTER, ...opts.filter, ...(opts.query ? { query: opts.query } : {}) });
  const [txFocusNonce, setTxFocusNonce] = useState(0);
  const [analysisPeriod, setAnalysisPeriod] = useState<AnalysisPeriod | null>(opts.analysisPeriod ?? null);
  const [analysisScope, setAnalysisScope] = useState<AnalysisScope>(opts.analysisScope ?? 'account');
  // Launchers carry an eligible account, as openTransfer/openShare guarantee.
  const opening = loggedIn ? opts.open : undefined;
  const [transferOpen, setTransferOpen] = useState(opening === 'transfer');
  const [transferPrefill, setTransferPrefill] = useState<TransferPrefill | null>(opening === 'transfer'
    ? { ...opts.transferPrefill, accountNumber: opts.transferPrefill?.accountNumber ?? (startAccount.canTransfer ? startAccount.accountNumber : ACCT.giro) }
    : null);
  const [shareOpen, setShareOpen] = useState(opening === 'share');
  // Girovo Plus with Play's offers as a German phone would see them; buying
  // here subscribes at once, as a licence tester's purchase does.
  const [plus, setPlus] = useState<PlusStatus>(() => ({
    state: opts.plus ?? 'free',
    plan: opts.plus === 'active' ? 'monthly' : null,
    offers: opts.plus === 'inactive' || opts.plus === 'active'
      ? [{ plan: 'monthly', price: '0,99 €', trialDays: 3 }, { plan: 'yearly', price: '9,99 €', trialDays: 3 }]
      : [],
    icon: 'standard',
  }));
  const plusRef = useRef(plus);
  plusRef.current = plus;
  const [plusOpen, setPlusOpen] = useState(opening === 'plus');
  // The fake bridge (./nano.ts): a purchase or an icon chosen on the Plus screen.
  useEffect(() => window.girovoMobile?.plus?.onChange?.(setPlus), []);
  const [sharePrefill, setSharePrefill] = useState<SharePrefill | null>(opening === 'share'
    ? { accountNumber: startAccount.iban ? startAccount.accountNumber : ACCT.giro }
    : null);
  const [inboxOpen, setInboxOpenState] = useState(opening === 'inbox');
  const [paletteOpen, setPaletteOpenState] = useState(opening === 'palette');
  const [shortcutsOpen, setShortcutsOpenState] = useState(opening === 'shortcuts');

  const [range, setRange] = useState<DateRange>(init.range);
  const [messages, setMessages] = useState<InboxMessage[]>(connected ? init.messages : []);
  const [activity, setActivity] = useState<ActivityEntry[]>(() => (!loggedIn ? [] : opts.unclear
    ? [{
        // The first list was fetched a minute ago (initialState): 'recent' went out after it.
        id: 'act-unklar', at: new Date(Date.now() - (opts.unclear === 'recent' ? 20_000 : 12 * 60_000)).toISOString(),
        kind: 'transfer' as const, outcome: 'unknown' as const,
        accountNumber: opts.unclear === 'tagesgeld' ? ACCT.tagesgeld : ACCT.giro, name: MOCK_PAYEES.max.name,
        iban: MOCK_PAYEES.max.iban.replace(/\s+/g, ''), amount: 75, instant: false,
      }, ...init.activity]
    : init.activity));
  const activityRef = useRef(activity);
  activityRef.current = activity;
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [forgetDeviceOpen, setForgetDeviceOpenState] = useState(false);
  const [vault, setVault] = useState<VaultData | null>(loggedIn ? init.vault : null);
  const [vaultStatus, setVaultStatus] = useState<VaultStatus>(loggedIn ? init.vaultStatus : 'idle');
  // Kept Umsätze: nothing on disk here — the mock keeps them in memory, as
  // the provider's session copy does.
  const [history, setHistory] = useState<HistoryData | null>(loggedIn ? init.history : null);
  const [historyStatus, setHistoryStatus] = useState<HistoryStatus>(loggedIn ? init.historyStatus : 'off');
  const [savedRange, setSavedRange] = useState(loggedIn && init.savedRange);
  const historyRef = useRef(history);
  historyRef.current = history;
  const historyStatusRef = useRef(historyStatus);
  historyStatusRef.current = historyStatus;
  const savedRangeRef = useRef(savedRange);
  savedRangeRef.current = savedRange;

  // ---- refs the simulated network reads ----------------------------------
  const busyRef = useRef(busy);
  const sessionGen = useRef(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const txCacheRef = useRef(txCache);
  txCacheRef.current = txCache;
  const activeRef = useRef(activeAccount);
  activeRef.current = activeAccount;
  const rangeRef = useRef(range);
  const vaultRef = useRef(vault);
  const vaultStatusRef = useRef(vaultStatus);
  const messagesRef = useRef(messages);
  const waitRef = useRef(wait);
  waitRef.current = wait;
  const selectedMethodRef = useRef(selectedMethod);
  selectedMethodRef.current = selectedMethod;
  /**
   * The device approvals go to, as the bank would name it in each challenge.
   * A remembered device (the logged-in start) kept the one picked at its login.
   */
  const tanMediaRef = useRef<string | null>(loggedIn ? data.tanMethods[0]?.activeTanMedia[0] ?? null : null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const lastTransferRef = useRef<TransferPayload | null>(null);
  /** Armed at the start with `secondApproval`; the first statement load after the login takes it. */
  const secondApprovalRef = useRef(false);
  const toastId = useRef(0);
  const accountLabelRef = useRef((a: SerializedAccount) => a.product?.trim() || translateType(a.accountType));

  const setBusy = useCallback((b: boolean) => {
    busyRef.current = b;
    setBusyState(b);
  }, []);

  /** A timer that dies with the session (and with the component). */
  const later = useCallback((ms: number, fn: () => void) => {
    const gen = sessionGen.current;
    const t = setTimeout(() => {
      timers.current.delete(t);
      if (gen === sessionGen.current) fn();
    }, ms);
    timers.current.add(t);
  }, []);

  useEffect(() => {
    const all = timers.current;
    return () => { for (const t of all) clearTimeout(t); all.clear(); };
  }, []);

  // ---- toasts -------------------------------------------------------------
  const toast = useCallback((message: string, tone: ToastTone = 'info', ms?: number, action?: ToastAction): number => {
    const id = ++toastId.current;
    const entry: Toast = { id, message, tone, ms: ms ?? (tone === 'error' ? 10_000 : 4200), ...(action ? { action } : {}) };
    setToasts((list) => [...list.filter((t) => t.message !== message || t.tone !== tone), entry].slice(-MAX_TOASTS));
    return id;
  }, []);

  const rewordToast = useCallback((id: number, message: string) => {
    setToasts((list) => list.map((t) => (t.id === id ? { ...t, message } : t)));
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  // ---- simulated decoupled approval ---------------------------------------
  const waitCb = useRef<{
    onDone?: () => void;
    retry?: (() => void) | null;
    onDialogEnded?: (() => void) | null;
    onCancelled?: (() => void) | null;
    onAnswer?: ((status: 'refused' | 'unclear', bankAnswers: string) => void) | null;
  }>({});
  const waitGen = useRef(0);
  /** Sends a typed TAN for the approval on screen; null while none is waited for. */
  const tanSubmit = useRef<((tan: string) => void) | null>(null);
  /** As the provider: the last approval that came through, for the "second approval" line. */
  const lastConfirmed = useRef<{ kind: WaitKind; gen: number; at: number } | null>(null);

  const startWait = useCallback((kind: WaitKind, w: {
    subject?: string;
    challenge?: string | null;
    vop?: SerializedVop | null;
    order?: WaitOrder | null;
    onDone: () => void;
    retry?: (() => void) | null;
    onDialogEnded?: (() => void) | null;
    onCancelled?: (() => void) | null;
    onAnswer?: ((status: 'refused' | 'unclear', bankAnswers: string) => void) | null;
    /** Forces how this approval ends, whatever the options say. */
    outcome?: 'confirm' | 'ended' | 'refused' | 'hold';
    /** The account it is for: its bank's login asks (named once there are several). */
    account?: string;
    /** A bank not in the view yet (one being added), and its method. */
    bank?: WaitState['bank'];
    method?: SerializedTanMethod | null;
  }) => {
    const prev = lastConfirmed.current;
    lastConfirmed.current = null;
    const second = kind === 'statements' && prev?.kind === 'login' && prev.gen === waitGen.current
      && Date.now() - prev.at < SECOND_APPROVAL_MS;
    const gen = ++waitGen.current;
    waitCb.current = {
      onDone: w.onDone, retry: w.retry ?? null, onDialogEnded: w.onDialogEnded ?? null,
      onCancelled: w.onCancelled ?? null, onAnswer: w.onAnswer ?? null,
    };
    // As the provider: a linked bank's approval runs on its own method, and names the bank.
    const link = w.account ? linksRef.current.find((l) => l.accountNumbers.includes(w.account!)) ?? null : null;
    const method = w.method ?? link?.method ?? selectedMethodRef.current ?? data.tanMethods[0];
    const asking = link?.bank ?? bankRef.current;
    const subject = w.subject || WAIT_SUBJECT[kind];
    // A typed TAN: the simulated bank's challenge for the method's kind.
    const tanKind = MOCK_TAN_KIND[method?.id ?? 0] ?? 'app';
    const typed = tanKind !== 'app';
    const request = typed ? mockTanRequest(tanKind, w.order, 0) : null;
    tanSubmit.current = null;
    setWait({
      open: true,
      kind,
      title: '',
      text: typed
        ? `Gib die TAN für ${subject} ein.`
        : method?.isDecoupled
          ? `Öffne „${method.name}“ und bestätige ${subject}.`
          : `Bestätige ${subject} in deiner Banking-App.`,
      challenge: request ? request.challenge : w.challenge ?? null,
      phase: 'waiting',
      error: null,
      canRetry: !!w.retry,
      startedAt: Date.now() - (optsRef.current.tanElapsedMs ?? 0),
      settledAt: null,
      vop: w.vop ?? null,
      // The device picked at the login belongs to its app method; a typed one names its own, if any.
      tanMediaName: (link || w.method || typed ? null : tanMediaRef.current)
        ?? (method?.activeTanMedia.length === 1 ? method.activeTanMedia[0] : null),
      order: w.order ?? null,
      note: second ? 'Die Anmeldung ist freigegeben – für die Umsätze fragt deine Bank ein zweites Mal.' : null,
      bank: w.bank !== undefined ? w.bank
        : linksRef.current.length && asking ? { name: asking.name, brand: asking.brand } : null,
      method,
      entry: request
        ? {
            image: request.image,
            flicker: request.flicker,
            maxLength: method?.tanMaxLength ?? null,
            numeric: method?.tanNumeric ?? null,
            sending: false,
            again: false,
          }
        : null,
    });

    const outcome = w.outcome ?? optsRef.current.tan ?? 'confirm';

    /** How the approval ends, as `outcome` says. */
    const settle = () => {
      if (gen !== waitGen.current) return;
      tanSubmit.current = null;
      if (outcome === 'refused') {
        const handler = waitCb.current.onAnswer;
        const refusal = typed ? MOCK_TAN_REFUSAL : MOCK_REFUSAL;
        if (handler) { handler('refused', refusal); return; }
        setWait((s) => ({ ...s, phase: 'refused', settledAt: Date.now(), error: refusal, canRetry: !!waitCb.current.retry }));
        return;
      }
      if (outcome === 'ended') {
        const handler = waitCb.current.onDialogEnded;
        if (handler) { handler(); return; }
        setWait((s) => ({
          ...s,
          phase: 'ended',
          settledAt: Date.now(),
          title: msgs().provider.wait.endedTitle,
          text: msgs().provider.wait.endedText,
          canRetry: !!waitCb.current.retry,
        }));
        return;
      }
      if (outcome === 'error') {
        setWait((s) => ({ ...s, phase: 'error', settledAt: Date.now(), error: MOCK_ERROR, canRetry: !!waitCb.current.retry }));
        return;
      }
      // 'again' ends as 'confirm' does, once its second TAN is in.
      lastConfirmed.current = { kind, gen, at: Date.now() };
      setWait((s) => ({ ...s, phase: 'confirmed', settledAt: Date.now() }));
      later(CONFIRMED_LINGER_MS, () => { if (gen === waitGen.current) setWait(IDLE_WAIT); });
      waitCb.current.onDone?.();
    };

    if (typed) {
      // Nothing happens until a TAN is sent; 'again' asks for a second one first.
      let round = 0;
      const submit = () => {
        if (gen !== waitGen.current) return;
        tanSubmit.current = null;
        setWait((s) => ({ ...s, entry: s.entry && { ...s.entry, sending: true } }));
        if (outcome === 'hold') return;
        later(optsRef.current.tanMs ?? TYPED_TAN_MS, () => {
          if (gen !== waitGen.current) return;
          if (outcome === 'again' && round === 0) {
            round = 1;
            const next = mockTanRequest(tanKind, w.order, 1);
            tanSubmit.current = submit;
            setWait((s) => ({
              ...s,
              challenge: next.challenge,
              entry: s.entry && { ...s.entry, image: next.image, flicker: next.flicker, sending: false, again: true },
            }));
            return;
          }
          settle();
        });
      };
      tanSubmit.current = submit;
      return;
    }

    if (outcome === 'hold') return;
    later(optsRef.current.tanMs ?? DEFAULT_TAN_MS, settle);
  }, [data, later]);

  const submitTan = useCallback((tan: string) => {
    if (tan) tanSubmit.current?.(tan);
  }, []);

  const closeWait = useCallback(() => {
    waitGen.current++;
    tanSubmit.current = null;
    setWait(IDLE_WAIT);
  }, []);

  const retryWait = useCallback(() => {
    const retry = waitCb.current.retry;
    closeWait();
    retry?.();
  }, [closeWait]);

  const logoutRef = useRef<(reason?: LogoutReason) => Promise<void>>(async () => {});

  const cancelWait = useCallback(async () => {
    const { onCancelled } = waitCb.current;
    waitCb.current = {};
    closeWait();
    if (viewRef.current !== 'dashboard') {
      void logoutRef.current('cancelled');
      return;
    }
    setBusy(false);
    setLoadingAccount(null);
    setPendingLoading(null);
    setBankOrdersLoading(null);
    onCancelled?.();
  }, [closeWait, setBusy]);

  // ---- statements ---------------------------------------------------------
  const today = data.today;
  const ninetyAgo = addDaysKey(today, -90);

  /** The kept Umsätze a load may plan with, as the provider's keptOf. */
  const keptOf = useCallback(() => (historyStatusRef.current === 'ready' ? historyRef.current : null), []);

  /** As the provider's spanFor: the applied range, or with "Alles Gespeicherte" what is kept for the account. */
  const spanFor = useCallback((acct: string): DateRange => {
    if (!savedRangeRef.current) return rangeRef.current;
    return savedPeriod(keptOf()?.accounts[acct]?.coverage, today) ?? presetRange('90d');
  }, [keptOf, today]);

  const loadTransactions = useCallback(async (
    account: SerializedAccount,
    from?: string,
    to?: string,
    o: { force?: boolean; onNotApplied?: () => void; quiet?: boolean; onSettled?: LoadSettled } = {},
  ) => {
    const acct = account.accountNumber;
    const applied = !from && !to ? spanFor(acct) : rangeRef.current;
    const span = { from: from || applied.from, to: to || applied.to };
    const cacheKey = `${span.from}|${span.to}`;
    const notApplied = (outcome: LoadOutcome, error?: string) => { o.onNotApplied?.(); o.onSettled?.(outcome, error); };
    if (!account.canStatements) { notApplied('skipped'); return; }
    if (!o.force && txCacheRef.current[acct]?.key === cacheKey) { o.onSettled?.('applied'); return; }
    // As the provider: with kept Umsätze, the bank is asked only for what they lack.
    const kept = keptOf();
    const plan = planFetch(span, kept?.accounts[acct]?.coverage, today);
    if (busyRef.current) { notApplied('busy'); return; }
    // As the provider: a linked bank that is logged out is not asked.
    const gone = loggedOutBank(acct);
    if (gone) {
      const message = msgs().banks.loggedOutRead(gone);
      if (!o.quiet) toast(message, 'info');
      notApplied('failed', message);
      return;
    }

    setTxErrors((e) => without(e, acct));
    setBusy(true);
    setLoadingAccount(acct);
    const finish = () => { setBusy(false); setLoadingAccount(null); };
    // As the provider: kept for the account, announced once.
    const fail = () => {
      finish();
      setTxErrors((e) => ({ ...e, [acct]: { message: MOCK_ERROR, at: Date.now() } }));
      if (!o.quiet) toast(failureSentence([{ name: accountLabelRef.current(account), message: MOCK_ERROR }])!, 'error');
      notApplied('failed', MOCK_ERROR);
    };
    const apply = () => {
      const now = keptOf();
      const l = mockList(data, acct, span, now, { broken: preset === 'unverified' && acct === ACCT.giro, empty: preset === 'empty' });
      const s = l.statement;
      // As the provider: a balance up to today, never one older than the known one.
      if (s?.balance && span.to >= today) {
        const balance = s.balance;
        setBalances((b) => (acceptsBalance(b[acct], balance) ? { ...b, [acct]: balance } : b));
      }
      const at = Date.now();
      setTxCache((c) => ({ ...c, [acct]: { key: cacheKey, txs: l.txs } }));
      setStatementInfo((si) => ({ ...si, [acct]: { ...l.info, loadedAt: at } }));
      // As the provider: the answer is kept, and the session's copy takes it in.
      if (now && s && l.fetchFrom && vaultRef.current?.keepBookings) {
        const delivered = deliveredSpan({ asked: { from: l.fetchFrom, to: span.to }, txs: s.txs, blocks: s.blocks, today });
        if (delivered) setHistory(mergeIntoHistory(now, acct, { span: delivered, txs: s.txs, blocks: s.blocks }, today));
      }
      // As the provider: the bank's list rides along with a read up to today.
      if (optsRef.current.pendingWithStatements && acct === ACCT.giro && span.to >= today) {
        setPendingCache((c) => ({ ...c, [acct]: preset === 'empty' ? [] : data.pending[acct] ?? [] }));
        setPendingAt((m) => ({ ...m, [acct]: at }));
      }
      o.onSettled?.('applied');
    };

    // Most banks want a fresh approval for anything older than 90 days — and
    // the kept Umsätze answer a past range they hold without the bank at all.
    const second = secondApprovalRef.current;
    secondApprovalRef.current = false;
    if (plan && (plan.from < ninetyAgo || second)) {
      later(450, () => startWait('statements', {
        account: acct,
        subject: `den Abruf der Umsätze von ${vaultRef.current?.aliases?.[acct] || account.product || translateType(account.accountType)} ab ${fmtDate(plan.from)}`,
        outcome: second ? 'hold' : undefined,
        challenge: `Umsatzabruf ab ${fmtDate(plan.from)} für ${account.product || translateType(account.accountType)} freigeben`,
        onDone: () => { if (optsRef.current.fail) { fail(); return; } finish(); apply(); },
        retry: () => { finish(); void loadTransactionsRef.current(account, span.from, span.to, { ...o, force: true }); },
        onCancelled: () => notApplied('cancelled'),
      }));
      return;
    }
    later(plan ? LOAD_MS : 150, () => { if (plan && optsRef.current.fail) { fail(); return; } finish(); apply(); });
  }, [data, preset, today, ninetyAgo, later, setBusy, startWait, toast, keptOf, spanFor]);

  const loadTransactionsRef = useRef(loadTransactions);
  loadTransactionsRef.current = loadTransactions;

  // ---- balance enquiry ----------------------------------------------------
  // As the provider's loadBalance: the balance alone, no approval in the mock.
  const loadBalance = useCallback(async (account: SerializedAccount, o: { quiet?: boolean; onSettled?: LoadSettled } = {}) => {
    const acct = account.accountNumber;
    const settle: LoadSettled = (outcome, error) => o.onSettled?.(outcome, error);
    if (!account.canBalance) { settle('skipped'); return; }
    if (busyRef.current) {
      if (!o.quiet) toast(BUSY_MESSAGE, 'info');
      settle('busy');
      return;
    }
    setBalanceErrors((e) => without(e, acct));
    setBusy(true);
    setBalanceLoading(acct);
    later(BALANCE_MS, () => {
      setBusy(false);
      setBalanceLoading(null);
      if (optsRef.current.fail) {
        setBalanceErrors((e) => ({ ...e, [acct]: { message: MOCK_ERROR, at: Date.now() } }));
        if (!o.quiet) toast(failureSentence([{ name: accountLabelRef.current(account), message: MOCK_ERROR }])!, 'error');
        settle('failed', MOCK_ERROR);
        return;
      }
      const balance = data.balance(acct, { empty: preset === 'empty' });
      setBalances((b) => (acceptsBalance(b[acct], balance) ? { ...b, [acct]: balance } : b));
      settle('applied');
    });
  }, [data, preset, later, setBusy, toast]);

  // ---- Depot (as the provider's loadPortfolio, without an approval) ---------------
  const [portfolios, setPortfolios] = useState<Record<string, SerializedPortfolio>>({});
  const [portfolioErrors, setPortfolioErrors] = useState<Record<string, LoadError>>({});
  const [portfolioLoading, setPortfolioLoading] = useState<string | null>(null);

  const loadPortfolio = useCallback(async (account: SerializedAccount, o: { quiet?: boolean; onSettled?: LoadSettled } = {}) => {
    const acct = account.accountNumber;
    const settle: LoadSettled = (outcome, error) => o.onSettled?.(outcome, error);
    if (!account.canPortfolio) { settle('skipped'); return; }
    if (busyRef.current) {
      if (!o.quiet) toast(BUSY_MESSAGE, 'info');
      settle('busy');
      return;
    }
    setPortfolioErrors((e) => without(e, acct));
    setBusy(true);
    setPortfolioLoading(acct);
    later(BALANCE_MS * 2, () => {
      setBusy(false);
      setPortfolioLoading(null);
      if (optsRef.current.fail) {
        setPortfolioErrors((e) => ({ ...e, [acct]: { message: MOCK_ERROR, at: Date.now() } }));
        if (!o.quiet) toast(failureSentence([{ name: accountLabelRef.current(account), message: MOCK_ERROR }])!, 'error');
        settle('failed', MOCK_ERROR);
        return;
      }
      setPortfolios((p) => ({ ...p, [acct]: mockPortfolio(data.today) }));
      settle('applied');
    });
  }, [data, later, setBusy, toast]);

  // ---- documents: the bank's Kontoauszüge and receipts, held in memory ------------
  const docBlobs = useRef(new Map<string, Blob>());
  const [docs, setDocs] = useState<ListedDoc[]>([]);
  const docsRef = useRef(docs);
  docsRef.current = docs;
  const [bankStatementsLoading, setBankStatementsLoading] = useState<string | null>(null);
  const [statementFetches, setStatementFetches] = useState<Record<string, StatementFetch>>({});

  /** Keeps a document in memory, as lib/doc-store.ts keeps one on disk. */
  const putDoc = useCallback((meta: Omit<KeptDoc, 'id' | 'addedAt' | 'size'>, blob: Blob, addedAt = new Date()): ListedDoc => {
    const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
    docBlobs.current.set(id, blob);
    return { ...meta, id, size: blob.size, addedAt: addedAt.toISOString(), sid: 'mock-session' };
  }, []);

  /** The bank's statement of a month, as it would hand it out. */
  const statementDoc = useCallback((acct: string, year: number, month: number) => {
    const last = new Date(year, month, 0);
    const from = `${year}-${String(month).padStart(2, '0')}-01`;
    const to = isoDate(last);
    const label = accountLabelRef.current(accountsRef.current.find((a) => a.accountNumber === acct) ?? data.accounts[0]);
    return putDoc({
      kind: 'statement', mime: 'application/pdf', name: `Kontoauszug ${year}-${String(month).padStart(3, '0')}.pdf`,
      accountNumber: acct, number: month, year, from, to, date: to,
    }, new Blob([mockPdf(`Kontoauszug ${month}/${year}`, [
      `${data.bank.name}`, `${label} (${acct})`, `Zeitraum ${fmtDate(from)} bis ${fmtDate(to)}`,
      'Beispielauszug der Design-Vorschau - keine echten Daten.',
    ]) as BlobPart], { type: 'application/pdf' }));
  }, [data, putDoc]);

  // MockOptions `docs`: two statements kept already, and a till receipt on the latest REWE booking.
  useEffect(() => {
    if (!opts.docs) return;
    const [y, m] = data.today.split('-').map(Number);
    const kept = [statementDoc(ACCT.giro, m <= 3 ? y - 1 : y, ((m + 8) % 12) + 1), statementDoc(ACCT.giro, m <= 2 ? y - 1 : y, ((m + 9) % 12) + 1)];
    const rewe = data.statement(ACCT.giro, presetRange('90d')).txs.find((t) => /REWE/i.test(t.remoteName));
    void mockReceiptImage().then((png) => {
      const receipt = rewe && png ? [putDoc({ kind: 'receipt', mime: 'image/png', name: 'Kassenbon REWE.png', accountNumber: ACCT.giro, tx: txKey(rewe), awaiting: null }, png)] : [];
      setDocs([...kept, ...receipt]);
    });
    // Seeded once, with the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const readDoc = useCallback(async (doc: ListedDoc): Promise<Blob> => {
    const blob = docBlobs.current.get(doc.id);
    if (!blob) throw new Error('Dieses Dokument gibt es nicht mehr.');
    return blob;
  }, []);

  // The preview has no share sheet: both save (a browser download).
  const openDoc = useCallback(async (doc: ListedDoc) => {
    const blob = await readDoc(doc);
    await saveFile(doc.name, blob);
  }, [readDoc]);

  const removeDoc = useCallback(async (doc: ListedDoc) => {
    docBlobs.current.delete(doc.id);
    setDocs((d) => d.filter((x) => x.id !== doc.id));
    if (doc.kind === 'receipt') toast('Beleg entfernt.', 'success');
  }, [toast]);

  const keepReceipt = useCallback(async (file: Blob & { name?: string }, accountNumber: string, to: { tx: string } | { awaiting: AwaitedBooking }) => {
    const mime = file.type === 'application/pdf' ? 'application/pdf' : file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
    const doc = putDoc({
      kind: 'receipt', mime, name: file.name || 'Beleg', accountNumber,
      tx: 'tx' in to ? to.tx : null, awaiting: 'awaiting' in to ? to.awaiting : null,
    }, file);
    setDocs((d) => [...d, doc]);
    if ('tx' in to) toast('Beleg angehängt.', 'success');
    return true;
  }, [putDoc, toast]);

  const receiptsOf = useCallback((tx: SerializedTransaction) => {
    const key = txKey(tx);
    return docs.filter((d) => d.kind === 'receipt' && d.tx === key);
  }, [docs]);
  const receiptKeys = useMemo(() => new Set(docs.filter((d) => d.kind === 'receipt' && d.tx).map((d) => d.tx!)), [docs]);

  /** As the provider: behind `busy`, with an approval; the bank has the last three months' statements waiting. */
  const fetchBankStatements = useCallback(async (account: SerializedAccount) => {
    const acct = account.accountNumber;
    if (!account.canBankStatements) return;
    if (busyRef.current) { toast(BUSY_MESSAGE, 'info'); return; }
    setBusy(true);
    setBankStatementsLoading(acct);
    const finish = () => { setBusy(false); setBankStatementsLoading(null); };
    startWait('bankStatements', {
      subject: `den Abruf der Kontoauszüge von ${accountLabelRef.current(account)}`,
      account: acct,
      onDone: () => {
        finish();
        const [y, m] = data.today.split('-').map(Number);
        const want = [1, 2, 3].map((back) => {
          const at = new Date(y, m - 1 - back, 1);
          return { year: at.getFullYear(), month: at.getMonth() + 1 };
        });
        const known = docsRef.current.filter((d) => d.kind === 'statement' && d.accountNumber === acct);
        const fresh = want.filter((w) => !known.some((d) => d.year === w.year && d.number === w.month))
          .map((w) => statementDoc(acct, w.year, w.month));
        setDocs((d) => [...d, ...fresh]);
        setStatementFetches((f) => ({ ...f, [acct]: { at: Date.now(), answer: { received: 3, added: fresh.length, more: false, held: false }, error: null } }));
      },
      retry: () => { finish(); void fetchBankStatements(account); },
      onCancelled: finish,
      onAnswer: (_status, answers) => {
        finish();
        setStatementFetches((f) => ({ ...f, [acct]: { at: Date.now(), answer: null, error: answers } }));
      },
    });
  }, [data, setBusy, startWait, statementDoc, toast]);

  // As the provider's loadAllBalances: one after the other, one toast for what failed.
  const loadAllBalances = useCallback(() => {
    if (busyRef.current) {
      toast(BUSY_MESSAGE, 'info');
      return;
    }
    const gen = sessionGen.current;
    const queue = balanceQueue(accounts.filter((a) => !loggedOutBank(a.accountNumber)), balances, rangeRef.current.to >= today);
    if (!queue.length) {
      if (accounts.some((a) => a.canStatements && !balances[a.accountNumber])) {
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
      if (gen !== sessionGen.current) return;
      const step = queue.shift();
      if (!step) { done(); return; }
      const { account } = step;
      const onSettled: LoadSettled = (outcome, error) => {
        if (outcome === 'failed') failed.push({ name: accountLabelRef.current(account), message: error ?? '' });
        if (outcome === 'cancelled' || outcome === 'busy') done();
        else next();
      };
      if (step.via === 'balance') void loadBalance(account, { quiet: true, onSettled });
      else void loadTransactionsRef.current(account, undefined, undefined, { quiet: true, onSettled });
    };
    next();
  }, [accounts, balances, today, toast, loadBalance]);

  // The mock's range never rolls over at midnight; the cache key is the whole answer.
  const isLoadedForAppliedRange = useCallback((accountNumber: string) => {
    const span = spanFor(accountNumber);
    return txCacheRef.current[accountNumber]?.key === `${span.from}|${span.to}`;
  }, [spanFor]);

  const selectAccount = useCallback((a: SerializedAccount) => {
    if (busyRef.current) return;
    setActiveAccount(a);
    activeRef.current = a;
    if (savedRangeRef.current) {
      // As the provider: "Alles Gespeicherte" names the account on screen's own span.
      const span = spanFor(a.accountNumber);
      rangeRef.current = span;
      setRange(span);
    }
    void loadTransactions(a);
    // As the provider: a Depot's holdings, else the balance alone.
    if (!a.canStatements && a.canPortfolio) {
      if (!portfolios[a.accountNumber]) void loadPortfolio(a);
    } else if (!a.canStatements && a.canBalance && !balances[a.accountNumber]) void loadBalance(a);
  }, [spanFor, loadTransactions, loadBalance, balances, loadPortfolio, portfolios]);

  const selectAccountRef = useRef(selectAccount);
  selectAccountRef.current = selectAccount;

  const refreshAccount = useCallback((account: SerializedAccount, from?: string, to?: string) => {
    void loadTransactions(account, from, to, { force: true });
  }, [loadTransactions]);

  /** As the provider's applyAndLoad: a range, or 'saved' for "Alles Gespeicherte"; undone if it does not land. */
  const applyAndLoad = useCallback((account: SerializedAccount, next: DateRange | 'saved') => {
    const prev = rangeRef.current;
    const prevSaved = savedRangeRef.current;
    savedRangeRef.current = next === 'saved';
    setSavedRange(next === 'saved');
    const span = next === 'saved' ? spanFor(account.accountNumber) : next;
    rangeRef.current = span;
    setRange(span);
    void loadTransactions(account, next === 'saved' ? undefined : span.from, next === 'saved' ? undefined : span.to, {
      onNotApplied: () => {
        if (rangeRef.current !== span) return;
        rangeRef.current = prev;
        setRange(prev);
        savedRangeRef.current = prevSaved;
        setSavedRange(prevSaved);
      },
      // As the provider: an approval not given closes without a word, so this says what stays.
      onSettled: (outcome) => {
        if (outcome !== 'cancelled' || rangeRef.current !== prev) return;
        const shown = fmtRange(prev.from, prev.to);
        toast(
          span.from < prev.from
            ? `Ältere Umsätze wurden nicht abgerufen – es bleibt beim Zeitraum ${shown}.`
            : `Der neue Zeitraum wurde nicht abgerufen – es bleibt bei ${shown}.`,
          'info',
          8000,
        );
      },
    });
  }, [spanFor, loadTransactions, toast]);

  const applyRange = useCallback((r: DateRange) => {
    const valid = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
    if (!r || !valid(r.from) || !valid(r.to)) {
      toast('Bitte einen gültigen Zeitraum wählen.', 'error');
      return;
    }
    if (busyRef.current) {
      toast(BUSY_MESSAGE, 'info');
      return;
    }
    let { from, to } = r;
    if (from > to) [from, to] = [to, from];
    if (to > today) to = today;
    if (from > today) from = today;
    const next = { from, to };
    const account = activeRef.current;
    if (account) {
      applyAndLoad(account, next);
    } else {
      savedRangeRef.current = false;
      setSavedRange(false);
      rangeRef.current = next;
      setRange(next);
    }
  }, [toast, today, applyAndLoad]);

  const applySavedRange = useCallback(() => {
    if (busyRef.current) {
      toast(BUSY_MESSAGE, 'info');
      return;
    }
    const account = activeRef.current;
    if (account) applyAndLoad(account, 'saved');
  }, [toast, applyAndLoad]);

  // As the provider: a past applied range is carried forward to today.
  const refreshAfterTransfer = useCallback((account: SerializedAccount) => {
    if (busyRef.current) {
      toast(BUSY_MESSAGE, 'info');
      return;
    }
    let r = rangeRef.current;
    if (r.to < today) {
      r = { from: r.from > ninetyAgo ? r.from : ninetyAgo, to: today };
      rangeRef.current = r;
      setRange(r);
    }
    setActiveAccount(account);
    activeRef.current = account;
    void loadTransactions(account, r.from, r.to, { force: true });
  }, [toast, today, ninetyAgo, loadTransactions]);

  const loadPending = useCallback(async (account: SerializedAccount) => {
    if (busyRef.current) {
      toast(BUSY_MESSAGE, 'info');
      return;
    }
    setPendingErrors((e) => without(e, account.accountNumber));
    setBusy(true);
    setPendingLoading(account.accountNumber);
    const finish = () => { setBusy(false); setPendingLoading(null); };
    const label = vaultRef.current?.aliases?.[account.accountNumber] || account.product || translateType(account.accountType);
    later(450, () => startWait('pending', {
      account: account.accountNumber,
      subject: `den Abruf der vorgemerkten Umsätze von ${label}`,
      onDone: () => {
        finish();
        // As the provider: the panel keeps the reason, the toast announces it.
        if (optsRef.current.failPending) {
          setPendingErrors((e) => ({ ...e, [account.accountNumber]: { message: MOCK_ERROR, at: Date.now() } }));
          toast(`Abruf der vorgemerkten Umsätze für „${label}“ fehlgeschlagen: ${MOCK_ERROR}`, 'error');
          return;
        }
        setPendingCache((c) => ({
          ...c, [account.accountNumber]: preset === 'empty' ? [] : data.pending[account.accountNumber] ?? [],
        }));
        setPendingAt((m) => ({ ...m, [account.accountNumber]: Date.now() }));
      },
      retry: () => { finish(); void loadPendingRef.current(account); },
    }));
  }, [data, preset, toast, later, setBusy, startWait]);

  const loadPendingRef = useRef(loadPending);
  loadPendingRef.current = loadPending;

  // ---- the bank's Daueraufträge and Terminüberweisungen -------------------
  // As the provider: one kind after the other. The Daueraufträge ask for an
  // approval (as at many banks); the Terminüberweisungen follow without one.
  const loadBankOrderKind = useCallback((account: SerializedAccount, kind: BankOrderKind, onSettled?: LoadSettled) => {
    if (!account[kind]?.list) { onSettled?.('skipped'); return; }
    if (busyRef.current) {
      toast(BUSY_MESSAGE, 'info');
      onSettled?.('busy');
      return;
    }
    const acct = account.accountNumber;
    setBusy(true);
    setBankOrdersLoading({ accountNumber: acct, kind });
    const finish = () => { setBusy(false); setBankOrdersLoading(null); };
    const apply = () => {
      finish();
      const orders = data.bankOrders(acct)[kind];
      setBankOrders((c) => ({ ...c, [acct]: { ...c[acct], [kind]: { orders, complete: true, unreadable: 0, loadedAt: Date.now() } } }));
      onSettled?.('applied');
    };
    if (kind === 'standing') {
      const label = vaultRef.current?.aliases?.[acct] || account.product || translateType(account.accountType);
      later(450, () => startWait('bankOrders', {
        subject: `den Abruf der Daueraufträge von ${label}`,
        onDone: apply,
        retry: () => { finish(); loadBankOrderKindRef.current(account, kind, onSettled); },
        onCancelled: () => { finish(); onSettled?.('cancelled'); },
      }));
    } else {
      later(LOAD_MS, apply);
    }
  }, [data, toast, later, setBusy, startWait]);

  const loadBankOrderKindRef = useRef(loadBankOrderKind);
  loadBankOrderKindRef.current = loadBankOrderKind;

  const loadBankOrders = useCallback((account: SerializedAccount, kinds?: readonly BankOrderKind[], onSettled?: LoadSettled) => {
    const list = (kinds ?? (['standing', 'dated'] as const)).filter((k) => account[k]?.list);
    const step = (i: number) => {
      if (i >= list.length) { onSettled?.('skipped'); return; }
      loadBankOrderKind(account, list[i], (outcome, error) => {
        if ((outcome === 'applied' || outcome === 'failed') && i + 1 < list.length) step(i + 1);
        else onSettled?.(outcome, error);
      });
    };
    step(0);
  }, [loadBankOrderKind]);

  // A deletion asks for its approval and goes through — refused in the app
  // with `tan: 'refused'`, unclear with `tan: 'ended'`.
  const deleteBankOrder = useCallback(async (account: SerializedAccount, order: SerializedBankOrder) => {
    void account;
    if (busyRef.current) {
      toast(BUSY_MESSAGE, 'info');
      return;
    }
    setBusy(true);
    const settle = (status: OrderDeletion['status'], answers?: string) => {
      setBusy(false);
      setOrderDeletions((d) => ({ ...d, [order.ref]: { status, ...(answers ? { answers } : {}), at: Date.now() } }));
      if (status === 'deleted') toast(`${order.kind === 'standing' ? 'Dauerauftrag' : 'Terminüberweisung'} an ${order.name} gelöscht.`, 'success');
    };
    later(500, () => startWait('orderDelete', {
      challenge: `Löschen ${order.kind === 'standing' ? 'des Dauerauftrags' : 'der Terminüberweisung'} über `
        + `${order.amount.toFixed(2).replace('.', ',')} EUR an ${order.name} freigeben`,
      order: { amount: order.amount, name: order.name, iban: order.iban, instant: false, schedule: order.schedule },
      onDone: () => settle('deleted', order.kind === 'standing' ? '0020: SEPA-Dauerauftrag gelöscht.' : '0020: Auftrag gelöscht.'),
      retry: null,
      onDialogEnded: () => { closeWait(); settle('unclear'); },
      onAnswer: (status, answers) => { closeWait(); settle(status === 'refused' ? 'refused' : 'unclear', answers); },
      onCancelled: () => settle('unclear'),
    }));
  }, [toast, later, setBusy, startWait, closeWait]);

  // ---- session clock ------------------------------------------------------
  const idleMsRef = useRef(DEFAULT_IDLE_MINUTES * 60_000);
  const deadlineRef = useRef<number | null>(null);
  const shownRef = useRef<{ value: number | null; at: number }>({ value: null, at: 0 });
  /**
   * The harness's first deadline (idleInMs), until a logout ends that session.
   * Absolute, so React's doubled effects in development cannot lose it.
   */
  const initialDeadline = useRef<number | null>(opts.idleInMs != null ? Date.now() + opts.idleInMs : null);

  const publishDeadline = useCallback((force = false) => {
    const deadline = deadlineRef.current;
    const shown = shownRef.current;
    if (deadline === shown.value) return;
    const now = Date.now();
    const urgent = shown.value == null || deadline == null || shown.value - now <= WARNING_WINDOW_MS + DEADLINE_PUBLISH_MS;
    if (!force && !urgent && now - shown.at < DEADLINE_PUBLISH_MS) return;
    shownRef.current = { value: deadline, at: now };
    setIdleDeadline(deadline);
  }, []);

  const inFlight = useCallback(() => {
    const w = waitRef.current;
    return w.open ? waitHoldsSession(w) : busyRef.current;
  }, []);

  const markActivity = useCallback((force = false) => {
    if (viewRef.current !== 'dashboard') return;
    const now = Date.now();
    if (deadlineRef.current != null && now >= deadlineRef.current && !inFlight()) {
      void logoutRef.current('idle');
      return;
    }
    deadlineRef.current = now + idleMsRef.current;
    publishDeadline(force);
  }, [inFlight, publishDeadline]);

  useEffect(() => {
    if (view !== 'dashboard') return;
    // The first dashboard of a harness may start close to the deadline.
    deadlineRef.current = initialDeadline.current ?? Date.now() + idleMsRef.current;
    shownRef.current = { value: null, at: 0 };
    publishDeadline(true);

    const onActivity = (e: Event) => { if (countsAsActivity(e)) markActivity(); };
    const o: AddEventListenerOptions = { capture: true, passive: true };
    for (const ev of ACTIVITY_EVENTS) window.addEventListener(ev, onActivity, o);
    const timer = setInterval(() => {
      const t = Date.now();
      if (deadlineRef.current != null && t >= deadlineRef.current && !inFlight()) {
        void logoutRef.current('idle');
        return;
      }
      if (inFlight()) deadlineRef.current = Math.max(deadlineRef.current ?? 0, t + idleMsRef.current);
      publishDeadline();
    }, 1000);
    return () => {
      for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, onActivity, o);
      clearInterval(timer);
    };
  }, [view, markActivity, inFlight, publishDeadline]);

  const stayLoggedIn = useCallback(() => markActivity(true), [markActivity]);

  const setIdleMinutes = useCallback((n: IdleMinutes) => {
    idleMsRef.current = n * 60_000;
    setIdleMinutesState(n);
    markActivity(true);
  }, [markActivity]);

  const togglePrivacy = useCallback(() => setPrivacy((p) => !p), []);

  // ---- navigation & launchers ---------------------------------------------
  const setTab = useCallback((t: DashboardTab) => setTabState(t), []);
  /**
   * The Einstellungen page, at one setting when the search asked for one
   * (components/settings/Settings.tsx scrolls there, focuses it, and clears it).
   */
  const [settingsTarget, setSettingsTarget] = useState<SettingsTarget | null>(null);
  // As the provider: on a phone Einstellungen leads back to the page it was opened from.
  const settingsFrom = useRef<DashboardTab>('overview');
  const openSettings = useCallback((target?: SettingsTarget) => {
    setTabState((current) => {
      if (current !== 'settings') settingsFrom.current = current;
      return 'settings';
    });
    setSettingsTarget(target ?? null);
  }, []);
  const leaveSettings = useCallback(() => setTabState(settingsFrom.current), []);
  const clearSettingsTarget = useCallback(() => setSettingsTarget(null), []);
  const setInboxOpen = useCallback((b: boolean) => setInboxOpenState(b), []);
  const setPaletteOpen = useCallback((b: boolean) => setPaletteOpenState(b), []);
  const setShortcutsOpen = useCallback((b: boolean) => setShortcutsOpenState(b), []);

  const showTransactions = useCallback((f?: Partial<TxFilter>) => {
    setTabState('overview');
    if (f) setTxFilter({ ...EMPTY_FILTER, ...f });
    setPaletteOpenState(false);
    setInboxOpenState(false);
    setTxFocusNonce((n) => n + 1);
  }, []);

  const clearTransients = useCallback(() => {
    setPaletteOpenState(false);
    setShortcutsOpenState(false);
    setInboxOpenState(false);
  }, []);

  const openTransfer = useCallback((p?: TransferPrefill) => {
    if (transferOpen) return;
    const eligible = accounts.filter((a) => a.canTransfer && !loggedOutBank(a.accountNumber));
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

  // Aufteilen's row of requests, as FintsProvider keeps it: "Weiter" closes
  // this one and the effect opens the next; closing ends the row.
  const [shareQueue, setShareQueue] = useState<SharePrefill[]>([]);
  const closeShare = useCallback(() => {
    setShareOpen(false);
    setSharePrefill(null);
    setShareQueue([]);
  }, []);
  const nextShare = useCallback(() => {
    setShareOpen(false);
    setSharePrefill(null);
  }, []);
  const openShareQueue = useCallback((list: SharePrefill[]) => {
    if (!list.length) return;
    setShareQueue(list.slice(1));
    openShare(list[0]);
  }, [openShare]);
  useEffect(() => {
    if (shareOpen || !shareQueue.length) return;
    const [next, ...rest] = shareQueue;
    setShareQueue(rest);
    openShare(next);
  }, [shareOpen, shareQueue, openShare]);

  // Aufteilen on the desktop (components/transactions/SplitRequests.tsx): every
  // person's GiroCode in one dialog, side by side, where the phone asks one
  // after the other.
  const [shareAll, setShareAll] = useState<ShareAllRequest | null>(null);
  const openShareAll = useCallback((request: ShareAllRequest) => {
    if (!request.people.length || transferOpen || shareOpen) return;
    clearTransients();
    setShareAll(request);
  }, [transferOpen, shareOpen, clearTransients]);
  const closeShareAll = useCallback(() => setShareAll(null), []);

  const markAllRead = useCallback(() => {
    if (!messagesRef.current.some((m) => !m.read)) return;
    const next = messagesRef.current.map((m) => (m.read ? m : { ...m, read: true }));
    messagesRef.current = next;
    setMessages(next);
  }, []);

  // ---- vault --------------------------------------------------------------
  const updateVault = useCallback((fn: (v: VaultData) => VaultData) => {
    if (vaultStatusRef.current === 'idle' || vaultStatusRef.current === 'loading') return;
    const base = vaultRef.current ?? EMPTY_VAULT;
    const changed = fn(base);
    if (changed === base) return;
    const next = { ...changed, updatedAt: new Date().toISOString() };
    vaultRef.current = next;
    setVault(next);
  }, []);

  const resetVault = useCallback(async () => {
    vaultStatusRef.current = 'ready';
    setVaultStatus('ready');
    toast('Persönliche Daten zurückgesetzt. Änderungen werden wieder gespeichert.', 'success');
  }, [toast]);

  // ---- kept Umsätze -------------------------------------------------------
  /** As the provider's dropHistory: lists that leaned on the kept days shrink to the bank's answers. */
  const dropHistory = useCallback(() => {
    historyRef.current = null;
    setHistory(null);
    historyStatusRef.current = 'off';
    setHistoryStatus('off');
    const wasSaved = savedRangeRef.current;
    savedRangeRef.current = false;
    setSavedRange(false);
    const nextInfo: Record<string, StatementInfo> = {};
    const nextCache: Cache = {};
    for (const [acct, info] of Object.entries(statementInfo)) {
      if (!info.saved) {
        nextInfo[acct] = info;
        if (txCache[acct]) nextCache[acct] = txCache[acct];
        continue;
      }
      if (!info.saved.fetched) continue;
      const from = addDaysKey(info.saved.to, 1);
      nextInfo[acct] = { from, to: info.to, blocks: info.blocks, loadedAt: info.loadedAt };
      nextCache[acct] = { key: `${from}|${info.to}`, txs: [...info.saved.fetched] };
    }
    setStatementInfo(nextInfo);
    setTxCache(nextCache);
    const active = activeRef.current ? nextInfo[activeRef.current.accountNumber] : undefined;
    if (wasSaved || active) {
      const r = active ? { from: active.from, to: today } : presetRange('90d');
      rangeRef.current = r;
      setRange(r);
    }
  }, [statementInfo, txCache, today]);

  /** As the provider's setKeepBookings — on: what this session loaded is kept at once, as the server folds it in. */
  const setKeepBookings = useCallback(async (on: boolean): Promise<boolean> => {
    if (vaultStatusRef.current !== 'ready') return false;
    await new Promise<void>((resolve) => setTimeout(resolve, 300));
    if (on) {
      updateVault((v) => (v.keepBookings ? v : { ...v, keepBookings: true }));
      let kept = EMPTY_HISTORY;
      for (const [acct, info] of Object.entries(statementInfo)) {
        const fetched = info.saved ? info.saved.fetched : txCache[acct]?.txs;
        if (!fetched) continue;
        const from = info.saved ? addDaysKey(info.saved.to, 1) : info.from;
        const span = deliveredSpan({ asked: { from, to: info.to }, txs: fetched, blocks: info.blocks, today });
        if (span) kept = mergeIntoHistory(kept, acct, { span, txs: fetched, blocks: info.blocks }, today);
      }
      historyRef.current = kept;
      setHistory(kept);
      historyStatusRef.current = 'ready';
      setHistoryStatus('ready');
      toast(msgs().history.turnedOn, 'success');
      return true;
    }
    dropHistory();
    updateVault((v) => {
      if (!v.keepBookings) return v;
      const { keepBookings: _off, ...rest } = v;
      return rest;
    });
    toast(msgs().history.deleted, 'success', 8000);
    return true;
  }, [statementInfo, txCache, today, updateVault, dropHistory, toast]);

  /** As the provider's resetHistory: the unreadable file set aside, a new one begun. */
  const resetHistory = useCallback(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 300));
    historyRef.current = EMPTY_HISTORY;
    setHistory(EMPTY_HISTORY);
    historyStatusRef.current = 'ready';
    setHistoryStatus('ready');
    toast(msgs().history.restarted, 'success');
  }, [toast]);

  // ---- login --------------------------------------------------------------
  const afterAccountsReady = useCallback(() => {
    const now = Date.now();
    setAccounts(bankAccounts);
    setSessionStartedAt(now);
    const r = presetRange('90d');
    rangeRef.current = r;
    setRange(r);
    vaultRef.current = data.vault;
    vaultStatusRef.current = 'ready';
    setVault(data.vault);
    setVaultStatus('ready');
    setView('dashboard');
    // As the provider: the bell and the Mitteilungen tile announce the bank's messages, no toast.
    const first = bankAccounts[0];
    setActiveAccount(first);
    activeRef.current = first;
    void loadTransactionsRef.current(first, r.from, r.to);
  }, [data, bankAccounts]);

  /** Ends the simulated login wait, like "Abbrechen" ends the real request. */
  const connectCancelRef = useRef<(() => void) | null>(null);

  const connect = useCallback(async (chosen: ChosenBank, login: string, pin: string) => {
    // "langsam": a bank that does not answer — until the login is called off.
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, /langsam/i.test(login) ? 600_000 : 900);
      connectCancelRef.current = () => {
        clearTimeout(t);
        reject(new DOMException('Die Anmeldung wurde abgebrochen.', 'AbortError'));
      };
    }).finally(() => { connectCancelRef.current = null; });
    // The bank's answers in the server's real format ("code: text | …").
    if (/gesperrt/i.test(login)) throw new Error('9942: Der Zugang ist gesperrt. | 9800: Dialog abgebrochen');
    if (/wartung/i.test(login)) throw new Error(BANK_UNAVAILABLE);
    if (/fehler/i.test(login) || !pin) throw new Error('9931: Anmeldename oder PIN ist falsch. | 9800: Dialog abgebrochen');
    sessionGen.current++;
    setSessionId(`mock-${Date.now()}`);
    setBank({ ...chosen, bic: chosen.bic ?? data.bank.bic ?? null });
    setUserId(login);
    const inbox = data.messages(new Date().toISOString());
    messagesRef.current = inbox;
    setMessages(inbox);
    setTanMethods(offeredMethods(data, optsRef.current.methods));
    setSelectedMethod(null);
    setMediaChoice(null);
    setTanMethodError(null);
    setView('tanmethod');
  }, [data]);

  const cancelConnect = useCallback(() => connectCancelRef.current?.(), []);

  const chooseTanMethod = useCallback(async (method: SerializedTanMethod, tanMediaName?: string) => {
    setSelectedMethod(method);
    selectedMethodRef.current = method;
    setTanMethodError(null);
    setMediaChoice(null);
    await new Promise<void>((resolve) => setTimeout(resolve, 400));
    const media = tanMediaName || (method.activeTanMedia.length === 1 ? method.activeTanMedia[0] : undefined);
    if (!media && method.activeTanMedia.length > 1) {
      setMediaChoice(method.activeTanMedia);
      return;
    }
    tanMediaRef.current = media ?? null;
    secondApprovalRef.current = !!optsRef.current.secondApproval;
    startWait('login', {
      challenge: 'Anmeldung im Online-Banking über FinTS freigeben',
      onDone: () => {
        setDeviceRemembered(true);
        // As in the provider: the action opens the confirmation, never the deletion.
        toast('Gerät gemerkt – künftige Anmeldungen brauchen seltener eine Freigabe.', 'info', 10_000, {
          label: 'Gerät vergessen …',
          run: () => setForgetDeviceOpenState(true),
        });
        afterAccountsReady();
      },
      retry: () => void chooseTanMethodRef.current(method, media),
    });
  }, [startWait, toast, afterAccountsReady]);

  const chooseTanMethodRef = useRef(chooseTanMethod);
  chooseTanMethodRef.current = chooseTanMethod;
  const setForgetDeviceOpen = useCallback((b: boolean) => setForgetDeviceOpenState(b), []);

  const clearMediaChoice = useCallback(() => setMediaChoice(null), []);

  // ---- more banks ---------------------------------------------------------
  // As the provider's: the login's steps in a sheet, for a session beside the
  // first one; see the header for what the simulated banks answer.
  const setAddBank = useCallback((next: AddBankState | null) => {
    addBankRef.current = next;
    setAddBankState(next);
  }, []);
  const updateAddBank = useCallback((fn: (a: AddBankState) => AddBankState) => {
    const cur = addBankRef.current;
    if (cur) setAddBank(fn(cur));
  }, [setAddBank]);
  const holdFlowBusy = useCallback(() => {
    flowBusyRef.current = true;
    setBusy(true);
  }, [setBusy]);
  const releaseFlowBusy = useCallback(() => {
    if (!flowBusyRef.current) return;
    flowBusyRef.current = false;
    setBusy(false);
  }, [setBusy]);

  const openAddBank = useCallback((from?: { bank: ChosenBank; userId?: string }) => {
    if (addBankRef.current) return;
    if (!bankAllowed(plusRef.current.state, false)) {
      setPlusOpen(true);
      return;
    }
    clearTransients();
    setAddBank({
      step: from ? 'credentials' : 'bank',
      bank: from?.bank ?? null,
      prefill: from?.userId ? { blz: from.bank.blz, userId: from.userId } : null,
      tanMethods: [], selectedMethod: null, mediaChoice: null, error: null, openedPin: null,
    });
  }, [clearTransients, setAddBank]);

  const closeAddBank = useCallback(() => {
    if (!addBankRef.current) return;
    connectCancelRef.current?.();
    addLoginRef.current = null;
    releaseFlowBusy();
    setAddBank(null);
  }, [releaseFlowBusy, setAddBank]);

  const pickAddBank = useCallback((b: ChosenBank | null) => {
    updateAddBank((a) => ({ ...a, bank: b, step: b ? 'credentials' : 'bank', error: null }));
  }, [updateAddBank]);

  const addBankBack = useCallback(() => {
    addLoginRef.current = null;
    releaseFlowBusy();
    updateAddBank((a) => ({ ...a, step: 'credentials', tanMethods: [], selectedMethod: null, mediaChoice: null, error: null }));
  }, [releaseFlowBusy, updateAddBank]);

  const clearAddBankMedia = useCallback(() => updateAddBank((a) => ({ ...a, mediaChoice: null })), [updateAddBank]);

  /** As the provider's finishAddBank: joins the view, or says why not. */
  const finishAddBank = useCallback((): string | null => {
    const login = addLoginRef.current;
    if (!login) return null;
    releaseFlowBusy();
    const said = msgs().banks;
    const incoming = login.bank.blz === data.bank.blz
      ? bankAccounts
      : /doppelt/i.test(login.login)
        ? [{ ...data.second.accounts[0], accountNumber: ACCT.giro }]
        : data.second.accounts;
    const asked = { blz: login.bank.blz, userId: login.login };
    const again = linksRef.current.find((l) => !l.sessionId && sameLogin({ blz: l.bank.blz, userId: l.userId }, asked)) ?? null;
    const shown = again
      ? accountsRef.current.filter((a) => !again.accountNumbers.includes(a.accountNumber))
      : accountsRef.current;
    const joined = joinAccounts(shown, incoming);
    let refusal: string | null = null;
    if (joined.collisions.length) {
      refusal = said.refused.collision(
        namesList(joined.collisions.map(({ incoming: a }) => msgs().insights.balances.quoted(a.product?.trim() || translateType(a.accountType)))),
        joined.collisions.length,
        login.bank.name,
      );
    } else if (!joined.added.length) {
      refusal = said.refused.nothingNew(login.bank.name);
    }
    if (refusal) {
      addLoginRef.current = null;
      const message = refusal;
      updateAddBank((a) => ({
        ...a, step: 'credentials', prefill: asked, tanMethods: [], selectedMethod: null, mediaChoice: null, error: message,
      }));
      return refusal;
    }
    const link: LinkedLogin = {
      id: again?.id ?? newId(),
      bank: login.bank,
      userId: login.login,
      sessionId: newId(),
      accountNumbers: joined.added.map((a) => a.accountNumber),
      method: data.second.tanMethods[0],
      deviceRemembered: true,
    };
    setLinks(again ? linksRef.current.map((l) => (l.id === again.id ? link : l)) : [...linksRef.current, link]);
    if (!again) setAccounts((list) => [...list, ...joined.added]);
    const fresh = data.second.messages(new Date().toISOString())
      .map((m) => ({ ...m, bank: login.bank.name }))
      .filter((m) => !messagesRef.current.some((x) => x.id === m.id));
    if (fresh.length) {
      messagesRef.current = [...messagesRef.current, ...fresh];
      setMessages(messagesRef.current);
    }
    updateVault((v) => ({ ...v, linkedBanks: rememberLinkedBank(v.linkedBanks ?? [], { ...asked, name: login.bank.name }) }));
    addLoginRef.current = null;
    setAddBank(null);
    toast(said.added(login.bank.name, joined.added.length), 'success');
    selectAccountRef.current(joined.added[0]);
    return null;
  }, [data, bankAccounts, releaseFlowBusy, updateAddBank, setLinks, updateVault, setAddBank, toast]);

  const connectAddBank = useCallback(async (chosen: ChosenBank, login: string, pin: string) => {
    const said = msgs().banks;
    const asked = { blz: chosen.blz, userId: login };
    const primary = bankRef.current;
    if ((primary && sameLogin({ blz: primary.blz, userId }, asked))
      || linksRef.current.some((l) => l.sessionId && sameLogin({ blz: l.bank.blz, userId: l.userId }, asked))) {
      throw new Error(said.refused.sameLogin(chosen.name));
    }
    if (busyRef.current) throw new Error(BUSY_MESSAGE);
    updateAddBank((a) => (a.error === null ? a : { ...a, error: null }));
    holdFlowBusy();
    try {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, /langsam/i.test(login) ? 600_000 : 900);
        connectCancelRef.current = () => {
          clearTimeout(t);
          reject(new DOMException('Die Anmeldung wurde abgebrochen.', 'AbortError'));
        };
      }).finally(() => { connectCancelRef.current = null; });
      if (/gesperrt/i.test(login)) throw new Error('9942: Der Zugang ist gesperrt. | 9800: Dialog abgebrochen');
      if (/wartung/i.test(login)) throw new Error(BANK_UNAVAILABLE);
      if (/fehler/i.test(login) || !pin) throw new Error('9931: Anmeldename oder PIN ist falsch. | 9800: Dialog abgebrochen');
    } finally {
      releaseFlowBusy();
    }
    if (!addBankRef.current) return;
    addLoginRef.current = { bank: chosen, login };
    updateAddBank((a) => ({
      ...a, bank: chosen, step: 'method', selectedMethod: null, mediaChoice: null, error: null,
      tanMethods: chosen.blz === data.bank.blz ? offeredMethods(data, optsRef.current.methods) : data.second.tanMethods,
    }));
  }, [data, userId, holdFlowBusy, releaseFlowBusy, updateAddBank]);

  const chooseAddBankMethod = useCallback(async (method: SerializedTanMethod, tanMediaName?: string) => {
    const login = addLoginRef.current;
    if (!login) return;
    if (busyRef.current) {
      updateAddBank((a) => ({ ...a, error: BUSY_MESSAGE }));
      return;
    }
    updateAddBank((a) => ({ ...a, selectedMethod: method, mediaChoice: null, error: null }));
    holdFlowBusy();
    await new Promise<void>((resolve) => setTimeout(resolve, 400));
    if (addLoginRef.current !== login) return;
    const media = tanMediaName || (method.activeTanMedia.length === 1 ? method.activeTanMedia[0] : undefined);
    if (!media && method.activeTanMedia.length > 1) {
      releaseFlowBusy();
      updateAddBank((a) => ({ ...a, mediaChoice: method.activeTanMedia }));
      return;
    }
    startWait('login', {
      challenge: 'Anmeldung im Online-Banking über FinTS freigeben',
      bank: { name: login.bank.name, brand: login.bank.brand },
      method,
      onDone: () => { finishAddBankRef.current(); },
      retry: () => {
        releaseFlowBusy();
        void chooseAddBankMethodRef.current(method, media);
      },
      onCancelled: () => {
        closeAddBank();
        toast(msgs().banks.cancelled(login.bank.name), 'info');
      },
    });
  }, [updateAddBank, holdFlowBusy, releaseFlowBusy, startWait, closeAddBank, toast]);

  const finishAddBankRef = useRef(finishAddBank);
  finishAddBankRef.current = finishAddBank;
  const chooseAddBankMethodRef = useRef(chooseAddBankMethod);
  chooseAddBankMethodRef.current = chooseAddBankMethod;

  const removeBank = useCallback((entry: BankEntry) => {
    if (entry.state === 'primary') return;
    if (busyRef.current) {
      toast(BUSY_MESSAGE, 'info');
      return;
    }
    const link = linksRef.current.find((l) => l.id === entry.key) ?? null;
    const login = link ? { blz: link.bank.blz, userId: link.userId } : entry.ref;
    if (link) {
      const gone = new Set(link.accountNumbers);
      setLinks(linksRef.current.filter((l) => l.id !== link.id));
      const rest = accountsRef.current.filter((a) => !gone.has(a.accountNumber));
      setAccounts(rest);
      setBalances((b) => link.accountNumbers.reduce((r, n) => without(r, n), b));
      setTxCache((c) => link.accountNumbers.reduce((r, n) => without(r, n), c));
      setStatementInfo((si) => link.accountNumbers.reduce((r, n) => without(r, n), si));
      if (activeRef.current && gone.has(activeRef.current.accountNumber) && rest[0]) selectAccountRef.current(rest[0]);
    }
    if (login) {
      updateVault((v) => {
        if (!v.linkedBanks?.some((r) => sameLogin(r, login))) return v;
        const list = forgetLinkedBank(v.linkedBanks, login);
        if (list.length) return { ...v, linkedBanks: list };
        const { linkedBanks: _gone, ...rest } = v;
        return rest as VaultData;
      });
    }
    toast(msgs().banks.removed(entry.bank.name), 'info');
  }, [setLinks, updateVault, toast]);

  /** Like the provider's: the session goes on with an empty vault that is never written. */
  const dropVault = useCallback(() => {
    vaultRef.current = EMPTY_VAULT;
    setVault(EMPTY_VAULT);
    vaultStatusRef.current = 'unavailable';
    setVaultStatus('unavailable');
    // As the provider: the kept Umsätze went with the saved data.
    dropHistory();
  }, [dropHistory]);

  const forgetDevice = useCallback(async (opts?: { wipeData?: boolean }) => {
    await new Promise<void>((resolve) => setTimeout(resolve, 300));
    setDeviceRemembered(false);
    if (opts?.wipeData === true) {
      dropVault();
      toast('Gerät vergessen und deine gespeicherten Daten von diesem Rechner gelöscht. Bis zum Abmelden wird nichts mehr gespeichert.', 'success', 8000);
      return;
    }
    toast('Gerät vergessen – bei der nächsten Anmeldung fragt deine Bank wieder nach einer Freigabe.', 'info', 6000);
  }, [toast, dropVault]);

  const wipeVault = useCallback(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 300));
    dropVault();
    toast('Deine gespeicherten Daten sind von diesem Rechner gelöscht. Bis zum Abmelden wird nichts mehr gespeichert.', 'success', 8000);
  }, [toast, dropVault]);

  const resetSession = useCallback(() => {
    sessionGen.current++;
    waitGen.current++;
    waitCb.current = {};
    for (const t of timers.current) clearTimeout(t);
    timers.current.clear();

    setSessionId(null);
    setAccounts([]);
    setActiveAccount(null);
    activeRef.current = null;
    setBalances({});
    setTxCache({});
    setPendingCache({});
    setPendingAt({});
    setStatementInfo({});
    setSelectedMethod(null);
    setTanMethods([]);
    setMediaChoice(null);
    tanMediaRef.current = null;
    setTanMethodError(null);
    setBusy(false);
    setLoadingAccount(null);
    setPendingLoading(null);
    setPendingErrors({});
    setBankOrders({});
    setBankOrdersLoading(null);
    setBankOrderErrors({});
    setOrderDeletions({});
    setDeviceRemembered(false);
    setTxErrors({});
    setBalanceErrors({});
    setBalanceLoading(null);
    setLoadingAllBalances(false);
    setWait(IDLE_WAIT);
    setPrintJob(null);

    deadlineRef.current = null;
    initialDeadline.current = null;
    shownRef.current = { value: null, at: 0 };
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
    setForgetDeviceOpenState(false);
    setLinks([]);
    addBankRef.current = null;
    setAddBankState(null);
    flowBusyRef.current = false;
    addLoginRef.current = null;
    const r = presetRange('90d');
    rangeRef.current = r;
    setRange(r);

    messagesRef.current = [];
    setMessages([]);
    setActivity([]);
    lastTransferRef.current = null;
    vaultRef.current = null;
    vaultStatusRef.current = 'idle';
    setVault(null);
    setVaultStatus('idle');
    historyRef.current = null;
    setHistory(null);
    historyStatusRef.current = 'off';
    setHistoryStatus('off');
    savedRangeRef.current = false;
    setSavedRange(false);

    setToasts((list) => list.filter((t) => !t.action));
    setView('login');
  }, [setBusy]);

  const logout = useCallback(async (reason: LogoutReason = 'user') => {
    if (reason !== 'idle' && reason !== 'expired' && reason !== 'cancelled') reason = 'user';
    if (viewRef.current === 'login') {
      if (reason === 'user' || reason === 'cancelled') resetSession();
      return;
    }
    const unclear = unclearTransfers(activityRef.current).map((e) => e.name);
    resetSession();
    if (reason === 'idle') {
      toast(idleLogoutNotice(unclear, unclear.length), 'info', IDLE_NOTICE_MS);
    } else if (reason === 'expired') {
      toast('Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.', 'error');
    } else {
      // The real provider adds the PIN clause once /api/logout answered.
      const said = reason;
      const id = toast(logoutNotice(said, false), 'info', 6000);
      // A plain timer: the reset above ends the session that later() is tied to.
      setTimeout(() => rewordToast(id, logoutNotice(said, true)), 300);
    }
  }, [resetSession, toast, rewordToast]);

  logoutRef.current = logout;

  const requestLogout = useCallback(() => {
    if (unclearTransfers(activityRef.current).length) {
      setLogoutConfirmOpen(true);
      return;
    }
    void logoutRef.current('user');
  }, []);

  const closeLogoutConfirm = useCallback(() => setLogoutConfirmOpen(false), []);

  // ---- transfer -----------------------------------------------------------
  const logTransfer = useCallback((outcome: ActivityEntry['outcome'], message?: string) => {
    const p = lastTransferRef.current;
    if (!p) return;
    const text = message ? bankAnswerLines(repairBankText(message)).join('\n') : '';
    const entry: ActivityEntry = {
      id: newId(),
      at: new Date().toISOString(),
      kind: 'transfer',
      outcome,
      accountNumber: p.accountNumber,
      name: p.recipientName.trim(),
      iban: normIban(p.iban),
      amount: Math.abs(parseAmount(p.amount) ?? 0),
      instant: p.instant,
      ...(p.schedule ? { schedule: p.schedule } : {}),
      ...(text ? { message: text } : {}),
    };
    setActivity((list) => [entry, ...list].slice(0, MAX_ACTIVITY));
    // As the provider: what may have moved money goes into the vault's log —
    // an order for later with its kind and first date.
    const cents = Math.round(entry.amount * 100);
    const s = p.schedule;
    if (outcome !== 'failed' && cents > 0) {
      const later = s ? { kind: s.kind, due: s.kind === 'dated' ? s.date : s.first } : {};
      updateVault((v) => ({
        ...v,
        sentOrders: recordSentOrder(v.sentOrders, {
          at: entry.at, accountNumber: entry.accountNumber, iban: entry.iban, cents, outcome, ...later,
        }),
      }));
    }
    // As the provider: the bank's list of that kind is out of date.
    if (s && outcome !== 'failed') {
      setBankOrders((c) => (c[p.accountNumber]?.[s.kind]
        ? { ...c, [p.accountNumber]: { ...c[p.accountNumber], [s.kind]: undefined } }
        : c));
    }
  }, [updateVault]);

  const withActivity = useCallback((h: TransferHandlers): TransferHandlers => ({
    ...h,
    onExecuted: (answers) => { logTransfer('executed', answers); h.onExecuted(answers); },
    onUnknown: (answers) => { logTransfer('unknown', answers); h.onUnknown(answers); },
    onRefused: (answers) => { logTransfer('failed', answers); h.onRefused(answers); },
    onError: (message) => { logTransfer('failed', message); h.onError(message); },
  }), [logTransfer]);

  /** The approval step every order ends in. */
  const approveTransfer = useCallback((p: TransferPayload, h: TransferHandlers, vop: SerializedVop | null) => {
    h.onTanStarted();
    const amount = parseAmount(p.amount) ?? 0;
    const ibanTail = normIban(p.iban).slice(-4);
    const what = p.schedule?.kind === 'standing' ? 'Dauerauftrag'
      : p.schedule?.kind === 'dated' ? 'Terminüberweisung'
        : p.instant ? 'Echtzeitüberweisung' : 'Überweisung';
    startWait(p.change ? 'orderChange' : orderWaitKind(p.schedule), {
      account: p.accountNumber,
      challenge: `${what} über ${amount.toFixed(2).replace('.', ',')} EUR `
        + `an ${p.recipientName.trim()} (IBAN …${ibanTail})${p.schedule ? `, ${scheduleSentence(p.schedule)},` : ''} freigeben`,
      vop,
      order: { amount, name: sepaSanitize(p.recipientName), iban: normIban(p.iban), instant: p.instant, schedule: p.schedule ?? null },
      onAnswer: (status, answers) => {
        setBusy(false);
        closeWait();
        if (status === 'refused') h.onRefused(answers);
        else h.onUnknown(answers);
      },
      onDone: () => {
        setBusy(false);
        h.onExecuted(p.schedule
          ? '0010 Auftrag entgegengenommen.\n0020 Auftrag zur Ausführung vorgemerkt.'
          : p.instant
            ? '0010 Nachricht entgegengenommen.\n0020 Echtzeitüberweisung ausgeführt.'
            : '0010 Nachricht entgegengenommen.\n0020 Auftrag ausgeführt.');
      },
      retry: null,
      onDialogEnded: () => { setBusy(false); closeWait(); h.onUnknown(); },
      onCancelled: () => h.onUnknown(),
      outcome: /unklar/i.test(p.recipientName) ? 'ended' : /abgelehnt/i.test(p.recipientName) ? 'refused' : undefined,
    });
  }, [startWait, setBusy, closeWait]);

  const vopOrder = useRef<TransferPayload | null>(null);
  /** The check result the parked order carries into its approval, as /api/vop-confirm passes it on. */
  const vopResult = useRef<SerializedVop | null>(null);

  const submitTransfer = useCallback(async (payload: TransferPayload, handlers: TransferHandlers) => {
    if (busyRef.current) {
      handlers.onError(BUSY_MESSAGE);
      return;
    }
    lastTransferRef.current = payload;
    const h = withActivity(handlers);
    setBusy(true);
    later(650, () => {
      const name = payload.recipientName.trim();
      if (/fehler/i.test(name)) {
        // Refused outright, before any approval.
        setBusy(false);
        h.onRefused('9050: Die Nachricht enthält Fehler. | 9210: Die Empfänger-IBAN ist für Überweisungen gesperrt. | 9800: Dialog abgebrochen.');
        return;
      }
      const iban = normIban(payload.iban);
      const park = (vop: SerializedVop) => {
        setBusy(false);
        vopOrder.current = payload;
        vopResult.current = vop;
        h.onVop(vop);
      };
      const notice = 'Wenn du den Auftrag trotzdem freigibst, kann das Geld auf einem Konto landen, dessen '
        + 'Inhaber nicht der von dir angegebene Empfänger ist. Deine Bank haftet dann nicht für die Ausführung.';
      if (/^max musterman$/i.test(name)) {
        // Namensabgleich: one letter off — the bank names who it really is.
        park({
          verdict: 'CLOSE_MATCH',
          suggestedName: 'Max Mustermann',
          reason: null,
          infoText: 'Der Name des Zahlungsempfängers stimmt nicht genau mit dem Namen überein, der zur angegebenen IBAN '
            + `hinterlegt ist. ${notice}`,
          submittedName: name,
          iban,
          validTo: null,
        });
        return;
      }
      if (/schmidt/i.test(name)) {
        park({
          verdict: 'NO_MATCH',
          suggestedName: null,
          reason: null,
          infoText: `Der Name des Zahlungsempfängers stimmt nicht mit dem Namen überein, der zur angegebenen IBAN hinterlegt ist. ${notice}`,
          submittedName: name,
          iban,
          validTo: null,
        });
        return;
      }
      if (/kiosk/i.test(name)) {
        park({
          verdict: 'NOT_APPLICABLE',
          suggestedName: null,
          reason: 'Die Bank des Zahlungsempfängers bietet keinen Namensabgleich an.',
          infoText: `Der Name des Zahlungsempfängers konnte nicht überprüft werden. ${notice}`,
          submittedName: name,
          iban,
          validTo: null,
        });
        return;
      }
      approveTransfer(payload, h, {
        verdict: 'MATCH', suggestedName: null, reason: null, infoText: null, submittedName: name, iban, validTo: null,
      });
    });
  }, [withActivity, setBusy, later, approveTransfer]);

  const confirmVop = useCallback(async (handlers: TransferHandlers) => {
    if (busyRef.current) {
      handlers.onError(BUSY_MESSAGE);
      return;
    }
    const order = vopOrder.current ?? lastTransferRef.current;
    if (!order) {
      handlers.onError('Kein Auftrag zum Bestätigen vorhanden.');
      return;
    }
    const h = withActivity(handlers);
    setBusy(true);
    const vop = vopResult.current;
    later(500, () => approveTransfer(order, h, vop));
  }, [withActivity, setBusy, later, approveTransfer]);

  const abandonVop = useCallback(async () => {
    vopOrder.current = null;
    vopResult.current = null;
    setBusy(false);
  }, [setBusy]);

  // ---- derived data -------------------------------------------------------
  const transactions = activeAccount ? txCache[activeAccount.accountNumber]?.txs ?? null : null;
  const txError = activeAccount ? txErrors[activeAccount.accountNumber]?.message ?? null : null;

  const txByAccount = useMemo(() => {
    const out: Record<string, SerializedTransaction[]> = {};
    for (const [acct, entry] of Object.entries(txCache)) out[acct] = entry.txs;
    return out;
  }, [txCache]);

  const ownIbans = useMemo(
    () => [...new Set(accounts.map((a) => normIban(a.iban)).filter(Boolean))],
    [accounts],
  );

  const unreadCount = useMemo(() => messages.filter((m) => !m.read).length, [messages]);

  // As the provider's: every bank of the view, in list order.
  const linkedBanks = vault?.linkedBanks;
  const banks = useMemo((): BankEntry[] => {
    if (!bank || !sessionId || view !== 'dashboard') return [];
    const out: BankEntry[] = [{ key: 'primary', bank, state: 'primary', ref: null, deviceRemembered }];
    for (const l of links) {
      out.push({
        key: l.id, bank: l.bank, state: l.sessionId ? 'active' : 'loggedOut',
        ref: { blz: l.bank.blz, name: l.bank.name, userId: l.userId }, deviceRemembered: l.deviceRemembered,
      });
    }
    (linkedBanks ?? []).forEach((r, i) => {
      if (sameLogin({ blz: bank.blz, userId }, r)) return;
      if (links.some((l) => sameLogin({ blz: l.bank.blz, userId: l.userId }, r))) return;
      // The bank list knows the second bank's mark; any other gets a monogram.
      const listed = r.blz === data.second.bank.blz ? data.second.bank : null;
      out.push({
        key: `remembered:${i}`,
        bank: { blz: r.blz, name: r.name, brand: listed?.brand ?? 'generic', bic: listed?.bic ?? null },
        state: 'remembered', ref: r, deviceRemembered: false,
      });
    });
    return out;
  }, [bank, sessionId, view, userId, deviceRemembered, links, linkedBanks, data]);

  const bankOf = useCallback((a: Pick<SerializedAccount, 'accountNumber'> | null | undefined): BankEntry | null => {
    if (!a) return null;
    const link = links.find((l) => l.accountNumbers.includes(a.accountNumber));
    return banks.find((b) => b.key === (link?.id ?? 'primary')) ?? null;
  }, [links, banks]);
  const activeBank = useMemo(() => bankOf(activeAccount), [bankOf, activeAccount]);

  const historyCoverage = useMemo(() => coverageOf(historyStatus === 'ready' ? history : null), [history, historyStatus]);

  vaultRef.current = vault;
  vaultStatusRef.current = vaultStatus;
  messagesRef.current = messages;

  const categoryRules = vault?.categoryRules;
  const txCategories = vault?.txCategories;
  const splits = vault?.splits;
  const customCategories = vault?.customCategories;
  // As the provider does: registered during the render, for everything below.
  useMemo(() => setCustomCategories(customCategories ?? []), [customCategories]);

  const categoryOf = useMemo(() => {
    const own = new Set(ownIbans);
    const memo = new WeakMap<SerializedTransaction, CategoryResult>();
    return (tx: SerializedTransaction): CategoryResult => {
      const hit = memo.get(tx);
      if (hit) return hit;
      let result: CategoryResult;
      try {
        result = categorize(tx, { ownIbans: own, rules: categoryRules, overrides: txCategories, splits, merchantLabel: null });
      } catch {
        result = { id: tx.amount >= 0 ? 'otherIn' : 'other', source: 'auto' };
      }
      memo.set(tx, result);
      return result;
    };
  }, [ownIbans, categoryRules, txCategories, splits, customCategories]);

  // As the provider's, without logos or a model: the keyword rules alone.
  const categoryGuessOf = useMemo(() => {
    const own = new Set(ownIbans);
    const memo = new WeakMap<SerializedTransaction, CategoryGuess>();
    return (tx: SerializedTransaction): CategoryGuess => {
      const hit = memo.get(tx);
      if (hit) return hit;
      let result: CategoryGuess;
      try {
        result = explainGuess(tx, { ownIbans: own, merchantLabel: null });
      } catch {
        result = { id: tx.amount >= 0 ? 'otherIn' : 'other', basis: 'none' };
      }
      memo.set(tx, result);
      return result;
    };
  }, [ownIbans]);

  const notes = vault?.notes;
  const noteOf = useCallback((tx: SerializedTransaction): string | undefined => {
    const n = notes?.[txKey(tx)];
    return typeof n === 'string' && n ? n : undefined;
  }, [notes]);

  const aliases = vault?.aliases;
  const accountLabel = useCallback(
    (a: SerializedAccount) => aliases?.[a.accountNumber] || a.product?.trim() || translateType(a.accountType),
    [aliases],
  );
  accountLabelRef.current = accountLabel;

  const renameAccount = useCallback((accountNumber: string, alias: string | null) => {
    const clean = (alias ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_ALIAS);
    updateVault((v) => {
      if (!clean) {
        const next = without(v.aliases, accountNumber);
        return next === v.aliases ? v : { ...v, aliases: next };
      }
      return v.aliases[accountNumber] === clean ? v : { ...v, aliases: { ...v.aliases, [accountNumber]: clean } };
    });
  }, [updateVault]);

  const saveTemplate = useCallback((t: Omit<TransferTemplate, 'id' | 'createdAt'>) => {
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
    updateVault((v) => (v.templates.some((t) => t.id === id) ? { ...v, templates: v.templates.filter((t) => t.id !== id) } : v));
  }, [updateVault]);

  const touchTemplate = useCallback((id: string) => {
    const at = new Date().toISOString();
    updateVault((v) => (v.templates.some((t) => t.id === id)
      ? { ...v, templates: v.templates.map((t) => (t.id === id ? { ...t, lastUsedAt: at } : t)) }
      : v));
  }, [updateVault]);

  const dismissRecurring = useCallback((id: string) => {
    updateVault((v) => (v.dismissedRecurring.includes(id) ? v : { ...v, dismissedRecurring: [...v.dismissedRecurring, id] }));
  }, [updateVault]);

  const restoreRecurring = useCallback((id: string) => {
    updateVault((v) => (v.dismissedRecurring.includes(id)
      ? { ...v, dismissedRecurring: v.dismissedRecurring.filter((x) => x !== id) }
      : v));
  }, [updateVault]);

  const setCategory = useCallback((tx: SerializedTransaction, id: CategoryId | null, o: { rule?: boolean } = {}) => {
    const k = txKey(tx);
    // As the provider: a choice of one category ends a split of this booking.
    updateVault((v) => {
      const rest = without(v.splits, k);
      return rest === v.splits ? v : { ...v, splits: rest };
    });
    if (id === null) {
      updateVault((v) => {
        const overrides = without(v.txCategories, k);
        return overrides === v.txCategories ? v : { ...v, txCategories: overrides };
      });
      return;
    }
    if (!categoryValidator(vaultRef.current?.customCategories ?? [])(id)) return;
    const who = counterpartyKey(tx);
    if (o.rule && who !== 'name:?') {
      const stale = new Set([k]);
      const loaded = [...Object.values(txCache).flatMap((e) => e.txs), ...Object.values(pendingCache).flat()];
      for (const t of loaded) if (counterpartyKey(t) === who) stale.add(txKey(t));
      updateVault((v) => {
        let overrides = v.txCategories;
        for (const s of stale) overrides = without(overrides, s);
        if (v.categoryRules[who] === id && overrides === v.txCategories) return v;
        return { ...v, categoryRules: { ...v.categoryRules, [who]: id }, txCategories: overrides };
      });
      return;
    }
    updateVault((v) => (v.txCategories[k] === id ? v : { ...v, txCategories: { ...v.txCategories, [k]: id } }));
  }, [txCache, pendingCache, updateVault]);

  const removeCategoryRule = useCallback((who: string) => {
    updateVault((v) => {
      const rules = without(v.categoryRules, who);
      return rules === v.categoryRules ? v : { ...v, categoryRules: rules };
    });
  }, [updateVault]);

  const setBudgets = useCallback((next: Budgets) => {
    updateVault((v) => ({ ...v, budgets: sanitizeBudgets(next, v.customCategories) }));
  }, [updateVault]);

  const setGoal = useCallback((accountNumber: string, goal: Omit<SavingsGoal, 'accountNumber'> | null) => {
    updateVault((v) => {
      const others = (v.goals ?? []).filter((g) => g.accountNumber !== accountNumber);
      return { ...v, goals: goal ? sanitizeGoals([...others, { ...goal, accountNumber }]) : others };
    });
  }, [updateVault]);

  const setSplit = useCallback((tx: SerializedTransaction, parts: readonly SplitPart[] | null): boolean => {
    const k = txKey(tx);
    if (parts === null) {
      updateVault((v) => {
        const rest = without(v.splits, k);
        return rest === v.splits ? v : { ...v, splits: rest };
      });
      return true;
    }
    const clean = sanitizeSplit(parts, categoryValidator(vaultRef.current?.customCategories ?? []));
    if (!clean || clean.reduce((sum, p) => sum + p.cents, 0) !== Math.round(Math.abs(tx.amount) * 100)) return false;
    updateVault((v) => {
      const { [k]: _was, ...rest } = v.splits;
      return { ...v, splits: { ...rest, [k]: clean }, txCategories: without(v.txCategories, k) };
    });
    return true;
  }, [updateVault]);

  const taken = (name: string, own: readonly { id: string; name: string }[], except?: string) => {
    const key = nameKey(name);
    return own.some((c) => c.id !== except && nameKey(c.name) === key)
      || [...Object.values(MESSAGES.de.categories), ...Object.values(MESSAGES.en.categories)].some((l) => nameKey(l) === key);
  };

  const addCustomCategory = useCallback((
    name: string, direction: 'in' | 'out',
  ): { id: CustomCategoryId } | { error: 'empty' | 'taken' | 'full' } => {
    const clean = cleanCategoryName(name);
    if (!clean) return { error: 'empty' };
    const list = vaultRef.current?.customCategories ?? [];
    if (list.length >= CUSTOM_LIMITS.count) return { error: 'full' };
    if (taken(clean, list)) return { error: 'taken' };
    const id = newCustomId();
    updateVault((v) => ({ ...v, customCategories: [...v.customCategories, { id, name: clean, direction }] }));
    return { id };
  }, [updateVault]);

  const renameCustomCategory = useCallback((id: CustomCategoryId, name: string): 'ok' | 'empty' | 'taken' => {
    const clean = cleanCategoryName(name);
    if (!clean) return 'empty';
    if (taken(clean, vaultRef.current?.customCategories ?? [], id)) return 'taken';
    updateVault((v) => ({ ...v, customCategories: v.customCategories.map((c) => (c.id === id ? { ...c, name: clean } : c)) }));
    return 'ok';
  }, [updateVault]);

  const deleteCustomCategory = useCallback((id: CustomCategoryId) => {
    updateVault((v) => ({ ...withoutCategory(v, id), customCategories: v.customCategories.filter((c) => c.id !== id) }));
  }, [updateVault]);

  const setNote = useCallback((tx: SerializedTransaction, text: string | null) => {
    let dropped = 0;
    updateVault((v) => {
      const res = withNote(v.notes, txKey(tx), text);
      dropped = res.dropped;
      return res.notes === v.notes ? v : { ...v, notes: res.notes };
    });
    if (dropped > 0) toast(msgs().budgets.notes.oldestDropped(dropped), 'info', 10_000);
  }, [updateVault, toast]);

  // ---- print --------------------------------------------------------------
  // No print sheet in the preview: window.print() would open a dialog over
  // every screenshot. Say what would have happened instead.
  const printStatement = useCallback((from?: string, to?: string) => {
    if (!activeAccount) return;
    const info = statementInfo[activeAccount.accountNumber];
    const span = info ? `${fmtDate(info.from)}–${fmtDate(info.to)}` : from && to ? `${fmtDate(from)}–${fmtDate(to)}` : '';
    toast(`Vorschau: Hier würde der Kontoauszug${span ? ` ${span}` : ''} als PDF erstellt.`, 'info', 6000);
  }, [activeAccount, statementInfo, toast]);

  const printTransaction = useCallback((tx: SerializedTransaction, pending = false) => {
    void tx;
    toast(`Vorschau: Hier würde ${pending ? 'der Beleg zum Vormerkposten' : 'der Beleg'} als PDF erstellt.`, 'info', 6000);
  }, [toast]);

  const printMessage = useCallback((message: InboxMessage) => {
    toast(`Vorschau: Hier würde die Mitteilung „${message.subject}“ als PDF erstellt.`, 'info', 6000);
  }, [toast]);

  const printTaxYear = useCallback((summary: TaxYear) => {
    toast(`Vorschau: Hier würde die Jahresübersicht ${summary.year} als PDF erstellt.`, 'info', 6000);
  }, [toast]);

  // The preview reads the year like any other range: the active account's list.
  const loadRange = useCallback((_account: SerializedAccount, r: DateRange) => applyRange(r), [applyRange]);

  // A preview has no server to seal or open a backup: it says what would happen.
  const makeBackup = useCallback(async (_password: string) => {
    toast('Vorschau: Hier würde die Sicherung erstellt und gespeichert.', 'info', 6000);
    return { ok: true as const, saved: false, summary: [] as BackupSummary[] };
  }, [toast]);
  const restoreBackup = useCallback(async (_text: string, _password: string) => {
    toast('Vorschau: Hier würde die Sicherung wiederhergestellt.', 'info', 6000);
    return { ok: true as const, report: [] as RestoreReport[] };
  }, [toast]);

  const inspectBankFile = useCallback(async (_text: string) => ({
    ok: true as const,
    info: { format: 'csv' as const, bookings: 412, skipped: 3, from: '2024-01-02', to: '2025-06-30', account: ACCT.giro, foreign: false },
  }), []);
  const importBankFile = useCallback(async (_text: string, _account: string) => {
    toast('Vorschau: Hier würden die Umsätze der Datei ergänzt.', 'info', 6000);
    return { ok: true as const, days: 545, bookings: 412 };
  }, [toast]);

  const closePrintJob = useCallback(() => setPrintJob(null), []);

  return {
    view, meta, popularBanks, logoFiles, bank, sessionId, userId,
    bankChecking, staleBank,
    tanMethods, selectedMethod, mediaChoice, tanMethodError,
    accounts, activeAccount, balances, transactions, pendingCache, pendingInfo, txError, merchants,
    txErrors, balanceErrors, balanceLoading, loadingAllBalances,
    portfolios, portfolioErrors, portfolioLoading, loadPortfolio,
    docs, docsLocked: false, loadDocs: async () => {}, readDoc, openDoc, removeDoc, keepReceipt, receiptsOf, receiptKeys,
    bankStatementsLoading, statementFetches, fetchBankStatements,
    busy, loadingAccount, pendingLoading, deviceRemembered, wait, toasts, printJob,
    pendingErrors,
    bankOrders, bankOrdersLoading, bankOrderErrors, orderDeletions,
    range, statementInfo, txByAccount, ownIbans,
    messages, messagesAsked: true, unreadCount, activity,
    vault, vaultStatus,
    keepBookings: vault?.keepBookings === true,
    historyStatus,
    historyCoverage,
    savedRange,
    privacy, idleMinutes, singleKeyShortcuts,
    logoConsent,
    sessionStartedAt, idleDeadline,
    tab, settingsTarget, txFilter, txFocusNonce,
    analysisPeriod, analysisScope,
    transferOpen, transferPrefill, shareOpen, sharePrefill, shareAll,
    inboxOpen, paletteOpen, shortcutsOpen,
    logoutConfirmOpen, forgetDeviceOpen,
    setView, setBank, connect, chooseTanMethod, clearMediaChoice, selectAccount, loadTransactions,
    cancelConnect,
    loadBalance, loadAllBalances,
    isLoadedForAppliedRange,
    refreshAccount, refreshAfterTransfer, applyRange, loadPending, submitTransfer, confirmVop, abandonVop,
    loadBankOrders, deleteBankOrder,
    forgetDevice, logout, stayLoggedIn, toast, dismissToast,
    requestLogout, closeLogoutConfirm, setForgetDeviceOpen,
    retryWait, cancelWait, closeWait, submitTan, printStatement, printTransaction, printMessage, closePrintJob,
    togglePrivacy, setIdleMinutes, setSingleKeyShortcuts,
    setLogoConsent,
    setTab, openSettings, leaveSettings, clearSettingsTarget, setTxFilter, showTransactions,
    setAnalysisPeriod, setAnalysisScope,
    openTransfer, closeTransfer, openShare, closeShare, nextShare, openShareQueue, openShareAll, closeShareAll,
    setInboxOpen, setPaletteOpen, setShortcutsOpen,
    markAllRead,
    updateVault, resetVault, wipeVault, accountLabel, renameAccount,
    setKeepBookings, resetHistory, applySavedRange,
    saveTemplate, deleteTemplate, touchTemplate, dismissRecurring, restoreRecurring,
    printTaxYear, loadRange,
    makeBackup, restoreBackup, inspectBankFile, importBankFile,
    categoryOf, setCategory, setSplit,
    removeCategoryRule,
    addCustomCategory, renameCustomCategory, deleteCustomCategory,
    // The preview runs no model: its keyword rules alone file the mock bookings.
    modelGuesses: {},
    // Gemini Nano's brands (Android): the preview shows the bank's names.
    brandNames: new Map<string, string>(),
    // Girovo Plus (?plus=…); the Plus screen's purchase and icon go through window.girovoMobile.plus.
    plus, plusOpen,
    openPlus: () => setPlusOpen(true),
    closePlus: () => setPlusOpen(false),
    categoryGuessOf, setBudgets, setGoal, noteOf, setNote,
    links, banks, bankOf, activeBank, addBank,
    openAddBank, closeAddBank, pickAddBank, connectAddBank, chooseAddBankMethod, clearAddBankMedia, addBankBack,
    removeBank,
  } satisfies FintsApi;
}

/**
 * <FintsProvider> for screenshots and harness pages. `preset` picks the first
 * frame, `overrides` force fields on top of the live value, the remaining
 * props tune the simulation (see MockOptions).
 */
export function MockFintsProvider({ children, preset = 'default', overrides, still, ...options }: MockFintsProviderProps) {
  // A preset and the first-frame options describe how a session starts. A
  // different start is a different session: it remounts (children included)
  // rather than pretending the running one had begun that way — so a harness
  // that switches ?preset= on the client gets what it asked for. `tan` and
  // `tanMs` are read live and need no new session.
  const sessionKey = JSON.stringify([
    preset, options.range, options.idleInMs, options.view, options.bankChosen, options.tab, options.open,
    options.transferPrefill, options.privacy, options.account, options.query, options.oneAccount,
    options.staleBank, options.methods,
    options.logos,
    options.filter, options.analysisPeriod, options.analysisScope, options.categoryRules,
    options.budgets, options.personal,
    options.unclear, options.failPending, options.pendingWithStatements, options.secondBank, options.history,
    options.ordersLoaded, options.noOrders,
  ]);
  const underElectron = useSyncExternalStore(noopSubscribe, isElectron, () => false);
  return (
    <MockSession key={sessionKey} preset={preset} options={options} overrides={overrides}>
      {(still ?? underElectron) && <style>{STILL_CSS}</style>}
      {children}
    </MockSession>
  );
}

function MockSession({ children, preset, options, overrides }: {
  children: ReactNode;
  preset: MockPreset;
  options: MockOptions;
  overrides?: Partial<FintsApi>;
}) {
  const api = useMockFintsState(preset, options);
  const value: FintsApi = overrides ? { ...api, ...overrides } : api;
  return <FintsContext.Provider value={value}>{children}</FintsContext.Provider>;
}

const noopSubscribe = () => () => {};
const isElectron = () => /Electron/i.test(navigator.userAgent);

/**
 * Still frames. The screenshot helper captures from a window that never
 * presents a frame, so compositor-driven keyframe animations (and smooth
 * scrolling) stay on their first frame: every dialog would be captured at
 * opacity 0. A large negative delay, paused, puts each animation at its end —
 * the settled state a person sees a moment later. Infinite ones (spinners,
 * shimmer) simply freeze. The dev indicator would cover the phone bottom bar.
 */
const STILL_CSS = `
*, *::before, *::after {
  animation-delay: -60s !important;
  animation-play-state: paused !important;
  transition-duration: 0s !important;
  transition-delay: 0s !important;
  scroll-behavior: auto !important;
}
nextjs-portal { display: none !important; }
`;
