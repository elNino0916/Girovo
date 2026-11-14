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
// The router lives as long as the page: an app refused stays refused until
// Girovo restarts. Grants and the Verlauf go to the vault in batches (a call
// stamps its app's last use and adds a line): one save every second or so,
// not one per call.

import { useEffect, useMemo, useRef } from 'react';
import { ApiRouter, type RouterHost } from '@/lib/api/router';
import type { ApiData } from '@/lib/api/methods';
import { appendLog } from '@/lib/api/grants';
import type { ApiGrant, ApiLogEntry } from '@/lib/api/types';
import type { VaultData } from '@/lib/app-types';
import { categoryLabel } from '@/lib/categories';
import { dayKey } from '@/lib/format';
import { useFints } from '../FintsProvider';
import { useAskScope } from '../insights/AskThread';
import { useRecurringModel } from '../insights/recurring-model';
import { ApiConsentDialog } from './ApiConsent';
import { hasApiBridge } from './bridge';
import { askConsent, dropConsents } from './consent-store';

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || '';
const FLUSH_MS = 1200;

/** What the router reads, kept current by the live component. */
type Live = {
  vault: VaultData | null;
  open: boolean;
  data: () => ApiData | null;
  updateVault: (fn: (v: VaultData) => VaultData) => void;
};

const live: { current: Live | null } = { current: null };
/** Grant changes and Verlauf lines not yet in the vault. */
const pendingGrants: Array<(g: readonly ApiGrant[]) => ApiGrant[]> = [];
const pendingLog: ApiLogEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function flush() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  const l = live.current;
  if (!l || (!pendingGrants.length && !pendingLog.length)) return;
  const fns = pendingGrants.splice(0);
  const lines = pendingLog.splice(0);
  l.updateVault((v) => {
    const grants = fns.reduce<ApiGrant[]>((g, fn) => fn(g), v.apiGrants ?? []);
    const log = appendLog(v.apiLog ?? [], lines);
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
  }), [accounts, accountLabel, bankOf, balances, txByAccount, categoryOf, noteOf, scope, recurring, vault?.budgets, vault?.goals]);

  // Current on every render, read by the router's host.
  const latest = useRef<Live | null>(null);
  latest.current = { vault, open: vaultStatus === 'ready', data, updateVault };
  live.current = latest.current;

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
    return () => {
      on = false;
      offCall();
      offClosed();
      apiRouter.reset();
      dropConsents();
      flush();
      live.current = null;
      void bridge.setEnabled(false).catch(() => {});
    };
  }, []);

  return <ApiConsentDialog />;
}
