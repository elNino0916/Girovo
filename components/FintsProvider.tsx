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
// encrypted personal-data vault (aliases, templates, categories, budgets,
// notes), the session's copy of the Umsätze kept on this computer, the bank's
// messages and this session's own record of what it sent. None of it talks to
// the bank; all of it is reset by a logout, except the user's preferences.
//
// More than one bank: the first login is the primary one — its vault holds
// the personal data of the whole view — and "Weitere Bank anmelden" adds
// logins beside it, each a session of its own on the server (`links`). Their
// accounts join the one account list, still keyed by account number, and
// every request about an account goes through the session of the login that
// brought it (sessionFor, lib/linked-banks.ts). Keepalive and logout cover
// every session; a linked bank whose session ends alone is marked logged
// out, the rest of the view stays.
//
// Async rule of thumb: every continuation after an `await` first checks that
// the session (and, for the TAN poll, the wait) it was started for is still
// the current one. A logout, an expiry or a cancelled approval can land while
// a request is out, and its answer must then go nowhere.
//
// This file is the hook; the types it hands out, its constants and the pure
// helpers it calls are in provider/model.ts (re-exported here).

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import {
  ApiError, BACK_EVENT, PIN_REFUSED_EVENT, SESSION_EXPIRED_EVENT, get, post, store, type SessionExpiredDetail,
} from '@/lib/client-api';
import { IS_ANDROID } from '@/lib/platform';
import { forgetHello, helloAvailable, helloOn, helloStoreBroken, sealWithHello } from '@/lib/windows-hello-client';
import {
  addSecurityKey as sealWithSecurityKey, forgetSecurityKeys, nameSecurityKey, removeSecurityKey as dropSecurityKey, securityKeyAvailable, securityKeysOf,
  type SecurityKeyInfo,
} from '@/lib/security-key-client';
import { withNoticed, type ContractNotice, type ContractReminder } from '@/lib/contract-watch';
import { keepsNothing, unsafePhone } from '@/lib/device-integrity';
import { msgs, type Messages } from '@/lib/i18n';
import { useLocale, useT } from '@/lib/i18n/react';
import { bankAnswerLines, notAboutPin } from '@/lib/bank-answer';
import { bookingKind, categorize, explainGuess, guessCategory, type CategoryGuess } from '@/lib/categorize';
import { EXAMPLE_MIN, nameSimilarity } from '@/lib/nano-categories';
import { sanitizeBudgets, type Budgets } from '@/lib/budgets';
import { withNote } from '@/lib/notes';
import {
  counterpartyKey, counterpartyName, counterpartyRuleKey, isCategoryId, rawCounterparty, ruleKeyFor, setCustomCategories, txKey,
  type CategoryId, type CategoryResult, type CustomCategoryId,
} from '@/lib/categories';
import {
  categoryValidator, cleanCategoryName, CUSTOM_LIMITS, newCustomId, sanitizeSplit,
  withoutCategory, type SplitPart,
} from '@/lib/splits';
import { isCardPurpose, parseCardAcceptor } from '@/lib/card-purpose';
import { setBrandNames } from './transactions/model';
import { bankAllowed, reminderDue, type PlusStatus } from '@/lib/plus';
import { reviewMoment } from './android/review';
import { parsePurpose } from '@/lib/sepa-purpose';
import {
  bankDay, compactIban, dayKey, fmtDate, fmtMoney, ibanValid, isoDate, repairBankText, toLocalDate, translateType,
  fmtRange,
} from '@/lib/format';
import { getMerchantKey, isBusinessBooking } from '@/lib/merchant-match';
import { asksForBrand } from '@/lib/nano-names';
import { ORDER_UNANSWERED_STATUS } from '@/lib/fints-order';
import { hasOverview, keepAbsentPlaces, liveValue, overviewFigures, sanitizeAccountOrder, type AccountGrouping } from '@/lib/account-overview';
import { localKey } from '@/lib/account-key';
import { keepBalances as foldKeptBalances, recordNetWorth, type KeptBalance, type NetWorthDay } from '@/lib/kept-balances';
import { acceptsBalance, balanceQueue, failureSentence, isDepot, namesList } from '@/lib/balances';
import {
  LINKED_BANK_LIMITS, claimedBefore, forgetLinkedBank, joinQualified, rememberLinkedBank, routeFor, sameLogin,
} from '@/lib/linked-banks';
import {
  EMPTY_HISTORY, deliveredSpan, historyCoverage, mergeIntoHistory, planFetch, sanitizeHistory, savedPeriod, spanAt,
  type HistoryData, type HistoryGetResponse, type HistoryStatus,
} from '@/lib/history';
import {
  dropKeys, keyMoves, keysLeadingTo, moveEntries, movesInVault, pageTies, sharedKeys, showFiled, VAULT_MAX_BYTES,
  type BookingGroup, type KeyMoves, type ShownFiled,
} from '@/lib/booking-keys';
import { afterStatementRead, pendingView, type PendingRead } from '@/lib/pending';
import { sanitizeGoals, type SavingsGoal } from '@/lib/savings-goal';
import { settleRequests, withRequests, type Incoming } from '@/lib/split-requests';
import { recordSentOrder, type SentOrder } from '@/lib/sent-orders';
import { idleLogoutNotice, logoutNotice, unclearNotice, unclearTransfers } from '@/lib/session-log';
import { sepaSanitize } from '@/lib/sepa-text';
import {
  EMPTY_FILTER, EMPTY_VAULT,
  type ActivityEntry, type DashboardTab, type DateRange, type InboxMessage, type SettingsTarget, type ShareAllRequest, type SharePrefill,
  type StatementInfo, type TransferPrefill, type TransferTemplate, type TxFilter, type VaultData,
  type VaultGetResponse, type VaultPutResponse, type VaultStatus,
} from '@/lib/app-types';
import type { AnalysisPeriod, AnalysisScope } from '@/lib/app-types';
import { PAGE_OF, type SettingsPage } from '@/lib/settings-pages';
import type { ManualContract, ManualDay } from '@/lib/manual-contracts';
import type {
  BalanceResponse, BankOrderKind, BankOrdersAnswer, BankOrdersResponse, BankStatementsAnswer, BankStatementsResponse,
  ConnectResponse, DeleteOrderResponse,
  Merchant, MerchantsResponse, MetaResponse, PendingResponse, PortfolioResponse,
  SelectTanResponse, SerializedAccount, SerializedBalance, SerializedBankOrder, SerializedPortfolio, SerializedTanMethod,
  SerializedTransaction, TanPollResponse, TransactionsResponse,
  TransferResponse,
} from '@/lib/fints-types';
import {
  base64ToBytes, bytesToBase64, type AwaitedBooking, type DocGetResponse, type DocResponse, type DocsListResponse,
  type DocsResetResponse,
} from '@/lib/docs';
import { matchAwaiting } from '@/lib/receipts';
import { saveFile, textBlob } from '@/lib/download';
import type { TaxYear } from '@/lib/tax-year';
import { TimeLimitError, withinTime } from '@/lib/time-limit';
import type { BackupSummary, RestoreReport } from '@/lib/backup';
import type { AlertsChange, AlertsView, Watch } from '@/lib/payment-alerts';
import type { PopularBank } from '@/lib/banks';
import { clearAsk } from './insights/ask-thread-store';

import {
  ACTIVITY_EVENTS, anchorOf, categoryNameTaken, closingBalanceOf, CONFIRMED_LINGER_MS, countsAsActivity,
  DEADLINE_PUBLISH_MS, DEFAULT_IDLE_MINUTES, DEFAULT_RANGE_PRESET, defaultRange, delay, deliveredEnd, dropSession,
  IDLE_NOTICE_MS, IDLE_WAIT, inboxOf, isIdleChoice, isOrderWait, KEEPALIVE_EVERY_MS, listsOf,
  LOGOUT_FLUSH_TIMEOUT_MS, MAX_ACTIVITY, MAX_ALIAS, MAX_TEMPLATES, MAX_TOASTS, newAttemptId, newId, normalizeRange,
  normalizeVault, orderWaitKind, placesOrder, rangeForLoad, rangeKey, SECOND_APPROVAL_MS, sentOrderOf, shownWait,
  typedAmount, VAULT_SAVE_DELAY_MS, waitHoldsSession, waitSubject, WARNING_WINDOW_MS, withLinkedBanks, without,
  written, type AccountFetch, type AddBankState, type BankEntry, type BankOrdersInfo, type BankSearchHit,
  type ChosenBank, type IdleMinutes, type ImportInfo, type KeptAddBank, type KeptLoadError, type KeptText,
  type KeptWait, type LinkedLogin, type ListedDoc, type LoadError, type LoadOutcome, type LoadSettled,
  type LogoConsent, type LogoutReason, type OrderDeletion, type OwnText, type PendingInfo, type PrintJob,
  type RangeAnchor, type StatementFetch, type TanGate, type Toast, type ToastAction, type ToastTone,
  type TransferHandlers, type TransferPayload, type View, type WaitCallbacks, type WaitKind, type WaitOrder,
  type WaitState,
} from './provider/model';

// The context's vocabulary lives in ./provider/model; screens import it from here.
export {
  countsAsActivity, IDLE_MINUTE_CHOICES, IDLE_NEUTRAL_ATTR, isOrderWait, isOrderWaitKind, orderWaitKind, placesOrder,
  waitHoldsSession, waitSubject,
} from './provider/model';
export type {
  AddBankState, BankEntry, BankOrdersInfo, BankSearchHit, ChosenBank, IdleMinutes, ImportInfo, LinkedLogin,
  ListedDoc, LoadError, LoadOutcome, LoadSettled, LogoConsent, LogoutReason, OrderDeletion, OrderWaitKind,
  PendingInfo, PrintJob, StatementFetch, TanEntry, Toast, ToastAction, ToastTone, TransferHandlers, TransferPayload,
  View, WaitKind, WaitOrder, WaitState,
} from './provider/model';

// ---------------------------------------------------------------------------

function useFintsState() {
  // The texts kept unwritten below are written in this language when shown;
  // `locale` relabels what depends on it (accountLabel).
  const texts = useT();
  const { locale } = useLocale();

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
  // Wrapped in an object: a function as the state itself would be taken for an updater.
  const [tanMethodErrorKept, setTanMethodError] = useState<{ text: KeptText } | null>(null);

  const [accounts, setAccounts] = useState<SerializedAccount[]>([]);
  const [activeAccount, setActiveAccount] = useState<SerializedAccount | null>(null);
  /**
   * The Übersicht's two levels once there is more than one account (issue
   * #19, components/overview/AccountsOverview.tsx): every account (false), or
   * the active one's page (true). The login starts on every account; choosing
   * one anywhere — the overview, the search, a deep link into its Umsätze —
   * opens its page.
   */
  const [accountOpen, setAccountOpen] = useState(false);
  /** Zahlungen's level below (6.0): the bank's own orders on a page of their own (components/BankOrders.tsx). */
  const [ordersOpen, setOrdersOpen] = useState(false);
  /** Whether every account stands before the active one's page (several accounts or banks): set below `banks`. */
  const overviewShownRef = useRef(false);
  const [balances, setBalances] = useState<Record<string, SerializedBalance>>({});
  /** When each balance above was read (ms): the overview's "Stand" is its oldest. */
  const [balanceAt, setBalanceAt] = useState<Record<string, number>>({});
  /**
   * Per account, the bank's last answer as it came, with what it was asked
   * for — what the lists are made of (`txCache` and `statementInfo` below,
   * together with the kept Umsätze).
   */
  const [fetches, setFetches] = useState<Record<string, AccountFetch>>({});
  /** Vorgemerkte as the bank listed them on request (HKVMK), with the moment it did (see `pendingCache` below). */
  const [pendingFetched, setPendingFetched] = useState<Record<string, PendingRead<SerializedTransaction>>>({});
  /** Vorgemerkte the bank sent beside the Umsätze of a statement read — the only way Sparkassen send them. */
  const [notedFetched, setNotedFetched] = useState<Record<string, PendingRead<SerializedTransaction>>>({});
  /** This login's Umsätze kept on this computer (lib/history.ts): the session's copy, while the vault says keep. */
  const [history, setHistory] = useState<HistoryData | null>(null);
  const [historyStatus, setHistoryStatus] = useState<HistoryStatus>('off');
  /** "Alles Gespeicherte": each account's list reaches back as far as what is kept for it (savedPeriod). */
  const [savedRange, setSavedRange] = useState(false);
  // What every view reads: the bank's answers, with the kept Umsätze before
  // them where they serve (listsOf) — never before they are loaded.
  const keptHistory = historyStatus === 'ready' ? history : null;
  const { txCache, statementInfo } = useMemo(() => listsOf(fetches, keptHistory), [fetches, keptHistory]);
  /** Per account: why its last statement load failed (see LoadError). */
  const [txErrors, setTxErrors] = useState<Record<string, LoadError>>({});
  /** Per account: why its last balance enquiry failed (shown as `balanceErrors`). */
  const [balanceErrorsKept, setBalanceErrors] = useState<Record<string, KeptLoadError>>({});
  /** The account whose balance alone is being asked for (loadBalance) — not a statement load. */
  const [balanceLoading, setBalanceLoading] = useState<string | null>(null);
  /** "Alle Salden abrufen" is working through the accounts. */
  const [loadingAllBalances, setLoadingAllBalances] = useState(false);
  /** Per Depot: its holdings, as the last read found them. */
  const [portfolios, setPortfolios] = useState<Record<string, SerializedPortfolio>>({});
  /** Per Depot: why its last read failed (shown as `portfolioErrors`). */
  const [portfolioErrorsKept, setPortfolioErrors] = useState<Record<string, KeptLoadError>>({});
  /** The Depot whose holdings are being read. */
  const [portfolioLoading, setPortfolioLoading] = useState<string | null>(null);
  const portfoliosRef = useRef(portfolios);
  portfoliosRef.current = portfolios;
  /** The documents kept on this machine, of every login in the view (lib/doc-store.ts). */
  const [docs, setDocs] = useState<ListedDoc[]>([]);
  const docsRef = useRef<ListedDoc[]>([]);
  const docsGenRef = useRef(0);
  /** A login's store does not open with its PIN: what it fetches is held for the session only. */
  const [docsLocked, setDocsLocked] = useState(false);
  // Locked, and the bank has taken that login's PIN: "Neu beginnen" may be offered (lib/doc-store.ts resetDocs).
  const [docsResettable, setDocsResettable] = useState(false);
  /** The account whose Kontoauszüge are being fetched from the bank. */
  const [bankStatementsLoading, setBankStatementsLoading] = useState<string | null>(null);
  /** Per account: how its last fetch of the bank's Kontoauszüge went. */
  const [statementFetches, setStatementFetches] = useState<Record<string, StatementFetch>>({});

  /** Counterparty name → company, or null once we know there's no match. */
  const [merchants, setMerchants] = useState<Record<string, Merchant | null>>({});
  // The on-device model's category guesses (lib/category-model.ts), by counterpartyKey.
  const [modelGuesses, setModelGuesses] = useState<Record<string, CategoryId>>({});
  const guessesAsked = useRef(new Set<string>());
  // Gemini Nano's brand per counterparty (lib/nano-names.ts), Android only:
  // the lists' names. Kept in a ref too, for the logo lookup.
  const [brandNames, setBrandNamesState] = useState<ReadonlyMap<string, string>>(() => new Map());
  const brandNamesRef = useRef(brandNames);
  brandNamesRef.current = brandNames;
  const namesAsked = useRef(new Set<string>());
  // Registered for every row read in this render (components/transactions/model.ts).
  useMemo(() => setBrandNames(brandNames), [brandNames]);

  const [busy, setBusyState] = useState(false);
  const [loadingAccount, setLoadingAccount] = useState<string | null>(null);
  const [pendingLoading, setPendingLoading] = useState<string | null>(null);
  /** Per account: why its last Vorgemerkt fetch failed — the panel says so, not only a toast. */
  const [pendingErrors, setPendingErrors] = useState<Record<string, LoadError>>({});
  /** The bank's Daueraufträge and terminierten Überweisungen, per account and kind, as last read (never on its own). */
  const [bankOrders, setBankOrders] = useState<Record<string, Partial<Record<BankOrderKind, BankOrdersInfo>>>>({});
  /** The read under way, if any. */
  const [bankOrdersLoading, setBankOrdersLoading] = useState<{ accountNumber: string; kind: BankOrderKind } | null>(null);
  /** Per account and kind: why its last read failed. */
  const [bankOrderErrors, setBankOrderErrors] = useState<Record<string, Partial<Record<BankOrderKind, LoadError>>>>({});
  /** What became of the deletions asked for in this session, by the order's handle. */
  const [orderDeletions, setOrderDeletions] = useState<Record<string, OrderDeletion>>({});
  const [deviceRemembered, setDeviceRemembered] = useState(false);

  const [keptWait, setWait] = useState<KeptWait>(IDLE_WAIT);
  const wait = useMemo(() => shownWait(keptWait, texts), [keptWait, texts]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [printJob, setPrintJob] = useState<PrintJob | null>(null);

  // Preferences — the only state a logout keeps.
  const [privacy, setPrivacy] = useState(false);
  const [idleMinutes, setIdleMinutesState] = useState<IdleMinutes>(DEFAULT_IDLE_MINUTES);
  /** Shortcuts on one unmodified key (/, ?, N, B, G, 1–9). On unless turned off. */
  const [singleKeyShortcuts, setSingleKeyShortcutsState] = useState(true);
  /** "Salden beim Anmelden abrufen" (Einstellungen): off unless the user switched it on. */
  const [balancesAtLogin, setBalancesAtLoginState] = useState(false);
  /** "Umsätze beim Anmelden abrufen" (Einstellungen): on unless the user switched it off. */
  const [bookingsAtLogin, setBookingsAtLoginState] = useState(true);
  /** The session whose login read (the first account's Umsätze) has settled: the others' may follow. */
  const [loginReadSid, setLoginReadSid] = useState<string | null>(null);
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
  // Girovo Plus (lib/plus.ts): 'free' wherever Plus does not apply — and on
  // Android until the bridge has answered, so nothing flashes locked.
  const [plus, setPlus] = useState<PlusStatus>({ state: 'free', offers: [], icon: 'standard' });
  const plusRef = useRef(plus);
  plusRef.current = plus;
  const [plusOpen, setPlusOpen] = useState(false);
  const [sharePrefill, setSharePrefill] = useState<SharePrefill | null>(null);
  const [inboxOpen, setInboxOpenState] = useState(false);
  const [paletteOpen, setPaletteOpenState] = useState(false);
  const [shortcutsOpen, setShortcutsOpenState] = useState(false);
  // The last session ended by itself (the idle limit, an expired session):
  // the login screen then asks for Windows Hello only from its button, never
  // by itself — the user may be in the middle of something else.
  const [autoLoggedOut, setAutoLoggedOut] = useState(false);
  /** "Trotzdem abmelden?" — asked only while the session log holds a transfer whose status is unclear. */
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  /** "Gerät vergessen?" — from the Sitzung panel or the "Gerät gemerkt" toast; one confirmation for both. */
  const [forgetDeviceOpen, setForgetDeviceOpenState] = useState(false);

  // The applied statement range — what every load asks the bank for.
  const [range, setRange] = useState<DateRange>(() => defaultRange());

  const [messages, setMessages] = useState<InboxMessage[]>([]);
  /** Whether this login asked the bank for its messages: a remembered device skips the sync that brings them. */
  const [messagesAsked, setMessagesAsked] = useState(true);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);

  const [vault, setVault] = useState<VaultData | null>(null);
  const [vaultStatus, setVaultStatus] = useState<VaultStatus>('idle');

  // More banks in the view (lib/linked-banks.ts): the logins beside the
  // primary one, the "Weitere Bank anmelden" flow, and what the bank list
  // says about each remembered bank (its logo, its town).
  const [links, setLinks] = useState<LinkedLogin[]>([]);
  const [addBankKept, setAddBankState] = useState<KeptAddBank | null>(null);
  const [bankInfo, setBankInfo] = useState<Record<string, ChosenBank>>({});
  // The further banks the first login opened — on Android with its
  // fingerprint, on the desktop with its PIN (lib/linked-unlock.ts) — still to
  // log in one after another, and the ones whose PIN the user chose not to
  // keep this session ("Nicht jetzt", or the desktop's offer left alone).
  const openedLinkedRef = useRef<GirovoSealedLogin[]>([]);
  const sealDeclinedRef = useRef(new Set<string>());
  // Bumped when the desktop's further banks arrive after the Übersicht is up:
  // the chain that logs them in reads a ref, which wakes nothing.
  const [openedLinkedTick, setOpenedLinkedTick] = useState(0);
  // The desktop: whether the further banks log in with the first login
  // ("Weitere Banken mit anmelden") — null until the login says, and where
  // the shell cannot keep their PINs — and the dialog that turns it on.
  const [linkedUnlock, setLinkedUnlockState] = useState<boolean | null>(null);
  const linkedUnlockRef = useRef<boolean | null>(null);
  const [linkedUnlockAsk, setLinkedUnlockAsk] = useState(false);
  // A remembered device's login, whose kept PINs wait for the bank's word on
  // its PIN (afterAccountsReady) — and whether this session offered the switch.
  const linkedAfterReadRef = useRef<string | null>(null);
  const linkedOfferedRef = useRef(false);
  const setLinkedUnlockBoth = useCallback((on: boolean | null) => {
    linkedUnlockRef.current = on;
    setLinkedUnlockState(on);
  }, []);
  // The desktop: whether the first login opens with Windows Hello
  // (lib/windows-hello.ts) — null until the login says, and where Windows
  // has none — and the login this session came in with: its BLZ and name,
  // and whether its PIN came from behind Windows Hello.
  const [windowsHello, setWindowsHelloState] = useState<boolean | null>(null);
  const windowsHelloRef = useRef<boolean | null>(null);
  const helloLoginRef = useRef<{ blz: string; userId: string; bank: string; hello: boolean } | null>(null);
  const setWindowsHelloBoth = useCallback((on: boolean | null) => {
    windowsHelloRef.current = on;
    setWindowsHelloState(on);
  }, []);
  // The desktop: this login's security keys (lib/security-key.ts), null where Windows can't use one.
  const [securityKeys, setSecurityKeysState] = useState<SecurityKeyInfo[] | null>(null);
  const securityKeysRef = useRef<SecurityKeyInfo[] | null>(null);
  const setSecurityKeysBoth = useCallback((keys: SecurityKeyInfo[] | null) => {
    securityKeysRef.current = keys;
    setSecurityKeysState(keys);
  }, []);
  // "Neue Umsätze melden" (lib/background-check.ts): whether it is on — null
  // until the login says, and where the shell cannot keep the PINs — and the
  // dialog that turns it on.
  const [backgroundChecks, setBackgroundState] = useState<boolean | null>(null);
  const backgroundRef = useRef<boolean | null>(null);
  const [backgroundAsk, setBackgroundAsk] = useState(false);
  const setBackgroundBoth = useCallback((on: boolean | null) => {
    backgroundRef.current = on;
    setBackgroundState(on);
  }, []);
  // Sync between devices (lib/sync.ts): how this login's sync stands — null
  // until its vault is loaded — and its sheet. While a round runs, edits are
  // shown at once, kept for the merged vault and saved after it.
  const [sync, setSyncState] = useState<SyncInfo | null>(null);
  const syncRef = useRef<SyncInfo | null>(null);
  const [syncOpen, setSyncOpen] = useState(false);
  const syncQueueRef = useRef<Array<(v: VaultData) => VaultData> | null>(null);
  // The round under way, if any: a second waits for none, a save or a wipe waits for it.
  const syncRunRef = useRef<Promise<void> | null>(null);
  // How many of the other devices' entries had no room here when that was last said: said once, not every round.
  const syncFullRef = useRef(0);
  const flushVaultRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const syncRoundRef = useRef<(sid: string, quiet: boolean) => Promise<void>>(() => Promise.resolve());
  // Android: the home screen widget was cleared ("Gerät vergessen", the wiped
  // data) — it gets no figure again until the next login.
  const widgetClearedRef = useRef(false);
  const setSyncBoth = useCallback((info: SyncInfo | null) => {
    syncRef.current = info;
    setSyncState(info);
  }, []);

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
  /** Written together with `fetches` (setFetchesBoth): a load reads the last answer within the same tick. */
  const fetchesRef = useRef(fetches);
  const historyRef = useRef<HistoryData | null>(null);
  const historyStatusRef = useRef<HistoryStatus>('off');
  /** Only the latest load of the kept Umsätze may land. */
  const historyLoadGenRef = useRef(0);
  const savedRangeRef = useRef(false);
  /**
   * The user picked a period since the login. Until then the lists reach as
   * far back as what is kept, once that has arrived (adoptHistory) — after it,
   * the user's choice stands.
   */
  const rangeChosenRef = useRef(false);
  const metaRef = useRef<MetaResponse | null>(null);
  const waitRef = useRef<WaitState>(wait);
  /** Names already sent for logo lookup — each is attempted once per session. */
  const merchantsAsked = useRef<Set<string>>(new Set());
  const logoConsentRef = useRef<LogoConsent>('unasked');
  /** The Vorgemerkt lists, for the logo lookup that catches up after a yes. */
  const pendingFetchedRef = useRef(pendingFetched);
  pendingFetchedRef.current = pendingFetched;
  const notedFetchedRef = useRef(notedFetched);
  notedFetchedRef.current = notedFetched;
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
  /** Logs out one linked bank whose session the server no longer knows (endLink). */
  const endLinkRef = useRef<(sid: string) => void>(() => {});

  /** The linked logins, written together with their state (setLinksBoth): routing reads them after an await. */
  const linksRef = useRef<LinkedLogin[]>([]);
  const addBankRef = useRef<KeptAddBank | null>(null);
  /** The add flow holds `busy` (its login is being asked, or approved): closing it lets go. */
  const flowBusyRef = useRef(false);
  /** The primary login's bank and login name, for the same-login check of a further one. */
  const bankRef = useRef<ChosenBank | null>(null);
  const userIdRef = useRef('');
  /** The session the approval on screen belongs to: polled, and told when it is called off. */
  const waitSidRef = useRef<string | null>(null);
  /** The session the order in flight went to — a Namensabgleich is confirmed or dropped there. */
  const transferSidRef = useRef<string | null>(null);
  /** BLZs already looked up for a remembered bank. */
  const bankInfoAsked = useRef(new Set<string>());

  sessionRef.current = sessionId;
  bankRef.current = bank;
  userIdRef.current = userId;
  accountsRef.current = accounts;
  activeAccountRef.current = activeAccount;
  balancesRef.current = balances;
  txCacheRef.current = txCache;
  fetchesRef.current = fetches;
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

  const setLinksBoth = useCallback((list: LinkedLogin[]) => {
    linksRef.current = list;
    setLinks(list);
  }, []);

  const setAddBankBoth = useCallback((next: KeptAddBank | null) => {
    addBankRef.current = next;
    setAddBankState(next);
  }, []);

  // ---- routing ------------------------------------------------------------
  // Every request about an account goes through the session of the login
  // that brought the account; the primary session is never a stand-in for a
  // linked bank's (lib/linked-banks.ts). The checks after an await stay on
  // the primary session (isCurrent): it is the dashboard's, and a logout
  // ends every login at once.

  /** The session for this account — null for one whose linked login has ended, which is then not asked at all. */
  const sessionFor = useCallback(
    (accountNumber: string) => routeFor(accountNumber, sessionRef.current, linksRef.current),
    [],
  );

  /** The linked login an account belongs to; null for the primary's. */
  const linkOf = useCallback(
    (accountNumber: string | null | undefined) =>
      (accountNumber ? linksRef.current.find((l) => l.accountNumbers.includes(accountNumber)) ?? null : null),
    [],
  );

  /** Why an account of a linked login that has ended is not read, in the language on screen when shown. */
  const loggedOutText = useCallback((accountNumber: string): OwnText => {
    const name = linkOf(accountNumber)?.bank.name ?? '';
    return (m) => m.banks.loggedOutRead(name);
  }, [linkOf]);

  /** The bank an approval on `sid` comes from — named only once the view holds more than one. */
  const waitBankFor = useCallback((sid: string | null): WaitState['bank'] => {
    if (!linksRef.current.length) return null;
    const b = linksRef.current.find((l) => l.sessionId === sid)?.bank ?? (sid === sessionRef.current ? bankRef.current : null);
    return b ? { name: b.name, brand: b.brand } : null;
  }, []);

  const setFetchesBoth = useCallback((next: Record<string, AccountFetch>) => {
    fetchesRef.current = next;
    setFetches(next);
  }, []);

  const setHistoryBoth = useCallback((data: HistoryData | null) => {
    historyRef.current = data;
    setHistory(data);
  }, []);

  const setHistoryStatusBoth = useCallback((s: HistoryStatus) => {
    historyStatusRef.current = s;
    setHistoryStatus(s);
  }, []);

  const setSavedRangeBoth = useCallback((on: boolean) => {
    savedRangeRef.current = on;
    setSavedRange(on);
  }, []);

  /** The kept Umsätze a load may plan with: only once they are loaded and readable. */
  const keptOf = useCallback(() => (historyStatusRef.current === 'ready' ? historyRef.current : null), []);

  // ---- toasts -------------------------------------------------------------
  // How long one stays is decided in Toasts.tsx (lib/toast-time.ts): `ms` is
  // the least the caller asks for, and reading time or an action lengthen it.
  const toast = useCallback((message: string, tone: ToastTone = 'info', ms?: number, action?: ToastAction): number => {
    const id = ++toastId.current;
    // Something failed: Google Play's rating card is not asked for right after it.
    if (tone === 'error') reviewMoment('trouble');
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
    if (store.get('fints.balancesAtLogin') === '1') setBalancesAtLoginState(true);
    if (store.get('fints.bookingsAtLogin') === '0') setBookingsAtLoginState(false);
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
   * The span a load of `account` shows when it follows the applied range: the
   * range itself — or, with "Alles Gespeicherte", everything kept for that
   * account that the bank's free window joins (savedPeriod), and the default
   * ninety days where nothing older is kept.
   */
  const spanFor = useCallback((account: SerializedAccount): DateRange => {
    const applied = resolveRange();
    if (!savedRangeRef.current) return applied;
    return savedPeriod(keptOf()?.accounts[account.accountNumber]?.coverage, isoDate(new Date())) ?? defaultRange();
  }, [resolveRange, keptOf]);

  /**
   * Whether switching to this account is answered from the cache — its
   * bookings are loaded for the very range a load would ask for now (after
   * midnight too) — or would ask the bank again, perhaps for a TAN. Read at
   * the moment of a click; nothing is applied.
   */
  const isLoadedForAppliedRange = useCallback((accountNumber: string): boolean => {
    const span = savedRangeRef.current
      ? savedPeriod(keptOf()?.accounts[accountNumber]?.coverage, isoDate(new Date())) ?? defaultRange()
      : rangeForLoad(rangeRef.current, rangeAnchorRef.current);
    return txCacheRef.current[accountNumber]?.key === rangeKey(span);
  }, [keptOf]);

  // ---- approval: in the bank's app, or a typed TAN ------------------------
  const stopTimers = useCallback(() => {
    if (pollTimer.current) { clearTimeout(pollTimer.current); pollTimer.current = null; }
  }, []);

  /** Sends a typed TAN for the approval on screen; null while none is waited for. */
  const tanSubmitRef = useRef<((tan: string) => Promise<void>) | null>(null);
  /** matchReceipts, for the statement reads defined before it. */
  const matchReceiptsRef = useRef<(accountNumber: string, txs: SerializedTransaction[]) => Promise<void>>(async () => {});

  /**
   * Waits for an approval the bank asked for. In the bank's app (decoupled),
   * /api/tan-poll is asked at the pace the method's HITANS sets until the
   * answer is in; with a typed TAN nothing is asked until the user sends one
   * (submitTan). Either answer is read the same way.
   */
  const startApproval = useCallback((
    method: SerializedTanMethod | null,
    data: TanGate,
    cbs: WaitCallbacks,
    opts: {
      kind?: WaitKind;
      /** What the user confirms, as the object of "bestätige …": "den Abruf der Umsätze von …". */
      subject?: OwnText;
      order?: WaitOrder | null;
      /** The session the approval belongs to (sessionFor); the primary one when left out. */
      sessionId?: string | null;
      /** Which bank asks, when it is not one of the view's logins yet (a bank being added). */
      bank?: WaitState['bank'];
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
    const sid = opts.sessionId !== undefined ? opts.sessionId : sessionRef.current;
    waitSidRef.current = sid;
    waitCbRef.current = cbs;
    const subject: OwnText = opts.subject ?? ((m) => waitSubject(m, kind));
    // The server says per approval whether the TAN is typed; the method, where it did not.
    const typed = data.decoupled === false || (data.decoupled === undefined && !!method && !method.isDecoupled);
    setWait({
      open: true,
      kind,
      // The overlay names each kind of approval itself (TanWaitOverlay.tsx).
      title: null,
      text: (m) => (typed
        ? m.provider.wait.typeTan(subject(m))
        : method?.isDecoupled
          ? m.provider.wait.openApp(method.name, subject(m))
          : m.provider.wait.confirmInApp(subject(m))),
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
      note: second ? (m) => m.provider.wait.secondApproval : null,
      bank: opts.bank !== undefined ? opts.bank : waitBankFor(sid),
      method,
      entry: typed
        ? {
            image: data.tanImage ?? null,
            flicker: data.flicker ?? null,
            maxLength: method?.tanMaxLength ?? null,
            numeric: method?.tanNumeric ?? null,
            sending: false,
            again: false,
          }
        : null,
    });

    const interval = Math.max(1500, (method?.decoupled?.waitBetween || 2) * 1000);
    const firstDelay = Math.max(1000, (method?.decoupled?.waitBeforeFirst || 1) * 1000);

    /** The bank's answer to a status request or to a typed TAN. */
    const answer = (r: TanPollResponse) => {
      if (r.status === 'pending') {
        if (typed) {
          // The bank wants another TAN, perhaps from a new challenge and graphic.
          const again = r.again;
          setWait((w) => ({
            ...w,
            challenge: again ? again.tanChallenge : w.challenge,
            entry: w.entry && {
              ...w.entry,
              sending: false,
              again: true,
              ...(again ? { image: again.tanImage, flicker: again.flicker } : {}),
            },
          }));
          return;
        }
        pollTimer.current = setTimeout(poll, interval);
        return;
      }
      if (r.status === 'dialog_ended') {
        stopTimers();
        tanSubmitRef.current = null;
        const handler = waitCbRef.current.onDialogEnded;
        if (handler) { handler(r); return; }
        setWait((w) => ({
          ...w,
          phase: 'ended',
          settledAt: Date.now(),
          title: (m) => m.provider.wait.endedTitle,
          // The bank's timeout, not the user's: no "zügig" (critique auth #6).
          text: (m) => m.provider.wait.endedText,
          canRetry: !!waitCbRef.current.retry,
          entry: w.entry && { ...w.entry, sending: false },
        }));
        return;
      }
      if (r.status === 'refused' || r.status === 'unclear') {
        // The bank's own answer — never mistaken for a lost connection.
        stopTimers();
        tanSubmitRef.current = null;
        const handler = waitCbRef.current.onAnswer;
        if (handler) { handler(r.status, r.bankAnswers); return; }
        setWait((w) => ({
          ...w,
          phase: r.status === 'refused' ? 'refused' : 'error',
          settledAt: Date.now(),
          error: r.bankAnswers || ((m: Messages) => m.provider.wait.notConfirmed),
          canRetry: !!waitCbRef.current.retry,
          entry: w.entry && { ...w.entry, sending: false },
        }));
        return;
      }
      stopTimers();
      tanSubmitRef.current = null;
      lastConfirmedRef.current = { kind, gen, at: Date.now() };
      setWait((w) => ({ ...w, phase: 'confirmed', settledAt: Date.now(), entry: w.entry && { ...w.entry, sending: false } }));
      // Only closes *this* wait: onDone may already have started the next
      // one (a statement that needs its own approval right after login).
      setTimeout(() => { if (gen === waitGenRef.current) setWait(IDLE_WAIT); }, CONFIRMED_LINGER_MS);
      waitCbRef.current.onDone?.(r);
    };

    // A 401 has already logged out (and bumped the generation) by now.
    // Anything else — the bank unreachable, "Kein offener Vorgang" — says
    // nothing about the approval: the overlay calls it unverifiable. For an
    // order the reason's own advice ("try again", "restart Girovo") could
    // read as "send it again", so an order says only that its fate is open —
    // closing then leads to "Status unklar".
    const unverifiable = (err: unknown) => {
      if (gen !== waitGenRef.current) return;
      stopTimers();
      tanSubmitRef.current = null;
      setWait((w) => ({
        ...w,
        phase: 'error',
        settledAt: Date.now(),
        error: isOrderWait(kind) ? ((m: Messages) => m.provider.wait.unverifiable) : (err as Error).message,
        canRetry: !!waitCbRef.current.retry,
        entry: w.entry && { ...w.entry, sending: false },
      }));
    };

    const poll = async () => {
      pollTimer.current = null;
      if (gen !== waitGenRef.current) return;
      try {
        const r = await post<TanPollResponse>('/api/tan-poll', { sessionId: sid });
        // Cancelled, superseded or logged out while the request was out.
        if (gen !== waitGenRef.current) return;
        answer(r);
      } catch (err) {
        unverifiable(err);
      }
    };

    const submit = async (tan: string) => {
      if (gen !== waitGenRef.current) return;
      // One TAN at a time: a second press while the first is out does nothing.
      tanSubmitRef.current = null;
      setWait((w) => ({ ...w, entry: w.entry && { ...w.entry, sending: true } }));
      try {
        const r = await post<TanPollResponse>('/api/tan-poll', { sessionId: sid, tan });
        if (gen !== waitGenRef.current) return;
        if (r.status === 'pending') tanSubmitRef.current = submit;
        answer(r);
      } catch (err) {
        unverifiable(err);
      }
    };

    if (typed) {
      tanSubmitRef.current = submit;
    } else {
      tanSubmitRef.current = null;
      pollTimer.current = setTimeout(poll, firstDelay);
    }
  }, [stopTimers, waitBankFor]);

  /** The TAN the user typed, for the approval on screen (TanWaitOverlay). */
  const submitTan = useCallback((tan: string) => {
    void tanSubmitRef.current?.(tan);
  }, []);

  const closeWait = useCallback(() => {
    waitGenRef.current++;
    stopTimers();
    tanSubmitRef.current = null;
    setWait(IDLE_WAIT);
  }, [stopTimers]);

  const retryWait = useCallback(() => {
    const retry = waitCbRef.current.retry;
    closeWait();
    retry?.();
  }, [closeWait]);

  const cancelWait = useCallback(async () => {
    const { onCancelled } = waitCbRef.current;
    // The login whose request this was — a linked bank's, perhaps.
    const sid = waitSidRef.current;
    waitCbRef.current = {};
    closeWait();
    // Cancelling the very first approval (the login sync) leaves nothing to
    // show — go back to the login screen rather than an empty dashboard. As a
    // logout, so the half-open session (and the PIN it holds in the server's
    // memory) is dropped now rather than by the 30-minute sweep. A bank being
    // added says what to do in its own onCancelled.
    if (!accountsRef.current.length && sid === sessionRef.current) {
      void logoutRef.current('cancelled');
      return;
    }
    setBusy(false);
    setLoadingAccount(null);
    setPendingLoading(null);
    setBankOrdersLoading(null);
    onCancelled?.();
    try { await post('/api/cancel-pending', { sessionId: sid }); } catch { /* best effort */ }
  }, [closeWait, setBusy]);

  /**
   * The method a mid-session approval should be attributed to — and polled
   * at the pace of: its HITANS timing says how long to wait before the first
   * status request and between them, and the bank counts the requests.
   * Read from refs, because the callers are often closures from an earlier
   * render (the first statement right after the login).
   */
  const approvalMethod = useCallback(() => {
    // The login's own. Without one, an app-approval method as the likeliest:
    // whether a TAN is typed, the server says with each approval anyway.
    return selectedMethodRef.current || tanMethodsRef.current.find((m) => m.isDecoupled) || null;
  }, []);

  /** The method of the login that holds `accountNumber`: a linked bank's own, else approvalMethod. */
  const methodFor = useCallback((accountNumber: string | null | undefined) => {
    const link = linkOf(accountNumber);
    return link ? link.method : approvalMethod();
  }, [linkOf, approvalMethod]);

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
        // Nano's brand finds the logo a terminal's descriptor hides ("PAYPAL *EBAY").
        const name = brandNamesRef.current.get(counterpartyKey(t)) ?? counterpartyName(t);
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

  // ---- kept Umsätze -------------------------------------------------------
  // "Umsätze auf diesem Rechner behalten" (lib/history.ts). The server keeps
  // what the bank answers, sealed with the PIN, whenever the vault says so;
  // the browser reads the kept Umsätze once after the login (or after the
  // switch went on) and from then on takes each answer into its own copy the
  // same way (loadTransactions). Nothing here ever sends a booking anywhere.

  /**
   * "Alles Gespeicherte": every account's list reaches back as far as what is
   * kept for it. Lists whose last bank answer already serves that span show
   * it at once — no bank call; the active account's span becomes the applied
   * range the screen names.
   */
  const enterSavedRange = useCallback(() => {
    setSavedRangeBoth(true);
    const today = isoDate(new Date());
    const kept = keptOf();
    const next = { ...fetchesRef.current };
    let changed = false;
    for (const [acct, f] of Object.entries(next)) {
      const coverage = kept?.accounts[acct]?.coverage;
      const want = savedPeriod(coverage, today) ?? defaultRange();
      if (f.fetchFrom == null || want.to !== f.span.to || rangeKey(want) === rangeKey(f.span)) continue;
      if (planFetch(want, coverage, today)?.from !== f.fetchFrom) continue;
      next[acct] = { ...f, span: want };
      changed = true;
    }
    if (changed) setFetchesBoth(next);
    const active = activeAccountRef.current;
    if (active) setAppliedRange(spanFor(active));
  }, [setSavedRangeBoth, keptOf, setFetchesBoth, setAppliedRange, spanFor]);

  /** The server's answer to `get` or `reset`, taken in. */
  const adoptHistory = useCallback((res: HistoryGetResponse) => {
    if (res.status !== 'ready') {
      // Another PIN sealed it: nothing is kept until the user starts over.
      setHistoryBoth(null);
      setHistoryStatusBoth('error');
      return;
    }
    const today = isoDate(new Date());
    setHistoryBoth(res.data == null ? EMPTY_HISTORY : sanitizeHistory(res.data, today) ?? EMPTY_HISTORY);
    setHistoryStatusBoth('ready');
    // Unless the user picked a period since the login, the lists reach as far
    // back as what is kept — Analyse and Verträge see it without being asked.
    if (!rangeChosenRef.current) enterSavedRange();
  }, [setHistoryBoth, setHistoryStatusBoth, enterSavedRange]);

  /**
   * A further bank's kept Umsätze, joined to the session's copy. Each login
   * keeps its own file, sealed with its own PIN; the server keeps a further
   * bank's answers when the primary login's vault says so (/api/history
   * "follow", sent when the bank joins the view). Its accounts are its own —
   * an account number is never shown twice (lib/linked-banks.ts). A file of
   * its that does not open is left as it is: that bank's lists go on with
   * its answers alone.
   */
  const loadLinkedHistory = useCallback(async (link: LinkedLogin) => {
    const sid = sessionRef.current;
    const gen = historyLoadGenRef.current;
    if (!sid || !link.sessionId || historyStatusRef.current !== 'ready') return;
    try {
      const res = await post<HistoryGetResponse>('/api/history', { sessionId: link.sessionId, op: 'get' });
      if (!isCurrent(sid) || gen !== historyLoadGenRef.current || historyStatusRef.current !== 'ready') return;
      if (res.status !== 'ready' || !res.data) return;
      const theirs = sanitizeHistory(res.data, isoDate(new Date()));
      const base = historyRef.current;
      if (!theirs || !base) return;
      const accounts = { ...base.accounts };
      let changed = false;
      for (const n of link.accountNumbers) {
        if (!theirs.accounts[n]) continue;
        accounts[n] = theirs.accounts[n];
        changed = true;
      }
      if (!changed) return;
      setHistoryBoth({ ...base, accounts });
      if (!rangeChosenRef.current) enterSavedRange();
    } catch { /* best effort, as above */ }
  }, [isCurrent, setHistoryBoth, enterSavedRange]);

  const loadHistory = useCallback(async (sid: string | null) => {
    if (!sid) return;
    const gen = ++historyLoadGenRef.current;
    const stale = () => !isCurrent(sid) || gen !== historyLoadGenRef.current;
    setHistoryStatusBoth('loading');
    try {
      const res = await post<HistoryGetResponse>('/api/history', { sessionId: sid, op: 'get' });
      if (stale()) return;
      adoptHistory(res);
      // Then every further bank logged in beside it, one after the other.
      for (const link of linksRef.current) {
        if (stale()) return;
        await loadLinkedHistory(link);
      }
    } catch {
      if (stale()) return;
      // The session goes on with the bank's answers alone.
      setHistoryBoth(null);
      setHistoryStatusBoth('unavailable');
    }
  }, [isCurrent, adoptHistory, loadLinkedHistory, setHistoryBoth, setHistoryStatusBoth]);

  /**
   * Forgets the session's copy of the kept Umsätze (switched off, or deleted
   * with the saved data). The lists that leaned on them shrink to the bank's
   * answers (listsOf), and the applied range follows the active one's, so
   * the screen never names a span it no longer shows.
   */
  const dropHistory = useCallback(() => {
    historyLoadGenRef.current++;
    setHistoryBoth(null);
    setHistoryStatusBoth('off');
    const wasSaved = savedRangeRef.current;
    setSavedRangeBoth(false);
    const active = activeAccountRef.current;
    const f = active ? fetchesRef.current[active.accountNumber] : undefined;
    if (wasSaved || (f && f.fetchFrom !== f.span.from)) {
      setAppliedRange(f?.fetchFrom ? { from: f.fetchFrom, to: f.span.to } : defaultRange());
    }
  }, [setHistoryBoth, setHistoryStatusBoth, setSavedRangeBoth, setAppliedRange]);

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
    // A sync round is under way: saved after it, onto the merged vault.
    if (syncQueueRef.current) return (syncRunRef.current ?? Promise.resolve()).then(() => flushVaultRef.current());
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
            toast(refused ? err.message : msgs().provider.vault.saveFailed, 'error');
          }
        }
      });
    }
    return vaultChainRef.current;
  }, [isCurrent, toast]);

  flushVaultRef.current = flushVault;

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
      if (res.status === 'ready') {
        adoptVault(normalizeVault(res.data), 'ready');
        // The choice to keep the Umsätze lives here; with it, they come next.
        if (vaultRef.current?.keepBookings) void loadHistory(sid);
      }
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
  }, [isCurrent, adoptVault, setVaultStatusBoth, loadHistory]);

  const updateVault = useCallback((fn: (v: VaultData) => VaultData) => {
    const status = vaultStatusRef.current;
    if (status === 'idle') return; // no session to attach it to
    if (status === 'loading') { vaultQueueRef.current.push(fn); return; }
    const base = vaultRef.current ?? EMPTY_VAULT;
    const changed = fn(base);
    if (changed === base) return;
    // During a sync round, made again on the vault it brings (syncNow).
    syncQueueRef.current?.push(fn);
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
      toast(msgs().provider.vault.reset, 'success');
    } catch (err) {
      if (!isCurrent(sid)) return;
      toast((err as Error).message, 'error');
    }
  }, [isCurrent, setVaultStatusBoth, scheduleVaultSave, toast]);

  /**
   * Deletes the kept Umsätze of every further bank logged in beside the
   * primary one — each login has its own file — when keeping them is
   * switched off. Resolves the first failure's message, or null. A bank that
   * is not logged in now cannot be asked: its file stays until it is, or
   * until its own login deletes it.
   */
  const wipeLinkedHistories = useCallback(async (): Promise<string | null> => {
    const sids = linksRef.current.map((l) => l.sessionId).filter((x): x is string => !!x);
    const results = await Promise.allSettled(sids.map((id) => post('/api/history', { sessionId: id, op: 'wipe' })));
    const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    return failed ? (failed.reason as Error)?.message || msgs().history.server.wipe : null;
  }, []);

  /**
   * Has the server delete the vault file and every backup of it (`request` is
   * "Gerät vergessen" with the box ticked, or the vault route on its own),
   * and before it every bank's kept Umsätze and documents — `linked` names
   * the further banks' sessions; those not logged in now the server finds in
   * the vault (lib/wipe-saved.ts). First every way this session could write
   * the file again is shut — the save timer, a load still in flight, saving
   * at all (updateVault and flushVault only write in 'ready') — and a save
   * already on its way is waited for. Afterwards the session goes on with an
   * empty vault in memory that is never written, and the login name this
   * machine remembers for the bank is forgotten too. Resolves whether it
   * worked; failures are toasted.
   */
  const wipeVaultWith = useCallback(async (request: (sid: string, linked: string[]) => Promise<unknown>): Promise<boolean> => {
    const sid = sessionRef.current;
    if (!sid) return false;
    const before = vaultStatusRef.current;
    if (vaultTimerRef.current) { clearTimeout(vaultTimerRef.current); vaultTimerRef.current = null; }
    if (before === 'loading') vaultLoadGenRef.current++;
    vaultStatusRef.current = 'unavailable';
    // A sync round under way finishes first: it must not bring back what goes now.
    await syncRunRef.current?.catch(() => {});
    await vaultChainRef.current;
    try {
      await request(sid, linksRef.current.map((l) => l.sessionId).filter((x): x is string => !!x));
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
    // The kept Umsätze and documents went with the saved data — every bank's
    // of the view, before the vault (both routes, lib/wipe-saved.ts) — and so
    // did the further banks' PINs kept beside the login on the desktop.
    dropHistory();
    docsGenRef.current++;
    docsRef.current = [];
    setDocs([]);
    setDocsLocked(false);
    setDocsResettable(false);
    // Nothing is kept for the rest of the session: no row, no offer, no PIN —
    // and the home screen widget forgets its Gesamtsaldo.
    if (IS_ANDROID) {
      widgetClearedRef.current = true;
      void window.girovoMobile?.widget?.clear();
    }
    openedLinkedRef.current = [];
    setLinkedUnlockBoth(null);
    setLinkedUnlockAsk(false);
    // This device left its sync group (app/api/vault): the shelf on the home network closes.
    if (syncRef.current?.place === 'lan' && !IS_ANDROID) void window.electronSync?.lan(false);
    setSyncBoth(null);
    // The login's PIN kept for Windows Hello went too (app/api/vault), and
    // every PIN kept for "Neue Umsätze melden".
    if (windowsHelloRef.current) setWindowsHelloBoth(false);
    if (securityKeysRef.current?.length) setSecurityKeysBoth([]);
    if (backgroundRef.current) {
      setBackgroundBoth(false);
      void shellSchedule(false);
    }
    if (bank) {
      store.del(`fints.userId.${bank.blz}`);
      try {
        const last = JSON.parse(store.get('fints.lastBank') ?? 'null') as ChosenBank | null;
        if (last?.blz === bank.blz) store.del('fints.lastBank');
      } catch { /* unreadable — nothing of ours to remove */ }
    }
    return true;
  }, [bank, isCurrent, loadVault, setVaultStatusBoth, scheduleVaultSave, toast, dropHistory, setLinkedUnlockBoth, setWindowsHelloBoth, setSecurityKeysBoth, setBackgroundBoth, setSyncBoth]);

  /** Deletes the saved personal data from this machine, the device registration untouched. */
  const wipeVault = useCallback(async () => {
    if (await wipeVaultWith((sid, linked) => post('/api/vault', { sessionId: sid, op: 'wipe', linked }))) {
      toast(msgs().provider.vault.wiped, 'success', 8000);
    }
  }, [wipeVaultWith, toast]);

  /**
   * The Sitzung panel's "Umsätze auf diesem Rechner behalten". On: the
   * choice goes into the vault and onto disk first — the server reads it
   * there before it keeps anything — then the kept Umsätze are read (with
   * what this session already loaded folded in by the server). Off: the kept
   * Umsätze are deleted first, every backup with them (the panel has said so
   * and asked), and only then the choice is forgotten; a deletion that fails
   * leaves everything as it was. Resolves whether it took effect.
   */
  const setKeepBookings = useCallback(async (on: boolean): Promise<boolean> => {
    const sid = sessionRef.current;
    if (!sid || vaultStatusRef.current !== 'ready') return false;
    if (on) {
      updateVault((v) => (v.keepBookings ? v : { ...v, keepBookings: true }));
      await flushVault();
      if (!isCurrent(sid)) return false;
      toast(msgs().history.turnedOn, 'success');
      void loadHistory(sid);
      return true;
    }
    try {
      await post('/api/history', { sessionId: sid, op: 'wipe' });
    } catch (err) {
      if (isCurrent(sid)) toast((err as Error).message, 'error');
      return false;
    }
    if (!isCurrent(sid)) return false;
    // Every further bank's too. One that cannot be deleted keeps nothing
    // more either (the server reads the choice from this login's vault),
    // and the user hears of it.
    const problem = await wipeLinkedHistories();
    if (!isCurrent(sid)) return false;
    if (problem) toast(problem, 'error');
    dropHistory();
    updateVault((v) => {
      if (!v.keepBookings) return v;
      const { keepBookings: _off, ...rest } = v;
      return rest;
    });
    void flushVault();
    toast(msgs().history.deleted, 'success', 8000);
    return true;
  }, [updateVault, flushVault, isCurrent, toast, loadHistory, dropHistory, wipeLinkedHistories]);

  /**
   * Starts the kept Umsätze over after the file stopped opening (a PIN
   * changed at the bank): the server sets the old file aside — its bookings
   * may be gone at the bank — and begins a new one.
   */
  const resetHistory = useCallback(async () => {
    const sid = sessionRef.current;
    if (!sid) return;
    try {
      const res = await post<HistoryGetResponse>('/api/history', { sessionId: sid, op: 'reset' });
      if (!isCurrent(sid)) return;
      adoptHistory(res);
      toast(msgs().history.restarted, 'success');
    } catch (err) {
      if (isCurrent(sid)) toast((err as Error).message, 'error');
    }
  }, [isCurrent, adoptHistory, toast]);

  // ---- transactions -------------------------------------------------------
  /**
   * Fetches one account's statement. `from`/`to` default to the applied range
   * (with "Alles Gespeicherte", to what is kept for the account: spanFor);
   * the cache is keyed by the range actually asked for.
   *
   * Kept Umsätze (lib/history.ts): with "Umsätze auf diesem Rechner behalten"
   * on, the bank is asked only for what they do not hold (planFetch) — from
   * the bank's free window or a week before the kept days end, whichever is
   * earlier — and the list shows the kept days before the answer. An answer
   * already in hand that serves the new span is not asked for again; a past
   * range the kept days hold entirely is not asked for at all. The server
   * keeps each answer itself (the vault tells it whether); the session's copy
   * of the kept Umsätze takes it in here the same way.
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
   * to the caller. `force` asks the bank again even for a span in hand.
   */
  const loadTransactions = useCallback(async (
    account: SerializedAccount,
    from?: string,
    to?: string,
    opts: { force?: boolean; onNotApplied?: () => void; quiet?: boolean; onSettled?: LoadSettled } = {},
  ) => {
    // Without a span of its own, a load follows the applied range.
    const follows = !from && !to;
    const applied = follows ? spanFor(account) : resolveRange();
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
    const today = isoDate(new Date());
    const plan = planFetch(span, keptOf()?.accounts[acct]?.coverage, today);
    if (!opts.force) {
      const cached = txCacheRef.current[acct];
      if (cached && cached.key === cacheKey) { opts.onSettled?.('applied'); return; }
      // The bank's last answer serves this span too, with kept days before
      // it: only the list changes.
      const last = fetchesRef.current[acct];
      if (last && plan && last.fetchFrom === plan.from && last.span.to === span.to) {
        setFetchesBoth({ ...fetchesRef.current, [acct]: { ...last, span } });
        opts.onSettled?.('applied');
        return;
      }
    }
    if (!plan) {
      // A past range the kept Umsätze hold whole, before the bank's free
      // window: no bank call, and so no approval either.
      setTxErrors((e) => without(e, acct));
      setFetchesBoth({
        ...fetchesRef.current,
        [acct]: { span, coveredTo: span.to, fetchFrom: null, txs: [], blocks: [], loadedAt: Date.now() },
      });
      opts.onSettled?.('applied');
      return;
    }
    if (busyRef.current) { notApplied('busy'); return; }

    const sid = sessionRef.current;
    // The login that holds the account. A linked bank that is logged out is
    // not asked: its list says so, and offers to log in again.
    const route = sessionFor(acct);
    if (!route) {
      const message = written(loggedOutText(acct), msgs());
      if (!opts.quiet) toast(message, 'info');
      notApplied('failed', message);
      return;
    }
    setTxErrors((e) => without(e, acct));
    setBusy(true);
    setLoadingAccount(acct);

    const finish = () => { setBusy(false); setLoadingAccount(null); };
    // What the bank is asked for: the span, or its part after the kept days.
    const ask = { from: plan.from, to: span.to };
    // A range up to today goes out open-ended, as the login load always
    // did: banks date weekend and holiday bookings — and the interim
    // closing balance — to the next Buchungstag (see isFutureDate), and a
    // Bis-Datum of today would make one that filters by booking date leave
    // them out. The cache and statementInfo still name the span asked for.
    const openEnd = span.to >= today;
    const apply = (
      txs: SerializedTransaction[],
      balance: SerializedBalance | null,
      blocks: StatementInfo['blocks'] | undefined,
      pending: SerializedTransaction[] | null | undefined,
    ) => {
      const list = txs || [];
      const blockList = blocks ?? [];
      // One moment for the statement and the Vorgemerkte it brought: read
      // together, they are never reconciled against each other (pendingView).
      const at = Date.now();
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
          const end = deliveredEnd(list, blockList);
          if (end && end < span.to) coveredTo = end > ask.from ? end : ask.from;
        } else {
          balancesRef.current = { ...balancesRef.current, [acct]: balance };
          setBalances((b) => ({ ...b, [acct]: balance }));
          setBalanceAt((t) => ({ ...t, [acct]: Date.now() }));
          setBalanceErrors((e) => without(e, acct));
        }
      }
      // The server has kept this answer if the vault says so; the session's
      // copy takes it in by the same rule, for the next plan and list.
      const kept = keptOf();
      if (kept && vaultRef.current?.keepBookings) {
        const delivered = deliveredSpan({ asked: { from: ask.from, to: openEnd ? today : span.to }, txs: list, blocks: blockList, today });
        if (delivered) setHistoryBoth(mergeIntoHistory(kept, acct, { span: delivered, txs: list, blocks: blockList }, today));
      }
      // "Alles Gespeicherte" may have come on while the bank was asked (the
      // kept Umsätze arrived meanwhile): then the account's own span, if this
      // answer serves it.
      let shown = span;
      if (follows && savedRangeRef.current) {
        const now = spanFor(account);
        if (now.to === span.to && planFetch(now, keptOf()?.accounts[acct]?.coverage, today)?.from === ask.from) shown = now;
      }
      setFetchesBoth({
        ...fetchesRef.current,
        [acct]: { span: shown, coveredTo, fetchFrom: ask.from, txs: list, blocks: blockList, loadedAt: at },
      });
      setNotedFetched((c) => {
        const next = afterStatementRead(c[acct], pending, openEnd, at);
        if (next === c[acct]) return c;
        return next ? { ...c, [acct]: next } : without(c, acct);
      });
      if (coveredTo !== span.to) {
        // The list, the Kontoverlauf and a printed statement all go by the
        // span recorded above; this says why it is shorter than asked for.
        toast(msgs().provider.reads.cutShort(fmtDate(toLocalDate(coveredTo))), 'info', 8000);
      }
      void resolveMerchants(pending?.length ? [...list, ...pending] : list);
      void matchReceiptsRef.current(acct, list);
      opts.onSettled?.('applied');
      reviewMoment('refresh');
    };

    try {
      const data = await post<TransactionsResponse>('/api/transactions', {
        sessionId: route, accountNumber: acct, from: ask.from, ...(openEnd ? {} : { to: ask.to }),
      });
      if (!isCurrent(sid)) return;
      if (data.needsTan) {
        startApproval(methodFor(acct), data, {
          onDone: (r) => {
            finish();
            if (r.kind === 'statements') apply(r.transactions, r.balance, r.blocks, r.pending);
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
          // Written when shown, like the rest of the wait: the account's name
          // and the date follow the language. The date is the one the bank
          // was asked from — what the approval in the app names.
          subject: (m) => m.provider.wait.statementsOf(approvalAccountName(account), fmtDate(toLocalDate(ask.from))),
          sessionId: route,
        });
      } else {
        finish();
        apply(data.transactions, data.balance, data.blocks, data.pending);
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
  }, [
    resolveRange, spanFor, keptOf, setFetchesBoth, setHistoryBoth, setBusy, isCurrent, sessionFor, loggedOutText,
    startApproval, methodFor, approvalAccountName, resolveMerchants, toast,
  ]);

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
      if (!opts.quiet) toast(msgs().provider.busy, 'info');
      settle('busy');
      return;
    }
    const sid = sessionRef.current;
    const route = sessionFor(acct);
    if (!route) {
      const message = written(loggedOutText(acct), msgs());
      if (!opts.quiet) toast(message, 'info');
      settle('failed', message);
      return;
    }
    setBalanceErrors((e) => without(e, acct));
    setBusy(true);
    setBalanceLoading(acct);

    const finish = () => { setBusy(false); setBalanceLoading(null); };
    // The reason is kept for the account as it came, or as the app's own words
    // unwritten; the toast and the caller get it written now.
    const fail = (reason: KeptText) => {
      setBalanceErrors((e) => ({ ...e, [acct]: { message: reason, at: Date.now() } }));
      const message = written(reason, msgs());
      if (!opts.quiet) toast(failureSentence([{ name: accountLabelRef.current(account), message }])!, 'error');
      settle('failed', message);
    };
    const apply = (balance: SerializedBalance | null) => {
      // An answer without a balance is not a zero balance.
      if (!balance) { fail((m) => m.provider.reads.noBalance); return; }
      if (acceptsBalance(balancesRef.current[acct], balance)) {
        balancesRef.current = { ...balancesRef.current, [acct]: balance };
        setBalances((b) => ({ ...b, [acct]: balance }));
        setBalanceAt((t) => ({ ...t, [acct]: Date.now() }));
      }
      settle('applied');
    };

    try {
      const data = await post<BalanceResponse>('/api/balance', { sessionId: route, accountNumber: acct });
      if (!isCurrent(sid)) return;
      if (data.needsTan) {
        startApproval(methodFor(acct), data, {
          onDone: (r) => {
            finish();
            if (r.kind === 'balance') apply(r.balance);
            else fail((m) => m.provider.reads.balanceMismatch);
          },
          retry: () => { finish(); void loadBalance(account, opts); },
          onCancelled: () => { finish(); settle('cancelled'); },
        }, {
          kind: 'balance', subject: (m) => m.provider.wait.balanceOf(approvalAccountName(account)), sessionId: route,
        });
      } else {
        finish();
        apply(data.balance);
      }
    } catch (err) {
      if (!isCurrent(sid)) return;
      finish();
      fail((err as Error).message);
    }
  }, [setBusy, isCurrent, sessionFor, loggedOutText, startApproval, methodFor, approvalAccountName, toast]);

  // ---- Depot -----------------------------------------------------------------
  /**
   * A Depot's holdings (HKWPD), as loadBalance reads a balance: behind
   * `busy`, through the account's own login, perhaps with an approval.
   */
  const loadPortfolio = useCallback(async (
    account: SerializedAccount,
    opts: { quiet?: boolean; onSettled?: LoadSettled } = {},
  ) => {
    const acct = account.accountNumber;
    const settle: LoadSettled = (outcome, error) => opts.onSettled?.(outcome, error);
    if (!account.canPortfolio) { settle('skipped'); return; }
    if (busyRef.current) {
      if (!opts.quiet) toast(msgs().provider.busy, 'info');
      settle('busy');
      return;
    }
    const sid = sessionRef.current;
    const route = sessionFor(acct);
    if (!route) {
      const message = written(loggedOutText(acct), msgs());
      if (!opts.quiet) toast(message, 'info');
      settle('failed', message);
      return;
    }
    setPortfolioErrors((e) => without(e, acct));
    setBusy(true);
    setPortfolioLoading(acct);

    const finish = () => { setBusy(false); setPortfolioLoading(null); };
    const fail = (reason: KeptText) => {
      setPortfolioErrors((e) => ({ ...e, [acct]: { message: reason, at: Date.now() } }));
      const message = written(reason, msgs());
      if (!opts.quiet) toast(failureSentence([{ name: accountLabelRef.current(account), message }])!, 'error');
      settle('failed', message);
    };
    const apply = (portfolio: SerializedPortfolio | null) => {
      // An answer the app could not read is not an empty Depot.
      if (!portfolio) { fail((m) => m.depot.unreadable); return; }
      setPortfolios((p) => ({ ...p, [acct]: portfolio }));
      settle('applied');
    };

    try {
      const data = await post<PortfolioResponse>('/api/portfolio', { sessionId: route, accountNumber: acct });
      if (!isCurrent(sid)) return;
      if (data.needsTan) {
        startApproval(methodFor(acct), data, {
          onDone: (r) => {
            finish();
            if (r.kind === 'portfolio') apply(r.portfolio);
            else fail((m) => m.depot.unreadable);
          },
          retry: () => { finish(); void loadPortfolio(account, opts); },
          onCancelled: () => { finish(); settle('cancelled'); },
        }, {
          kind: 'portfolio', subject: (m) => m.provider.wait.portfolioOf(approvalAccountName(account)), sessionId: route,
        });
      } else {
        finish();
        apply(data.portfolio);
      }
    } catch (err) {
      if (!isCurrent(sid)) return;
      finish();
      fail((err as Error).message);
    }
  }, [setBusy, isCurrent, sessionFor, loggedOutText, startApproval, methodFor, approvalAccountName, toast]);

  // ---- documents: the bank's Kontoauszüge, and receipts -----------------------
  // Kept per login on this machine (lib/doc-store.ts) and listed for all of
  // the view's logins together. Not bank calls: they run outside `busy`,
  // except the fetch from the bank.

  const setDocsBoth = useCallback((next: ListedDoc[]) => {
    docsRef.current = next;
    setDocs(next);
  }, []);

  /** Lists the documents of every login in the view that is logged in. */
  const loadDocs = useCallback(async () => {
    const gen = ++docsGenRef.current;
    const sids = [sessionRef.current, ...linksRef.current.map((l) => l.sessionId)].filter((x): x is string => !!x);
    const lists = await Promise.all(sids.map(async (sid) => {
      try {
        return { sid, ...(await post<DocsListResponse>('/api/docs', { sessionId: sid, op: 'list' })) };
      } catch {
        return { sid, docs: [], locked: false, resettable: false };
      }
    }));
    if (gen !== docsGenRef.current || !sessionRef.current) return;
    setDocsBoth(lists.flatMap((l) => l.docs.map((d) => ({ ...d, sid: l.sid }))));
    setDocsLocked(lists.some((l) => l.locked));
    // Starting over is offered once the bank has taken the PIN of a login whose store does not open.
    setDocsResettable(lists.some((l) => l.locked && l.resettable));
  }, [setDocsBoth]);

  /**
   * The way out of documents this PIN cannot open (it changed at the bank),
   * as resetVault is the vault's: each login of the view whose store does not
   * open sets it aside and begins a new one (lib/doc-store.ts resetDocs) —
   * nothing is deleted, and a store that opens is left as it is. Listed
   * again afterwards; the outcome is toasted.
   */
  const resetDocs = useCallback(async () => {
    const sids = [sessionRef.current, ...linksRef.current.map((l) => l.sessionId)].filter((x): x is string => !!x);
    if (!sids.length) return;
    const results = await Promise.allSettled(sids.map((sid) => post<DocsResetResponse>('/api/docs', { sessionId: sid, op: 'reset' })));
    if (!sessionRef.current) return;
    await loadDocs();
    const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failed) toast((failed.reason as Error)?.message || msgs().docs.server.write, 'error');
    else if (results.some((r) => r.status === 'fulfilled' && r.value.reset)) toast(msgs().docs.unreadable.done, 'success');
  }, [loadDocs, toast]);

  /** The bytes of a kept document, as a Blob of its type. */
  const readDoc = useCallback(async (doc: ListedDoc): Promise<Blob> => {
    const r = await post<DocGetResponse>('/api/docs', { sessionId: doc.sid, op: 'get', id: doc.id });
    return new Blob([base64ToBytes(r.data) as BlobPart], { type: doc.mime });
  }, []);

  /**
   * Hands a kept document to the user: on the phone "open" is the share
   * sheet (a PDF viewer, a gallery), "save" Android's own picker; on the
   * desktop both save it — the window opens no files of its own.
   */
  const openDoc = useCallback(async (doc: ListedDoc, how: 'open' | 'save') => {
    try {
      const blob = await readDoc(doc);
      const mobile = typeof window !== 'undefined' ? window.girovoMobile : undefined;
      if (how === 'open' && mobile) {
        await mobile.share(doc.name, blob, doc.name);
        return;
      }
      const outcome = await saveFile(doc.name, blob);
      if (outcome === 'saved') toast(msgs().docs.saved(doc.name), 'success');
    } catch (err) {
      toast((err as Error).message || msgs().docs.openFailed, 'error');
    }
  }, [readDoc, toast]);

  const removeDoc = useCallback(async (doc: ListedDoc) => {
    try {
      await post('/api/docs', { sessionId: doc.sid, op: 'remove', id: doc.id });
      setDocsBoth(docsRef.current.filter((d) => d.id !== doc.id));
      if (doc.kind === 'receipt') toast(msgs().docs.receipts.removed, 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }, [setDocsBoth, toast]);

  /**
   * Keeps a receipt: on a booking (`tx`), or waiting for the booking of an
   * order just sent (`awaiting`). Through the login of the account it is for.
   * Resolves whether it was kept.
   */
  const keepReceipt = useCallback(async (file: Blob & { name?: string }, accountNumber: string, to: { tx: string } | { awaiting: AwaitedBooking }) => {
    const sid = sessionFor(accountNumber);
    if (!sid) {
      toast(written(loggedOutText(accountNumber), msgs()), 'info');
      return false;
    }
    try {
      const data = bytesToBase64(new Uint8Array(await file.arrayBuffer()));
      const r = await post<DocResponse>('/api/docs', {
        sessionId: sid, op: 'addReceipt', name: file.name ?? '', data, accountNumber,
        tx: 'tx' in to ? to.tx : null, awaiting: 'awaiting' in to ? to.awaiting : null,
      });
      if (!isCurrent(sid) && !linksRef.current.some((l) => l.sessionId === sid)) return false;
      setDocsBoth([...docsRef.current, { ...r.doc, sid }]);
      if ('tx' in to) toast(msgs().docs.receipts.attached, 'success');
      return true;
    } catch (err) {
      toast((err as Error).message, 'error');
      return false;
    }
  }, [sessionFor, loggedOutText, isCurrent, setDocsBoth, toast]);

  // The bookings known now, as lib/booking-keys.ts takes them: each account's
  // list (holding its days from the list's start), its kept Umsätze (their
  // days), its Vorgemerkte.
  const bookingGroups = useMemo((): BookingGroup[] => {
    const listed = (acct: string) => (day: string) => !!statementInfo[acct] && day >= statementInfo[acct].from;
    return [
      ...Object.entries(txCache).map(([account, list]) => ({ account, txs: list.txs, covers: listed(account) })),
      ...Object.entries(keptHistory?.accounts ?? {}).map(([account, kept]) => ({ account, txs: kept.txs, covers: (day: string) => !!spanAt(kept.coverage, day) })),
      ...[...Object.entries(pendingFetched), ...Object.entries(notedFetched)].map(([account, read]) => ({ account, txs: read.txs, covers: listed(account) })),
    ];
  }, [txCache, statementInfo, keptHistory, pendingFetched, notedFetched]);
  // What is filed under a key from before is shown under the booking it leads
  // to — while it is not moved yet, and wherever it may have to wait — when
  // every known booking with that key has the same key now. Never one that
  // could be another booking's (lib/booking-keys.ts).
  const readMoves = useMemo(() => keyMoves(bookingGroups, { accounts: [] }), [bookingGroups]);
  // A key from before that several known bookings may own (twins) is shown on
  // each of them, as the version before did — never moved, deleted by none.
  const sharedReads = useMemo(() => sharedKeys(bookingGroups), [bookingGroups]);

  /** A booking's receipts — those tied to a key from before that leads to it, or that it may share, included. */
  const receiptsOf = useCallback((tx: SerializedTransaction) => {
    const key = txKey(tx);
    return docs.filter((d) => d.kind === 'receipt' && !!d.tx
      && (d.tx === key || readMoves.get(d.tx)?.to === key || !!sharedReads.get(d.tx)?.includes(key)));
  }, [docs, readMoves, sharedReads]);

  /** Bookings that have a receipt, by txKey — for the rows' marker. */
  const receiptKeys = useMemo(
    () => new Set(docs.filter((d) => d.kind === 'receipt' && d.tx)
      .flatMap((d) => sharedReads.get(d.tx!) ?? [readMoves.get(d.tx!)?.to ?? d.tx!])),
    [docs, readMoves, sharedReads],
  );

  /**
   * After a statement read: the invoices waiting for a booking of this
   * account (lib/receipts.ts) go to the bookings that arrived for them.
   */
  const matchReceipts = useCallback(async (accountNumber: string, txs: SerializedTransaction[]) => {
    const waiting = docsRef.current.filter((d) => d.kind === 'receipt' && !d.tx && d.awaiting && d.accountNumber === accountNumber);
    if (!waiting.length || !txs.length) return;
    let linked = 0;
    for (const { doc, key } of matchAwaiting(waiting, txs)) {
      const listed = doc as ListedDoc;
      try {
        const r = await post<DocResponse>('/api/docs', { sessionId: listed.sid, op: 'link', id: doc.id, tx: key, accountNumber });
        setDocsBoth(docsRef.current.map((d) => (d.id === doc.id ? { ...r.doc, sid: listed.sid } : d)));
        linked++;
      } catch { /* it waits for the next read */ }
    }
    if (linked) toast(msgs().docs.receipts.matched(linked), 'success');
  }, [setDocsBoth, toast]);
  matchReceiptsRef.current = matchReceipts;

  /**
   * The bank's own Kontoauszüge for an account (HKEKA): fetched and kept by
   * the server as they arrive (lib/bank-statements.ts), then listed again.
   * Behind `busy`, like every bank call; perhaps with an approval.
   */
  const fetchBankStatements = useCallback(async (account: SerializedAccount) => {
    const acct = account.accountNumber;
    if (!account.canBankStatements) return;
    if (busyRef.current) { toast(msgs().provider.busy, 'info'); return; }
    const sid = sessionRef.current;
    const route = sessionFor(acct);
    if (!route) { toast(written(loggedOutText(acct), msgs()), 'info'); return; }
    setBusy(true);
    setBankStatementsLoading(acct);
    const finish = () => { setBusy(false); setBankStatementsLoading(null); };
    const report = (answer: BankStatementsAnswer | null, error: string | null) => {
      setStatementFetches((f) => ({ ...f, [acct]: { at: Date.now(), answer, error } }));
      if (answer) void loadDocs();
    };
    try {
      const data = await post<BankStatementsResponse>('/api/bank-statements', { sessionId: route, accountNumber: acct });
      if (!isCurrent(sid)) return;
      if (data.needsTan) {
        startApproval(methodFor(acct), data, {
          onDone: (r) => {
            finish();
            if (r.kind === 'bankStatements') report(r, null);
          },
          retry: () => { finish(); void fetchBankStatements(account); },
          onCancelled: finish,
          onAnswer: (_status, answers) => { finish(); report(null, answers || msgs().docs.statements.failed); },
        }, {
          kind: 'bankStatements', subject: (m) => m.provider.wait.bankStatementsOf(approvalAccountName(account)), sessionId: route,
        });
      } else {
        finish();
        report(data, null);
      }
    } catch (err) {
      if (!isCurrent(sid)) return;
      finish();
      report(null, (err as Error).message);
    }
  }, [setBusy, isCurrent, sessionFor, loggedOutText, startApproval, methodFor, approvalAccountName, loadDocs, toast]);

  /**
   * "Alle Salden abrufen": every balance this session does not know yet, one
   * account after the other behind `busy` (lib/balances.ts balanceQueue). The
   * active account stays the active one. Stops when an approval is
   * cancelled; what failed is said once, at the end. Never started on its
   * own — each read can cost an approval.
   */
  /** Answers whether it started (false: a read was running, or nothing was left to read). */
  const loadAllBalances = useCallback((only?: readonly string[]): boolean => {
    if (busyRef.current) {
      if (!only) toast(msgs().provider.busy, 'info');
      return false;
    }
    const sid = sessionRef.current;
    // A linked bank that is logged out has nobody to ask; its list says so.
    // `only`: these accounts alone ("Salden beim Anmelden abrufen" for the
    // ones that just joined, never again for one whose approval was refused).
    const reachable = accountsRef.current.filter((a) => sessionFor(a.accountNumber) && (!only || only.includes(a.accountNumber)));
    // And every Depot whose holdings were not read yet: on the overview its
    // value stands among the balances and counts in the Gesamtsaldo.
    const queue: Array<{ account: SerializedAccount; via: 'balance' | 'statement' | 'portfolio' }> = [
      ...balanceQueue(reachable, balancesRef.current, resolveRange().to >= isoDate(new Date())),
      ...reachable
        .filter((a) => isDepot(a) && !portfoliosRef.current[a.accountNumber])
        .map((account) => ({ account, via: 'portfolio' as const })),
    ];
    if (!queue.length) {
      // Only accounts whose statement is the way to their balance are left,
      // and the applied range ends before today. Said to a press, not to the login's own read.
      if (!only && reachable.some((a) => a.canStatements && !balancesRef.current[a.accountNumber])) {
        toast(msgs().provider.reads.balanceWithStatements, 'info', 8000);
      }
      return false;
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
      else if (step.via === 'portfolio') void loadPortfolio(account, { quiet: true, onSettled });
      else void loadTransactions(account, undefined, undefined, { quiet: true, onSettled });
    };
    next();
    return true;
  }, [toast, sessionFor, resolveRange, isCurrent, loadBalance, loadPortfolio, loadTransactions]);

  const selectAccount = useCallback((a: SerializedAccount) => {
    if (busyRef.current) return; // don't interrupt an in-flight approval
    setActiveAccount(a);
    activeAccountRef.current = a;
    setAccountOpen(true);
    // "Alles Gespeicherte" reaches as far back for each account as is kept for
    // it: the applied range names the one now on screen.
    if (savedRangeRef.current) setAppliedRange(spanFor(a));
    void loadTransactions(a);
    // No Umsätze to read its balance from: a Depot's holdings, else the balance alone.
    if (!a.canStatements && a.canPortfolio) {
      if (!portfoliosRef.current[a.accountNumber]) void loadPortfolio(a);
    } else if (!a.canStatements && a.canBalance && !balancesRef.current[a.accountNumber]) void loadBalance(a);
  }, [setAppliedRange, spanFor, loadTransactions, loadBalance, loadPortfolio]);

  /** Back from an account's page to every account (the overview's first level). */
  const closeAccount = useCallback(() => setAccountOpen(false), []);

  /** Drop the cache for one account and re-read it from the bank. */
  const refreshAccount = useCallback((account: SerializedAccount, from?: string, to?: string) => {
    void loadTransactions(account, from, to, { force: true });
  }, [loadTransactions]);

  /**
   * Applies `next` — a range, or 'saved' for "Alles Gespeicherte" — and reads
   * `account` with it. The range is applied at once, so the list can say which
   * span it is fetching — but it is kept only if that statement arrives. A
   * cancelled approval or a refusal by the bank puts the previous range back:
   * otherwise every later account switch or refresh would quietly ask for a
   * span nobody has seen, perhaps with a TAN of its own, while the screen
   * still names the one that is loaded.
   *
   * Not forced unless asked: a span the bank's last answer already serves
   * (with the kept Umsätze before it) is shown without asking again.
   */
  const applyAndLoad = useCallback((account: SerializedAccount, next: DateRange | 'saved', opts: { force?: boolean; then?: LoadSettled } = {}) => {
    const prev = rangeRef.current;
    const prevAnchor = rangeAnchorRef.current;
    const prevSaved = savedRangeRef.current;
    rangeChosenRef.current = true;
    setSavedRangeBoth(next === 'saved');
    const span = next === 'saved' ? spanFor(account) : next;
    setAppliedRange(span);
    const applied = rangeRef.current;
    void loadTransactions(account, next === 'saved' ? undefined : next.from, next === 'saved' ? undefined : next.to, {
      force: opts.force,
      onNotApplied: () => {
        // Applied over meanwhile (another pick, or midnight): leave that be.
        if (rangeRef.current !== applied) return;
        rangeRef.current = prev;
        rangeAnchorRef.current = prevAnchor;
        setRange(prev);
        setSavedRangeBoth(prevSaved);
      },
      // A failure says so in its own toast. An approval that was not given
      // closes without a word — so this says what the screen still shows.
      onSettled: (outcome, error) => {
        opts.then?.(outcome, error);
        if (outcome !== 'cancelled' || rangeRef.current !== prev) return;
        const shown = fmtRange(prev.from, prev.to);
        const said = msgs().provider.reads;
        toast(span.from < prev.from ? said.olderNotFetched(shown) : said.periodNotFetched(shown), 'info', 8000);
      },
    });
  }, [setSavedRangeBoth, spanFor, setAppliedRange, loadTransactions, toast]);

  /**
   * Makes `r` the range every statement load uses, and re-reads the active
   * account with it. Refused while another operation runs, so the applied
   * range never names something that is not being fetched — and undone if
   * the fetch does not land (applyAndLoad).
   */
  const applyRange = useCallback((r: DateRange, accounts?: readonly SerializedAccount[]) => {
    const next = normalizeRange(r);
    if (!next) {
      toast(msgs().provider.reads.invalidPeriod, 'error');
      return;
    }
    if (busyRef.current) {
      toast(msgs().provider.busy, 'info');
      return;
    }
    // `accounts`: the frame's ledger, whose ticked accounts all show the
    // period. The first carries it (undone if its read does not land), the
    // others follow one after the other; a refused approval stops them.
    const live = accounts?.filter((a) => sessionFor(a.accountNumber));
    if (live?.length) {
      const [first, ...rest] = live;
      const step = (i: number) => {
        if (i >= rest.length) return;
        void loadTransactions(rest[i], next.from, next.to, {
          quiet: true,
          onSettled: (o) => { if (o !== 'cancelled' && o !== 'busy') step(i + 1); },
        });
      };
      applyAndLoad(first, next, { then: (o) => { if (o === 'applied' || o === 'skipped') step(0); } });
      return;
    }
    const account = activeAccountRef.current;
    if (account) {
      applyAndLoad(account, next);
    } else {
      rangeChosenRef.current = true;
      setSavedRangeBoth(false);
      setAppliedRange(next);
    }
  }, [toast, setSavedRangeBoth, setAppliedRange, applyAndLoad, loadTransactions, sessionFor]);

  /**
   * Reads `account` over `r` — the Steuer-Jahresübersicht's "Ganzes Jahr
   * laden". The range becomes the one every list shows, as a pick in the
   * Zeitraum control would make it, and is undone the same way if the read
   * does not land.
   */
  const loadRange = useCallback((account: SerializedAccount, r: DateRange) => {
    const next = normalizeRange(r);
    if (!next) {
      toast(msgs().provider.reads.invalidPeriod, 'error');
      return;
    }
    if (busyRef.current) {
      toast(msgs().provider.busy, 'info');
      return;
    }
    applyAndLoad(account, next);
  }, [toast, applyAndLoad]);

  /**
   * "Alles Gespeicherte" from the Zeitraum control: every account's list
   * reaches back as far as what is kept for it — asking the bank only for its
   * free window, where nothing older is kept for an account just the default
   * ninety days. Undone like applyRange if the fetch does not land.
   */
  const applySavedRange = useCallback((accounts?: readonly SerializedAccount[]) => {
    if (busyRef.current) {
      toast(msgs().provider.busy, 'info');
      return;
    }
    // `accounts`: the frame's ledger — every ticked account in turn, each as
    // far back as is kept for it (as applyRange does for a period).
    const live = accounts?.filter((a) => sessionFor(a.accountNumber));
    if (live?.length) {
      const [first, ...rest] = live;
      const step = (i: number) => {
        if (i >= rest.length) return;
        void loadTransactions(rest[i], undefined, undefined, {
          quiet: true,
          onSettled: (o) => { if (o !== 'cancelled' && o !== 'busy') step(i + 1); },
        });
      };
      applyAndLoad(first, 'saved', { then: (o) => { if (o === 'applied' || o === 'skipped') step(0); } });
      return;
    }
    const account = activeAccountRef.current;
    if (account) {
      applyAndLoad(account, 'saved');
    } else {
      rangeChosenRef.current = true;
      setSavedRangeBoth(true);
    }
  }, [toast, setSavedRangeBoth, applyAndLoad, loadTransactions, sessionFor]);

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
      toast(msgs().provider.busy, 'info');
      return;
    }
    const today = isoDate(new Date());
    const r = resolveRange();
    setActiveAccount(account);
    activeAccountRef.current = account;
    if (savedRangeRef.current) {
      // Runs up to today already, for this account its own span.
      setAppliedRange(spanFor(account));
      void loadTransactions(account, undefined, undefined, { force: true });
    } else if (r.to < today) {
      const floor = defaultRange().from;
      applyAndLoad(account, { from: r.from > floor ? r.from : floor, to: today }, { force: true });
    } else {
      void loadTransactions(account, r.from, r.to, { force: true });
    }
  }, [toast, resolveRange, setAppliedRange, spanFor, applyAndLoad, loadTransactions]);

  // ---- vorgemerkte Umsätze ------------------------------------------------
  const loadPending = useCallback(async (account: SerializedAccount) => {
    if (busyRef.current) {
      toast(msgs().provider.busy, 'info');
      return;
    }
    const sid = sessionRef.current;
    const route = sessionFor(account.accountNumber);
    if (!route) {
      toast(written(loggedOutText(account.accountNumber), msgs()), 'info');
      return;
    }
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
        sessionId: route, accountNumber: account.accountNumber,
      });
      if (!isCurrent(sid)) return;
      if (data.needsTan) {
        startApproval(methodFor(account.accountNumber), data, {
          onDone: (r) => { finish(); if (r.kind === 'pending') apply(r.pending); },
          retry: () => { finish(); void loadPending(account); },
        }, {
          kind: 'pending', subject: (m) => m.provider.wait.pendingOf(approvalAccountName(account)), sessionId: route,
        });
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
      toast(msgs().provider.reads.pendingFailed(accountLabelRef.current(account), message), 'error');
    }
  }, [
    setBusy, isCurrent, sessionFor, loggedOutText, startApproval, methodFor, approvalAccountName, toast,
    resolveMerchants,
  ]);

  // ---- the bank's Daueraufträge and terminierte Überweisungen -------------
  /**
   * Reads one kind of the orders the bank keeps for an account (HKCDB or
   * HKCSB). Only ever asked for — it can cost an approval like any read. A
   * fresh list replaces the last one. `onSettled` as for loadTransactions.
   */
  const loadBankOrderKind = useCallback(async (account: SerializedAccount, kind: BankOrderKind, onSettled?: LoadSettled) => {
    const acct = account.accountNumber;
    if (!account[kind]?.list) { onSettled?.('skipped'); return; }
    if (busyRef.current) {
      toast(msgs().provider.busy, 'info');
      onSettled?.('busy');
      return;
    }
    const sid = sessionRef.current;
    // Asked through the login that holds the account (sessionFor); a linked
    // bank that is logged out is not asked at all.
    const route = sessionFor(acct);
    if (!route) {
      const message = written(loggedOutText(acct), msgs());
      toast(message, 'info');
      onSettled?.('failed', message);
      return;
    }
    setBankOrderErrors((e) => (e[acct]?.[kind] ? { ...e, [acct]: { ...e[acct], [kind]: undefined } } : e));
    setBusy(true);
    setBankOrdersLoading({ accountNumber: acct, kind });

    const finish = () => { setBusy(false); setBankOrdersLoading(null); };
    // Every read hands out new handles, so what this session's deletions said
    // stays with the old list's entries and the fresh list speaks for itself.
    const apply = (a: BankOrdersAnswer) => {
      const info: BankOrdersInfo = { orders: a.orders, complete: a.complete, unreadable: a.unreadable, loadedAt: Date.now() };
      setBankOrders((c) => ({ ...c, [acct]: { ...c[acct], [kind]: info } }));
      onSettled?.('applied');
    };
    const fail = (message: string) => {
      setBankOrderErrors((e) => ({ ...e, [acct]: { ...e[acct], [kind]: { message, at: Date.now() } } }));
      toast(msgs().orders.list.failed(message), 'error');
      onSettled?.('failed', message);
    };

    try {
      const data = await post<BankOrdersResponse>('/api/bank-orders', { sessionId: route, accountNumber: acct, kind });
      if (!isCurrent(sid)) return;
      if (data.needsTan) {
        startApproval(methodFor(acct), data, {
          onDone: (r) => {
            finish();
            if (r.kind === 'bankOrders' && r.orderKind === kind) apply(r);
            else fail(msgs().orders.route.listFailed);
          },
          retry: () => { finish(); void loadBankOrderKind(account, kind, onSettled); },
          onCancelled: () => { finish(); onSettled?.('cancelled'); },
        }, { kind: 'bankOrders', subject: (m) => m.orders.wait.listOf(kind, approvalAccountName(account)), sessionId: route });
      } else {
        finish();
        apply(data);
      }
    } catch (err) {
      if (!isCurrent(sid)) return;
      finish();
      fail((err as Error).message);
    }
  }, [setBusy, isCurrent, sessionFor, loggedOutText, startApproval, methodFor, approvalAccountName, toast]);

  /**
   * Reads the bank's orders of the given kinds (all the account can list,
   * by default) one after the other, each perhaps with an approval of its
   * own. A cancelled approval ends the run: no second request follows one the
   * user just declined. `onSettled` hears once, at the end, how the last
   * read ended.
   */
  const loadBankOrders = useCallback((account: SerializedAccount, kinds?: readonly BankOrderKind[], onSettled?: LoadSettled) => {
    const list = (kinds ?? (['standing', 'dated'] as const)).filter((k) => account[k]?.list);
    const step = (i: number) => {
      if (i >= list.length) { onSettled?.('skipped'); return; }
      void loadBankOrderKind(account, list[i], (outcome, error) => {
        if ((outcome === 'applied' || outcome === 'failed') && i + 1 < list.length) step(i + 1);
        else onSettled?.(outcome, error);
      });
    };
    step(0);
  }, [loadBankOrderKind]);

  /**
   * Deletes one order the bank keeps (HKCDL or HKCSL), as listed by the last
   * read. Its outcome is kept per order (orderDeletions): deleted, refused, or
   * unclear — an unclear deletion is never sent again by itself; the list
   * read again says how it stands.
   */
  const deleteBankOrder = useCallback(async (account: SerializedAccount, order: SerializedBankOrder) => {
    if (busyRef.current) {
      toast(msgs().provider.busy, 'info');
      return;
    }
    const sid = sessionRef.current;
    // Through the login that holds the account and read the list — never another bank's.
    const route = sessionFor(account.accountNumber);
    if (!route) {
      toast(written(loggedOutText(account.accountNumber), msgs()), 'info');
      return;
    }
    setBusy(true);
    const settle = (status: OrderDeletion['status'], answers?: string) => {
      setBusy(false);
      const text = answers ? repairBankText(answers) : answers;
      setOrderDeletions((d) => ({ ...d, [order.ref]: { status, ...(text ? { answers: text } : {}), at: Date.now() } }));
      if (status === 'deleted') toast(msgs().orders.list.deletedToast(order.kind, order.name), 'success');
    };
    try {
      const data = await post<DeleteOrderResponse>('/api/bank-orders/delete', {
        sessionId: route, accountNumber: account.accountNumber, ref: order.ref,
      });
      if (!isCurrent(sid)) return;
      if ('outcome' in data) {
        settle(data.outcome === 'refused' ? 'refused' : 'unclear', data.bankAnswers);
        return;
      }
      if (data.needsTan) {
        startApproval(methodFor(account.accountNumber), data, {
          onDone: (r) => settle('deleted', r.kind === 'orderDeleted' ? r.bankAnswers : undefined),
          retry: null,
          onDialogEnded: () => { closeWait(); settle('unclear'); },
          onAnswer: (status, answers) => { closeWait(); settle(status === 'refused' ? 'refused' : 'unclear', answers); },
          // Approved in the app after we stopped asking, it is gone all the same.
          onCancelled: () => settle('unclear'),
        }, {
          kind: 'orderDelete',
          order: { amount: order.amount, name: order.name, iban: order.iban, instant: false, schedule: order.schedule },
          sessionId: route,
        });
        return;
      }
      settle('deleted', data.bankAnswers);
    } catch (err) {
      if (!isCurrent(sid)) return;
      // As for a transfer: no answer at all may still have reached the bank.
      if (err instanceof ApiError && (err.status === 0 || err.status === ORDER_UNANSWERED_STATUS)) {
        settle('unclear');
        return;
      }
      setBusy(false);
      toast((err as Error).message, 'error');
    }
  }, [setBusy, isCurrent, sessionFor, loggedOutText, startApproval, methodFor, closeWait, toast]);

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

  /** Keeps the server's 30-minute sessions alive — every login of the view. No bank traffic. */
  const sendKeepalive = useCallback(() => {
    const sid = sessionRef.current;
    if (!sid) return;
    lastKeepaliveRef.current = Date.now();
    // A 401 logs out through SESSION_EXPIRED_EVENT (only that bank, for a
    // linked one); anything else is retried with the next activity. A bank
    // being added is kept too: its form is being filled in.
    const sids = [sid, ...linksRef.current.map((l) => l.sessionId), addBankRef.current?.sessionId];
    for (const s of sids) if (s) post('/api/keepalive', { sessionId: s }).catch(() => {});
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
   * "Salden beim Anmelden abrufen": after the login every balance is read
   * as "Alle Salden abrufen" reads them. Kept on this device, not in the
   * vault — the choice is needed before the vault is open.
   */
  const setBalancesAtLogin = useCallback((on: boolean) => {
    setBalancesAtLoginState(on);
    store.set('fints.balancesAtLogin', on ? '1' : '0');
  }, []);

  /**
   * "Umsätze beim Anmelden abrufen": after the login's own read, every other
   * shown account's Umsätze, one after the other. On this device, like the
   * balances' choice.
   */
  const setBookingsAtLogin = useCallback((on: boolean) => {
    setBookingsAtLoginState(on);
    store.set('fints.bookingsAtLogin', on ? '1' : '0');
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
        ...Object.values(notedFetchedRef.current).flatMap((p) => p.txs),
      ]);
    } else {
      setMerchants({});
      merchantsAsked.current.clear();
    }
  }, [resolveMerchants]);

  // ---- navigation & launchers ---------------------------------------------
  const setTab = useCallback((t: DashboardTab) => setTabState(t), []);
  /**
   * The Einstellungen page, at one setting when the search asked for one
   * (components/settings/Settings.tsx scrolls there, focuses it, and clears it).
   */
  const [settingsTarget, setSettingsTarget] = useState<SettingsTarget | null>(null);
  // On a phone Einstellungen is a page under another (reached from the Sitzung
  // panel or the search, with no place of its own in the navigation bar): its
  // way back leads to the page it was opened from.
  const settingsFrom = useRef<DashboardTab>('overview');
  // Its page (lib/settings-pages.ts): null is the list of them on a phone,
  // the first on the desktop. The search's setting opens the page it is on.
  const [settingsPage, setSettingsPage] = useState<SettingsPage | null>(null);
  const openSettings = useCallback((target?: SettingsTarget) => {
    setTabState((current) => {
      if (current !== 'settings') settingsFrom.current = current;
      return 'settings';
    });
    setSettingsTarget(target ?? null);
    setSettingsPage(target ? PAGE_OF[target] : null);
  }, []);
  const leaveSettings = useCallback(() => setTabState(settingsFrom.current), []);
  const clearSettingsTarget = useCallback(() => setSettingsTarget(null), []);

  // Android: while an approval in the bank's app is awaited, the app keeps its
  // network (a short foreground service, android/…/ApprovalService.java).
  // Approving means switching to that app, and from Android 15 an app in the
  // background is cut off — the next "approved yet?" would never reach the bank.
  // A typed TAN goes out with the app in front: nothing to hold for it.
  const awaitingApproval = wait.open && wait.phase === 'waiting' && !wait.entry;
  useEffect(() => {
    const mobile = IS_ANDROID ? window.girovoMobile : undefined;
    if (!mobile || !awaitingApproval) return;
    const said = msgs().android.approval;
    void mobile.approval.hold({ title: said.title, text: said.text });
    return () => {
      void mobile.approval.release();
    };
  }, [awaitingApproval]);

  // Google Play's rating card (lib/play-review.ts) waits while an approval is
  // under way, and is not asked for right after one that ran out or failed.
  useEffect(() => {
    if (!wait.open) return;
    if (wait.phase === 'waiting') reviewMoment('approval');
    else if (wait.phase !== 'confirmed') reviewMoment('trouble');
  }, [wait.open, wait.phase, wait.startedAt]);

  // Android's back gesture, once no layer is open to close (mobile/bridges/back.ts):
  // from Einstellungen to the page it was opened from, from Analyse or Verträge
  // back to the Übersicht, from an account's page back to every account, from
  // the login form back to the bank list. Anywhere else the app goes to the
  // background, session intact.
  useEffect(() => {
    if (!IS_ANDROID) return;
    const onBack = (e: Event) => {
      if (busyRef.current) return;
      if (view === 'dashboard' && tab === 'settings' && settingsPage) {
        // A page of Einstellungen: back to their list first.
        e.preventDefault();
        setSettingsPage(null);
      } else if (view === 'dashboard' && tab === 'settings') {
        e.preventDefault();
        setTabState(settingsFrom.current);
      } else if (view === 'dashboard' && tab === 'overview' && accountOpen && overviewShownRef.current) {
        e.preventDefault();
        setAccountOpen(false);
      } else if (view === 'dashboard' && tab === 'contracts' && ordersOpen) {
        e.preventDefault();
        setOrdersOpen(false);
      } else if (view === 'dashboard' && tab !== 'overview') {
        e.preventDefault();
        setTabState('overview');
      } else if (view === 'login' && bank) {
        e.preventDefault();
        setBank(null);
      }
    };
    window.addEventListener(BACK_EVENT, onBack);
    return () => window.removeEventListener(BACK_EVENT, onBack);
  }, [view, tab, bank, accountOpen, ordersOpen, settingsPage]);
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
    setAccountOpen(true);
    if (f) setTxFilter({ ...EMPTY_FILTER, ...f });
    setPaletteOpenState(false);
    setInboxOpenState(false);
    setTxFocusNonce((n) => n + 1);
  }, []);

  /**
   * "Aufträge" (6.0): the bank's Daueraufträge and Terminüberweisungen on a
   * page of their own, a level below Zahlungen — from its row there, the
   * search, a Mitteilung, the transfer sheet's "Aufträge ansehen".
   */
  const openOrders = useCallback(() => {
    setTabState('contracts');
    setOrdersOpen(true);
    setPaletteOpenState(false);
    setInboxOpenState(false);
  }, []);
  const closeOrders = useCallback(() => setOrdersOpen(false), []);

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
    // Not from a linked bank that is logged out: there is no session to send it with.
    const eligible = accounts.filter((a) => a.canTransfer && sessionFor(a.accountNumber));
    if (!eligible.length) {
      toast(msgs().provider.launch.noTransferAccount, 'error');
      return;
    }
    const accountNumber =
      (p?.accountNumber && eligible.some((a) => a.accountNumber === p.accountNumber) && p.accountNumber)
      || (activeAccount && eligible.some((a) => a.accountNumber === activeAccount.accountNumber)
        ? activeAccount.accountNumber
        : eligible[0].accountNumber);
    clearTransients();
    setShareOpen(false);
    setSharePrefill(null);
    setTransferPrefill({ ...p, accountNumber });
    setTransferOpen(true);
  }, [transferOpen, accounts, activeAccount, sessionFor, toast, clearTransients]);

  const closeTransfer = useCallback(() => {
    setTransferOpen(false);
    setTransferPrefill(null);
  }, []);

  const openShare = useCallback((p?: SharePrefill) => {
    if (transferOpen || shareOpen) return;
    const eligible = accounts.filter((a) => a.iban);
    if (!eligible.length) {
      toast(msgs().provider.launch.noIbanAccount, 'error');
      return;
    }
    const accountNumber =
      (p?.accountNumber && eligible.some((a) => a.accountNumber === p.accountNumber) && p.accountNumber)
      || (activeAccount?.iban ? activeAccount.accountNumber : eligible[0].accountNumber);
    clearTransients();
    setSharePrefill({ ...p, accountNumber });
    setShareOpen(true);
  }, [transferOpen, shareOpen, accounts, activeAccount, toast, clearTransients]);

  const openPlus = useCallback(() => setPlusOpen(true), []);
  const closePlus = useCallback(() => setPlusOpen(false), []);

  // Girovo Plus's state from the phone (mobile/bridges/plus.ts): asked at
  // start — the plugin answers with what Play said last — and on every change
  // (a purchase, a lapse noticed when the app comes back).
  useEffect(() => {
    const bridge = IS_ANDROID ? window.girovoMobile?.plus : undefined;
    if (!bridge) return;
    let live = true;
    void bridge.status().then((s) => live && setPlus(s));
    const off = bridge.onChange((s) => live && setPlus(s));
    return () => {
      live = false;
      off();
    };
  }, []);

  // The weekly Plus reminder (lib/plus.ts reminderDue): a toast once the user
  // is in, at most every 7 days, only in the Play build without Plus. Its
  // clock starts the first time the app sees them without it, so a new user
  // first gets a week with the app.
  useEffect(() => {
    if (view !== 'dashboard' || plusOpen) return;
    const key = 'girovo.plus.reminder';
    const now = Date.now();
    const raw = store.get(key);
    const due = reminderDue(plus.state, raw == null ? null : Number(raw), now);
    if (due === 'none' || due === 'wait') return;
    store.set(key, String(now));
    if (due === 'show') toast(msgs().plus.reminder, 'info', 12000, { label: msgs().plus.reminderAction, run: () => setPlusOpen(true) });
  }, [view, plus.state, plusOpen, toast]);

  // Aufteilen (components/transactions/BillSplit.tsx): one Geld anfordern per
  // person, one after the other. The sheet's "Weiter: Lea" (nextShare) closes
  // this one and the effect below opens the next; closing it ends the row.
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

  // ---- bank messages ------------------------------------------------------
  const markAllRead = useCallback(() => {
    if (!messagesRef.current.some((m) => !m.read)) return;
    const next = messagesRef.current.map((m) => (m.read ? m : { ...m, read: true }));
    messagesRef.current = next;
    setMessages(next);
  }, []);

  // ---- login --------------------------------------------------------------
  /**
   * The desktop, once the bank has taken the first login's PIN (connect,
   * afterAccountsReady): the further banks' PINs kept beside it open with it
   * (lib/linked-unlock.ts), and the chain below logs them in once the
   * Übersicht is up — as after a fingerprint login on Android. Whatever goes
   * wrong, the further banks are simply logged in by hand, as before.
   */
  const openLinkedUnlock = useCallback(async (sid: string) => {
    const secret = await linkedUnlockSecret();
    if (!secret || !isCurrent(sid)) return;
    try {
      const r = await post<{ on: boolean; linked: GirovoSealedLogin[]; dropped?: boolean }>(
        '/api/linked-unlock', { op: 'open', sessionId: sid, secret },
      );
      if (!isCurrent(sid)) return;
      setLinkedUnlockBoth(r.on === true);
      // A file this PIN no longer opens is gone: said, or the switch would just be off.
      if (r.dropped) toast(msgs().settings.linkedUnlock.dropped, 'info', 12_000);
      const linked = Array.isArray(r.linked) ? r.linked : [];
      if (linked.length && !openedLinkedRef.current.length) {
        openedLinkedRef.current = linked;
        setOpenedLinkedTick((n) => n + 1);
      }
    } catch {
      // Not offered this session.
    }
  }, [isCurrent, setLinkedUnlockBoth, toast]);

  /**
   * The desktop's "Mit Windows Hello anmelden": on keeps this login's PIN
   * under a Windows Hello gesture (lib/windows-hello.ts; the first time
   * Windows sets its key up too) — only once the bank has taken the PIN;
   * off deletes it.
   */
  const setWindowsHello = useCallback(async (on: boolean) => {
    const sid = sessionRef.current;
    const login = helloLoginRef.current;
    if (!sid || !login || windowsHelloRef.current === null) return;
    const said = msgs().settings.windowsHello;
    if (!on) {
      await forgetHello({ blz: login.blz, userId: login.userId });
      if (isCurrent(sid)) setWindowsHelloBoth(false);
      toast(said.nowOff, 'info');
      return;
    }
    try {
      const sealed = await sealWithHello(sid);
      if (sealed.result === 'canceled') return;
      if (sealed.result === 'failed') {
        // What Windows threw is named: trying again rarely helps then.
        const { code } = sealed;
        if (!code) toast(said.failed, 'error');
        else toast(helloStoreBroken(code) ? said.brokenStore(code) : said.failedCode(code), 'error', 15_000);
        return;
      }
      if (isCurrent(sid)) setWindowsHelloBoth(true);
      toast(said.nowOn, 'success');
    } catch (err) {
      toast((err as Error).message || said.failed, 'error');
    }
  }, [isCurrent, setWindowsHelloBoth, toast]);

  /**
   * The desktop, once the bank has taken the first login's PIN: whether the
   * login opens with Windows Hello — the row in Sicherheit — and, after a
   * login with the PIN typed on a Windows that has it, a toast that offers
   * it, once ever (the row stays).
   */
  const checkWindowsHello = useCallback(async (sid: string) => {
    const login = helloLoginRef.current;
    if (IS_ANDROID || !login || !(await helloAvailable())) return;
    const on = await helloOn({ blz: login.blz, userId: login.userId });
    if (!isCurrent(sid)) return;
    setWindowsHelloBoth(on);
    if (on || login.hello || store.get(HELLO_OFFERED) === '1') return;
    store.set(HELLO_OFFERED, '1');
    const said = msgs().settings.windowsHello;
    toast(said.offer(login.bank), 'info', 12_000, { label: said.offerAction, run: () => void setWindowsHello(true) });
  }, [isCurrent, setWindowsHelloBoth, setWindowsHello, toast]);

  /** The desktop, once the bank has taken the first login's PIN: the login's security keys, the row in Sicherheit. */
  const checkSecurityKeys = useCallback(async (sid: string) => {
    const login = helloLoginRef.current;
    if (IS_ANDROID || !login || !(await securityKeyAvailable())) return;
    const keys = await securityKeysOf({ blz: login.blz, userId: login.userId });
    if (keys && isCurrent(sid)) setSecurityKeysBoth(keys);
  }, [isCurrent, setSecurityKeysBoth]);

  /** One more security key: Windows asks for two touches, and the PIN the bank took is kept under it. */
  const addSecurityKey = useCallback(async () => {
    const sid = sessionRef.current;
    const login = helloLoginRef.current;
    if (!sid || !login || securityKeysRef.current === null) return;
    const said = msgs().settings.securityKeys;
    try {
      const added = await sealWithSecurityKey(sid, { blz: login.blz, userId: login.userId });
      if (added.result === 'added') {
        if (isCurrent(sid)) setSecurityKeysBoth(added.keys);
        toast(said.nowOn, 'success');
      } else if (added.result === 'failed') {
        toast(added.code ? said.failedCode(added.code) : said.failed, 'error', 12_000);
      } else if (added.result === 'exists') {
        toast(said.exists, 'info');
      } else if (added.result === 'unsupported') {
        toast(said.unsupported, 'error', 12_000);
      }
    } catch (err) {
      toast((err as Error).message || said.failed, 'error');
    }
  }, [isCurrent, setSecurityKeysBoth, toast]);

  /** A key's name, '' taking it away. */
  const renameSecurityKey = useCallback(async (id: string, name: string) => {
    const sid = sessionRef.current;
    const login = helloLoginRef.current;
    if (!sid || !login) return;
    try {
      const keys = await nameSecurityKey({ blz: login.blz, userId: login.userId }, id, name);
      if (isCurrent(sid)) setSecurityKeysBoth(keys);
    } catch (err) {
      toast((err as Error).message || msgs().settings.securityKeys.failed, 'error');
    }
  }, [isCurrent, setSecurityKeysBoth, toast]);

  /** One key goes, with the PIN kept under it. */
  const removeSecurityKey = useCallback(async (id: string) => {
    const sid = sessionRef.current;
    const login = helloLoginRef.current;
    if (!sid || !login) return;
    const said = msgs().settings.securityKeys;
    try {
      const keys = await dropSecurityKey({ blz: login.blz, userId: login.userId }, id);
      if (isCurrent(sid)) setSecurityKeysBoth(keys);
      toast(said.removed, 'info');
    } catch (err) {
      toast((err as Error).message || said.failed, 'error');
    }
  }, [isCurrent, setSecurityKeysBoth, toast]);

  /**
   * "Neue Umsätze melden": on keeps the PINs of the logged-in banks that have
   * a remembered device (the dialog said what that means), plans the checks
   * and — on Android 13 and later — asks to notify first; off deletes every
   * kept PIN and stops them.
   */
  const setBackgroundChecks = useCallback(async (on: boolean, amounts = true) => {
    const primary = sessionRef.current;
    if (!primary || backgroundRef.current === null) return;
    const said = msgs().background;
    if (!on) {
      try {
        await withinTime(post('/api/background', { op: 'off' }), BACKGROUND_LIMIT_MS.server);
        // The PINs are gone: a plan left behind ends at its next check, which finds none.
        await withinTime(shellSchedule(false), BACKGROUND_LIMIT_MS.shell).catch(() => {});
        if (isCurrent(primary)) setBackgroundBoth(false);
        toast(said.nowOff, 'info');
      } catch {
        toast(said.failed, 'error');
      }
      return;
    }
    // From the moment the PINs are sent, a failure has to take them back:
    // the switch would say off while they are kept.
    let sent = false;
    try {
      const phone = IS_ANDROID ? window.girovoMobile?.background : undefined;
      if (phone && !(await withinTime(phone.requestNotifications(), BACKGROUND_LIMIT_MS.permission))) {
        toast(said.noPermission, 'error', 12_000);
        return;
      }
      const secret = await withinTime(backgroundSecret(), BACKGROUND_LIMIT_MS.secret);
      if (!secret) {
        toast(said.failed, 'error');
        return;
      }
      const sessionIds = [primary, ...linksRef.current.flatMap((l) => (l.sessionId ? [l.sessionId] : []))];
      sent = true;
      const r = await withinTime(post<{ on: boolean; count: number; skipped: string[] }>(
        '/api/background', { op: 'enroll', secret, sessionIds, amounts },
      ), BACKGROUND_LIMIT_MS.server);
      if (!r.count) {
        toast(said.noneTaken, 'info', 12_000);
        return;
      }
      await withinTime(shellSchedule(true), BACKGROUND_LIMIT_MS.shell);
      if (isCurrent(primary)) setBackgroundBoth(true);
      toast(said.nowOn(r.count), 'success');
      if (r.skipped?.length) toast(said.noDevice(namesList(r.skipped)), 'info', 12_000);
    } catch (err) {
      if (sent) void post('/api/background', { op: 'off' }).then(() => shellSchedule(false)).catch(() => {});
      toast(err instanceof TimeLimitError ? said.failed : (err as Error).message || said.failed, 'error');
    }
  }, [isCurrent, setBackgroundBoth, toast]);

  /**
   * Einstellungen → Was Girovo meldet (lib/payment-alerts.ts): what the
   * notices are about and the limits of `accountKeys`, after `set` changed
   * them. Null when the checks are off or the answer did not come.
   */
  const backgroundAlerts = useCallback(async (accountKeys: readonly string[], set?: AlertsChange): Promise<AlertsView | null> => {
    if (backgroundRef.current !== true) return null;
    const secret = await backgroundSecret();
    if (!secret) return null;
    const named = (acct: string) => {
      const sessionId = sessionFor(acct);
      return sessionId ? { sessionId, accountNumber: acct } : null;
    };
    const accounts = accountKeys.map(named).filter((a) => !!a);
    const change = set && {
      ...set,
      limits: set.limits?.flatMap((l) => {
        const a = named(l.account);
        return a ? [{ ...a, cents: l.cents, label: l.label }] : [];
      }),
    };
    try {
      const r = await post<{ on: boolean } & Partial<AlertsView>>(
        '/api/background', { op: 'alerts', secret, accounts, ...(change ? { set: change } : {}) },
      );
      if (!r.on || !r.prefs || !r.accounts) return null;
      return { prefs: r.prefs, amounts: r.amounts !== false, accounts: r.accounts };
    } catch {
      return null;
    }
  }, [sessionFor]);

  /** Verträge & Abos' watch list for the checks (components/settings/BackgroundAlerts.tsx AlertWatch). */
  const sendAlertWatch = useCallback(async (
    watch: Omit<Watch, 'reminders'> & { drop: string[]; reminders?: Array<{ id: string; by: string; lead: number; name: string }> },
  ): Promise<boolean> => {
    if (backgroundRef.current !== true) return false;
    const secret = await backgroundSecret();
    if (!secret) return false;
    try {
      // The session tells the route whose vault the reminders are from.
      const r = await post<{ on: boolean }>('/api/background', { op: 'watch', secret, sessionId: sessionRef.current, ...watch });
      return r.on === true;
    } catch {
      return false;
    }
  }, []);

  /** "Frag deine Umsätze" on the desktop: the built-in model's category for what a question is about (app/api/ask-category). */
  const askCategory = useCallback(async (topic: string): Promise<CategoryId | null> => {
    const sid = sessionRef.current;
    if (!sid || !topic.trim()) return null;
    try {
      const r = await post<{ category?: CategoryId | null }>('/api/ask-category', { sessionId: sid, topic });
      return r.category ?? null;
    } catch {
      return null;
    }
  }, []);

  /** One login's PIN kept for the checks goes (its bank refused it, it was removed, its device forgotten). */
  const forgetBackgroundLogin = useCallback(async (login: { blz: string; userId: string }) => {
    if (backgroundRef.current !== true) return;
    const secret = await backgroundSecret();
    if (!secret) return;
    try {
      await post('/api/background', { op: 'forget', secret, login: { blz: login.blz, userId: login.userId } });
      const r = await post<{ on: boolean }>('/api/background', { op: 'status' });
      // The last one gone: the checks stop too.
      if (!r.on) {
        await shellSchedule(false);
        setBackgroundBoth(false);
      }
    } catch {
      // Asked again with the next refusal; a check never tries a refused PIN anyway.
    }
  }, [setBackgroundBoth]);

  // ---- sync between devices (lib/sync.ts) ---------------------------------
  const refreshSync = useCallback(async () => {
    const sid = sessionRef.current;
    if (!sid || vaultStatusRef.current !== 'ready') return;
    try {
      const r = await post<SyncInfo>('/api/sync', { op: 'status', sessionId: sid });
      if (isCurrent(sid)) setSyncBoth(r);
    } catch {
      // Not offered this session.
    }
  }, [isCurrent, setSyncBoth]);

  /**
   * One round: the vault as it is (saved first) merged with the other
   * devices', the result shown and kept. Edits made meanwhile are made again
   * on it and saved after. `quiet`: the rounds that run by themselves say
   * nothing unless something came.
   */
  const syncNow = useCallback((quiet = false): Promise<void> => {
    // One round at a time — decided at once, before anything is awaited.
    if (syncRunRef.current) return syncRunRef.current;
    const sid = sessionRef.current;
    if (!sid || syncRef.current?.on !== true || vaultStatusRef.current !== 'ready') return Promise.resolve();
    const run = syncRoundRef.current(sid, quiet).finally(() => {
      if (syncRunRef.current === run) syncRunRef.current = null;
    });
    syncRunRef.current = run;
    return run;
  }, []);

  /** One round's work, current with every render (syncNow is made once). */
  const syncRound = async (sid: string, quiet: boolean): Promise<void> => {
    const said = msgs().sync;
    // Whatever waits to be saved goes first; then saves wait for the round.
    await flushVault();
    syncQueueRef.current = [];
    let r: SyncRunResponse | null = null;
    try {
      // Booking keys still to move go along: the round moves them after the merge (lib/booking-keys.ts).
      const moves = movesInVault(vaultRef.current ?? EMPTY_VAULT, bookingKeyMovesRef.current, undefined, docsRef.current);
      r = await post<SyncRunResponse>('/api/sync', {
        op: 'run', sessionId: sid, vault: vaultRef.current, deviceName: await deviceName(), ...(moves.length ? { moves } : {}),
      });
    } catch (err) {
      if (!quiet) {
        const lanPhone = IS_ANDROID && syncRef.current?.place === 'lan';
        toast(lanPhone ? said.unreachableLan : (err as Error).message || said.failed, 'error');
      }
    } finally {
      const queued = syncQueueRef.current ?? [];
      syncQueueRef.current = null;
      if (r && isCurrent(sid)) {
        if (r.changed && r.vault) {
          let next = normalizeVault(r.vault);
          for (const fn of queued) next = fn(next);
          vaultRef.current = next;
          setVault(next);
          if (queued.length) vaultDirtyRef.current = true;
        }
        if (syncRef.current) setSyncBoth({ ...syncRef.current, lastSync: r.lastSync, devices: r.devices });
        if (r.receipts.added || r.receipts.removed || r.receipts.relinked) void loadDocs();
        // The vault is full: the rest keeps syncing, and this is said once — again only once it fitted meanwhile.
        const full = r.full ?? 0;
        if (full && !syncFullRef.current) toast(said.full(full), 'error');
        else if (!quiet || r.changed || r.receipts.added) {
          toast(r.changed || r.receipts.added ? said.syncedChanges(r.receipts.added) : said.synced, quiet ? 'info' : 'success');
        }
        syncFullRef.current = full;
      }
      if (vaultDirtyRef.current) scheduleVaultSave();
    }
  };
  syncRoundRef.current = syncRound;

  /** The place as this device offers it: the desktop's shelf with where the phone finds it. */
  const withAddresses = async (place: SyncPlaceChoice): Promise<SyncPlaceChoice | null> => {
    if (place.kind !== 'lan') return place;
    const info = await window.electronSync?.lan(true).catch(() => null);
    return info?.addresses.length ? { kind: 'lan', addresses: info.addresses, port: info.port } : null;
  };
  const deviceName = async (): Promise<string> =>
    (IS_ANDROID ? await window.girovoMobile?.deviceName() : await window.electronSync?.deviceName().catch(() => null))
      || (IS_ANDROID ? 'Android' : 'Computer');

  /** This device as the group's first: answers the code the next device takes, or null. */
  const createSync = useCallback(async (place: SyncPlaceChoice): Promise<string | null> => {
    const sid = sessionRef.current;
    if (!sid) return null;
    const said = msgs().sync;
    try {
      const full = await withAddresses(place);
      if (!full) {
        toast(said.failed, 'error');
        return null;
      }
      const r = await post<{ code: string }>('/api/sync', { op: 'create', sessionId: sid, place: full, deviceName: await deviceName() });
      await refreshSync();
      void syncNow(true);
      return r.code;
    } catch (err) {
      toast((err as Error).message || said.failed, 'error');
      return null;
    }
  }, [refreshSync, syncNow, toast]);

  /** The code for one more device (the desktop's addresses as they are now). */
  const syncCode = useCallback(async (): Promise<string | null> => {
    const sid = sessionRef.current;
    if (!sid) return null;
    try {
      const place = syncRef.current?.place === 'lan' && !IS_ANDROID ? await withAddresses({ kind: 'lan', addresses: [], port: 0 }) : null;
      const r = await post<{ code: string }>('/api/sync', { op: 'code', sessionId: sid, ...(place ? { place } : {}) });
      return r.code;
    } catch (err) {
      toast((err as Error).message || msgs().sync.failed, 'error');
      return null;
    }
  }, [toast]);

  /** This device into the group the code names (a folder of its own where the group meets in one). */
  const joinSync = useCallback(async (code: string, folder?: string): Promise<boolean> => {
    const sid = sessionRef.current;
    if (!sid) return false;
    const said = msgs().sync;
    try {
      await post('/api/sync', {
        op: 'join', sessionId: sid, code, deviceName: await deviceName(),
        ...(folder ? { place: { kind: 'folder', path: folder } } : {}),
      });
      await refreshSync();
      toast(said.joined, 'success');
      void syncNow(false);
      return true;
    } catch (err) {
      toast((err as Error).message || said.failed, 'error');
      return false;
    }
  }, [refreshSync, syncNow, toast]);

  const leaveSync = useCallback(async () => {
    const sid = sessionRef.current;
    if (!sid) return;
    const said = msgs().sync;
    try {
      const wasLan = syncRef.current?.place === 'lan';
      await post('/api/sync', { op: 'leave', sessionId: sid });
      if (wasLan && !IS_ANDROID) void window.electronSync?.lan(false);
      await refreshSync();
      toast(said.left, 'info');
    } catch (err) {
      toast((err as Error).message || said.failed, 'error');
    }
  }, [refreshSync, toast]);

  const openSync = useCallback(() => setSyncOpen(true), []);
  const closeSync = useCallback(() => setSyncOpen(false), []);

  const openBackgroundAsk = useCallback(() => setBackgroundAsk(true), []);
  const closeBackgroundAsk = useCallback(() => setBackgroundAsk(false), []);

  /** The desktop: the bank took the first login's PIN — what was kept with it may open now. */
  const pinTaken = useCallback((sid: string) => {
    void openLinkedUnlock(sid);
    void checkWindowsHello(sid);
    void checkSecurityKeys(sid);
  }, [openLinkedUnlock, checkWindowsHello, checkSecurityKeys]);

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
    // start the next session with yesterday's "today". Kept Umsätze, once
    // they arrive, widen it unless the user has picked one by then.
    setAppliedRange(defaultRange());
    rangeChosenRef.current = false;
    setView('dashboard');
    // The bank's messages are announced by the masthead's bell and the
    // Übersicht's Mitteilungen tile, both of which stay until they are read —
    // not by a toast as well (components/shell/MessagesTeaser.tsx).

    if (list[0]) {
      setActiveAccount(list[0]);
      activeAccountRef.current = list[0];
      // A remembered device's login: the first statement the bank answers is
      // its word on the PIN, and only then do the kept PINs open (connect).
      const afterRead = linkedAfterReadRef.current === sid;
      void loadTransactions(list[0], undefined, undefined, {
        onSettled: (outcome) => {
          if (afterRead && outcome === 'applied') pinTaken(sid);
          // The other accounts' Umsätze may follow ("Umsätze beim Anmelden
          // abrufen") — not after an approval called off or a failed read.
          if (outcome === 'applied' || outcome === 'skipped') setLoginReadSid(sid);
        },
      });
      // Synchronised (and approved, where the bank asked): the bank took the PIN.
      if (!afterRead && !IS_ANDROID) pinTaken(sid);
    }
    // Not a bank call: it runs beside the first statement, outside `busy`.
    void loadVault(sid);
    void loadDocs();
  }, [startSessionClock, setAppliedRange, loadTransactions, loadVault, loadDocs, pinTaken]);

  // Said after the fact, so the way back is right there: on a shared
  // computer "Gerät vergessen" is one press away, not a trip to the Sitzung
  // panel. The press opens the same confirmation the panel does — never the
  // deletion itself, which F6 then Enter would otherwise set off unasked.
  const setForgetDeviceOpen = useCallback((b: boolean) => setForgetDeviceOpenState(b), []);
  const notifyDeviceSaved = useCallback(() => {
    setDeviceRemembered(true);
    const said = msgs().provider.device;
    toast(said.saved, 'info', 10_000, {
      label: said.forget,
      run: () => setForgetDeviceOpenState(true),
    });
  }, [toast]);

  /** The login the bank is being asked for right now, so it can be called off. */
  const connectAttemptRef = useRef<{ id: string; ctrl: AbortController } | null>(null);

  /**
   * `unsealed` (Android): the PIN came from behind the fingerprint, and with
   * it the further banks' PINs kept beside it, which log in next. On the
   * desktop the PIN — typed, or from behind Windows Hello (`hello`) — opens
   * theirs (openLinkedUnlock). A PIN that was kept rather than typed is sent
   * as `kept`: the server does not ask the bank with one that no longer
   * opens the remembered device (app/api/connect).
   */
  const connect = useCallback(async (chosen: ChosenBank, login: string, pin: string, unsealed?: { linked: GirovoSealedLogin[]; hello?: true; securityKey?: true }) => {
    // "Zurück zur Anmeldung" from the TAN-method screen leaves the half-open
    // session behind; a new login replaces it.
    const previous = sessionRef.current;
    const attempt = { id: newAttemptId(), ctrl: new AbortController() };
    connectAttemptRef.current = attempt;
    let data: ConnectResponse;
    try {
      data = await post<ConnectResponse>('/api/connect', {
        blz: chosen.blz, userId: login, pin, attemptId: attempt.id, ...(unsealed ? { kept: true } : {}),
      }, { signal: attempt.ctrl.signal });
    } finally {
      if (connectAttemptRef.current === attempt) connectAttemptRef.current = null;
    }
    // Called off while the answer was on its way: it goes nowhere.
    if (attempt.ctrl.signal.aborted) throw new DOMException(msgs().provider.login.cancelled, 'AbortError');

    // A phone Girovo keeps nothing on (lib/device-integrity.ts) keeps no
    // login name either: the next login starts at the bank list again.
    const phone = IS_ANDROID ? window.girovoMobile : undefined;
    if (!phone || !keepsNothing(await phone.integrity().catch(() => null))) {
      store.set('fints.lastBank', JSON.stringify(chosen));
      store.set(`fints.userId.${chosen.blz}`, login);
    }

    setSessionId(data.sessionId);
    sessionRef.current = data.sessionId;
    openedLinkedRef.current = unsealed?.linked ?? [];
    // The desktop's kept PINs of the further banks open once the bank has
    // taken this PIN: at once after a synchronisation it answered, after the
    // first statement read for a remembered device, which opens on this
    // computer alone, with an old PIN too (afterAccountsReady).
    linkedAfterReadRef.current = null;
    helloLoginRef.current = { blz: chosen.blz, userId: login, bank: data.bank.bankName || chosen.name, hello: unsealed?.hello === true || unsealed?.securityKey === true };
    widgetClearedRef.current = false;
    // What was kept with this PIN opens once the bank has taken it: when the
    // Übersicht comes up after a synchronisation (and any approval it asked
    // for), after the first statement read for a remembered device
    // (afterAccountsReady).
    if (!IS_ANDROID) linkedAfterReadRef.current = 'restored' in data && data.restored ? data.sessionId : null;
    if (previous && previous !== data.sessionId) {
      // Only drops it from the server's memory (and the PIN with it) — no bank traffic.
      post('/api/logout', { sessionId: previous }).catch(() => {});
    }
    const named = { ...chosen, name: data.bank.bankName || chosen.name, brand: data.bank.brand, bic: data.bank.bic };
    setBank(named);
    setUserId(login);

    // The bank's notices arrive with the login synchronisation only; a
    // remembered device skips that round trip and so has none to show.
    const inbox = inboxOf('bankMessages' in data ? data.bankMessages || [] : [], new Date().toISOString(), named.name);
    messagesRef.current = inbox;
    setMessages(inbox);
    setMessagesAsked(!('restored' in data && data.restored));

    if ('restored' in data && data.restored) {
      // Remembered device: cached accounts + TAN method, no sync SCA. Set
      // before the accounts: the first statement load starts right away and
      // paces its approval by this method.
      setSelectedMethodBoth(data.selectedTanMethod);
      setTanMethodsBoth(data.selectedTanMethod ? [data.selectedTanMethod] : []);
      setDeviceRemembered(true);
      toast(msgs().provider.login.deviceRecognised);
      afterAccountsReady(data.accounts || []);
    } else if ('tanMethods' in data) {
      setTanMethodsBoth(data.tanMethods || []);
      setSelectedMethodBoth(null);
      setMediaChoice(null);
      // No method at all: the step's own heading says so (auth.tanMethod.none).
      setTanMethodError(null);
      setView('tanmethod');
      // A remembered device asked for an approval after all: say why.
      if (data.productChanged) toast(msgs().provider.login.productChanged, 'info', 10_000);
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
        startApproval(method, { ...data, tanMediaName: data.tanMediaName || media || null }, {
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
        if (data.restored) {
          // The bank knows this device under the previous product ID only: it opened as it is.
          setSelectedMethodBoth(data.selectedTanMethod ?? method);
          setDeviceRemembered(true);
          toast(msgs().provider.login.deviceRecognised);
        } else if (data.deviceSaved) notifyDeviceSaved();
        afterAccountsReady(data.accounts || []);
      }
    } catch (err) {
      if (!isCurrent(sid)) return;
      setTanMethodError({ text: (err as Error).message });
    }
  }, [isCurrent, startApproval, afterAccountsReady, notifyDeviceSaved, setSelectedMethodBoth, toast]);

  /** "Anderes Verfahren wählen" from the device list: back to the methods. */
  const clearMediaChoice = useCallback(() => setMediaChoice(null), []);

  // ---- more banks ---------------------------------------------------------
  // "Weitere Bank anmelden" runs the login's own steps — bank, Anmeldename
  // and PIN, Sicherheitsverfahren, Freigabe — for a session beside the
  // primary one, in a sheet over the dashboard (components/AddBank.tsx). The
  // new login joins the view only once its accounts are in and none of their
  // numbers collides with one already shown (lib/linked-banks.ts); whenever
  // the flow ends otherwise, its session is dropped. While its bank is asked
  // it holds `busy`, so no read can open a second approval meanwhile.

  const updateAddBank = useCallback((fn: (a: KeptAddBank) => KeptAddBank) => {
    const cur = addBankRef.current;
    if (cur) setAddBankBoth(fn(cur));
  }, [setAddBankBoth]);

  const holdFlowBusy = useCallback(() => {
    flowBusyRef.current = true;
    setBusy(true);
  }, [setBusy]);

  /** Lets go of `busy` — if the add flow is what holds it. */
  const releaseFlowBusy = useCallback(() => {
    if (!flowBusyRef.current) return;
    flowBusyRef.current = false;
    setBusy(false);
  }, [setBusy]);

  /**
   * `from`: a bank to start with — a remembered one, or one logged out — and
   * its login name, and (Android) its PIN when the first login's fingerprint
   * opened it. Every bank beside the one the app opens with needs Girovo
   * Plus in the Play build: without it, the Plus screen opens instead.
   */
  const openAddBank = useCallback((from?: { bank: ChosenBank; userId?: string; pin?: string }) => {
    if (!sessionRef.current || addBankRef.current) return;
    if (!bankAllowed(plusRef.current.state, false)) {
      setPlusOpen(true);
      return;
    }
    clearTransients();
    setAddBankBoth({
      step: from ? 'credentials' : 'bank',
      bank: from?.bank ?? null,
      prefill: from?.userId ? { blz: from.bank.blz, userId: from.userId } : null,
      tanMethods: [],
      selectedMethod: null,
      mediaChoice: null,
      error: null,
      sessionId: null,
      login: '',
      messages: [],
      openedPin: from?.pin ?? null,
      sealed: false,
      // Only the chain after a fingerprint login hands a PIN in.
      auto: !!from?.pin,
    });
  }, [clearTransients, setAddBankBoth]);

  /**
   * Closes the sheet: a login still being asked is called off, a half-open
   * one dropped. The view stays as it was, and the further banks a
   * fingerprint opened stay unasked.
   */
  const closeAddBank = useCallback(() => {
    const flow = addBankRef.current;
    if (!flow) return;
    openedLinkedRef.current = [];
    cancelConnect();
    dropSession(flow.sessionId);
    releaseFlowBusy();
    setAddBankBoth(null);
  }, [cancelConnect, releaseFlowBusy, setAddBankBoth]);

  /** A bank chosen in the sheet's picker, or null for "Ändern" (back to the picker). */
  const pickAddBank = useCallback((b: ChosenBank | null) => {
    updateAddBank((a) => ({ ...a, bank: b, step: b ? 'credentials' : 'bank', error: null }));
  }, [updateAddBank]);

  /** "Zurück zur Anmeldung" from the methods: the half-open login goes, the form comes back. */
  const addBankBack = useCallback(() => {
    const flow = addBankRef.current;
    if (!flow) return;
    dropSession(flow.sessionId);
    releaseFlowBusy();
    updateAddBank((a) => ({
      ...a, step: 'credentials', sessionId: null, tanMethods: [], selectedMethod: null, mediaChoice: null, error: null, messages: [],
    }));
  }, [releaseFlowBusy, updateAddBank]);

  const clearAddBankMedia = useCallback(() => updateAddBank((a) => ({ ...a, mediaChoice: null })), [updateAddBank]);

  /** Forgets everything read for these accounts: they have left the view. */
  const purgeAccounts = useCallback((numbers: readonly string[]) => {
    if (!numbers.length) return;
    const drop = <V,>(rec: Record<string, V>): Record<string, V> => numbers.reduce((r, n) => without(r, n), rec);
    balancesRef.current = drop(balancesRef.current);
    setBalances(drop);
    setBalanceAt(drop);
    // The lists and statementInfo are derived from these (listsOf).
    setFetchesBoth(drop(fetchesRef.current));
    setPendingFetched(drop);
    setNotedFetched(drop);
    setTxErrors(drop);
    setBalanceErrors(drop);
    setPendingErrors(drop);
  }, []);

  /**
   * The desktop: keeps the PINs of the further banks' sessions `sids` beside
   * the first login's, and turns it on. How many are kept now; the server's
   * refusal to say as it is (409: the kept PINs do not open with a PIN the
   * bank has not taken yet, lib/linked-unlock.ts); null when nothing could be.
   */
  const sealLinked = useCallback(async (sids: string[]): Promise<number | string | null> => {
    const primary = sessionRef.current;
    const secret = await linkedUnlockSecret();
    if (!primary || !secret) return null;
    try {
      const r = await post<{ on: boolean; count?: number }>('/api/linked-unlock', { op: 'seal', sessionId: primary, secret, linked: sids });
      if (isCurrent(primary)) setLinkedUnlockBoth(true);
      return typeof r.count === 'number' ? r.count : 0;
    } catch (err) {
      return err instanceof ApiError && err.status === 409 && err.message ? err.message : null;
    }
  }, [isCurrent, setLinkedUnlockBoth]);

  /**
   * The desktop's "Weitere Banken mit anmelden": on keeps the PINs of the
   * further banks logged in now (the dialog asked first) and of each one
   * logged in later; off deletes every one kept beside this login — and the
   * offer after a further bank's login does not come again.
   */
  const setLinkedUnlock = useCallback(async (on: boolean) => {
    const primary = sessionRef.current;
    if (!primary) return;
    const said = msgs().settings.linkedUnlock;
    if (on) {
      const sids = linksRef.current.flatMap((l) => (l.sessionId ? [l.sessionId] : []));
      const kept = await sealLinked(sids);
      // With no further bank logged in yet, nothing is kept until each one logs in once.
      if (typeof kept === 'number') toast(kept ? said.nowOn : said.nowOnLater, 'success');
      else toast(kept ?? said.failed, 'error');
      return;
    }
    // The further banks this login opened stay unasked: their PINs are what goes.
    openedLinkedRef.current = [];
    store.set(LINKED_OFFER_DECLINED, '1');
    try {
      await post('/api/linked-unlock', { op: 'off', sessionId: primary });
      if (isCurrent(primary)) setLinkedUnlockBoth(false);
      toast(said.nowOff, 'info');
    } catch {
      toast(said.failed, 'error');
    }
  }, [sealLinked, isCurrent, setLinkedUnlockBoth, toast]);

  const openLinkedUnlockAsk = useCallback(() => setLinkedUnlockAsk(true), []);
  const closeLinkedUnlockAsk = useCallback(() => setLinkedUnlockAsk(false), []);
  /** "Nicht jetzt" in its dialog: closed, and the offer after a further bank's login does not come again. */
  const declineLinkedUnlock = useCallback(() => {
    store.set(LINKED_OFFER_DECLINED, '1');
    setLinkedUnlockAsk(false);
  }, []);

  /**
   * One further bank's PIN kept beside the first login's goes — its bank
   * refused it (never tried twice: a few wrong tries lock the online
   * banking), it no longer fits, or the bank was removed. The desktop: out of
   * the first login's box (lib/linked-unlock.ts); Android: from behind its
   * fingerprint, that one copy and nothing else kept for either login.
   */
  const forgetLinkedPin = useCallback(async (login: { blz: string; userId: string }) => {
    const primary = sessionRef.current;
    if (IS_ANDROID) {
      const own = bankRef.current;
      if (primary && own && userIdRef.current) {
        await window.girovoMobile?.biometric.forgetLinked(own.blz, userIdRef.current, login.blz, login.userId);
      }
      return;
    }
    if (!primary || linkedUnlockRef.current !== true) return;
    const secret = await linkedUnlockSecret();
    if (!secret) return;
    await post('/api/linked-unlock', { op: 'forget', sessionId: primary, secret, login: { blz: login.blz, userId: login.userId } })
      .catch(() => { /* the next refusal asks again */ });
  }, []);

  /**
   * The desktop: a further bank logged in with its PIN typed. With "Weitere
   * Banken mit anmelden" on, its PIN is kept beside the first login's at
   * once; off, a toast offers to turn it on — once a session, and never again
   * after a "Nicht jetzt" in its dialog or the switch turned off.
   */
  const offerLinkedUnlock = useCallback(async (link: LinkedLogin) => {
    if (!link.sessionId || linkedUnlockRef.current === null) return;
    const said = msgs().settings.linkedUnlock;
    if (linkedUnlockRef.current) {
      const kept = await sealLinked([link.sessionId]);
      if (typeof kept === 'number') toast(said.sealed(link.bank.name), 'success');
      else toast(kept ?? said.sealFailed(link.bank.name), 'error');
      return;
    }
    if (linkedOfferedRef.current || store.get(LINKED_OFFER_DECLINED) === '1') return;
    linkedOfferedRef.current = true;
    toast(said.offer(link.bank.name), 'info', 12_000, { label: said.offerAction, run: () => setLinkedUnlockAsk(true) });
  }, [sealLinked, toast]);

  /**
   * Android, with fingerprint login on: a further bank logged in with its PIN
   * typed is sealed beside the first login's, after a fingerprint of its own
   * — the prompt is the question, "Nicht jetzt" the answer for this session.
   * Never on a phone no PIN may be sealed on.
   */
  const offerSeal = useCallback(async (link: LinkedLogin) => {
    const phone = IS_ANDROID ? window.girovoMobile : undefined;
    const primary = sessionRef.current;
    const own = bankRef.current;
    const name = userIdRef.current;
    const declined = `${link.bank.blz}|${link.userId}`;
    if (!phone || !primary || !own || !name || !link.sessionId || sealDeclinedRef.current.has(declined)) return;
    if (!(await phone.biometric.isOn(own.blz, name))) return;
    if (unsafePhone(await phone.integrity().catch(() => null)) || !isCurrent(primary)) return;
    const bio = msgs().android.biometric;
    const result = await phone.biometric.seal(primary, [link.sessionId], {
      title: bio.sealTitle,
      subtitle: bio.sealSubtitle(link.bank.name),
      cancel: bio.notNow,
    });
    if (result === 'sealed') toast(bio.sealed(link.bank.name), 'success');
    else if (result === 'canceled') sealDeclinedRef.current.add(declined);
    else if (result === 'failed') toast(bio.sealFailed(link.bank.name), 'error');
  }, [isCurrent, toast]);

  /**
   * The flow's login joins the view with `list` as its accounts — or does not,
   * and says why (KeptText, also kept as the sheet's error): an account
   * number already shown under another account, or nothing new at all. Its
   * session is dropped then. A linked bank logging in again takes its old
   * place, and whatever it no longer lists leaves with its data. As after a
   * login, the new bank's first account is opened — unless the bank logged
   * in on its own after a fingerprint login (Android), when the account on
   * screen stays.
   */
  const finishAddBank = useCallback((
    list: SerializedAccount[], method: SerializedTanMethod | null, device: boolean,
  ): KeptText | null => {
    const flow = addBankRef.current;
    const sid = flow?.sessionId;
    if (!flow || !sid || !flow.bank) return null;
    releaseFlowBusy();
    const chosen = flow.bank;
    const login = { blz: chosen.blz, userId: flow.login };
    const again = linksRef.current.find((l) => !l.sessionId && sameLogin({ blz: l.bank.blz, userId: l.userId }, login)) ?? null;
    const shown = again ? accountsRef.current.filter((a) => !again.accountNumbers.includes(a.accountNumber)) : accountsRef.current;
    // An account that only shares its number with one shown joins under its bank's key (lib/linked-banks.ts joinQualified).
    const blzOf = (a: SerializedAccount) => linksRef.current.find((l) => l.accountNumbers.includes(a.accountNumber))?.bank.blz ?? bankRef.current?.blz;
    // …and one a bank added before this one holds, whether or not it is logged in now: the order banks
    // were added decides which keeps the plain number, never the order they log in.
    const joined = joinQualified(shown, list, chosen.blz, blzOf, claimedBefore(vaultRef.current?.linkedBanks ?? [], login));
    let refusal: KeptText | null = null;
    if (joined.collisions.length) {
      const named = joined.collisions.map(({ incoming }) => incoming);
      refusal = (m) => m.banks.refused.collision(
        namesList(named.map((a) => m.insights.balances.quoted(a.product?.trim() || translateType(a.accountType)))),
        named.length,
        chosen.name,
      );
    } else if (!joined.added.length) {
      refusal = (m) => m.banks.refused.nothingNew(chosen.name);
    }
    if (refusal) {
      dropSession(sid);
      const said = refusal;
      // Back to the form, which says why: nothing further on this login would help.
      updateAddBank((a) => ({
        ...a, step: 'credentials', prefill: login, sessionId: null, tanMethods: [], selectedMethod: null, mediaChoice: null,
        messages: [], error: said,
      }));
      return refusal;
    }

    const link: LinkedLogin = {
      id: again?.id ?? newId(),
      bank: chosen,
      userId: flow.login,
      sessionId: sid,
      accountNumbers: joined.added.map((a) => a.accountNumber),
      method,
      deviceRemembered: device,
    };
    const before = linksRef.current;
    const owned = new Set(before.flatMap((l) => l.accountNumbers));
    const current = new Map(accountsRef.current.map((a) => [a.accountNumber, a] as const));
    const nextLinks = again ? before.map((l) => (l.id === again.id ? link : l)) : [...before, link];
    // The primary login's accounts first, then each linked bank's, in order.
    const nextAccounts = [
      ...accountsRef.current.filter((a) => !owned.has(a.accountNumber)),
      ...nextLinks.flatMap((l) => (l.id === link.id ? joined.added : l.accountNumbers.flatMap((n) => current.get(n) ?? []))),
    ];
    if (again) purgeAccounts(again.accountNumbers.filter((n) => !link.accountNumbers.includes(n)));
    setLinksBoth(nextLinks);
    accountsRef.current = nextAccounts;
    setAccounts(nextAccounts);
    // Its login keeps documents of its own.
    void loadDocs();

    // Its login's messages, once — logging in again brings the same ones.
    const known = new Set(messagesRef.current.map((m) => `${m.bank}\n${m.subject}\n${m.text}`));
    const inbox = inboxOf(flow.messages, new Date().toISOString(), chosen.name)
      .filter((m) => !known.has(`${m.bank}\n${m.subject}\n${m.text}`));
    if (inbox.length) {
      messagesRef.current = [...messagesRef.current, ...inbox];
      setMessages(messagesRef.current);
    }
    // Kept in the primary login's store — BLZ, name and login name — for the next login's offer.
    updateVault((v) => {
      const next = rememberLinkedBank(v.linkedBanks ?? [], { ...login, name: chosen.name, accounts: list.map((a) => a.accountNumber) });
      return JSON.stringify(next) === JSON.stringify(v.linkedBanks ?? []) ? v : withLinkedBanks(v, next);
    });
    setAddBankBoth(null);
    // Its Umsätze are kept on this computer when this view keeps them: the
    // server follows the primary login's choice for it from now on.
    const primary = sessionRef.current;
    if (primary && link.sessionId) {
      void post('/api/history', { sessionId: link.sessionId, op: 'follow', primary })
        .then(() => loadLinkedHistory(link))
        .catch(() => { /* that bank's answers are then simply not kept */ });
    }
    toast(msgs().banks.added(chosen.name, joined.added.length), 'success');
    // A bank logged in on its own after the fingerprint leaves the account on
    // screen where it was: the user did not ask for that bank.
    if (!flow.auto) selectAccount(joined.added[0]);
    if (!flow.sealed) void (IS_ANDROID ? offerSeal(link) : offerLinkedUnlock(link));
    return null;
  }, [releaseFlowBusy, updateAddBank, purgeAccounts, setLinksBoth, updateVault, setAddBankBoth, toast, selectAccount, loadLinkedHistory, offerSeal, offerLinkedUnlock]);

  /**
   * Step two of the flow: the bank is asked for this login, a session of its
   * own. `unsealed` (Android): its PIN came from behind the fingerprint.
   */
  const connectAddBank = useCallback(async (chosen: ChosenBank, login: string, pin: string, unsealed?: { linked: GirovoSealedLogin[] }) => {
    const primary = sessionRef.current;
    if (!primary || !addBankRef.current) return;
    // Kept, not typed: from behind the fingerprint, or opened by the first login (app/api/connect `kept`).
    const kept = !!unsealed || (!!addBankRef.current.openedPin && addBankRef.current.openedPin === pin);
    // An opened PIN is tried once: what happens next is this attempt's.
    if (addBankRef.current.openedPin) updateAddBank((a) => ({ ...a, openedPin: null }));
    const said = msgs().banks;
    const asked = { blz: chosen.blz, userId: login };
    // The same login twice would be one access in two sessions. A linked bank
    // whose session ended is the exception: that is logging in again.
    const same = linksRef.current.find((l) => sameLogin({ blz: l.bank.blz, userId: l.userId }, asked));
    const primaryLogin = bankRef.current ? { blz: bankRef.current.blz, userId: userIdRef.current } : null;
    // Turned down before the bank is asked: nothing said about the PIN.
    if ((primaryLogin && sameLogin(primaryLogin, asked)) || same?.sessionId) throw notAboutPin(said.refused.sameLogin(chosen.name));
    if (!same && linksRef.current.length >= LINKED_BANK_LIMITS.count) {
      throw notAboutPin(said.refused.tooMany(LINKED_BANK_LIMITS.count));
    }
    if (busyRef.current) throw notAboutPin(msgs().provider.busy);

    const attempt = { id: newAttemptId(), ctrl: new AbortController() };
    connectAttemptRef.current = attempt;
    updateAddBank((a) => (a.error === null ? a : { ...a, error: null }));
    holdFlowBusy();
    let data: ConnectResponse;
    try {
      data = await post<ConnectResponse>('/api/connect', {
        blz: chosen.blz, userId: login, pin, attemptId: attempt.id, ...(kept ? { kept: true } : {}),
      }, { signal: attempt.ctrl.signal });
    } catch (err) {
      if (isCurrent(primary)) releaseFlowBusy();
      throw err;
    } finally {
      if (connectAttemptRef.current === attempt) connectAttemptRef.current = null;
    }
    if (attempt.ctrl.signal.aborted) throw new DOMException(msgs().provider.login.cancelled, 'AbortError');
    // Logged out, or the sheet closed, while the bank answered: the new session goes at once.
    if (!isCurrent(primary) || !addBankRef.current) {
      dropSession(data.sessionId);
      return;
    }
    const named: ChosenBank = { ...chosen, name: data.bank.bankName || chosen.name, brand: data.bank.brand, bic: data.bank.bic };
    updateAddBank((a) => ({
      ...a, bank: named, sessionId: data.sessionId, login, messages: 'bankMessages' in data ? data.bankMessages || [] : [],
      sealed: !!unsealed,
    }));
    if ('restored' in data && data.restored) {
      // A remembered device: the accounts come at once, without an approval.
      // A refusal now is the view's, after the bank took the PIN.
      const refusal = finishAddBank(data.accounts || [], data.selectedTanMethod, true);
      if (refusal) throw notAboutPin(written(refusal, msgs()));
      return;
    }
    releaseFlowBusy();
    const methods = 'tanMethods' in data ? data.tanMethods || [] : [];
    updateAddBank((a) => ({
      ...a,
      step: 'method',
      tanMethods: methods,
      selectedMethod: null,
      mediaChoice: null,
      // No method at all: the step's own heading says so (auth.tanMethod.none).
      error: null,
    }));
    if ('productChanged' in data && data.productChanged) toast(msgs().provider.login.productChanged, 'info', 10_000);
  }, [isCurrent, holdFlowBusy, releaseFlowBusy, updateAddBank, finishAddBank, toast]);

  /** Step three: the method (and device) that approves this login — then the usual approval, naming the bank. */
  const chooseAddBankMethod = useCallback(async (method: SerializedTanMethod, tanMediaName?: string) => {
    const primary = sessionRef.current;
    const flow = addBankRef.current;
    const sid = flow?.sessionId;
    if (!primary || !flow?.bank || !sid) return;
    if (busyRef.current) {
      updateAddBank((a) => ({ ...a, error: (m) => m.provider.busy }));
      return;
    }
    const asking = { name: flow.bank.name, brand: flow.bank.brand };
    updateAddBank((a) => ({ ...a, selectedMethod: method, mediaChoice: null, error: null }));
    const media = tanMediaName || (method.activeTanMedia?.length === 1 ? method.activeTanMedia[0] : undefined);
    // Logged out, closed, or gone back to the form while the bank answered.
    const stale = () => !isCurrent(primary) || addBankRef.current?.sessionId !== sid;
    holdFlowBusy();
    try {
      const data = await post<SelectTanResponse>('/api/select-tan', {
        sessionId: sid, tanMethodId: method.id, tanMediaName: media,
      });
      if (stale()) return;
      if ('chooseTanMedia' in data) {
        releaseFlowBusy();
        updateAddBank((a) => ({ ...a, mediaChoice: data.chooseTanMedia }));
        return;
      }
      if ('needsTan' in data && data.needsTan) {
        // `busy` stays held through the approval.
        startApproval(method, { ...data, tanMediaName: data.tanMediaName || media || null }, {
          onDone: (r) => {
            if (r.kind === 'accounts') finishAddBank(r.accounts || [], method, r.deviceSaved);
            else releaseFlowBusy();
          },
          retry: () => {
            releaseFlowBusy();
            void chooseAddBankMethodRef.current(method, media);
          },
          // Called off (or closed once refused): the login goes, the view stays as it was.
          onCancelled: () => {
            closeAddBank();
            toast(msgs().banks.cancelled(asking.name), 'info');
          },
        }, { kind: 'login', sessionId: sid, bank: asking });
        return;
      }
      // `restored`: the bank knows this device under the previous product ID only, and it opened as it is.
      if ('accounts' in data) {
        if (data.restored) finishAddBank(data.accounts || [], data.selectedTanMethod ?? method, true);
        else finishAddBank(data.accounts || [], method, data.deviceSaved);
      }
    } catch (err) {
      if (stale()) return;
      releaseFlowBusy();
      updateAddBank((a) => ({ ...a, error: (err as Error).message }));
    }
  }, [isCurrent, updateAddBank, holdFlowBusy, releaseFlowBusy, startApproval, finishAddBank, closeAddBank, toast]);

  const chooseAddBankMethodRef = useRef(chooseAddBankMethod);
  chooseAddBankMethodRef.current = chooseAddBankMethod;

  /**
   * "Bank entfernen": a linked bank leaves the view — logged out, its
   * accounts and what was read for them gone — and the primary login's store
   * forgets it. A remembered one is only forgotten.
   */
  const removeBank = useCallback((entry: BankEntry) => {
    if (entry.state === 'primary') return;
    if (busyRef.current) {
      toast(msgs().provider.busy, 'info');
      return;
    }
    const link = linksRef.current.find((l) => l.id === entry.key) ?? null;
    const login = link ? { blz: link.bank.blz, userId: link.userId } : entry.ref;
    if (link) {
      dropSession(link.sessionId);
      const gone = new Set(link.accountNumbers);
      setLinksBoth(linksRef.current.filter((l) => l.id !== link.id));
      const nextAccounts = accountsRef.current.filter((a) => !gone.has(a.accountNumber));
      accountsRef.current = nextAccounts;
      setAccounts(nextAccounts);
      purgeAccounts(link.accountNumbers);
      const active = activeAccountRef.current;
      // Back to every account, the first remaining one active — without a
      // read: removing a bank must not start one (it may ask for an approval).
      if (active && gone.has(active.accountNumber) && nextAccounts[0]) {
        activeAccountRef.current = nextAccounts[0];
        setActiveAccount(nextAccounts[0]);
        setAccountOpen(false);
      }
    }
    if (login) {
      updateVault((v) => (v.linkedBanks?.some((r) => sameLogin(r, login))
        ? withLinkedBanks(v, forgetLinkedBank(v.linkedBanks, login))
        : v));
      // Its PIN kept beside the first login's goes with it (Android: behind
      // the fingerprint; the desktop: lib/linked-unlock.ts).
      openedLinkedRef.current = openedLinkedRef.current.filter((l) => !sameLogin(l, login));
      const own = bankRef.current;
      if (IS_ANDROID && own) void window.girovoMobile?.biometric.forgetLinked(own.blz, userIdRef.current, login.blz, login.userId);
      else void forgetLinkedPin(login);
      void forgetBackgroundLogin(login);
    }
    toast(msgs().banks.removed(entry.bank.name), 'info');
  }, [toast, setLinksBoth, purgeAccounts, selectAccount, updateVault, forgetLinkedPin, forgetBackgroundLogin]);

  /**
   * A linked bank's session ended (the server answered 401 for it): only that
   * bank is logged out. Its accounts stay as they were last read, marked, with
   * the way to log in again.
   */
  const endLink = useCallback((sid: string) => {
    const link = linksRef.current.find((l) => l.sessionId === sid);
    if (!link) return;
    setLinksBoth(linksRef.current.map((l) => (l.id === link.id ? { ...l, sessionId: null } : l)));
    const said = msgs().banks;
    toast(said.ended(link.bank.name), 'info', 10_000, {
      label: said.loginAgain,
      run: () => openAddBank({ bank: link.bank, userId: link.userId }),
    });
  }, [setLinksBoth, toast, openAddBank]);
  endLinkRef.current = endLink;

  // ---- device + session ---------------------------------------------------
  /**
   * `wipeData`: delete the saved personal data from this machine as well —
   * what someone handing the computer on wants (wipeVaultWith).
   */
  const forgetDevice = useCallback(async (opts?: { wipeData?: boolean }) => {
    // Android: a PIN kept behind the fingerprint is part of what this phone
    // remembers about the login, so it goes with the device profile.
    const name = userIdRef.current;
    const blz = bankRef.current?.blz;
    if (IS_ANDROID && blz && name) void window.girovoMobile?.biometric.forget(blz, name);
    // …and so is the Gesamtsaldo the home screen widget shows.
    if (IS_ANDROID) {
      widgetClearedRef.current = true;
      void window.girovoMobile?.widget?.clear();
    }
    if (opts?.wipeData === true) {
      if (await wipeVaultWith((sid, linked) => post('/api/forget-device', { sessionId: sid, wipeData: true, linked }))) {
        setDeviceRemembered(false);
        toast(msgs().provider.device.forgottenAndWiped, 'success', 8000);
      }
      return;
    }
    try {
      await post('/api/forget-device', { sessionId: sessionRef.current });
      setDeviceRemembered(false);
      // The route deleted the further banks' PINs kept beside the login too,
      // the login's own one kept for Windows Hello, and every one kept for
      // "Neue Umsätze melden".
      openedLinkedRef.current = [];
      if (linkedUnlockRef.current) setLinkedUnlockBoth(false);
      if (windowsHelloRef.current) setWindowsHelloBoth(false);
      if (securityKeysRef.current?.length) setSecurityKeysBoth([]);
      if (backgroundRef.current) {
        setBackgroundBoth(false);
        void shellSchedule(false);
      }
      toast(msgs().provider.device.forgotten, 'info', 6000);
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }, [toast, wipeVaultWith, setLinkedUnlockBoth, setWindowsHelloBoth, setSecurityKeysBoth, setBackgroundBoth]);

  /** Everything a session owns, back to its pre-login state. Preferences stay. */
  const resetSession = useCallback(() => {
    // Girovo Next: the conversations about the bookings end with the session.
    clearAsk();
    waitGenRef.current++;
    waitCbRef.current = {};
    stopTimers();
    if (vaultTimerRef.current) { clearTimeout(vaultTimerRef.current); vaultTimerRef.current = null; }

    sessionRef.current = null;
    readySidRef.current = null;
    setSessionId(null);
    linksRef.current = [];
    setLinks([]);
    addBankRef.current = null;
    setAddBankState(null);
    openedLinkedRef.current = [];
    sealDeclinedRef.current.clear();
    setLinkedUnlockBoth(null);
    setLinkedUnlockAsk(false);
    linkedAfterReadRef.current = null;
    linkedOfferedRef.current = false;
    setWindowsHelloBoth(null);
    setSecurityKeysBoth(null);
    helloLoginRef.current = null;
    setBackgroundBoth(null);
    setBackgroundAsk(false);
    touchedRef.current = {};
    setSyncBoth(null);
    setSyncOpen(false);
    syncQueueRef.current = null;
    flowBusyRef.current = false;
    waitSidRef.current = null;
    transferSidRef.current = null;
    accountsRef.current = [];
    setAccounts([]);
    activeAccountRef.current = null;
    setActiveAccount(null);
    setAccountOpen(false);
    setOrdersOpen(false);
    balancesRef.current = {};
    setBalances({});
    setBalanceAt({});
    txCacheRef.current = {};
    setFetchesBoth({});
    setPendingFetched({});
    setNotedFetched({});
    historyLoadGenRef.current++;
    setHistoryBoth(null);
    setHistoryStatusBoth('off');
    setSavedRangeBoth(false);
    rangeChosenRef.current = false;
    setMerchants({});
    merchantsAsked.current.clear();
    setModelGuesses({});
    guessesAsked.current.clear();
    setBrandNamesState(new Map());
    namesAsked.current.clear();
    setSelectedMethodBoth(null);
    setTanMethodsBoth([]);
    setMediaChoice(null);
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
    setPortfolios({});
    setPortfolioErrors({});
    setPortfolioLoading(null);
    docsGenRef.current++;
    docsRef.current = [];
    setDocs([]);
    setDocsLocked(false);
    setDocsResettable(false);
    setBankStatementsLoading(null);
    setStatementFetches({});
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
    setForgetDeviceOpenState(false);
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
  }, [
    stopTimers, setBusy, setAppliedRange, setVaultStatusBoth, setSelectedMethodBoth, setTanMethodsBoth,
    setFetchesBoth, setHistoryBoth, setHistoryStatusBoth, setSavedRangeBoth,
  ]);

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
    if (reason !== 'idle' && reason !== 'expired' && reason !== 'cancelled' && reason !== 'hidden') reason = 'user';
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
    if (w.open && placesOrder(w.kind) && !waitHoldsSession(w)) {
      unclear.unshift(lastTransferRef.current?.recipientName.trim() ?? '');
    }
    // Every login of the view goes with it: the linked banks', and one being
    // added (still being asked: called off).
    const sids = [sid, ...linksRef.current.map((l) => l.sessionId), addBankRef.current?.sessionId]
      .filter((s): s is string => !!s);
    cancelConnect();
    resetSession();
    setAutoLoggedOut(reason === 'idle' || reason === 'expired');

    let notice: number | null = null;
    let said: 'user' | 'cancelled' | 'hidden' | null = null;
    if (reason === 'idle') {
      toast(idleLogoutNotice(unclear, unclear.length), 'info', IDLE_NOTICE_MS);
    } else if (reason === 'expired') {
      toast(msgs().provider.logout.expired, 'error');
    } else {
      // An unclear transfer named stays as long as the idle notice does: the
      // window closed into the notification area shows it only when it is back.
      said = reason;
      notice = toast(logoutNotice(said, false, unclear), 'info', unclear.length ? IDLE_NOTICE_MS : 6000);
    }

    await Promise.race([saved, delay(LOGOUT_FLUSH_TIMEOUT_MS)]);
    // Best effort — the server's 30-minute sweep remains. The PIN is said to
    // be gone only once every session that held one confirmed it.
    const results = await Promise.allSettled(sids.map((s) => post('/api/logout', { sessionId: s })));
    const dropped = results.every((r) => r.status === 'fulfilled');
    if (notice != null && said && dropped) {
      rewordToast(notice, logoutNotice(said, true, unclear));
    }
  }, [flushVault, cancelConnect, resetSession, toast, rewordToast]);

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
      if (!sessionRef.current) return;
      if (refused && refused !== sessionRef.current) {
        // A linked bank's ends that bank alone; anything else is a straggler.
        endLinkRef.current(refused);
        return;
      }
      void logoutRef.current('expired');
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  // A bank turned a session's PIN down on a call within it (lib/client-api.ts
  // PIN_REFUSED_EVENT): a PIN that opened the remembered device on this
  // computer but is not the bank's any more. Nothing more may go out with it
  // — a few wrong tries lock the online banking. A further bank's session
  // ends at once, so its next reads stay unasked; its remembered device
  // (which opens with that PIN alone) goes, and so does its PIN where it is
  // kept. The first login's own: its remembered device goes and, on Android,
  // the PIN behind the fingerprint, so the next login asks the bank first.
  useEffect(() => {
    const onRefused = (e: Event) => {
      const sid = (e as CustomEvent<SessionExpiredDetail>).detail?.sessionId;
      if (!sid || !sessionRef.current) return;
      const said = msgs().banks;
      const own = bankRef.current;
      const link = linksRef.current.find((l) => l.sessionId === sid);
      if (link) {
        const login = { blz: link.bank.blz, userId: link.userId };
        setLinksBoth(linksRef.current.map((l) => (l.id === link.id ? { ...l, sessionId: null } : l)));
        openedLinkedRef.current = openedLinkedRef.current.filter((l) => !sameLogin(l, login));
        // With its session, while the server still has it: the PIN is noted as
        // refused there, for a copy of it kept beside some other login
        // (app/api/forget-device). Then the session goes; nothing here uses it any more.
        void post('/api/forget-device', { ...login, sessionId: sid, refused: true })
          .catch(() => { /* asked again with the next refusal */ })
          .finally(() => dropSession(sid));
        if (IS_ANDROID && own) void window.girovoMobile?.biometric.forgetLinked(own.blz, userIdRef.current, login.blz, login.userId);
        else void forgetLinkedPin(login);
        void forgetBackgroundLogin(login);
        toast(said.pinRefused(link.bank.name), 'error', 15_000, {
          label: said.loginAgain,
          run: () => openAddBank({ bank: link.bank, userId: link.userId }),
        });
        return;
      }
      if (sid !== sessionRef.current || !own) return;
      // Refused, not forgotten: the other banks' kept PINs for the checks stay (forgetBackgroundLogin below).
      void post('/api/forget-device', { sessionId: sid, refused: true }).catch(() => { /* asked again with the next refusal */ });
      setDeviceRemembered(false);
      if (IS_ANDROID && userIdRef.current) void window.girovoMobile?.biometric.forget(own.blz, userIdRef.current);
      // The desktop: the PIN kept for Windows Hello is that same refused one.
      if (!IS_ANDROID && userIdRef.current) {
        void forgetHello({ blz: own.blz, userId: userIdRef.current });
        if (windowsHelloRef.current) setWindowsHelloBoth(false);
        void forgetSecurityKeys({ blz: own.blz, userId: userIdRef.current });
        if (securityKeysRef.current?.length) setSecurityKeysBoth([]);
      }
      // …and so is the one the checks for new Umsätze would use.
      if (userIdRef.current) void forgetBackgroundLogin({ blz: own.blz, userId: userIdRef.current });
      // The route took the further banks' PINs sealed with it too (.linked): the switch says so.
      if (linkedUnlockRef.current) setLinkedUnlockBoth(false);
      toast(said.firstPinRefused(own.name), 'error', 20_000);
    };
    window.addEventListener(PIN_REFUSED_EVENT, onRefused);
    return () => window.removeEventListener(PIN_REFUSED_EVENT, onRefused);
  }, [setLinksBoth, forgetLinkedPin, forgetBackgroundLogin, openAddBank, setWindowsHelloBoth, setSecurityKeysBoth, setLinkedUnlockBoth, toast]);

  // The desktop with "Neue Umsätze melden" on: closing the window leaves the
  // app in the notification area (src-tauri/src/background.rs). The bank session ends
  // as it did when closing quit the app, so the window opened again from
  // there shows the login. The login screen names any transfer left unclear —
  // and since nobody sees the window now, a system notice names it at once.
  useEffect(() => {
    const off = window.electronBackground?.onHidden?.(() => {
      // Not while an approval runs or an order is on its way to the bank
      // (busy, before any approval shows): the idle logout follows once it is
      // over, as it never cuts one off either.
      if (!sessionRef.current || waitRef.current.open || busyRef.current) return;
      const unclear = unclearTransfers(activityRef.current).map((e) => e.name);
      if (unclear.length) {
        void window.electronBackground?.notice?.({ title: msgs().provider.logout.hiddenTitle, text: unclearNotice(unclear) })
          .catch(() => { /* the login screen's notice remains */ });
      }
      void logout('hidden');
    });
    return off;
  }, [logout]);

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
      iban: compactIban(p.iban),
      amount: typedAmount(p.amount),
      instant: p.instant,
      ...(p.schedule ? { schedule: p.schedule } : {}),
      ...(text ? { message: text } : {}),
    };
    setActivity((list) => [entry, ...list].slice(0, MAX_ACTIVITY));
    const inFlight = sentOrderRef.current;
    sentOrderRef.current = null;
    if (outcome === 'failed') {
      if (inFlight) logSentOrder(null, inFlight);
    } else if (!p.change) {
      logSentOrder(sentOrderOf(p, outcome, inFlight?.at ?? entry.at), inFlight);
    }
    // The bank's list of that kind no longer says how things stand: it is
    // dropped rather than shown as if it did, and read again on request.
    const s = p.schedule;
    if (s && outcome !== 'failed') {
      setBankOrders((c) => (c[p.accountNumber]?.[s.kind]
        ? { ...c, [p.accountNumber]: { ...c[p.accountNumber], [s.kind]: undefined } }
        : c));
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
      const sent = p && !p.change ? sentOrderOf(p, 'unknown', new Date().toISOString()) : null;
      sentOrderRef.current = sent;
      if (sent) logSentOrder(sent, null);
      startApproval(methodFor(p?.accountNumber), data, {
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
        // A change of a bank-held order says so: the order exists already.
        kind: p?.change ? 'orderChange' : orderWaitKind(p?.schedule),
        order: p
          ? {
            amount: typedAmount(p.amount), name: sepaSanitize(p.recipientName), iban: compactIban(p.iban), instant: p.instant,
            schedule: p.schedule ?? null,
          }
          : null,
        sessionId: transferSidRef.current ?? undefined,
      });
      return;
    }
    // Executed without an approval. Unconditional, so an answer missing its
    // bank texts cannot leave `busy` stuck on.
    setBusy(false);
    handlers.onExecuted(data.bankAnswers);
  }, [setBusy, startApproval, methodFor, closeWait, logSentOrder]);

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
      handlers.onError(msgs().provider.busy); // never sent, so not logged
      return;
    }
    const sid = sessionRef.current;
    // Sent through the login that holds the account it goes from — never another bank's.
    const route = sessionFor(payload.accountNumber);
    if (!route) {
      handlers.onError(written(loggedOutText(payload.accountNumber), msgs())); // never sent either
      return;
    }
    lastTransferRef.current = payload;
    transferSidRef.current = route;
    sentOrderRef.current = null;
    const h = withActivity(handlers);
    setBusy(true);
    try {
      const data = await post<TransferResponse>('/api/transfer', {
        sessionId: route, ...payload,
      });
      if (!isCurrent(sid)) return;
      handleTransferAnswer(data, h);
    } catch (err) {
      if (!isCurrent(sid)) return;
      settleTransferError(err, h);
    }
  }, [withActivity, setBusy, isCurrent, sessionFor, loggedOutText, handleTransferAnswer, settleTransferError]);

  /**
   * "Send it anyway" after a Namensabgleich flagged the payee name. The server
   * still holds the original order and replays it with the bank's VOP-ID; the
   * bank then issues a fresh challenge, so this lands back in the TAN wait.
   */
  const confirmVop = useCallback(async (handlers: TransferHandlers) => {
    if (busyRef.current) {
      handlers.onError(msgs().provider.busy);
      return;
    }
    const sid = sessionRef.current;
    const h = withActivity(handlers);
    setBusy(true);
    try {
      // The session that holds the parked order: the one it was sent with.
      const data = await post<TransferResponse>('/api/vop-confirm', { sessionId: transferSidRef.current ?? sid });
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
    try {
      await post('/api/cancel-pending', { sessionId: transferSidRef.current ?? sessionRef.current });
    } catch { /* best effort */ }
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

  // Kept bookings a list adds get their company logos like the bank's —
  // only with the user's yes, and each booking offered once (a kept history
  // can run to thousands; resolveMerchants then asks for each name once).
  // A yes given later catches up on everything loaded (setLogoConsent).
  const offeredForLogos = useRef(new WeakSet<SerializedTransaction>());
  useEffect(() => {
    if (logoConsentRef.current !== 'on') return;
    const fresh = Object.values(txByAccount).flat().filter((t) => !offeredForLogos.current.has(t));
    for (const t of fresh) offeredForLogos.current.add(t);
    if (fresh.length) void resolveMerchants(fresh);
  }, [txByAccount, resolveMerchants]);

  // What the user files for one booking — category, split, note, receipt —
  // hangs on the booking's key, which goes by the bank's day now
  // (lib/categories.ts txKey). What is still filed under the key before
  // moves to the key its booking has now as bookings become known — the kept
  // Umsätze, a statement read, an imported file, the Vorgemerkte — and only
  // where it can be no other booking's (lib/booking-keys.ts). A key from
  // before that names the day before waits until every account of every
  // bank logged in has its list: the twin it may belong to could be at any.
  // Every bank of the view counts — those the vault remembers beside this
  // login too — and all of their accounts, hidden ones included: until each
  // is logged in this session with its list loaded, such a key waits (and
  // its entry is shown meanwhile, readMoves).
  const rememberedBanks = vault?.linkedBanks;
  const bookingKeyMoves = useMemo(() => {
    const allIn = !!sessionId && (rememberedBanks ?? []).every((r) => links.some((l) => !!l.sessionId && sameLogin({ blz: l.bank.blz, userId: l.userId }, r)));
    const required = accounts.filter((a) => a.canStatements && !isDepot(a)).map((a) => a.accountNumber);
    // A bank not logged in is an account no list covers: nothing that names another day moves.
    return keyMoves(bookingGroups, { accounts: allIn ? required : [...required, '\u0000logged-out'] });
  }, [bookingGroups, accounts, sessionId, rememberedBanks, links]);
  // The moves as they stand now: read when they are carried out (a sync round, an update), never a set from before a wait.
  const bookingKeyMovesRef = useRef(bookingKeyMoves);
  bookingKeyMovesRef.current = bookingKeyMoves;
  const movingReceipts = useRef(new Set<string>());
  // Receipts that could not be tied to their key now: not tried again this session (a new login's are).
  const failedReceipts = useRef(new Set<string>());
  const movesAsked = useRef<KeyMoves | null>(null);
  // The vault as the page reads it (lib/booking-keys.ts showFiled): what is
  // not moved yet shown under the booking it leads to, a key twins may own
  // on each of them. Worked out again only for a part whose maps changed: a
  // note written leaves the categories the same object, and every booking's
  // category is not worked out again.
  const shownPrev = useRef<ShownFiled | undefined>(undefined);
  const shownFiled = useMemo(
    () => (shownPrev.current = showFiled(vault ?? EMPTY_VAULT, readMoves, sharedReads, shownPrev.current)),
    [vault, readMoves, sharedReads],
  );
  // The keys from before a choice for a booking clears: every one that leads to it (keysLeadingTo).
  const leadingNow = useMemo(() => keysLeadingTo(readMoves), [readMoves]);
  const leadingRef = useRef(leadingNow);
  leadingRef.current = leadingNow;
  const [filedCategories, filedSplits, filedNotes] = [vault?.txCategories, vault?.splits, vault?.notes];
  useEffect(() => {
    if (!bookingKeyMoves.size || view !== 'dashboard' || vaultStatus === 'idle' || vaultStatus === 'loading') return;
    // Without sync the page ties every receipt anew; with sync only a further bank's (the round ties the first login's).
    const receipts = (synced: boolean) => pageTies(docsRef.current, bookingKeyMovesRef.current, { synced, primary: sessionRef.current })
      .filter((m) => !movingReceipts.current.has(m.doc.id) && !failedReceipts.current.has(`${m.doc.sid}|${m.doc.id}`));
    const filed = vaultRef.current ?? EMPTY_VAULT;
    const entries = moveEntries(filed, bookingKeyMoves) !== filed;
    if (!entries && !receipts(false).length) return;
    const sid = sessionRef.current;
    void (async () => {
      if (syncRef.current === null) await refreshSync();
      // Whether sync is on is not known: nothing is moved, here or in a round, until it is.
      if (!isCurrent(sid) || syncRef.current === null) return;
      const synced = syncRef.current.on === true;
      if (entries && synced && vaultStatusRef.current === 'ready') {
        // With sync on, inside a round: after the merge, with every entry's
        // stamp (lib/sync.ts) — the round sends the moves as they stand then.
        // Asked for once per set of moves; the rounds that run by themselves
        // take them along as well.
        if (movesAsked.current !== bookingKeyMoves) {
          movesAsked.current = bookingKeyMoves;
          await syncNow(true);
        }
      } else if (entries) {
        updateVault((v) => moveEntries(v, bookingKeyMovesRef.current, { maxBytes: VAULT_MAX_BYTES }));
      }
      // With sync on the round ties the first login's receipts anew, at their own stamps (lib/sync-entries.ts moveMergedKeys).
      for (const { doc, tx } of receipts(synced)) {
        // Another pass has it, or has tied it anew meanwhile.
        if (!isCurrent(sid) || movingReceipts.current.has(doc.id) || !docsRef.current.some((d) => d.id === doc.id && d.tx === doc.tx)) continue;
        movingReceipts.current.add(doc.id);
        try {
          const r = await post<DocResponse>('/api/docs', { sessionId: doc.sid, op: 'link', id: doc.id, tx, accountNumber: doc.accountNumber });
          if (isCurrent(sid)) setDocsBoth(docsRef.current.map((d) => (d.id === doc.id ? { ...r.doc, sid: doc.sid } : d)));
        } catch {
          failedReceipts.current.add(`${doc.sid}|${doc.id}`);
        } finally {
          movingReceipts.current.delete(doc.id);
        }
      }
    })();
  }, [
    bookingKeyMoves, view, vaultStatus, filedCategories, filedSplits, filedNotes, docs,
    refreshSync, syncNow, isCurrent, updateVault, setDocsBoth,
  ]);

  /** "Umsätze auf diesem Rechner behalten": the vault's word, off unless it says so. */
  const keepBookings = vault?.keepBookings === true;
  /** Per account, the days kept — what the Zeitraum control plans with (lib/history.ts). */
  const keptCoverage = useMemo(() => historyCoverage(keptHistory), [keptHistory]);

  /**
   * Vorgemerkte per account, as they stand against the newest statement.
   * A list fetched on request (HKVMK; it can take a TAN) is never re-read
   * behind the user's back, and one the bank sent with the Umsätze is only
   * as new as that read; a statement loaded after either — and reaching the
   * day it was read — may already list some of its items as booked. Those
   * leave here: kept, they would be counted once inside the Kontostand and
   * once more as "Vorgemerkt". `pendingInfo` says when the list was read and
   * whether it is older than the bookings beside it (lib/pending.ts).
   */
  const { pendingCache, pendingInfo } = useMemo(() => {
    const cache: Record<string, SerializedTransaction[]> = {};
    const info: Record<string, PendingInfo> = {};
    for (const acct of new Set([...Object.keys(notedFetched), ...Object.keys(pendingFetched)])) {
      const st = statementInfo[acct];
      const booked = txCache[acct]?.txs;
      const view = pendingView(
        { noted: notedFetched[acct], fetched: pendingFetched[acct] },
        st && booked ? { loadedAt: st.loadedAt, to: st.to, booked } : undefined,
      );
      if (!view) continue;
      cache[acct] = view.txs as SerializedTransaction[];
      info[acct] = { loadedAt: view.loadedAt, behindStatement: view.behindStatement, booked: view.booked, readAt: view.readAt };
    }
    return { pendingCache: cache, pendingInfo: info };
  }, [notedFetched, pendingFetched, statementInfo, txCache]);

  const ownIbans = useMemo(
    () => [...new Set(accounts.map((a) => compactIban(a.iban)).filter(Boolean))],
    [accounts],
  );

  const unreadCount = useMemo(() => messages.filter((m) => !m.read).length, [messages]);

  // ---- the banks of the view ----------------------------------------------
  const linkedBanks = vault?.linkedBanks;

  // A remembered bank's logo and town, from this machine's own bank list —
  // asked once per BLZ. Without an answer it gets a monogram.
  useEffect(() => {
    for (const r of linkedBanks ?? []) {
      if (bankInfoAsked.current.has(r.blz)) continue;
      bankInfoAsked.current.add(r.blz);
      get<{ bank: BankSearchHit | null }>(`/api/banks?blz=${encodeURIComponent(r.blz)}`)
        .then(({ bank: listed }) => {
          if (!listed) return;
          setBankInfo((m) => ({
            ...m, [r.blz]: { blz: listed.blz, name: listed.name, location: listed.location, brand: listed.brand, bic: listed.bic },
          }));
        })
        .catch(() => { /* a monogram, then */ });
    }
  }, [linkedBanks]);

  /**
   * Every bank of the view, in list order: the primary login, the linked
   * ones (logged in, or logged out during this session), then the ones the
   * primary login's store remembers but that are not logged in now.
   */
  const banks = useMemo((): BankEntry[] => {
    if (!bank || !sessionId) return [];
    const out: BankEntry[] = [{ key: 'primary', bank, state: 'primary', ref: null, deviceRemembered }];
    for (const l of links) {
      out.push({
        key: l.id,
        bank: l.bank,
        state: l.sessionId ? 'active' : 'loggedOut',
        ref: { blz: l.bank.blz, name: l.bank.name, userId: l.userId },
        deviceRemembered: l.deviceRemembered,
      });
    }
    (linkedBanks ?? []).forEach((r, i) => {
      // Logged in already, or the primary login itself.
      if (sameLogin({ blz: bank.blz, userId }, r)) return;
      if (links.some((l) => sameLogin({ blz: l.bank.blz, userId: l.userId }, r))) return;
      const listed = bankInfo[r.blz];
      out.push({
        key: `remembered:${i}`,
        bank: { blz: r.blz, name: r.name, brand: listed?.brand ?? 'generic', bic: listed?.bic ?? null, ...(listed?.location ? { location: listed.location } : {}) },
        state: 'remembered',
        ref: r,
        deviceRemembered: false,
      });
    });
    return out;
  }, [bank, sessionId, userId, deviceRemembered, links, linkedBanks, bankInfo]);

  // The Übersicht's own rule (lib/account-overview.ts hasOverview): the back
  // gesture leads from an account's page to every account only where that
  // page has one in front of it.
  useEffect(() => {
    overviewShownRef.current = hasOverview(accounts, banks);
  }, [accounts, banks]);

  // "Salden beim Anmelden abrufen": once the login's own reads are done, every
  // balance still missing — and again for a further bank's accounts when it
  // joins the view later. Each account is asked for once per session, so a
  // refused approval is not asked again; never while a read runs.
  const autoBalancesRef = useRef<{ sid: string | null; asked: Set<string> }>({ sid: null, asked: new Set() });
  useEffect(() => {
    if (!balancesAtLogin || view !== 'dashboard' || busy || accounts.length < 2) return;
    if (autoBalancesRef.current.sid !== sessionId) autoBalancesRef.current = { sid: sessionId, asked: new Set() };
    const asked = autoBalancesRef.current.asked;
    const fresh = accounts.filter((a) => !asked.has(a.accountNumber));
    if (!fresh.length) return;
    // Marked as asked only once queued: another effect's read may have taken
    // `busy` first (the frame's one-account switch); this runs again after it.
    const ids = fresh.map((a) => a.accountNumber);
    if (loadAllBalances(ids) || ids.every((id) => !sessionFor(id))) for (const id of ids) asked.add(id);
  }, [balancesAtLogin, view, busy, accounts, sessionId, loadAllBalances]);

  // "Umsätze beim Anmelden abrufen" (on unless switched off): once the login's
  // own read has come back, the Umsätze of every other account that has them
  // and is shown (not unticked in the desktop's sidebar), one after the other,
  // as the Übersicht's "Umsätze abrufen" reads them — and a further bank's
  // accounts when it joins the view. Each account once per session. An
  // approval called off or a read that failed ends it for the session: no
  // second prompt for the next account, and the Übersicht's line still offers
  // the rest by hand. Never while another read runs.
  const autoBookingsRef = useRef<{ sid: string | null; asked: Set<string>; running: boolean; stopped: boolean }>(
    { sid: null, asked: new Set(), running: false, stopped: false },
  );
  const accountsHidden = vault?.accountsHidden;
  useEffect(() => {
    if (!bookingsAtLogin || view !== 'dashboard' || busy || !sessionId || loginReadSid !== sessionId) return;
    if (autoBookingsRef.current.sid !== sessionId) {
      autoBookingsRef.current = { sid: sessionId, asked: new Set(), running: false, stopped: false };
    }
    const run = autoBookingsRef.current;
    if (run.running || run.stopped) return;
    const hidden = new Set(accountsHidden ?? []);
    // A further bank logged out is left out (its list offers the login), not
    // counted as a failed read that would end the run for everyone after it.
    const list = accounts.filter((a) => a.canStatements && !isDepot(a) && !hidden.has(a.accountNumber)
      && !run.asked.has(a.accountNumber) && !txByAccount[a.accountNumber] && !!sessionFor(a.accountNumber));
    if (!list.length) return;
    run.running = true;
    const step = (i: number) => {
      // Another login since: that one's own run takes over.
      if (autoBookingsRef.current !== run || i >= list.length) { run.running = false; return; }
      const account = list[i];
      void loadTransactions(account, undefined, undefined, {
        quiet: true,
        onSettled: (outcome) => {
          // Another read had the line: this runs again once it is done.
          if (outcome === 'busy') { run.running = false; return; }
          run.asked.add(account.accountNumber);
          if (outcome === 'cancelled' || outcome === 'failed') {
            run.stopped = true;
            run.running = false;
            return;
          }
          step(i + 1);
        },
      });
    };
    step(0);
  }, [bookingsAtLogin, view, busy, sessionId, loginReadSid, accounts, accountsHidden, txByAccount, loadTransactions]);

  // Kept balances (lib/kept-balances.ts): every balance this session read
  // goes into the vault as the account's last, with when it was read — and,
  // on a day every figure is known, the overview's figures for that day.
  // Nothing of it while the user said no.
  const keepingBalances = vaultStatus === 'ready' && vault?.keepBalances !== false;
  useEffect(() => {
    if (!keepingBalances) return;
    const read: Record<string, KeptBalance> = {};
    for (const [acct, b] of Object.entries(balances)) {
      const at = balanceAt[acct];
      if (at) read[acct] = { cents: Math.round(b.balance * 100), currency: (b.currency || 'EUR').toUpperCase(), readAt: new Date(at).toISOString() };
    }
    for (const [acct, p] of Object.entries(portfolios)) {
      if (p.totalValue != null) read[acct] = { cents: Math.round(p.totalValue * 100), currency: (p.currency || 'EUR').toUpperCase(), readAt: p.readAt };
    }
    if (!Object.keys(read).length) return;
    updateVault((v) => {
      const had = v.keptBalances ?? NO_KEPT;
      const kept = foldKeptBalances(had, read);
      return kept === had ? v : { ...v, keptBalances: kept };
    });
  }, [keepingBalances, balances, balanceAt, portfolios, updateVault]);
  useEffect(() => {
    if (!keepingBalances || !accounts.length) return;
    const absent = banks.filter((b) => b.state === 'remembered').length;
    const f = overviewFigures(accounts, (a) => liveValue(a, balances[a.accountNumber], portfolios[a.accountNumber]), absent);
    // A day's figure is a whole one: not while a Depot is still to be read.
    if (f.total == null || f.excluded.some((e) => e.reason === 'unread')) return;
    const entry: NetWorthDay = { day: isoDate(new Date()), total: f.total, assets: f.assets ?? 0, liabilities: f.liabilities ?? 0 };
    updateVault((v) => {
      const had = v.netWorth ?? NO_DAYS;
      const days = recordNetWorth(had, entry);
      return days === had ? v : { ...v, netWorth: days };
    });
  }, [keepingBalances, accounts, banks, balances, portfolios, updateVault]);

  // Android: the home screen widget (BalanceWidget.java) shows the Gesamtsaldo
  // the overview shows, with since when — handed over whenever a whole figure
  // is known. The phone keeps it only while a widget is placed, and never on
  // a phone Girovo keeps nothing on (lib/device-integrity.ts).
  useEffect(() => {
    const phone = IS_ANDROID ? window.girovoMobile : undefined;
    // Cleared by "Gerät vergessen" or the wiped data: nothing goes back this session.
    if (!phone?.widget || widgetClearedRef.current || view !== 'dashboard' || !accounts.length) return;
    // "Letzte Salden behalten" off: no balance stays on the phone, the widget's neither.
    if (vaultStatus === 'ready' && vault?.keepBalances === false) {
      void phone.widget.clear().catch(() => {});
      return;
    }
    const absent = banks.filter((b) => b.state === 'remembered').length;
    const f = overviewFigures(accounts, (a) => liveValue(a, balances[a.accountNumber], portfolios[a.accountNumber]), absent);
    if (f.total == null || f.excluded.some((e) => e.reason === 'unread')) return;
    // The total is in cents (lib/account-overview.ts).
    const amount = fmtMoney(f.total / 100);
    const said = msgs().android.widget;
    // "Stand": as fresh as the oldest figure the total is made of, as the overview says it.
    const readTimes = f.counted.map((a) => (isDepot(a)
      ? (portfolios[a.accountNumber] ? Date.parse(portfolios[a.accountNumber].readAt) : NaN)
      : balanceAt[a.accountNumber] ?? NaN)).filter(Number.isFinite);
    const stamp = said.stamp(readTimes.length ? new Date(Math.min(...readTimes)) : new Date());
    void phone.integrity().catch(() => null).then((facts) => {
      // A forget or wipe while the check ran: nothing goes back.
      if (widgetClearedRef.current || keepsNothing(facts)) return;
      void phone.widget.update(amount, stamp, said.title);
    });
  }, [view, accounts, banks, balances, balanceAt, portfolios, vault?.keepBalances, vaultStatus]);

  // "Neue Umsätze melden": whether the shell here can keep the PINs, and
  // whether the checks are on — asked once the Übersicht is up.
  useEffect(() => {
    if (view !== 'dashboard' || !sessionId || backgroundRef.current !== null) return;
    let current = true;
    void (async () => {
      if (!backgroundShell() || !(await backgroundSecret())) return;
      const r = await post<{ on: boolean }>('/api/background', { op: 'status' }).catch(() => null);
      if (!current || !r || !isCurrent(sessionId)) return;
      setBackgroundBoth(r.on === true);
      // The shell follows the box: a box gone (a refused last PIN, a new
      // secret) stops the checks; a job Android dropped is planned again.
      void shellSchedule(r.on === true);
    })();
    return () => {
      current = false;
    };
  }, [view, sessionId, isCurrent, setBackgroundBoth]);

  // Sync between devices: how it stands once the vault is loaded; with it on,
  // a round at once, every five minutes, and half a minute after a change.
  useEffect(() => {
    if (view === 'dashboard' && vaultStatus === 'ready' && syncRef.current === null) void refreshSync();
  }, [view, vaultStatus, refreshSync]);
  const syncOn = sync?.on === true && vaultStatus === 'ready' && view === 'dashboard';
  useEffect(() => {
    if (!syncOn) return;
    void syncNow(true);
    const every = setInterval(() => void syncNow(true), 5 * 60_000);
    return () => clearInterval(every);
  }, [syncOn, syncNow]);
  const vaultStamp = vault?.updatedAt;
  useEffect(() => {
    if (!syncOn || !vaultStamp) return;
    const t = setTimeout(() => void syncNow(true), 30_000);
    return () => clearTimeout(t);
  }, [syncOn, vaultStamp, syncNow]);

  // …and with it on, what the bank just answered in the app counts as seen —
  // no notice for it later — while a kept login takes the PIN the bank took
  // and resumes where it waited for the user (lib/background-check.ts touch).
  const touchedRef = useRef<Record<string, number>>({});
  useEffect(() => {
    if (backgroundChecks !== true) return;
    const cutoff = isoDate(new Date(Date.now() - 45 * 86_400_000));
    for (const [acct, f] of Object.entries(fetches)) {
      if (!f.fetchFrom || touchedRef.current[acct] === f.loadedAt) continue;
      touchedRef.current[acct] = f.loadedAt;
      const sid = sessionFor(acct);
      if (!sid) continue;
      const keys = f.txs.filter((t) => String(t.entryDate || t.valueDate || '').slice(0, 10) >= cutoff).map(txKey).slice(-600);
      void backgroundSecret().then((secret) => secret && post('/api/background', {
        op: 'touch', secret, sessionId: sid, accountNumber: acct, keys,
      }).catch(() => {}));
    }
  }, [backgroundChecks, fetches, sessionFor]);

  /** The bank an account belongs to, as the view shows it. */
  const bankOf = useCallback((a: Pick<SerializedAccount, 'accountNumber'> | null | undefined): BankEntry | null => {
    if (!a) return null;
    const link = links.find((l) => l.accountNumbers.includes(a.accountNumber));
    return banks.find((b) => b.key === (link?.id ?? 'primary')) ?? null;
  }, [links, banks]);

  /** The active account's bank: what the institute bar names. */
  const activeBank = useMemo(() => bankOf(activeAccount), [bankOf, activeAccount]);

  /** The add flow as the sheet reads it, its error in the language on screen. */
  const addBank = useMemo((): AddBankState | null => {
    if (!addBankKept) return null;
    const { step, bank: chosen, prefill, tanMethods: methods, selectedMethod: picked, mediaChoice: devices, error, openedPin } = addBankKept;
    return {
      step, bank: chosen, prefill, tanMethods: methods, selectedMethod: picked, mediaChoice: devices,
      error: error === null ? null : written(error, texts), openedPin,
    };
  }, [addBankKept, texts]);

  // After a fingerprint login (Android) or a PIN login with "Weitere Banken
  // mit anmelden" on (the desktop), the further banks it opened log in
  // one after another, each in the add sheet with its PIN filled in and the
  // approval as its bank asks — once the dashboard is up, nothing else is
  // under way and the vault says which banks it remembers. Only those: a
  // bank removed since is not asked. Without Girovo Plus none are, and the
  // Plus screen does not open for them either.
  useEffect(() => {
    if (view !== 'dashboard' || busy || addBankKept || vaultStatus !== 'ready' || !openedLinkedRef.current.length) return;
    if (!bankAllowed(plus.state, false)) {
      openedLinkedRef.current = [];
      return;
    }
    // A moment of quiet first: the first bank's reads come one after another,
    // and a login started between two of them would find the bank busy.
    const timer = setTimeout(() => {
      while (openedLinkedRef.current.length) {
        const [next, ...rest] = openedLinkedRef.current;
        openedLinkedRef.current = rest;
        const entry = banks.find((b) => b.state === 'remembered' && b.ref && sameLogin(b.ref, next));
        if (!entry) continue;
        openAddBank({ bank: entry.bank, userId: next.userId, pin: next.pin });
        return;
      }
    }, 1500);
    return () => clearTimeout(timer);
  }, [view, busy, addBankKept, vaultStatus, banks, plus.state, openAddBank, openedLinkedTick]);

  const categoryRules = vault?.categoryRules;
  // As shown: entries not moved yet under the booking they lead to (shownFiled).
  const txCategories = shownFiled.txCategories;
  const splits = shownFiled.splits;
  const customCategories = vault?.customCategories;
  // The user's own categories, registered for every label, menu and sum on
  // the page (lib/categories.ts). Here, during the render, rather than in an
  // effect: whatever renders below the provider in this pass must already
  // name them. Idempotent, so a repeated render does no harm.
  useMemo(() => setCustomCategories(customCategories ?? []), [customCategories]);

  // The user's rules are the model's examples: with a new one, every
  // counterparty is asked again (the server keeps its vectors, so that is cheap).
  useEffect(() => {
    guessesAsked.current.clear();
  }, [categoryRules]);

  // The on-device model's guesses (lib/category-model.ts) for the outgoing
  // bookings the keywords left as "Sonstiges" — asked once per counterparty
  // and session. The server is this app's own: nothing leaves the machine.
  useEffect(() => {
    const sid = sessionRef.current;
    if (!sid) return;
    const own = new Set(ownIbans);
    const all = [
      ...Object.values(txByAccount).flat(),
      ...Object.values(pendingFetched).flatMap((p) => p.txs),
      ...Object.values(notedFetched).flatMap((p) => p.txs),
    ];
    const names = new Map<string, string>();
    const items: { key: string; name: string; purpose: string }[] = [];
    for (const tx of all) {
      const key = counterpartyKey(tx);
      const name = counterpartyName(tx);
      if (!name) continue;
      if (!names.has(key)) names.set(key, name);
      if (Number(tx.amount) >= 0 || guessesAsked.current.has(key)) continue;
      if (guessCategory(tx, { ownIbans: own }) !== 'other') continue;
      guessesAsked.current.add(key);
      // A card system's record says nothing about what was bought.
      items.push({ key, name, purpose: isCardPurpose(tx.purpose) ? '' : parsePurpose(tx.purpose).text });
    }
    if (!items.length) return;
    const examples = Object.entries(categoryRules ?? {}).flatMap(([key, category]) => {
      const name = names.get(key);
      return name ? [{ name, category }] : [];
    });
    void post<{ guesses?: Record<string, CategoryId | null> }>('/api/category-guesses', { sessionId: sid, items, examples })
      .then(({ guesses }) => {
        if (!isCurrent(sid) || !guesses) return;
        setModelGuesses((prev) => {
          const next = { ...prev };
          for (const [key, guess] of Object.entries(guesses)) {
            if (isCategoryId(guess)) next[key] = guess;
            else delete next[key];
          }
          return next;
        });
      })
      // Asked again with the next change, rather than never.
      .catch(() => {
        for (const it of items) guessesAsked.current.delete(it.key);
      });
  }, [sessionId, txByAccount, pendingFetched, notedFetched, ownIbans, categoryRules, isCurrent]);

  // 5.9.0 took "Essen & Trinken" out of "Freizeit & Gastronomie". What Girovo
  // filed itself moved along; what the user filed or budgeted stayed on
  // Freizeit — said once, to whoever has such a choice, and never again.
  useEffect(() => {
    if (!vault || store.get('fints.notice.dining') === '1') return;
    const own = [
      ...Object.values(vault.categoryRules ?? {}),
      ...Object.values(vault.txCategories ?? {}),
      ...Object.keys(vault.budgets ?? {}),
    ];
    store.set('fints.notice.dining', '1');
    if (own.includes('leisure')) toast(msgs().provider.diningSplit, 'info', 9000);
  }, [vault, toast]);

  // Gemini Nano's clean names for the lists (lib/nano-names.ts) — Android
  // only, where Nano is; the desktop's route answers "unavailable". Card
  // payments and direct debits only: their other side is a business, never a
  // person. Each counterparty once per session; a brand that arrives asks for
  // its logo again, now by the brand.
  useEffect(() => {
    const sid = sessionRef.current;
    if (!IS_ANDROID || !sid) return;
    const all = [
      ...Object.values(txByAccount).flat(),
      ...Object.values(pendingFetched).flatMap((p) => p.txs),
      ...Object.values(notedFetched).flatMap((p) => p.txs),
    ];
    const byKey = new Map<string, SerializedTransaction[]>();
    const items: { key: string; name: string }[] = [];
    for (const tx of all) {
      if (!(isBusinessBooking(tx) || bookingKind(tx) === 'karte')) continue;
      const key = counterpartyKey(tx);
      byKey.set(key, [...(byKey.get(key) ?? []), tx]);
      if (namesAsked.current.has(key)) continue;
      const name = counterpartyName(tx);
      // Not a payment service: the shop behind PayPal comes from each purpose.
      if (!asksForBrand(name)) continue;
      namesAsked.current.add(key);
      items.push({ key, name });
    }
    if (!items.length) return;
    void post<{ names?: Record<string, string | null> }>('/api/merchant-names', { sessionId: sid, items })
      .then(({ names }) => {
        if (!isCurrent(sid) || !names) return;
        const found = Object.entries(names).filter((e): e is [string, string] => typeof e[1] === 'string' && !!e[1]);
        if (!found.length) return;
        setBrandNamesState((prev) => {
          const next = new Map(prev);
          for (const [key, brand] of found) next.set(key, brand);
          return next;
        });
        // Their logos once more, by the brand.
        const again = found.flatMap(([key]) => byKey.get(key) ?? []);
        for (const tx of again) merchantsAsked.current.delete(getMerchantKey(tx));
        queueMicrotask(() => void resolveMerchants(again));
      })
      .catch(() => {
        for (const it of items) namesAsked.current.delete(it.key);
      });
  }, [sessionId, txByAccount, pendingFetched, notedFetched, isCurrent, resolveMerchants]);

  /**
   * The user's rules for other spellings of a filed payee: the category of a
   * filed name nearly the same (lib/nano-categories.ts nameSimilarity ≥
   * EXAMPLE_MIN), so "HORNBACH BAUMARKT FIL. 0815" follows a filed "Hornbach
   * Baumarkt AG" instead of the "Baumarkt" keyword. Null without rules.
   */
  const ruleByName = useMemo(() => {
    const rules = categoryRules ?? {};
    if (!Object.keys(rules).length) return null;
    const filed: { name: string; category: CategoryId }[] = [];
    const seen = new Set<string>();
    const all = [
      ...Object.values(txByAccount).flat(),
      ...Object.values(pendingFetched).flatMap((p) => p.txs),
      ...Object.values(notedFetched).flatMap((p) => p.txs),
    ];
    for (const tx of all) {
      const key = counterpartyKey(tx);
      if (seen.has(key)) continue;
      seen.add(key);
      const category = rules[key];
      const name = counterpartyName(tx);
      if (name && isCategoryId(category)) filed.push({ name, category });
    }
    const memo = new Map<string, CategoryId | null>();
    return (name: string): CategoryId | null => {
      const hit = memo.get(name);
      if (hit !== undefined) return hit;
      let best: { category: CategoryId; score: number } | null = null;
      for (const f of filed) {
        const score = nameSimilarity(name, f.name);
        if (score >= EXAMPLE_MIN && (!best || score > best.score)) best = { category: f.category, score };
      }
      memo.set(name, best?.category ?? null);
      return best?.category ?? null;
    };
  }, [categoryRules, txByAccount, pendingFetched, notedFetched]);

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
          ownIbans: own, rules: categoryRules, ruleByName, overrides: txCategories, splits, merchantLabel: merchant?.label ?? null,
          modelGuesses,
        });
      } catch {
        // A guess gone wrong must not take the dashboard down with it.
        result = { id: tx.amount >= 0 ? 'otherIn' : 'other', source: 'auto' };
      }
      memo.set(tx, result);
      return result;
    };
    // customCategories: a renamed or deleted category relabels every booking.
  }, [ownIbans, categoryRules, ruleByName, txCategories, splits, customCategories, merchants, modelGuesses]);

  /**
   * What the app would file a booking under on its own, and by which rung
   * (lib/categorize.ts explainGuess) — the same own accounts, logos and model
   * guesses as categoryOf, without the user's choices. The drawer's way back
   * ("Automatisch (…)") and the Kategorie-Check read it.
   */
  const categoryGuessOf = useMemo(() => {
    const own = new Set(ownIbans);
    const memo = new WeakMap<SerializedTransaction, CategoryGuess>();
    return (tx: SerializedTransaction): CategoryGuess => {
      const hit = memo.get(tx);
      if (hit) return hit;
      const merchant = merchants[getMerchantKey(tx)] ?? merchants[counterpartyName(tx)] ?? null;
      let result: CategoryGuess;
      try {
        result = explainGuess(tx, { ownIbans: own, merchantLabel: merchant?.label ?? null, modelGuesses });
      } catch {
        result = { id: tx.amount >= 0 ? 'otherIn' : 'other', basis: 'none' };
      }
      memo.set(tx, result);
      return result;
    };
  }, [ownIbans, merchants, modelGuesses]);

  // The user's notes on bookings (lib/notes.ts): one lookup for every place
  // that shows or searches them. A new function whenever a note changes, so
  // a search context built on it is built anew.
  const notes = shownFiled.notes;
  const noteOf = useCallback(
    (tx: SerializedTransaction): string | undefined => {
      const n = notes?.[txKey(tx)];
      return typeof n === 'string' && n ? n : undefined;
    },
    [notes],
  );

  const aliases = vault?.aliases;
  // translateType answers in the language on screen: `locale` makes a new
  // label function on a change of language, so every account name relabels.
  const accountLabel = useCallback(
    (a: SerializedAccount) => aliases?.[a.accountNumber] || a.product?.trim() || translateType(a.accountType),
    [aliases, locale],
  );
  accountLabelRef.current = accountLabel;

  // The kept reasons, written in the language on screen.
  const tanMethodError = tanMethodErrorKept ? written(tanMethodErrorKept.text, texts) : null;
  const portfolioErrors = useMemo(() => {
    const out: Record<string, LoadError> = {};
    for (const [acct, e] of Object.entries(portfolioErrorsKept)) out[acct] = { message: written(e.message, texts), at: e.at };
    return out;
  }, [portfolioErrorsKept, texts]);

  const balanceErrors = useMemo(() => {
    const out: Record<string, LoadError> = {};
    for (const [acct, e] of Object.entries(balanceErrorsKept)) out[acct] = { message: written(e.message, texts), at: e.at };
    return out;
  }, [balanceErrorsKept, texts]);

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

  /** "Letzte Salden behalten" (Einstellungen): on by default; off deletes what is kept. */
  const setKeepBalances = useCallback((on: boolean) => {
    updateVault((v) => {
      if (on) {
        if (v.keepBalances !== false) return v;
        const rest = { ...v };
        delete rest.keepBalances;
        return rest;
      }
      const rest = { ...v };
      delete rest.keptBalances;
      delete rest.netWorth;
      return { ...rest, keepBalances: false };
    });
  }, [updateVault]);

  /** "Konten anordnen": the accounts' order and grouping, kept in the vault (lib/account-overview.ts). */
  const arrangeAccounts = useCallback((next: { order?: readonly string[]; grouping?: AccountGrouping }) => {
    updateVault((v) => {
      let out = v;
      // Accounts not on screen (a further bank not logged in) keep their places.
      if (next.order) out = { ...out, accountOrder: sanitizeAccountOrder(keepAbsentPlaces(v.accountOrder, next.order)) };
      if (next.grouping && next.grouping !== v.accountGrouping) out = { ...out, accountGrouping: next.grouping };
      return out;
    });
  }, [updateVault]);

  /**
   * Konten als Ebenen (the desktop's frame, 2026-11-04): the accounts the
   * user unticked in the sidebar. A ticked account's Umsätze join the
   * Übersicht's ledger and its balance the sum; one ticked alone is its page.
   * Kept in the vault on this device only (never synced: a phone has no
   * layers); without a readable vault the change lives in memory. `next`
   * may be worked out from the list as it then stands: a tick while the
   * vault still loads applies to the saved list, not to an empty one.
   */
  const setAccountsHidden = useCallback((next: readonly string[] | ((current: readonly string[]) => readonly string[])) => {
    updateVault((v) => {
      const list = sanitizeAccountOrder(typeof next === 'function' ? next(v.accountsHidden ?? []) : next);
      if (list.length) return { ...v, accountsHidden: list };
      if (!v.accountsHidden) return v;
      const rest = { ...v };
      delete rest.accountsHidden;
      return rest;
    });
  }, [updateVault]);

  const saveTemplate = useCallback((t: Omit<TransferTemplate, 'id' | 'createdAt'>) => {
    // The same limits lib/vault.ts enforces on the way in — applied here too,
    // so what the user sees now is what comes back after the next login
    // instead of a template the server quietly clipped or dropped.
    const clip = (s: string | undefined, n: number) => (s == null ? undefined : [...s.trim()].slice(0, n).join(''));
    const iban = compactIban(t.iban);
    if (!t.name.trim() || !ibanValid(iban)) {
      toast(msgs().provider.vault.templateInvalid, 'error');
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
    updateVault((v) => withoutReminder(v.dismissedRecurring.includes(id)
      ? v
      : { ...v, dismissedRecurring: [...v.dismissedRecurring, id] }, id));
  }, [updateVault]);

  const restoreRecurring = useCallback((id: string) => {
    updateVault((v) => (v.dismissedRecurring.includes(id)
      ? { ...v, dismissedRecurring: v.dismissedRecurring.filter((x) => x !== id) }
      : v));
  }, [updateVault]);

  /** A contract's cancellation reminder (lib/contract-watch.ts), or `null` to take it away. */
  const setContractReminder = useCallback((id: string, reminder: ContractReminder | null) => {
    updateVault((v) => {
      const next = { ...v.contractReminders };
      if (reminder) next[id] = reminder;
      else delete next[id];
      const { contractReminders: _, ...rest } = v;
      return Object.keys(next).length ? { ...rest, contractReminders: next } : rest;
    });
  }, [updateVault]);

  /** A contract's own name in place of the bank's, or `null` to go back to the bank's. */
  const setContractName = useCallback((id: string, name: string | null) => {
    updateVault((v) => {
      const next = { ...v.contractNames };
      if (name) next[id] = name;
      else delete next[id];
      const { contractNames: _, ...rest } = v;
      return Object.keys(next).length ? { ...rest, contractNames: next } : rest;
    });
  }, [updateVault]);

  /** A contract the user added from a booking (lib/manual-contracts.ts), or removed with null. */
  const setManualContract = useCallback((id: string, contract: ManualContract | null) => {
    updateVault((v) => {
      const next = { ...v.manualContracts };
      if (contract) next[id] = contract;
      else delete next[id];
      const { manualContracts: _, ...rest } = v;
      const kept = Object.keys(next).length ? { ...rest, manualContracts: next } : rest;
      return contract ? kept : withoutReminder(kept, id);
    });
  }, [updateVault]);

  /** The newest booking seen of a contract the user added — only while it is there, only ever later. */
  const setManualDay = useCallback((id: string, seen: ManualDay) => {
    updateVault((v) => {
      if (!v.manualContracts?.[id]) return v;
      const had = v.manualDays?.[id];
      const later = !had || seen.day > had.day;
      const label = had?.label || seen.label;
      if (!later && label === had?.label) return v;
      return { ...v, manualDays: { ...v.manualDays, [id]: { day: later ? seen.day : had!.day, ...(label ? { label } : {}) } } };
    });
  }, [updateVault]);

  /** The contract notices Mitteilungen showed: no dot for them again. */
  const markContractsNoticed = useCallback((notices: readonly ContractNotice[]) => {
    if (!notices.length) return;
    updateVault((v) => {
      const seen = new Set(v.noticedContracts ?? []);
      return notices.every((n) => seen.has(n.key)) ? v : { ...v, noticedContracts: withNoticed(v.noticedContracts, notices) };
    });
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
    // Every key from before that leads to the booking goes with every choice
    // for it — the one shown and any a move would set aside behind it — so
    // none comes back over it. A key twins may share stays: it was theirs too
    // (lib/booking-keys.ts keysLeadingTo).
    const olds = leadingRef.current(key);
    // A choice of one category — or going back to the automatic one — ends a
    // split of this booking: the booking is then filed whole again.
    const unsplit = (v: VaultData): VaultData => {
      const rest = dropKeys(v.splits, [key, ...olds]);
      return rest === v.splits ? v : { ...v, splits: rest };
    };
    if (id === null) {
      updateVault((v0) => {
        const v = unsplit(v0);
        const overrides = dropKeys(v.txCategories, [key, ...olds]);
        return overrides === v.txCategories ? v : { ...v, txCategories: overrides };
      });
      return;
    }
    // Checked against the vault itself: a category made a moment ago is
    // there before the page has registered it (the next render does).
    if (!categoryValidator(vaultRef.current?.customCategories ?? [])(id)) return;
    // The key of the rule that files this booking now — its own, or the one
    // found through the other spelling of its name's umlauts — else its own
    // key: the rule is overwritten, never given a second one beside it.
    const who = ruleKeyFor(vaultRef.current?.categoryRules, tx);
    // A counterparty with neither IBAN, creditor ID nor name cannot carry a rule.
    if (opts.rule && who !== 'name:?') {
      const stale = new Set([key, ...olds]);
      const loaded = [
        ...Object.values(txCache).flatMap((e) => e.txs),
        ...Object.values(pendingFetched).flatMap((e) => e.txs),
        ...Object.values(notedFetched).flatMap((e) => e.txs),
      ];
      // Every loaded booking the rule files, in either spelling.
      const reach = { ...vaultRef.current?.categoryRules, [who]: id };
      for (const t of loaded) {
        if (counterpartyRuleKey(reach, t) !== who) continue;
        stale.add(txKey(t));
        for (const k of leadingRef.current(txKey(t))) stale.add(k);
      }
      updateVault((v0) => {
        const v = unsplit(v0);
        const overrides = dropKeys(v.txCategories, [...stale]);
        if (v.categoryRules[who] === id && overrides === v.txCategories) return v;
        return { ...v, categoryRules: { ...v.categoryRules, [who]: id }, txCategories: overrides };
      });
      return;
    }
    updateVault((v0) => {
      const v = unsplit(v0);
      const overrides = dropKeys(v.txCategories, olds);
      return v.txCategories[key] === id && overrides === v.txCategories ? v : { ...v, txCategories: { ...overrides, [key]: id } };
    });
  }, [txCache, pendingFetched, notedFetched, updateVault]);

  /**
   * Splits one booking across categories (lib/splits.ts) — `parts` in whole
   * cents, adding up to the booking — or, with `null`, files it whole again
   * under what it had before. A split replaces a choice of one category for
   * this booking; a rule for its counterparty stays and takes it back once
   * the split goes.
   */
  const setSplit = useCallback((tx: SerializedTransaction, parts: readonly SplitPart[] | null): boolean => {
    const key = txKey(tx);
    // Its keys from before go too, as with setCategory.
    const olds = leadingRef.current(key);
    if (parts === null) {
      updateVault((v) => {
        const rest = dropKeys(v.splits, [key, ...olds]);
        return rest === v.splits ? v : { ...v, splits: rest };
      });
      return true;
    }
    const clean = sanitizeSplit(parts, categoryValidator(vaultRef.current?.customCategories ?? []));
    const total = Math.round(Math.abs(Number(tx.amount)) * 100);
    if (!clean || clean.reduce((sum, p) => sum + p.cents, 0) !== total) return false;
    updateVault((v) => {
      const rest = dropKeys(v.splits, [key, ...olds]);
      // Newest last, so the vault's cap keeps it (lib/splits.ts sanitizeSplits).
      return { ...v, splits: { ...rest, [key]: clean }, txCategories: dropKeys(v.txCategories, [key, ...olds]) };
    });
    return true;
  }, [updateVault]);

  /**
   * A category of the user's own, made now (lib/splits.ts). The name must be
   * new — neither one of theirs nor one of the app's, in either language —
   * and there may be CUSTOM_LIMITS.count of them. Answers the new id, or why not.
   */
  const addCustomCategory = useCallback((
    name: string, direction: 'in' | 'out',
  ): { id: CustomCategoryId } | { error: 'empty' | 'taken' | 'full' } => {
    const clean = cleanCategoryName(name);
    if (!clean) return { error: 'empty' };
    const list = vaultRef.current?.customCategories ?? [];
    if (list.length >= CUSTOM_LIMITS.count) return { error: 'full' };
    if (categoryNameTaken(clean, list)) return { error: 'taken' };
    const id = newCustomId();
    updateVault((v) => ({ ...v, customCategories: [...v.customCategories, { id, name: clean, direction }] }));
    return { id };
  }, [updateVault]);

  /** A new name for one of the user's own categories; every booking filed under it relabels. */
  const renameCustomCategory = useCallback((id: CustomCategoryId, name: string): 'ok' | 'empty' | 'taken' => {
    const clean = cleanCategoryName(name);
    if (!clean) return 'empty';
    const list = vaultRef.current?.customCategories ?? [];
    if (categoryNameTaken(clean, list.filter((c) => c.id !== id))) return 'taken';
    updateVault((v) => ({
      ...v,
      customCategories: v.customCategories.map((c) => (c.id === id ? { ...c, name: clean } : c)),
    }));
    return 'ok';
  }, [updateVault]);

  /**
   * Deletes one of the user's own categories. What it filed goes back to the
   * automatic guess: its rules and single choices, its budget, and every
   * split that used it (lib/splits.ts withoutCategory).
   */
  const deleteCustomCategory = useCallback((id: CustomCategoryId) => {
    updateVault((v) => {
      if (!v.customCategories.some((c) => c.id === id)) return v;
      return { ...withoutCategory(v, id), customCategories: v.customCategories.filter((c) => c.id !== id) };
    });
  }, [updateVault]);

  /**
   * Drops the user's rule for one counterparty; its bookings go back to the
   * automatic guess. `who` is the key the rule is stored under — for a booking
   * ruleKeyFor(), not its own counterpartyKey(), which misses a rule found
   * through the other spelling of the name's umlauts.
   */
  const removeCategoryRule = useCallback((who: string) => {
    updateVault((v) => {
      const rules = without(v.categoryRules, who);
      return rules === v.categoryRules ? v : { ...v, categoryRules: rules };
    });
  }, [updateVault]);

  /**
   * Replaces the monthly budgets (CategoryId → whole cents). Cleaned by the
   * rules the vault applies (lib/budgets.ts), so what is shown now is what
   * comes back after the next login.
   */
  /** The Sparziel of a savings account (lib/savings-goal.ts); null removes it. */
  const setGoal = useCallback((accountNumber: string, goal: Omit<SavingsGoal, 'accountNumber'> | null) => {
    updateVault((v) => {
      const others = (v.goals ?? []).filter((g) => g.accountNumber !== accountNumber);
      const goals = goal ? sanitizeGoals([...others, { ...goal, accountNumber }]) : others;
      if (goals.length) return { ...v, goals };
      const { goals: _gone, ...rest } = v;
      return rest as VaultData;
    });
  }, [updateVault]);

  /** Aufteilen's requests from a booking (lib/split-requests.ts), kept so Girovo AI can say who still owes what. */
  const recordSplitRequests = useCallback((tx: SerializedTransaction, people: { name: string; cents: number }[]) => {
    if (!people.length) return;
    updateVault((v) => ({ ...v, splitRequests: withRequests(v.splitRequests ?? [], txKey(tx), people, dayKey(new Date())) }));
  }, [updateVault]);

  // A request is paid once money from that person comes in (lib/split-requests.ts settleRequests).
  const splitRequests = vault?.splitRequests;
  useEffect(() => {
    if (!splitRequests?.some((r) => !r.paid)) return;
    const incoming: Incoming[] = Object.values(txByAccount).flat().filter((tx) => tx.amount > 0).map((tx) => ({
      key: txKey(tx),
      day: bankDay(tx),
      cents: Math.round(tx.amount * 100),
      names: [counterpartyName(tx), String(tx.remoteName ?? '')].filter(Boolean),
    }));
    updateVault((v) => {
      const list = v.splitRequests ?? [];
      const settled = settleRequests(list, incoming);
      return settled === list ? v : { ...v, splitRequests: [...settled] };
    });
  }, [splitRequests, txByAccount, updateVault]);

  const setBudgets = useCallback((next: Budgets) => {
    updateVault((v) => {
      const clean = sanitizeBudgets(next, v.customCategories);
      const before = v.budgets;
      const same = Object.keys(clean).length === Object.keys(before).length
        && Object.entries(clean).every(([id, cents]) => before[id as CategoryId] === cents);
      return same ? v : { ...v, budgets: clean };
    });
  }, [updateVault]);

  /**
   * The user's note on one booking — `null` or an empty text removes it. Kept
   * as lib/notes.ts keeps it (one line, 280 characters, the newest within the
   * caps); should the caps take the oldest to make room, the user is told.
   */
  const setNote = useCallback((tx: SerializedTransaction, text: string | null) => {
    const key = txKey(tx);
    // Its keys from before go too, as with setCategory.
    const olds = leadingRef.current(key);
    let dropped = 0;
    updateVault((v) => {
      const res = withNote(dropKeys(v.notes, olds), key, text);
      dropped = res.dropped;
      return res.notes === v.notes ? v : { ...v, notes: res.notes };
    });
    if (dropped > 0) toast(msgs().budgets.notes.oldestDropped(dropped), 'info', 10_000);
  }, [updateVault, toast]);

  // ---- backup (lib/backup.ts) ---------------------------------------------

  /** The view's sessions besides the first login's: the further banks signed in now. */
  const linkedSessionIds = useCallback(
    () => linksRef.current.map((l) => l.sessionId).filter((id): id is string => !!id),
    [],
  );

  /**
   * Makes a backup of what this machine keeps for the view and offers it for
   * saving. The vault is written first, so the file holds what the screen
   * shows. Answers what went into it, or why there is none.
   */
  const makeBackup = useCallback(async (password: string): Promise<
    { ok: true; saved: boolean; summary: BackupSummary[] } | { ok: false; error: string }
  > => {
    const sid = sessionRef.current;
    if (!sid) return { ok: false, error: msgs().provider.server.sessionExpired };
    await flushVault();
    try {
      const r = await post<{ name: string; text: string; summary: BackupSummary[] }>('/api/backup', {
        sessionId: sid, linked: linkedSessionIds(), op: 'make', password,
      });
      const outcome = await saveFile(r.name, textBlob(r.text, 'application/octet-stream'));
      return { ok: true, saved: outcome !== 'canceled', summary: r.summary };
    } catch (e) {
      return { ok: false, error: (e as Error).message || msgs().provider.server.unreachable };
    }
  }, [flushVault, linkedSessionIds]);

  /**
   * Restores a backup file's text into the view's logins, then reads back
   * what changed: the vault, the kept Umsätze, the documents. Pending vault
   * edits are written first, so the merge on the server sees them.
   */
  const restoreBackup = useCallback(async (text: string, password: string): Promise<
    { ok: true; report: RestoreReport[] } | { ok: false; error: string }
  > => {
    const sid = sessionRef.current;
    if (!sid) return { ok: false, error: msgs().provider.server.sessionExpired };
    await flushVault();
    let report: RestoreReport[];
    try {
      ({ report } = await post<{ report: RestoreReport[] }>('/api/backup', {
        sessionId: sid, linked: linkedSessionIds(), op: 'restore', text, password,
      }));
    } catch (e) {
      return { ok: false, error: (e as Error).message || msgs().provider.server.unreachable };
    }
    if (!isCurrent(sid)) return { ok: true, report };
    await loadVault(sid);
    if (vaultRef.current?.keepBookings) await loadHistory(sid);
    await loadDocs();
    return { ok: true, report };
  }, [flushVault, linkedSessionIds, isCurrent, loadVault, loadHistory, loadDocs]);

  // ---- older Umsätze from the online banking's export (lib/bank-import.ts) --

  /**
   * What an export file holds: its format, how many bookings, the days it
   * vouches for, and which of the view's accounts it names. Each login of the
   * view is asked in turn until one recognises the account; the first
   * login's answer stands when none does.
   */
  const inspectBankFile = useCallback(async (text: string): Promise<
    { ok: true; info: ImportInfo } | { ok: false; error: string }
  > => {
    const sid = sessionRef.current;
    if (!sid) return { ok: false, error: msgs().provider.server.sessionExpired };
    let first: ImportInfo | null = null;
    // Each login in turn; a further bank answers with its own key ("123"),
    // which the view knows as that bank's ("123@BLZ").
    const logins = [
      { id: sid, keys: null as readonly string[] | null },
      ...linksRef.current.filter((l) => !!l.sessionId).map((l) => ({ id: l.sessionId!, keys: l.accountNumbers })),
    ];
    for (const { id, keys } of logins) {
      try {
        const info = await post<ImportInfo>('/api/history-import', { sessionId: id, op: 'inspect', text });
        if (info.account) {
          const own = keys?.find((k) => localKey(k) === info.account) ?? info.account;
          return { ok: true, info: { ...info, account: own } };
        }
        first ??= info;
      } catch (e) {
        if (id === sid) return { ok: false, error: (e as Error).message || msgs().provider.server.unreachable };
      }
    }
    return first ? { ok: true, info: first } : { ok: false, error: msgs().history.import.server.notReadable };
  }, []);

  /**
   * Fills the kept Umsätze of `accountNumber` from an export file, through
   * the account's own login, then reads that login's kept Umsätze again.
   */
  const importBankFile = useCallback(async (text: string, accountNumber: string): Promise<
    { ok: true; days: number; bookings: number } | { ok: false; error: string }
  > => {
    const sid = sessionRef.current;
    const target = sessionFor(accountNumber);
    if (!sid || !target) return { ok: false, error: msgs().provider.server.sessionExpired };
    try {
      const r = await post<{ days: number; bookings: number }>('/api/history-import', {
        sessionId: target, op: 'import', text, accountNumber,
      });
      if (r.days && isCurrent(sid)) {
        const link = linkOf(accountNumber);
        if (link) await loadLinkedHistory(link);
        else await loadHistory(sid);
      }
      return { ok: true, days: r.days, bookings: r.bookings };
    } catch (e) {
      return { ok: false, error: (e as Error).message || msgs().provider.server.unreachable };
    }
  }, [sessionFor, isCurrent, linkOf, loadLinkedHistory, loadHistory]);

  // ---- printable Kontoauszug / transaction receipt / bank message ---------
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
      // The account's own bank is the kontoführendes Institut on paper.
      bank: activeBank?.bank ?? bank,
      transactions: transactions ?? [],
      balance: past ? closingBalanceOf(info, activeAccount.currency) : balances[acct] ?? null,
      from: info?.from ?? from,
      to: info?.to ?? to,
      // The bank's opening balance is the one at the start of its answer. A
      // list with kept days before that starts earlier, so the sheet works
      // its Alter Kontostand out and marks it so (The Bank's Figure Rule).
      blocks: info?.saved ? null : info?.blocks ?? null,
    });
    // The desktop shell exports the PDF directly to a native save dialog (see
    // Statement.tsx); only the browser's own print dialog needs this nudge.
    if (typeof window === 'undefined' || !window.electronPDF) {
      toast(msgs().provider.printAsPdf, 'info', 6000);
    }
  }, [activeAccount, statementInfo, activeBank, bank, transactions, balances, toast]);

  /** A booking's Beleg; `account` where it is not the active one's (the frame's ledger). */
  const printTransaction = useCallback((tx: SerializedTransaction, pending = false, account?: SerializedAccount) => {
    const of = account ?? activeAccount;
    if (!of) return;
    setPrintJob({
      kind: 'transaction',
      account: of,
      bank: (account ? bankOf(account) : activeBank)?.bank ?? bank,
      tx,
      pending,
    });
    if (typeof window === 'undefined' || !window.electronPDF) {
      toast(msgs().provider.printAsPdf, 'info', 6000);
    }
  }, [activeAccount, activeBank, bankOf, bank, toast]);

  // Messages are gone after the logout, so a notice the user must keep (new
  // Sonderbedingungen, a changed fee) leaves as a document. It is the bank's,
  // not an account's: no account needs to be open.
  const printMessage = useCallback((message: InboxMessage) => {
    // With more than one bank in the view the message names its sender
    // (InboxMessage.bank); the letterhead is that bank's, not the primary's.
    const sender = message.bank ? banks.find((b) => b.bank.name === message.bank)?.bank : null;
    setPrintJob({ kind: 'message', bank: sender ?? bank, message });
    if (typeof window === 'undefined' || !window.electronPDF) {
      toast(msgs().provider.printAsPdf, 'info', 6000);
    }
  }, [bank, banks, toast]);

  /**
   * The Steuer-Jahresübersicht on paper. The accounts are named as the bank
   * names them (product or type), never by the user's own name for them: a
   * third party reads this.
   */
  const printTaxYear = useCallback((summary: TaxYear) => {
    const inScope = summary.accounts
      .map((c) => accounts.find((a) => a.accountNumber === c.accountNumber))
      .filter((a): a is SerializedAccount => !!a);
    setPrintJob({
      kind: 'taxYear',
      summary,
      holder: inScope.find((a) => a.holder?.trim())?.holder ?? '',
      accounts: inScope.map((a) => ({
        accountNumber: a.accountNumber,
        iban: a.iban || '',
        label: a.product?.trim() || translateType(a.accountType),
        bank: bankOf(a)?.bank?.name ?? '',
      })),
    });
    if (typeof window === 'undefined' || !window.electronPDF) {
      toast(msgs().provider.printAsPdf, 'info', 6000);
    }
  }, [accounts, bankOf, toast]);

  const closePrintJob = useCallback(() => setPrintJob(null), []);

  return {
    // data
    view, meta, popularBanks, logoFiles, bank, sessionId, userId,
    bankChecking, staleBank,
    tanMethods, selectedMethod, mediaChoice, tanMethodError,
    accounts, activeAccount, balances, transactions, pendingCache, pendingInfo, txError, merchants,
    txErrors, balanceErrors, balanceLoading, loadingAllBalances,
    portfolios, portfolioErrors, portfolioLoading, loadPortfolio,
    docs, docsLocked, docsResettable, loadDocs, resetDocs, readDoc, openDoc, removeDoc, keepReceipt, receiptsOf, receiptKeys,
    bankStatementsLoading, statementFetches, fetchBankStatements,
    busy, loadingAccount, pendingLoading, deviceRemembered, wait, toasts, printJob,
    pendingErrors,
    bankOrders, bankOrdersLoading, bankOrderErrors, orderDeletions,
    range, statementInfo, txByAccount, ownIbans, balanceAt,
    messages, messagesAsked, unreadCount, activity,
    vault, vaultStatus,
    keepBookings, historyStatus, historyCoverage: keptCoverage, savedRange,
    // prefs
    privacy, idleMinutes, singleKeyShortcuts, balancesAtLogin, bookingsAtLogin,
    logoConsent,
    // session
    sessionStartedAt, idleDeadline,
    // navigation & launchers
    tab, settingsTarget, settingsPage, setSettingsPage, txFilter, txFocusNonce, accountOpen, ordersOpen,
    analysisPeriod, analysisScope,
    transferOpen, transferPrefill, shareOpen, sharePrefill, shareAll,
    inboxOpen, paletteOpen, shortcutsOpen, autoLoggedOut,
    logoutConfirmOpen, forgetDeviceOpen,
    // actions
    setView, setBank, connect, chooseTanMethod, clearMediaChoice, selectAccount, closeAccount, loadTransactions,
    cancelConnect,
    loadBalance, loadAllBalances,
    isLoadedForAppliedRange,
    refreshAccount, refreshAfterTransfer, applyRange, loadPending, submitTransfer, confirmVop, abandonVop,
    loadBankOrders, deleteBankOrder,
    forgetDevice, logout, stayLoggedIn, toast, dismissToast,
    requestLogout, closeLogoutConfirm, setForgetDeviceOpen,
    retryWait, cancelWait, closeWait, submitTan, printStatement, printTransaction, printMessage, closePrintJob,
    printTaxYear, loadRange,
    makeBackup, restoreBackup, inspectBankFile, importBankFile,
    togglePrivacy, setIdleMinutes, setSingleKeyShortcuts, setBalancesAtLogin, setBookingsAtLogin,
    setLogoConsent,
    setTab, openSettings, leaveSettings, clearSettingsTarget, setTxFilter, showTransactions, openOrders, closeOrders,
    setAnalysisPeriod, setAnalysisScope,
    openTransfer, closeTransfer, openShare, closeShare, nextShare, openShareQueue, openShareAll, closeShareAll,
    setInboxOpen, setPaletteOpen, setShortcutsOpen,
    markAllRead,
    updateVault, resetVault, wipeVault, accountLabel, renameAccount, arrangeAccounts, setKeepBalances,
    accountsHidden: vault?.accountsHidden ?? NO_ACCOUNTS, setAccountsHidden,
    setKeepBookings, resetHistory, applySavedRange,
    saveTemplate, deleteTemplate, touchTemplate, dismissRecurring, restoreRecurring, setContractReminder, setContractName, setManualContract, setManualDay, markContractsNoticed,
    categoryOf, setCategory, setSplit,
    removeCategoryRule,
    addCustomCategory, renameCustomCategory, deleteCustomCategory,
    modelGuesses, brandNames,
    // Girovo Plus (lib/plus.ts)
    plus, plusOpen, openPlus, closePlus,
    categoryGuessOf, setBudgets, setGoal, recordSplitRequests, noteOf, setNote,
    // more banks (lib/linked-banks.ts)
    links, banks, bankOf, activeBank, addBank,
    openAddBank, closeAddBank, pickAddBank, connectAddBank, chooseAddBankMethod, clearAddBankMedia, addBankBack,
    removeBank,
    // further banks with the first login on the desktop (lib/linked-unlock.ts)
    linkedUnlock, linkedUnlockAsk, setLinkedUnlock, openLinkedUnlockAsk, closeLinkedUnlockAsk, declineLinkedUnlock,
    forgetLinkedPin,
    // Windows Hello in place of the first login's PIN on the desktop (lib/windows-hello.ts)
    windowsHello, setWindowsHello,
    securityKeys, addSecurityKey, renameSecurityKey, removeSecurityKey,
    // "Neue Umsätze melden" (lib/background-check.ts)
    backgroundChecks, backgroundAsk, setBackgroundChecks, openBackgroundAsk, closeBackgroundAsk,
    backgroundAlerts, sendAlertWatch, askCategory,
    // sync between devices (lib/sync.ts)
    sync, syncOpen, openSync, closeSync, syncNow, createSync, syncCode, joinSync, leaveSync,
  };
}

export type FintsApi = ReturnType<typeof useFintsState>;

/** What an empty vault field stands for, one object each, so "nothing changed" can be told by identity. */
const NO_KEPT: Record<string, KeptBalance> = {};
const NO_DAYS: NetWorthDay[] = [];

/** The shell pref that says the offer of "Weitere Banken mit anmelden" is not to come again. */
const LINKED_OFFER_DECLINED = 'fints.linkedUnlock.declined';
/** The shell pref that says Windows Hello was offered once (the toast after a typed login). */
const HELLO_OFFERED = 'fints.windowsHello.offered';
/** Konten als Ebenen with every account ticked: one list, so the value keeps its identity. */
const NO_ACCOUNTS: readonly string[] = [];

/** How this login's sync stands (app/api/sync, op status). */
export type SyncInfo = {
  on: boolean;
  place?: 'lan' | 'webdav' | 'folder';
  deviceName?: string;
  deviceId?: string;
  lastSync?: number | null;
  devices?: Array<{ id: string; name: string; at: number; kind?: 'phone' | 'computer' }>;
};
/** Where the devices meet, as the sheet sets it up (lib/sync.ts SyncPlace). */
export type SyncPlaceChoice =
  | { kind: 'lan'; addresses: string[]; port: number }
  | { kind: 'webdav'; url: string; user: string; password: string }
  | { kind: 'folder'; path?: string };
type SyncRunResponse = {
  changed: boolean;
  vault?: VaultData;
  devices: Array<{ id: string; name: string; at: number; kind?: 'phone' | 'computer' }>;
  lastSync: number;
  receipts: { added: number; removed: number; relinked?: number };
  /** The other devices' entries with no room here (lib/sync.ts SyncResult.full). */
  full?: number;
};

/**
 * How long each step of switching "Neue Umsätze melden" may take. The dialog
 * cannot be closed while it works, so a step that never answers would hold the
 * whole app. `permission` waits for a person, `secret` for a keyring that may
 * ask for its password (25 s, src-tauri/src/secret/linux.rs).
 */
const BACKGROUND_LIMIT_MS = { permission: 120_000, secret: 40_000, server: 20_000, shell: 15_000 };

/** Where "Neue Umsätze melden" can keep its PINs: the desktop shell, or the Android app. */
function backgroundShell(): 'desktop' | 'android' | null {
  if (typeof window === 'undefined') return null;
  if (IS_ANDROID) return window.girovoMobile?.background ? 'android' : null;
  return window.electronBackground && window.electronLinkedUnlock ? 'desktop' : null;
}

/** The shell's secret the checks' box is sealed with (lib/background-check.ts); null where there is none. */
async function backgroundSecret(): Promise<string | null> {
  const shell = backgroundShell();
  if (shell === 'android') return window.girovoMobile!.background.secret().catch(() => null);
  if (shell === 'desktop') return window.electronLinkedUnlock!.secret().catch(() => null);
  return null;
}

/** Plans the shell's checks, or stops them (src-tauri/src/background.rs; BackgroundState.java). */
async function shellSchedule(on: boolean): Promise<void> {
  const shell = backgroundShell();
  if (shell === 'android') await window.girovoMobile!.background.schedule(on);
  else if (shell === 'desktop') await window.electronBackground!.set(on);
}

/** The vault without one contract's cancellation reminder: it goes with the contract. */
const withoutReminder = (v: VaultData, id: string): VaultData => {
  if (!v.contractReminders?.[id]) return v;
  const { [id]: _gone, ...left } = v.contractReminders;
  const { contractReminders: _all, ...rest } = v;
  return Object.keys(left).length ? { ...rest, contractReminders: left } : rest;
};

/** The desktop shell's secret for the further banks' PINs (src-tauri/src/secret.rs); null anywhere else. */
async function linkedUnlockSecret(): Promise<string | null> {
  if (IS_ANDROID || typeof window === 'undefined' || !window.electronLinkedUnlock) return null;
  return window.electronLinkedUnlock.secret().catch(() => null);
}

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
