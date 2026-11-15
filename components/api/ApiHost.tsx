'use client';

// Girovo API, the page's side (docs/girovo-api.md, lib/api/): mounted once in
// each shell (components/Dashboard.tsx ShellLayers), it does nothing without
// the desktop shell's bridge (window.electronGirovoApi) — the browser, Android
// and the design preview without ?api=… never see it.
//
// The switch "Girovo API zulassen" is the shell's (./bridge.ts useApiOn): it
// listens from the app's start while the switch is on, logged in or not, and
// holds a call that comes while the page can't answer, bringing Girovo
// forward so the login shows who waits (ApiWaitingNotice). While the switch
// is on and the vault open, this tells the shell the page is ready
// (setPageReady), hears every call, has lib/api/router.ts decide it and
// answers. With the logout (this unmounts with the dashboard) the page is no
// longer ready and what was waiting here ends; the pipe stays. Only the
// switch turned off closes it.
//
// Phase 2: the write methods go through the provider's own setters (the same
// ones the screens and Girovo AI use), settings through Einstellungen' own,
// bank.refresh through the provider's reads (the Freigabe in Girovo's window,
// brought to the front), transfers.request through Girovo's transfer sheet
// (./transfer-requests.ts), and events go out through the shell's notify
// whenever the data changes.
//
// The router lives as long as the page: an app refused stays refused until
// Girovo restarts. Grants and the Verlauf go to the vault in batches (a call
// stamps its app's last use and adds a line): one save every second or so,
// not one per call.

import { useEffect, useMemo, useRef } from 'react';
import { ApiRouter, type RouterHost } from '@/lib/api/router';
import type { ApiData } from '@/lib/api/methods';
import { snapshotOf } from '@/lib/api/events';
import { appendLog, grantSubject, withLogOutcome } from '@/lib/api/grants';
import type { SettingsHost } from '@/lib/api/settings';
import type { ApiWrites } from './host-actions';
import type { ApiGrant, ApiLogEntry, TransferState } from '@/lib/api/types';
import type { VaultData } from '@/lib/app-types';
import { categoryLabel } from '@/lib/categories';
import { dayKey, fmtAmountInput } from '@/lib/format';
import { useFints } from '../FintsProvider';
import { useAskScope } from '../insights/AskThread';
import { useRecurringModel } from '../insights/recurring-model';
import { ApiConsentDialog } from './ApiConsent';
import { pageReadyFor, publisherLabel, vaultSwitchMove } from '@/lib/api/host-state';
import { bringForward, hasApiBridge, setApiOn, setPageReady, useApiOn } from './bridge';
import { askConsent, dropConsents } from './consent-store';
import { refreshing, useApiWrites } from './host-actions';
import { onBeforeLogout } from '../provider/before-logout';
import { dropTransfers, onTransferEnd, openTransferId, queueTransfer, takeTransfer, useQueuedTransfers } from './transfer-requests';

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || '';
const FLUSH_MS = 1200;

/** What the router reads, kept current by the live component. */
type Live = {
  vault: VaultData | null;
  open: boolean;
  data: () => ApiData | null;
  updateVault: (fn: (v: VaultData) => VaultData) => void;
  writes: ApiWrites;
};

const live: { current: Live | null } = { current: null };
/** Grant changes, Verlauf lines and transfer outcomes not yet in the vault. */
const pendingGrants: Array<(g: readonly ApiGrant[]) => ApiGrant[]> = [];
const pendingLog: ApiLogEntry[] = [];
/** The grants the last flush saved, and the vault state's grants it was made from: used until that state changes. */
let savedGrants: { grants: ApiGrant[]; from: ApiGrant[] | undefined } | null = null;
function currentGrants(): ApiGrant[] {
  const inState = live.current?.vault?.apiGrants;
  if (savedGrants && savedGrants.from === inState) return savedGrants.grants;
  savedGrants = null;
  return inState ?? [];
}
const pendingOutcomes: Array<{ request: string; outcome: TransferState }> = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function flush() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  const l = live.current;
  if (!l || (!pendingGrants.length && !pendingLog.length && !pendingOutcomes.length)) return;
  const fns = pendingGrants.splice(0);
  const lines = pendingLog.splice(0);
  const outcomes = pendingOutcomes.splice(0);
  l.updateVault((v) => {
    const grants = fns.reduce<ApiGrant[]>((g, fn) => fn(g), v.apiGrants ?? []);
    // Until the next render brings them in the vault state, calls read these (host.grants).
    savedGrants = { grants, from: l.vault?.apiGrants };
    const log = outcomes.reduce((all, o) => withLogOutcome(all, o.request, o.outcome), appendLog(v.apiLog ?? [], lines));
    const next: VaultData = { ...v };
    if (grants.length) next.apiGrants = grants;
    else delete next.apiGrants;
    if (log.length) next.apiLog = log;
    else delete next.apiLog;
    return next;
  });
}

const schedule = () => {
  flushTimer ??= setTimeout(flush, FLUSH_MS);
};

/**
 * Waiting requests end as refused (the open sheet's one ends with the sheet)
 * and everything not yet saved goes into the vault: at the logout, before
 * the vault closes (FintsProvider runs this first), and when the API is
 * switched off.
 */
function settleAndFlush() {
  dropTransfers();
  apiRouter.settlePending(openTransferId());
  flush();
}

const host: RouterHost = {
  vaultOpen: () => !!live.current?.open,
  // What the vault holds, with what is still on its way there (and what was just saved but not rendered yet).
  grants: () => pendingGrants.reduce<ApiGrant[]>((g, fn) => fn(g), currentGrants()),
  setGrants: (fn) => {
    pendingGrants.push(fn);
    schedule();
  },
  data: () => live.current?.data() ?? null,
  ask: askConsent,
  log: (entry) => {
    pendingLog.push(entry);
    schedule();
  },
  now: () => new Date(),
  girovoVersion: APP_VERSION,

  actions: () => (live.current?.open ? live.current.writes.actions : null),
  settings: {
    values: () => live.current?.writes.settings.values() ?? {},
    write: (key, value) => live.current?.writes.settings.write(key, value),
  } satisfies SettingsHost,
  refresh: (key) => live.current?.writes.refresh(key) ?? Promise.resolve({ steps: [] }),
  openTransfer: (record, ask, client) => {
    const { who } = grantSubject(client);
    queueTransfer({ label: { id: record.id, app: who.name, publisher: publisherLabel(who) }, ask });
  },
  notify: (connection, method, params) => {
    const notify = typeof window === 'undefined' ? undefined : window.electronGirovoApi?.notify;
    if (notify && params && typeof params === 'object') void notify(connection, method, params).catch(() => false);
  },
  setLogOutcome: (request, outcome) => {
    pendingOutcomes.push({ request, outcome });
    schedule();
  },
};

/** One router for the page's life: refusals last until Girovo restarts. */
export const apiRouter = new ApiRouter(host);

export function ApiHost() {
  const { vault, vaultStatus, updateVault } = useFints();
  const bridge = hasApiBridge();
  const on = useApiOn();
  const vaultOn = !!vault?.apiOn;
  // The switch from builds that kept it in the vault only moves to the shell, once (lib/api/host-state.ts).
  useEffect(() => {
    if (!bridge || vaultStatus !== 'ready') return;
    const move = vaultSwitchMove(vaultOn, on);
    if (move.turnOn) void setApiOn(true);
    if (move.dropFromVault) {
      updateVault((v) => {
        if (!v.apiOn) return v;
        const rest = { ...v };
        delete rest.apiOn;
        return rest;
      });
    }
  }, [bridge, vaultStatus, vaultOn, on, updateVault]);
  // Without the shell's bridge, or switched off, nothing here: no hooks over the data either.
  if (!bridge || !on) return null;
  return <ApiLive />;
}

function ApiLive() {
  const {
    vault, vaultStatus, updateVault, accounts, balances, txByAccount, categoryOf, noteOf, accountLabel, bankOf,
  } = useFints();
  const scope = useAskScope();
  const recurring = useRecurringModel();
  const writes = useApiWrites();

  const data = useMemo<() => ApiData>(() => () => ({
    accounts: accounts.map((a) => ({
      key: a.accountNumber,
      account: a,
      label: accountLabel(a),
      bank: bankOf(a)?.bank.name ?? '',
      balance: balances[a.accountNumber] ?? null,
    })),
    txByAccount,
    categoryOf,
    categoryName: categoryLabel,
    noteOf,
    scope: scope ? { txs: scope.txs, from: scope.from, to: scope.to, currency: scope.currency } : null,
    contracts: [...recurring.income, ...recurring.expense],
    budgets: vault?.budgets ?? {},
    goals: vault?.goals ?? [],
    today: dayKey(new Date()),
    customCategories: vault?.customCategories ?? [],
    reminders: vault?.contractReminders ?? {},
  }), [accounts, accountLabel, bankOf, balances, txByAccount, categoryOf, noteOf, scope, recurring, vault?.budgets, vault?.goals,
    vault?.customCategories, vault?.contractReminders]);

  // Current on every render, read by the router's host.
  const latest = useRef<Live | null>(null);
  latest.current = { vault, open: vaultStatus === 'ready', data, updateVault, writes };
  live.current = latest.current;

  // The events: every change of the bookings or balances is compared with the last (lib/api/events.ts).
  useEffect(() => {
    if (vaultStatus !== 'ready') return;
    const d = data();
    apiRouter.dataChanged(snapshotOf(d), d);
  }, [data, vaultStatus]);

  // The calls are heard while this is mounted (switched on, logged in); the pipe itself is the shell's.
  useEffect(() => {
    const bridge = window.electronGirovoApi;
    if (!bridge) return;
    live.current = latest.current;
    let on = true;
    const offCall = bridge.onCall((call) => {
      void apiRouter.handle(call).then((payload) => (on ? bridge.reply(call.id, payload) : undefined)).catch(() => {});
    });
    const offClosed = bridge.onClosed(({ connection }) => apiRouter.closed(connection));
    // Kept after this unmounts: an open sheet reports its end as it closes,
    // after the logout too, and the app hears it then (the router outlives this).
    onTransferEnd((id, end) => apiRouter.settleTransfer(id, end.state, { text: end.text, changed: end.changed }));
    const offLogout = onBeforeLogout(settleAndFlush);
    // An end that came in while logged out waits to be saved with this login.
    if (pendingGrants.length || pendingLog.length || pendingOutcomes.length) schedule();
    return () => {
      on = false;
      offCall();
      offClosed();
      offLogout();
      settleAndFlush();
      apiRouter.reset();
      dropConsents();
      live.current = null;
    };
  }, []);

  // Ready once the vault is open, no longer at the logout (this unmounts) or
  // while it closes: until then the shell holds calls (after the listener
  // above is registered, bridge.js ready).
  const ready = pageReadyFor(vaultStatus);
  useEffect(() => {
    if (!ready) return;
    setPageReady(true);
    return () => setPageReady(false);
  }, [ready]);

  return (
    <>
      <ApiConsentDialog />
      <TransferOpener />
      <FreigabeForward />
    </>
  );
}

/**
 * Opens the next transfer an app asked for in Girovo's own sheet, filled in
 * and marked with the app, once no other sheet is open and no read holds
 * the line; brings the window forward for it.
 */
function TransferOpener() {
  const { transferOpen, openTransfer, view, busy, vaultStatus, accounts, bankOf } = useFints();
  const waiting = useQueuedTransfers();
  useEffect(() => {
    if (!waiting || transferOpen || busy || view !== 'dashboard' || vaultStatus !== 'ready') return;
    const next = takeTransfer();
    if (!next) return;
    const { label, ask } = next;
    // Nothing that can send it now (a further bank logged out): the request ends without a sheet.
    const senders = accounts.filter((a) => a.canTransfer && bankOf(a)?.state !== 'loggedOut');
    if (!senders.length || (ask.accountKey && !senders.some((a) => a.accountNumber === ask.accountKey))) {
      apiRouter.settleTransfer(label.id, 'failed');
      return;
    }
    bringForward();
    openTransfer({
      ...(ask.accountKey ? { accountNumber: ask.accountKey } : {}),
      name: ask.name,
      iban: ask.iban,
      amount: fmtAmountInput(ask.cents / 100),
      purpose: ask.purpose,
      ...(ask.executeOn ? { executeOn: ask.executeOn } : {}),
      request: label,
    });
  }, [waiting, transferOpen, busy, view, vaultStatus, openTransfer, accounts, bankOf]);
  return null;
}

/** While a read an app asked for runs, the bank's Freigabe brings Girovo's window to the front. */
function FreigabeForward() {
  const { wait } = useFints();
  const open = wait.open;
  useEffect(() => {
    if (open && refreshing.count > 0) bringForward();
  }, [open]);
  return null;
}
