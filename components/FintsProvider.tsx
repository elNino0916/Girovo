'use client';

// The whole client-side state machine.
//
// Every read on the bank may need its own SCA approval, so operations are
// strictly serialized behind `busy`. A single statement query yields both the
// transactions AND the balance, which is why there is no separate balance
// fetch on the dashboard path — that would cost a second approval.

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { get, post, store } from '@/lib/client-api';
import type {
  ConnectResponse, Merchant, MerchantsResponse, MetaResponse, PendingResponse,
  SelectTanResponse, SerializedAccount, SerializedBalance, SerializedTanMethod,
  SerializedTransaction, TanPollResponse, TransactionsResponse, TransferResponse,
} from '@/lib/fints-types';
import type { PopularBank } from '@/lib/banks';

export type ChosenBank = {
  blz: string;
  name: string;
  brand: string;
  bic?: string | null;
  location?: string;
  hint?: string;
};

export type BankSearchHit = {
  blz: string; name: string; location: string; bic: string; brand: string;
};

export type Toast = { id: number; message: string; tone: 'info' | 'error' };

export type View = 'login' | 'tanmethod' | 'dashboard';

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
    }
  | { kind: 'transaction'; account: SerializedAccount; bank: ChosenBank | null; tx: SerializedTransaction };

type WaitPhase = 'waiting' | 'confirmed' | 'error' | 'ended';

export type WaitState = {
  open: boolean;
  title: string;
  text: string;
  challenge: string | null;
  phase: WaitPhase;
  error: string | null;
  canRetry: boolean;
  /** Seconds since the approval was requested — makes the wait feel bounded. */
  elapsed: number;
};

const IDLE_WAIT: WaitState = {
  open: false, title: '', text: '', challenge: null,
  phase: 'waiting', error: null, canRetry: false, elapsed: 0,
};

type TanGate = { needsTan?: boolean; tanChallenge?: string | null };

type WaitCallbacks = {
  onDone?: (r: TanPollResponse & { status: 'done' }) => void;
  retry?: (() => void) | null;
  onDialogEnded?: ((r: TanPollResponse) => void) | null;
};

// ---------------------------------------------------------------------------

function useFintsState() {
  const [view, setView] = useState<View>('login');
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [popularBanks, setPopularBanks] = useState<PopularBank[]>([]);
  const [logoFiles, setLogoFiles] = useState<Record<string, string>>({});

  const [bank, setBank] = useState<ChosenBank | null>(null);
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
  const [pendingCache, setPendingCache] = useState<Record<string, SerializedTransaction[]>>({});
  const [txError, setTxError] = useState<string | null>(null);

  /** Counterparty name → company, or null once we know there's no match. */
  const [merchants, setMerchants] = useState<Record<string, Merchant | null>>({});

  const [busy, setBusy] = useState(false);
  const [loadingAccount, setLoadingAccount] = useState<string | null>(null);
  const [pendingLoading, setPendingLoading] = useState<string | null>(null);
  const [deviceRemembered, setDeviceRemembered] = useState(false);

  const [wait, setWait] = useState<WaitState>(IDLE_WAIT);
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Refs mirror the state the async poll loop reads, so a long-running approval
  // never closes over a stale render.
  const sessionRef = useRef<string | null>(null);
  const busyRef = useRef(false);
  const accountsRef = useRef<SerializedAccount[]>([]);
  const metaRef = useRef<MetaResponse | null>(null);
  /** Names already sent for logo lookup — each is attempted once per session. */
  const merchantsAsked = useRef<Set<string>>(new Set());
  const waitCbRef = useRef<WaitCallbacks>({});
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const elapsedTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const toastId = useRef(0);

  sessionRef.current = sessionId;
  busyRef.current = busy;
  accountsRef.current = accounts;
  metaRef.current = meta;

  const toast = useCallback((message: string, tone: 'info' | 'error' = 'info', ms = 4200) => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ms);
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

    const last = store.get('fints.lastBank');
    if (last) {
      try { setBank(JSON.parse(last) as ChosenBank); } catch { /* stale value */ }
    }
  }, []);

  useEffect(() => () => {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    if (elapsedTimer.current) clearInterval(elapsedTimer.current);
  }, []);

  // ---- decoupled TAN wait -------------------------------------------------
  const stopTimers = useCallback(() => {
    if (pollTimer.current) { clearTimeout(pollTimer.current); pollTimer.current = null; }
    if (elapsedTimer.current) { clearInterval(elapsedTimer.current); elapsedTimer.current = null; }
  }, []);

  const startDecoupledWait = useCallback((
    method: SerializedTanMethod | null,
    data: TanGate,
    cbs: WaitCallbacks,
    opts: { title?: string } = {},
  ) => {
    waitCbRef.current = cbs;
    setWait({
      open: true,
      title: opts.title || 'Freigabe in deiner App',
      text: method?.isDecoupled
        ? `Öffne „${method.name}“ und bestätige die Anfrage.`
        : 'Bestätige die Anfrage in deiner Banking-App.',
      challenge: data.tanChallenge || null,
      phase: 'waiting',
      error: null,
      canRetry: false,
      elapsed: 0,
    });

    stopTimers();
    elapsedTimer.current = setInterval(() => {
      setWait((w) => (w.open && w.phase === 'waiting' ? { ...w, elapsed: w.elapsed + 1 } : w));
    }, 1000);

    const interval = Math.max(1500, (method?.decoupled?.waitBetween || 2) * 1000);
    const firstDelay = Math.max(1000, (method?.decoupled?.waitBeforeFirst || 1) * 1000);

    const poll = async () => {
      try {
        const r = await post<TanPollResponse>('/api/tan-poll', { sessionId: sessionRef.current });
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
            title: 'Freigabe nicht rechtzeitig angekommen',
            text:
              'Die Bank hat den Vorgang beendet, bevor die Freigabe verarbeitet wurde. ' +
              'Bitte erneut starten und die Freigabe zügig bestätigen.',
            canRetry: !!waitCbRef.current.retry,
          }));
          return;
        }
        stopTimers();
        setWait((w) => ({ ...w, phase: 'confirmed' }));
        setTimeout(() => setWait(IDLE_WAIT), 350);
        waitCbRef.current.onDone?.(r);
      } catch (err) {
        stopTimers();
        setWait((w) => ({
          ...w,
          phase: 'error',
          error: (err as Error).message,
          canRetry: !!waitCbRef.current.retry,
        }));
      }
    };

    pollTimer.current = setTimeout(poll, firstDelay);
  }, [stopTimers]);

  const closeWait = useCallback(() => {
    stopTimers();
    setWait(IDLE_WAIT);
  }, [stopTimers]);

  const retryWait = useCallback(() => {
    const retry = waitCbRef.current.retry;
    closeWait();
    retry?.();
  }, [closeWait]);

  const cancelWait = useCallback(async () => {
    closeWait();
    setBusy(false);
    setLoadingAccount(null);
    setPendingLoading(null);
    try { await post('/api/cancel-pending', { sessionId: sessionRef.current }); } catch { /* best effort */ }
    // Cancelling the very first approval (the login sync) leaves nothing to
    // show — go back to the login screen rather than an empty dashboard.
    if (!accountsRef.current.length) setView('login');
  }, [closeWait]);

  /** The method a mid-session approval should be attributed to. */
  const decoupledMethod = useCallback(
    () => selectedMethod || tanMethods.find((m) => m.isDecoupled) || tanMethods[0] || null,
    [selectedMethod, tanMethods],
  );

  // ---- company logos ------------------------------------------------------
  // Decoration, so it runs outside the `busy` gate that serialises bank calls
  // and never blocks or fails a statement. Each counterparty is asked about
  // once per session; the server caches misses too.
  const resolveMerchants = useCallback(async (txs: SerializedTransaction[]) => {
    if (!metaRef.current?.merchantLogos) return;
    const names = [...new Set(txs.map((t) => (t.remoteName || '').trim()).filter(Boolean))]
      .filter((n) => !merchantsAsked.current.has(n));
    if (!names.length) return;
    names.forEach((n) => merchantsAsked.current.add(n));

    try {
      const found = await post<MerchantsResponse>('/api/merchants', {
        sessionId: sessionRef.current, names,
      });
      setMerchants((m) => ({ ...m, ...found }));
    } catch { /* a missing logo is not worth surfacing */ }
  }, []);

  // ---- transactions -------------------------------------------------------
  const loadTransactions = useCallback(async (
    account: SerializedAccount,
    from?: string,
    to?: string,
    opts: { force?: boolean } = {},
  ) => {
    const cacheKey = `${from || ''}|${to || ''}`;
    setTxError(null);

    if (!opts.force) {
      const cached = txCache[account.accountNumber];
      if (cached && cached.key === cacheKey) return;
    }
    if (busyRef.current) return;

    setBusy(true);
    setLoadingAccount(account.accountNumber);

    const finish = () => { setBusy(false); setLoadingAccount(null); };
    const apply = (txs: SerializedTransaction[], balance: SerializedBalance | null) => {
      if (balance) setBalances((b) => ({ ...b, [account.accountNumber]: balance }));
      setTxCache((c) => ({ ...c, [account.accountNumber]: { key: cacheKey, txs: txs || [] } }));
      void resolveMerchants(txs || []);
    };

    try {
      const data = await post<TransactionsResponse>('/api/transactions', {
        sessionId: sessionRef.current, accountNumber: account.accountNumber, from, to,
      });
      if ('needsTan' in data && data.needsTan) {
        startDecoupledWait(decoupledMethod(), data, {
          onDone: (r) => {
            finish();
            if (r.kind === 'statements') apply(r.transactions, r.balance);
          },
          retry: () => { finish(); void loadTransactions(account, from, to, { force: true }); },
        });
      } else if (!('needsTan' in data) || !data.needsTan) {
        finish();
        apply(data.transactions, data.balance);
      }
    } catch (err) {
      finish();
      setTxError((err as Error).message);
    }
  }, [txCache, startDecoupledWait, decoupledMethod, resolveMerchants]);

  const selectAccount = useCallback((a: SerializedAccount) => {
    if (busyRef.current) return; // don't interrupt an in-flight approval
    setActiveAccount(a);
    void loadTransactions(a);
  }, [loadTransactions]);

  // ---- vorgemerkte Umsätze ------------------------------------------------
  const loadPending = useCallback(async (account: SerializedAccount) => {
    if (busyRef.current) {
      toast('Bitte warten — ein anderer Vorgang läuft noch.', 'error');
      return;
    }
    setBusy(true);
    setPendingLoading(account.accountNumber);

    const finish = () => { setBusy(false); setPendingLoading(null); };
    const apply = (txs: SerializedTransaction[]) => {
      setPendingCache((c) => ({ ...c, [account.accountNumber]: txs || [] }));
      void resolveMerchants(txs || []);
    };

    try {
      const data = await post<PendingResponse>('/api/pending', {
        sessionId: sessionRef.current, accountNumber: account.accountNumber,
      });
      if ('needsTan' in data && data.needsTan) {
        startDecoupledWait(decoupledMethod(), data, {
          onDone: (r) => { finish(); if (r.kind === 'pending') apply(r.pending); },
          retry: () => { finish(); void loadPending(account); },
        }, { title: 'Vorgemerkte Umsätze freigeben' });
      } else if (!('needsTan' in data) || !data.needsTan) {
        finish();
        apply(data.pending);
      }
    } catch (err) {
      finish();
      toast((err as Error).message, 'error');
    }
  }, [startDecoupledWait, decoupledMethod, toast, resolveMerchants]);

  // ---- login --------------------------------------------------------------
  const afterAccountsReady = useCallback((list: SerializedAccount[]) => {
    setAccounts(list);
    setView('dashboard');
    if (list[0]) {
      setActiveAccount(list[0]);
      void loadTransactions(list[0]);
    }
  }, [loadTransactions]);

  const notifyDeviceSaved = useCallback(() => {
    setDeviceRemembered(true);
    toast('Gerät gemerkt — künftige Anmeldungen brauchen seltener eine TAN.', 'info', 6000);
  }, [toast]);

  const connect = useCallback(async (chosen: ChosenBank, login: string, pin: string) => {
    const data = await post<ConnectResponse>('/api/connect', {
      blz: chosen.blz, userId: login, pin,
    });

    store.set('fints.lastBank', JSON.stringify(chosen));
    store.set(`fints.userId.${chosen.blz}`, login);

    setSessionId(data.sessionId);
    sessionRef.current = data.sessionId;
    setBank({ ...chosen, name: data.bank.bankName || chosen.name, brand: data.bank.brand, bic: data.bank.bic });
    setUserId(login);

    if ('bankMessages' in data) {
      for (const m of data.bankMessages || []) {
        if (m?.subject) toast(m.subject, 'info', 6000);
      }
    }

    if ('restored' in data && data.restored) {
      // Remembered device: cached accounts + TAN method, no sync SCA.
      setSelectedMethod(data.selectedTanMethod);
      setTanMethods(data.selectedTanMethod ? [data.selectedTanMethod] : []);
      setDeviceRemembered(true);
      toast('Gerät erkannt — ohne neue TAN angemeldet.');
      afterAccountsReady(data.accounts || []);
    } else if ('tanMethods' in data) {
      setTanMethods(data.tanMethods || []);
      setSelectedMethod(null);
      setMediaChoice(null);
      setTanMethodError(data.tanMethods?.length ? null : 'Die Bank bietet keine TAN-Verfahren für diesen Zugang an.');
      setView('tanmethod');
    }
  }, [afterAccountsReady, toast]);

  const chooseTanMethod = useCallback(async (method: SerializedTanMethod, tanMediaName?: string) => {
    setSelectedMethod(method);
    setTanMethodError(null);
    const media = tanMediaName
      || (method.activeTanMedia?.length === 1 ? method.activeTanMedia[0] : undefined);
    try {
      const data = await post<SelectTanResponse>('/api/select-tan', {
        sessionId: sessionRef.current, tanMethodId: method.id, tanMediaName: media,
      });

      if ('chooseTanMedia' in data) {
        setMediaChoice(data.chooseTanMedia);
        return;
      }
      if ('needsTan' in data && data.needsTan) {
        startDecoupledWait(method, data, {
          onDone: (r) => {
            if (r.kind !== 'accounts') return;
            if (r.deviceSaved) notifyDeviceSaved();
            afterAccountsReady(r.accounts || []);
          },
          retry: () => void chooseTanMethod(method, media),
        });
        return;
      }
      if ('accounts' in data) {
        if (data.deviceSaved) notifyDeviceSaved();
        afterAccountsReady(data.accounts || []);
      }
    } catch (err) {
      setTanMethodError((err as Error).message);
    }
  }, [startDecoupledWait, afterAccountsReady, notifyDeviceSaved]);

  // ---- device + session ---------------------------------------------------
  const forgetDevice = useCallback(async () => {
    try {
      await post('/api/forget-device', { sessionId: sessionRef.current });
      setDeviceRemembered(false);
      toast('Gerät vergessen — bei der nächsten Anmeldung wird wieder eine TAN angefragt.', 'info', 6000);
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }, [toast]);

  const logout = useCallback(async () => {
    stopTimers();
    try { await post('/api/logout', { sessionId: sessionRef.current }); } catch { /* best effort */ }
    // Logout clears the session only; the remembered device stays (use
    // "Gerät vergessen" to wipe it).
    setSessionId(null);
    sessionRef.current = null;
    setAccounts([]);
    setActiveAccount(null);
    setBalances({});
    setTxCache({});
    setPendingCache({});
    setMerchants({});
    merchantsAsked.current.clear();
    setSelectedMethod(null);
    setTanMethods([]);
    setMediaChoice(null);
    setBusy(false);
    setLoadingAccount(null);
    setPendingLoading(null);
    setDeviceRemembered(false);
    setTxError(null);
    setWait(IDLE_WAIT);
    setView('login');
  }, [stopTimers]);

  // ---- transfer -----------------------------------------------------------
  const submitTransfer = useCallback(async (
    payload: {
      accountNumber: string; recipientName: string; iban: string;
      amount: string; purpose: string; instant: boolean;
    },
    handlers: {
      onExecuted: (bankAnswers?: string) => void;
      onUnknown: () => void;
      onError: (message: string) => void;
      onTanStarted: () => void;
    },
  ) => {
    if (busyRef.current) {
      handlers.onError('Bitte warten — ein anderer Vorgang läuft noch.');
      return;
    }
    setBusy(true);
    try {
      const data = await post<TransferResponse>('/api/transfer', {
        sessionId: sessionRef.current, ...payload,
      });

      if ('needsTan' in data && data.needsTan) {
        handlers.onTanStarted();
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
        }, { title: 'Überweisung freigeben' });
      } else if ('bankAnswers' in data) {
        setBusy(false);
        handlers.onExecuted(data.bankAnswers);
      }
    } catch (err) {
      setBusy(false);
      handlers.onError((err as Error).message);
    }
  }, [startDecoupledWait, decoupledMethod, closeWait]);

  /** Drop the cache for one account and re-read it from the bank. */
  const refreshAccount = useCallback((account: SerializedAccount, from?: string, to?: string) => {
    void loadTransactions(account, from, to, { force: true });
  }, [loadTransactions]);

  const transactions = activeAccount ? txCache[activeAccount.accountNumber]?.txs ?? null : null;

  // ---- printable Kontoauszug / transaction receipt ------------------------
  // A print job just snapshots what's already on screen (no extra bank call,
  // no PDF library): Statement.tsx renders it print-only, and the browser's
  // own "Save as PDF" print target is the actual PDF generator.
  const [printJob, setPrintJob] = useState<PrintJob | null>(null);

  const printStatement = useCallback((from?: string, to?: string) => {
    if (!activeAccount) return;
    setPrintJob({
      kind: 'statement',
      account: activeAccount,
      bank,
      transactions: transactions ?? [],
      balance: balances[activeAccount.accountNumber] ?? null,
      from,
      to,
    });
    toast('Im Druckdialog „Als PDF speichern“ wählen.', 'info', 6000);
  }, [activeAccount, bank, transactions, balances, toast]);

  const printTransaction = useCallback((tx: SerializedTransaction) => {
    if (!activeAccount) return;
    setPrintJob({ kind: 'transaction', account: activeAccount, bank, tx });
    toast('Im Druckdialog „Als PDF speichern“ wählen.', 'info', 6000);
  }, [activeAccount, bank, toast]);

  const closePrintJob = useCallback(() => setPrintJob(null), []);

  return {
    // data
    view, meta, popularBanks, logoFiles, bank, sessionId, userId,
    tanMethods, selectedMethod, mediaChoice, tanMethodError,
    accounts, activeAccount, balances, transactions, pendingCache, txError, merchants,
    busy, loadingAccount, pendingLoading, deviceRemembered, wait, toasts, printJob,
    // actions
    setView, setBank, connect, chooseTanMethod, selectAccount, loadTransactions,
    refreshAccount, loadPending, submitTransfer, forgetDevice, logout, toast,
    retryWait, cancelWait, closeWait, printStatement, printTransaction, closePrintJob,
  };
}

export type FintsApi = ReturnType<typeof useFintsState>;

const FintsContext = createContext<FintsApi | null>(null);

export function FintsProvider({ children }: { children: React.ReactNode }) {
  const value = useFintsState();
  return <FintsContext.Provider value={value}>{children}</FintsContext.Provider>;
}

export function useFints(): FintsApi {
  const ctx = useContext(FintsContext);
  if (!ctx) throw new Error('useFints must be used inside <FintsProvider>');
  return ctx;
}

/** Convenience: the logo filename for a brand, or undefined for a monogram. */
export function useLogoFile(brand: string | undefined): string | undefined {
  const { logoFiles } = useFints();
  return useMemo(() => (brand ? logoFiles[brand] : undefined), [logoFiles, brand]);
}
