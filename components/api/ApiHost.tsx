'use client';

// Girovo API, the page's side (docs/girovo-api.md, lib/api/): mounted once in
// each shell (components/Dashboard.tsx ShellLayers), it does nothing without
// the desktop shell's bridge (window.electronGirovoApi) — the browser, Android
// and the design preview without ?api=… never see it.
//
// While "Girovo API zulassen" is on (vault.apiOn) it opens the pipe or socket
// (setEnabled(true)), hears every call the shell sends, has lib/api/router.ts
// decide it and answers. Switched off, or with the logout (this unmounts with
// the dashboard), it closes the pipe again and ends what was waiting.
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
import { bringForward, hasApiBridge } from './bridge';
import { askConsent, dropConsents } from './consent-store';
import { refreshing, useApiWrites } from './host-actions';
import { dropTransfers, onTransferEnd, queueTransfer, takeTransfer, useQueuedTransfers } from './transfer-requests';

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

const host: RouterHost = {
  vaultOpen: () => !!live.current?.open,
  // What the vault holds, with what is still on its way there.
  grants: () => pendingGrants.reduce<ApiGrant[]>((g, fn) => fn(g), live.current?.vault?.apiGrants ?? []),
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
    const publisher = who.publisher.kind === 'mtmedia' ? 'MT-Media' : who.publisher.name?.trim() || null;
    queueTransfer({ label: { id: record.id, app: who.name, publisher }, ask });
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
  const { vault } = useFints();
  // Without the shell's bridge nothing here: no hooks over the data either.
  if (!hasApiBridge() || !vault?.apiOn) return null;
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

  // The pipe opens with this component and closes with it (switched off, logged out).
  useEffect(() => {
    const bridge = window.electronGirovoApi;
    if (!bridge) return;
    live.current = latest.current;
    let on = true;
    void bridge.setEnabled(true).catch(() => {});
    const offCall = bridge.onCall((call) => {
      void apiRouter.handle(call).then((payload) => (on ? bridge.reply(call.id, payload) : undefined)).catch(() => {});
    });
    const offClosed = bridge.onClosed(({ connection }) => apiRouter.closed(connection));
    onTransferEnd((id, end) => apiRouter.settleTransfer(id, end.state, { text: end.text, changed: end.changed }));
    return () => {
      on = false;
      offCall();
      offClosed();
      // Requests whose sheet never opened end as refused; an open sheet reports its own end as it closes.
      dropTransfers();
      apiRouter.settlePending();
      onTransferEnd(null);
      apiRouter.reset();
      dropConsents();
      flush();
      live.current = null;
      void bridge.setEnabled(false).catch(() => {});
    };
  }, []);

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
