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
//   login                 user name … "fehler" → wrong PIN, "gesperrt" → access locked,
//                           "wartung" → bank not answering, "langsam" → no answer
//                           until "Abbrechen"; else TAN methods
//   print                 no PDF — a toast says so
//
// Nothing here persists: privacy, idle limit and theme stay in memory, so the
// harness can never change the preferences of the real app on the same origin.

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import {
  FintsContext, countsAsActivity, waitHoldsSession,
  type ChosenBank, type FintsApi, type IdleMinutes, type LoadError, type LoadOutcome, type LoadSettled,
  type LogoutReason, type PendingInfo, type PrintJob, type Toast,
  type ToastAction, type ToastTone, type TransferHandlers, type TransferPayload, type View, type WaitKind,
  type WaitOrder, type WaitState,
} from '@/components/FintsProvider';
import type { LogoConsent } from '@/components/FintsProvider';
import { acceptsBalance, balanceQueue, failureSentence } from '@/lib/balances';
import { BANK_UNAVAILABLE, bankAnswerLines } from '@/lib/bank-answer';
import { categorize } from '@/lib/categorize';
import { counterpartyKey, isCategoryId, txKey, type CategoryId, type CategoryResult } from '@/lib/categories';
import { addDaysKey, fmtDate, ibanValid, isoDate, parseAmount, presetRange, repairBankText, translateType } from '@/lib/format';
import { recordSentOrder } from '@/lib/sent-orders';
import { sepaSanitize } from '@/lib/sepa-text';
import {
  EMPTY_FILTER, EMPTY_VAULT,
  type ActivityEntry, type DashboardTab, type DateRange, type InboxMessage, type SharePrefill, type StatementInfo,
  type TransferPrefill, type TransferTemplate, type TxFilter, type VaultData, type VaultStatus,
} from '@/lib/app-types';
import type { AnalysisPeriod, AnalysisScope } from '@/lib/app-types';
import type {
  Merchant, SerializedAccount, SerializedBalance, SerializedTanMethod, SerializedTransaction, SerializedVop,
} from '@/lib/fints-types';
import { ACCT, getMockData, type MockData } from './data';

export type MockPreset = 'default' | 'empty' | 'past-range' | 'unverified' | 'loading' | 'error';

export type MockOptions = {
  /** The statement range loaded at start. Default '90d', like the real app after login. */
  range?: '90d' | '365d' | 'all';
  /** How a simulated approval ends. 'hold' keeps it waiting (for screenshots of the wait). */
  tan?: 'confirm' | 'hold' | 'ended' | 'error' | 'refused';
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
  /** 'typed': the bank offers only methods that need a typed TAN (the dead end). */
  methods?: 'typed';
  // First-frame navigation. Part of the initial state rather than set from an
  // effect, so nothing (a slow first compile, a hot reload) can race it.
  tab?: DashboardTab;
  /** A launcher open from the start. */
  open?: 'inbox' | 'palette' | 'shortcuts' | 'share' | 'transfer';
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
  order: null, note: null,
};
/** As the provider's WAIT_SUBJECT. */
const WAIT_SUBJECT: Record<WaitKind, string> = {
  login: 'die Anmeldung',
  statements: 'den Umsatzabruf',
  pending: 'den Abruf der vorgemerkten Umsätze',
  balance: 'die Saldoabfrage',
  transfer: 'die Überweisung',
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
const BUSY_MESSAGE = 'Bitte warten — ein anderer Vorgang läuft noch.';
const LOAD_MS = 700;
const BALANCE_MS = 500;
const DEFAULT_TAN_MS = 2600;
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

/** Everything a preset decides about the first frame. */
function initialState(data: MockData, preset: MockPreset, opts: MockOptions) {
  const range = startRange(data, preset, opts.range);
  const empty = preset === 'empty';
  const broken = preset === 'unverified';
  const balances: Record<string, SerializedBalance> = {};
  const txCache: Cache = {};
  const statementInfo: Record<string, StatementInfo> = {};
  const now = Date.now();

  const load = (acct: string, r: DateRange) => {
    const s = data.statement(acct, r, { broken: broken && acct === ACCT.giro, empty });
    txCache[acct] = { key: `${r.from}|${r.to}`, txs: s.txs };
    statementInfo[acct] = { from: r.from, to: r.to, blocks: s.blocks, loadedAt: now - 60_000 };
    if (s.balance) balances[acct] = s.balance;
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
    if (opts.account && opts.account !== ACCT.giro && opts.account !== ACCT.karte) load(opts.account, range);
    // The card was looked at earlier in this session (with today's range, so
    // its balance is known); the Tagesgeld was not — "Saldo abrufen".
    if (!opts.oneAccount) load(ACCT.karte, preset === 'past-range' ? presetRange('90d') : range);
    if (preset === 'past-range') {
      // The current balance is known from that earlier load too.
      balances[ACCT.giro] = data.balance(ACCT.giro);
    }
  }

  const pendingCache: Record<string, SerializedTransaction[]> =
    preset === 'default' || preset === 'unverified' || preset === 'past-range'
      ? { [ACCT.giro]: data.pending[ACCT.giro] }
      : empty ? { [ACCT.giro]: [] } : {};

  const sessionStartedAt = now - 7 * 60_000;
  return {
    range, balances, txCache, statementInfo, txErrors, busy, loadingAccount, pendingCache,
    messages: empty ? [] : data.messages(new Date(sessionStartedAt).toISOString()),
    activity: empty ? [] : data.activity(now),
    vault: preset === 'loading' ? null : empty ? EMPTY_VAULT
      : opts.categoryRules ? { ...data.vault, categoryRules: opts.categoryRules } : data.vault,
    vaultStatus: (preset === 'loading' ? 'loading' : 'ready') as VaultStatus,
    sessionStartedAt,
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
    opts.view === 'tanmethod' || opts.view === 'login' ? null : data.tanMethods[0],
  );
  const [mediaChoice, setMediaChoice] = useState<string[] | null>(null);
  const [tanMethodError, setTanMethodError] = useState<string | null>(null);

  const loggedIn = !opts.view || opts.view === 'dashboard';
  // What the bank lists for this login; a first-frame option, so fixed per session.
  const [bankAccounts] = useState(() => (opts.oneAccount ? data.accounts.slice(0, 1) : data.accounts));
  const startAccount = bankAccounts.find((a) => a.accountNumber === opts.account) ?? bankAccounts[0];
  const [accounts, setAccounts] = useState<SerializedAccount[]>(loggedIn ? bankAccounts : []);
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
    for (const [a, at] of Object.entries(pendingAt)) if (pendingCache[a]) out[a] = { loadedAt: at, behindStatement: false, booked: 0 };
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
  const [sharePrefill, setSharePrefill] = useState<SharePrefill | null>(opening === 'share'
    ? { accountNumber: startAccount.iban ? startAccount.accountNumber : ACCT.giro }
    : null);
  const [inboxOpen, setInboxOpenState] = useState(opening === 'inbox');
  const [paletteOpen, setPaletteOpenState] = useState(opening === 'palette');
  const [shortcutsOpen, setShortcutsOpenState] = useState(opening === 'shortcuts');

  const [range, setRange] = useState<DateRange>(init.range);
  const [messages, setMessages] = useState<InboxMessage[]>(connected ? init.messages : []);
  const [activity, setActivity] = useState<ActivityEntry[]>(loggedIn ? init.activity : []);
  const [vault, setVault] = useState<VaultData | null>(loggedIn ? init.vault : null);
  const [vaultStatus, setVaultStatus] = useState<VaultStatus>(loggedIn ? init.vaultStatus : 'idle');

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
  const toast = useCallback((message: string, tone: ToastTone = 'info', ms?: number, action?: ToastAction) => {
    const id = ++toastId.current;
    const entry: Toast = { id, message, tone, ms: ms ?? (tone === 'error' ? 9000 : 4200), ...(action ? { action } : {}) };
    setToasts((list) => [...list.filter((t) => t.message !== message || t.tone !== tone), entry].slice(-MAX_TOASTS));
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
    const method = selectedMethodRef.current ?? data.tanMethods[0];
    const subject = w.subject || WAIT_SUBJECT[kind];
    setWait({
      open: true,
      kind,
      title: '',
      text: method?.isDecoupled
        ? `Öffne „${method.name}“ und bestätige ${subject}.`
        : `Bestätige ${subject} in deiner Banking-App.`,
      challenge: w.challenge ?? null,
      phase: 'waiting',
      error: null,
      canRetry: !!w.retry,
      startedAt: Date.now() - (optsRef.current.tanElapsedMs ?? 0),
      settledAt: null,
      vop: w.vop ?? null,
      tanMediaName: tanMediaRef.current
        ?? (method?.activeTanMedia.length === 1 ? method.activeTanMedia[0] : null),
      order: w.order ?? null,
      note: second ? 'Die Anmeldung ist freigegeben – für die Umsätze fragt deine Bank ein zweites Mal.' : null,
    });

    const outcome = w.outcome ?? optsRef.current.tan ?? 'confirm';
    if (outcome === 'hold') return;
    later(optsRef.current.tanMs ?? DEFAULT_TAN_MS, () => {
      if (gen !== waitGen.current) return;
      if (outcome === 'refused') {
        const handler = waitCb.current.onAnswer;
        if (handler) { handler('refused', MOCK_REFUSAL); return; }
        setWait((s) => ({ ...s, phase: 'refused', settledAt: Date.now(), error: MOCK_REFUSAL, canRetry: !!waitCb.current.retry }));
        return;
      }
      if (outcome === 'ended') {
        const handler = waitCb.current.onDialogEnded;
        if (handler) { handler(); return; }
        setWait((s) => ({
          ...s,
          phase: 'ended',
          settledAt: Date.now(),
          title: 'Freigabe nicht rechtzeitig angekommen',
          text: 'Deine Bank hat die Anfrage beendet. Sende sie neu und bestätige sie in der App.',
          canRetry: !!waitCb.current.retry,
        }));
        return;
      }
      if (outcome === 'error') {
        setWait((s) => ({ ...s, phase: 'error', settledAt: Date.now(), error: MOCK_ERROR, canRetry: !!waitCb.current.retry }));
        return;
      }
      lastConfirmed.current = { kind, gen, at: Date.now() };
      setWait((s) => ({ ...s, phase: 'confirmed', settledAt: Date.now() }));
      later(CONFIRMED_LINGER_MS, () => { if (gen === waitGen.current) setWait(IDLE_WAIT); });
      waitCb.current.onDone?.();
    });
  }, [data, later]);

  const closeWait = useCallback(() => {
    waitGen.current++;
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
      void logoutRef.current('user');
      return;
    }
    setBusy(false);
    setLoadingAccount(null);
    setPendingLoading(null);
    onCancelled?.();
  }, [closeWait, setBusy]);

  // ---- statements ---------------------------------------------------------
  const today = data.today;
  const ninetyAgo = addDaysKey(today, -90);

  const loadTransactions = useCallback(async (
    account: SerializedAccount,
    from?: string,
    to?: string,
    o: { force?: boolean; onNotApplied?: () => void; quiet?: boolean; onSettled?: LoadSettled } = {},
  ) => {
    const applied = rangeRef.current;
    const span = { from: from || applied.from, to: to || applied.to };
    const cacheKey = `${span.from}|${span.to}`;
    const acct = account.accountNumber;
    const notApplied = (outcome: LoadOutcome, error?: string) => { o.onNotApplied?.(); o.onSettled?.(outcome, error); };
    if (!account.canStatements) { notApplied('skipped'); return; }
    if (!o.force && txCacheRef.current[acct]?.key === cacheKey) { o.onSettled?.('applied'); return; }
    if (busyRef.current) { notApplied('busy'); return; }

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
      const s = data.statement(acct, span, { broken: preset === 'unverified' && acct === ACCT.giro, empty: preset === 'empty' });
      // As the provider: a balance up to today, never one older than the known one.
      if (s.balance && span.to >= today) {
        const balance = s.balance;
        setBalances((b) => (acceptsBalance(b[acct], balance) ? { ...b, [acct]: balance } : b));
      }
      setTxCache((c) => ({ ...c, [acct]: { key: cacheKey, txs: s.txs } }));
      setStatementInfo((si) => ({ ...si, [acct]: { from: span.from, to: span.to, blocks: s.blocks, loadedAt: Date.now() } }));
      o.onSettled?.('applied');
    };

    // Most banks want a fresh approval for anything older than 90 days.
    const second = secondApprovalRef.current;
    secondApprovalRef.current = false;
    if (span.from < ninetyAgo || second) {
      later(450, () => startWait('statements', {
        subject: `den Abruf der Umsätze von ${vaultRef.current?.aliases?.[acct] || account.product || translateType(account.accountType)} ab ${fmtDate(span.from)}`,
        outcome: second ? 'hold' : undefined,
        challenge: `Umsatzabruf ab ${fmtDate(span.from)} für ${account.product || translateType(account.accountType)} freigeben`,
        onDone: () => { if (optsRef.current.fail) { fail(); return; } finish(); apply(); },
        retry: () => { finish(); void loadTransactionsRef.current(account, span.from, span.to, { ...o, force: true }); },
        onCancelled: () => notApplied('cancelled'),
      }));
      return;
    }
    later(LOAD_MS, () => { if (optsRef.current.fail) { fail(); return; } finish(); apply(); });
  }, [data, preset, today, ninetyAgo, later, setBusy, startWait, toast]);

  const loadTransactionsRef = useRef(loadTransactions);
  loadTransactionsRef.current = loadTransactions;

  // ---- balance enquiry ----------------------------------------------------
  // As the provider's loadBalance: the balance alone, no approval in the mock.
  const loadBalance = useCallback(async (account: SerializedAccount, o: { quiet?: boolean; onSettled?: LoadSettled } = {}) => {
    const acct = account.accountNumber;
    const settle: LoadSettled = (outcome, error) => o.onSettled?.(outcome, error);
    if (!account.canBalance) { settle('skipped'); return; }
    if (busyRef.current) {
      if (!o.quiet) toast(BUSY_MESSAGE, 'error');
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

  // As the provider's loadAllBalances: one after the other, one toast for what failed.
  const loadAllBalances = useCallback(() => {
    if (busyRef.current) {
      toast(BUSY_MESSAGE, 'error');
      return;
    }
    const gen = sessionGen.current;
    const queue = balanceQueue(accounts, balances, rangeRef.current.to >= today);
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
  const isLoadedForAppliedRange = useCallback((accountNumber: string) => (
    txCacheRef.current[accountNumber]?.key === `${rangeRef.current.from}|${rangeRef.current.to}`
  ), []);

  const selectAccount = useCallback((a: SerializedAccount) => {
    if (busyRef.current) return;
    setActiveAccount(a);
    activeRef.current = a;
    void loadTransactions(a);
    if (!a.canStatements && a.canBalance && !balances[a.accountNumber]) void loadBalance(a);
  }, [loadTransactions, loadBalance, balances]);

  const refreshAccount = useCallback((account: SerializedAccount, from?: string, to?: string) => {
    void loadTransactions(account, from, to, { force: true });
  }, [loadTransactions]);

  const applyRange = useCallback((r: DateRange) => {
    const valid = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
    if (!r || !valid(r.from) || !valid(r.to)) {
      toast('Bitte einen gültigen Zeitraum wählen.', 'error');
      return;
    }
    if (busyRef.current) {
      toast(BUSY_MESSAGE, 'error');
      return;
    }
    let { from, to } = r;
    if (from > to) [from, to] = [to, from];
    if (to > today) to = today;
    if (from > today) from = today;
    const next = { from, to };
    const prev = rangeRef.current;
    rangeRef.current = next;
    setRange(next);
    const account = activeRef.current;
    // As the provider: kept only if its statement lands.
    if (account) {
      void loadTransactions(account, next.from, next.to, {
        force: true,
        onNotApplied: () => {
          if (rangeRef.current !== next) return;
          rangeRef.current = prev;
          setRange(prev);
        },
      });
    }
  }, [toast, today, loadTransactions]);

  // As the provider: a past applied range is carried forward to today.
  const refreshAfterTransfer = useCallback((account: SerializedAccount) => {
    if (busyRef.current) {
      toast(BUSY_MESSAGE, 'error');
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
      toast(BUSY_MESSAGE, 'error');
      return;
    }
    setBusy(true);
    setPendingLoading(account.accountNumber);
    const finish = () => { setBusy(false); setPendingLoading(null); };
    later(450, () => startWait('pending', {
      subject: `den Abruf der vorgemerkten Umsätze von ${vaultRef.current?.aliases?.[account.accountNumber] || account.product || translateType(account.accountType)}`,
      onDone: () => {
        finish();
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
    if (!method.isDecoupled) {
      // As /api/select-tan refuses it.
      setTanMethodError('Dieses Verfahren braucht eine TAN-Eingabe. Hier geht nur die Freigabe in einer Banking-App.');
      return;
    }
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
        toast('Gerät gemerkt — künftige Anmeldungen brauchen seltener eine TAN.', 'info', 10_000, {
          label: 'Gerät vergessen',
          run: () => void forgetDeviceRef.current(),
        });
        afterAccountsReady();
      },
      retry: () => void chooseTanMethodRef.current(method, media),
    });
  }, [startWait, toast, afterAccountsReady]);

  const chooseTanMethodRef = useRef(chooseTanMethod);
  chooseTanMethodRef.current = chooseTanMethod;
  /** For the "Gerät gemerkt" toast above, as in the provider. */
  const forgetDeviceRef = useRef<() => Promise<void>>(async () => {});

  const clearMediaChoice = useCallback(() => setMediaChoice(null), []);

  /** Like the provider's: the session goes on with an empty vault that is never written. */
  const dropVault = useCallback(() => {
    vaultRef.current = EMPTY_VAULT;
    setVault(EMPTY_VAULT);
    vaultStatusRef.current = 'unavailable';
    setVaultStatus('unavailable');
  }, []);

  const forgetDevice = useCallback(async (opts?: { wipeData?: boolean }) => {
    await new Promise<void>((resolve) => setTimeout(resolve, 300));
    setDeviceRemembered(false);
    if (opts?.wipeData === true) {
      dropVault();
      toast('Gerät vergessen und deine gespeicherten Daten von diesem Rechner gelöscht. Bis zum Abmelden wird nichts mehr gespeichert.', 'success', 8000);
      return;
    }
    toast('Gerät vergessen — bei der nächsten Anmeldung wird wieder eine TAN angefragt.', 'info', 6000);
  }, [toast, dropVault]);
  forgetDeviceRef.current = forgetDevice;

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

    setToasts((list) => list.filter((t) => !t.action));
    setView('login');
  }, [setBusy]);

  const logout = useCallback(async (reason: LogoutReason = 'user') => {
    if (reason !== 'idle' && reason !== 'expired') reason = 'user';
    resetSession();
    if (reason === 'idle') toast('Du wurdest aus Sicherheitsgründen abgemeldet.', 'info', IDLE_NOTICE_MS);
    else if (reason === 'expired') toast('Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.', 'error');
  }, [resetSession, toast]);

  logoutRef.current = logout;

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
      ...(text ? { message: text } : {}),
    };
    setActivity((list) => [entry, ...list].slice(0, MAX_ACTIVITY));
    // As the provider: what may have moved money goes into the vault's log.
    const cents = Math.round(entry.amount * 100);
    if (outcome !== 'failed' && cents > 0) {
      updateVault((v) => ({
        ...v,
        sentOrders: recordSentOrder(v.sentOrders, { at: entry.at, accountNumber: entry.accountNumber, iban: entry.iban, cents, outcome }),
      }));
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
    startWait('transfer', {
      challenge: `${p.instant ? 'Echtzeitüberweisung' : 'Überweisung'} über ${amount.toFixed(2).replace('.', ',')} EUR `
        + `an ${p.recipientName.trim()} (IBAN …${ibanTail}) freigeben`,
      vop,
      order: { amount, name: sepaSanitize(p.recipientName), iban: normIban(p.iban), instant: p.instant },
      onAnswer: (status, answers) => {
        setBusy(false);
        closeWait();
        if (status === 'refused') h.onRefused(answers);
        else h.onUnknown(answers);
      },
      onDone: () => {
        setBusy(false);
        h.onExecuted(p.instant
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

  vaultRef.current = vault;
  vaultStatusRef.current = vaultStatus;
  messagesRef.current = messages;

  const categoryRules = vault?.categoryRules;
  const txCategories = vault?.txCategories;

  const categoryOf = useMemo(() => {
    const own = new Set(ownIbans);
    const memo = new WeakMap<SerializedTransaction, CategoryResult>();
    return (tx: SerializedTransaction): CategoryResult => {
      const hit = memo.get(tx);
      if (hit) return hit;
      let result: CategoryResult;
      try {
        result = categorize(tx, { ownIbans: own, rules: categoryRules, overrides: txCategories, merchantLabel: null });
      } catch {
        result = { id: tx.amount >= 0 ? 'otherIn' : 'other', source: 'auto' };
      }
      memo.set(tx, result);
      return result;
    };
  }, [ownIbans, categoryRules, txCategories]);

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
    if (id === null) {
      updateVault((v) => {
        const overrides = without(v.txCategories, k);
        return overrides === v.txCategories ? v : { ...v, txCategories: overrides };
      });
      return;
    }
    if (!isCategoryId(id)) return;
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

  const closePrintJob = useCallback(() => setPrintJob(null), []);

  return {
    view, meta, popularBanks, logoFiles, bank, sessionId, userId,
    bankChecking, staleBank,
    tanMethods, selectedMethod, mediaChoice, tanMethodError,
    accounts, activeAccount, balances, transactions, pendingCache, pendingInfo, txError, merchants,
    txErrors, balanceErrors, balanceLoading, loadingAllBalances,
    busy, loadingAccount, pendingLoading, deviceRemembered, wait, toasts, printJob,
    range, statementInfo, txByAccount, ownIbans,
    messages, unreadCount, activity,
    vault, vaultStatus,
    privacy, idleMinutes, singleKeyShortcuts,
    logoConsent,
    sessionStartedAt, idleDeadline,
    tab, txFilter, txFocusNonce,
    analysisPeriod, analysisScope,
    transferOpen, transferPrefill, shareOpen, sharePrefill,
    inboxOpen, paletteOpen, shortcutsOpen,
    setView, setBank, connect, chooseTanMethod, clearMediaChoice, selectAccount, loadTransactions,
    cancelConnect,
    loadBalance, loadAllBalances,
    isLoadedForAppliedRange,
    refreshAccount, refreshAfterTransfer, applyRange, loadPending, submitTransfer, confirmVop, abandonVop,
    forgetDevice, logout, stayLoggedIn, toast, dismissToast,
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
