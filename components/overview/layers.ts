'use client';

// Konten als Ebenen (the desktop's frame, 2026-11-04): every account is a
// layer the user ticks on or off in the sidebar (components/overview/
// AccountLayers.tsx). The ticked ones make the Übersicht — their Umsätze one
// ledger (Ledger.tsx), their balances one sum — and one ticked alone is its
// page. What is unticked lives in the vault (accountsHidden), on this device.

import { useCallback } from 'react';
import { liveValue, orderAccounts, type AccountValue } from '@/lib/account-overview';
import { isDepot } from '@/lib/balances';
import type { SerializedAccount } from '@/lib/fints-types';
import { useFints } from '../FintsProvider';

/**
 * Each account's colour, by its place in the user's order: the chart slots
 * (app/globals.css), which keep apart under protan and deutan simulation and
 * stay clear of the value colours. A layer's dot and its tick carry it.
 */
const LAYER_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)'] as const;

/** Whether an account has Umsätze to show: a Depot has holdings instead. */
export const hasBookings = (a: SerializedAccount): boolean => a.canStatements && !isDepot(a);

export type Layer = { account: SerializedAccount; color: string; shown: boolean };

/** Every account as a layer, in the user's order, with its colour and whether it is ticked. */
export function useLayers(): { layers: Layer[]; shown: SerializedAccount[]; setShown: (acct: string, on: boolean) => void; only: (a: SerializedAccount) => void; all: () => void } {
  const { accounts, vault, accountsHidden, setAccountsHidden, selectAccount } = useFints();
  const off = new Set(accountsHidden);
  const layers = orderAccounts(accounts, vault?.accountOrder).map((account, i) => ({
    account,
    color: LAYER_COLORS[i % LAYER_COLORS.length],
    shown: !off.has(account.accountNumber),
  }));
  const shown = layers.filter((l) => l.shown).map((l) => l.account);
  const setShown = useCallback((acct: string, on: boolean) => {
    const rest = accountsHidden.filter((x) => x !== acct);
    setAccountsHidden(on ? rest : [...rest, acct]);
  }, [accountsHidden, setAccountsHidden]);
  // One account alone is its page: it becomes the active one too.
  const only = useCallback((a: SerializedAccount) => {
    setAccountsHidden(accounts.filter((x) => x.accountNumber !== a.accountNumber).map((x) => x.accountNumber));
    selectAccount(a);
  }, [accounts, setAccountsHidden, selectAccount]);
  const all = useCallback(() => setAccountsHidden([]), [setAccountsHidden]);
  return { layers, shown, setShown, only, all };
}

/**
 * What is known of an account's figure (lib/account-overview.ts): this
 * session's read, else the one kept from an earlier session (dated where it
 * is shown), as the overview of every account reads it.
 */
export function useAccountValue(): (a: SerializedAccount) => AccountValue {
  const { balances, portfolios, vault } = useFints();
  const kept = vault?.keepBalances === false ? undefined : vault?.keptBalances;
  return useCallback((a: SerializedAccount): AccountValue => {
    const live = liveValue(a, balances[a.accountNumber], portfolios[a.accountNumber]);
    const k = kept?.[a.accountNumber];
    if (live.state === 'known' || live.state === 'never' || !k) return live;
    return { state: 'known', cents: k.cents, currency: k.currency, kept: true };
  }, [balances, portfolios, kept]);
}
