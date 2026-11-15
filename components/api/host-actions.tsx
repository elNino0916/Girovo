'use client';

// The Girovo API's ways to change things (phase 2), made each render from the
// provider's own setters, so a change an app makes is kept, cleaned and synced
// exactly as the same change made on screen:
//
//   actions   lib/api/writes.ts: setCategory, addCustomCategory, setNote,
//             setBudgets, setGoal, setContractReminder, setContractName (as
//             the screens and Girovo AI's actions call them)
//   settings  lib/api/settings.ts' allowlist: each key read where
//             Einstellungen reads it and written with the control's own setter
//   refresh   bank.refresh: each account read as its own buttons read it
//             (loadTransactions forced, the Depot's holdings, the balance),
//             one after the other behind the provider's line, stopping at the
//             first Freigabe the user calls off

import { useRef } from 'react';
import type { SettingKey, SettingsValues } from '@/lib/api/settings';
import type { RefreshReport, RefreshStep } from '@/lib/api/transfers';
import type { ApiActions } from '@/lib/api/writes';
import { DEFAULT_LENGTH, DEFAULT_TONE } from '@/lib/ask-style';
import { isDepot } from '@/lib/balances';
import type { SerializedAccount } from '@/lib/fints-types';
import { useLocale } from '@/lib/i18n/react';
import { IS_ANDROID } from '@/lib/platform';
import { goalsAllowed } from '@/lib/plus';
import { setBlack, setThemePref } from '@/lib/theme';
import type { VaultData } from '@/lib/app-types';
import { useFints, type IdleMinutes } from '../FintsProvider';
import { withOwnGroupsOff, withOwnGroupsOn } from '../overview/own-groups';
import { msgs } from '@/lib/i18n';
import { useGemma } from '../insights/gemma';
import { useBlackBackground, useThemePref } from '../ThemeToggle';

export type ApiWrites = {
  actions: ApiActions;
  settings: {
    values: () => Partial<SettingsValues>;
    offers: { ownGroups: boolean };
    write: <K extends SettingKey>(key: K, value: SettingsValues[K]) => void;
  };
  refresh: (key: string | null) => Promise<RefreshReport>;
};

/** How many bank.refresh calls are reading now (the bank's Freigabe then brings the window forward). */
export const refreshing = { count: 0 };

type Via = 'statement' | 'portfolio' | 'balance';

/** The reads of a refresh: each account the provider can read now, as its own buttons read it. */
export function refreshPlan(
  accounts: readonly SerializedAccount[], key: string | null, reachable: (a: SerializedAccount) => boolean,
): { account: SerializedAccount; via: Via }[] {
  const out: { account: SerializedAccount; via: Via }[] = [];
  for (const a of accounts) {
    if ((key && a.accountNumber !== key) || !reachable(a)) continue;
    const via: Via | null = a.canStatements && !isDepot(a) ? 'statement' : isDepot(a) && a.canPortfolio ? 'portfolio' : a.canBalance ? 'balance' : null;
    if (via) out.push({ account: a, via });
  }
  return out;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** How long a read may wait for the line or for its own end. */
const LINE_WAIT_MS = 120_000;
const READ_MAX_MS = 6 * 60_000;

/** The vault with a flag set (on) or removed (off): the vault keeps such switches only while they are not the default. */
function flag<K extends keyof VaultData>(v: VaultData, key: K, on: boolean, value: VaultData[K]): VaultData {
  if (on) return v[key] === value ? v : { ...v, [key]: value };
  if (v[key] === undefined) return v;
  const rest = { ...v };
  delete rest[key];
  return rest;
}

export function useApiWrites(): ApiWrites {
  const f = useFints();
  const { locale, setLocale } = useLocale();
  const theme = useThemePref();
  const black = useBlackBackground();
  const gemma = useGemma();
  // The reads of a refresh outlive the render that started them: they read the provider as it stands now.
  const now = useRef(f);
  now.current = f;
  const { vault, vaultStatus, updateVault } = f;
  const ready = vaultStatus === 'ready' && !!vault;

  const actions: ApiActions = {
    setCategory: (tx, id, rule) => f.setCategory(tx, id, { rule }),
    addCategory: (name, direction) => f.addCustomCategory(name, direction),
    setNote: (tx, text) => f.setNote(tx, text),
    setBudgets: (next) => f.setBudgets(next),
    goalsAllowed: goalsAllowed(f.plus.state),
    setGoal: (key, goal) => f.setGoal(key, goal),
    setReminder: (id, reminder) => f.setContractReminder(id, reminder),
    setContractName: (id, name) => f.setContractName(id, name),
  };

  const values = (): Partial<SettingsValues> => {
    const out: Partial<SettingsValues> = {
      language: locale,
      blackBackground: black,
      idleMinutes: f.idleMinutes,
      balancesAtLogin: f.balancesAtLogin,
      bookingsAtLogin: f.bookingsAtLogin,
      singleKeyShortcuts: f.singleKeyShortcuts,
    };
    // The Android app follows the phone's light and dark.
    if (!IS_ANDROID) out.theme = theme;
    if (f.meta?.merchantLogos) out.companyLogos = f.logoConsent === 'on';
    if (ready) {
      out.keepBalances = vault.keepBalances !== false;
      out.keepBookings = f.keepBookings;
      out.ai = !vault.askOff;
      out.aiTone = vault.askTone ?? DEFAULT_TONE;
      out.aiLength = vault.askLength ?? DEFAULT_LENGTH;
      out.aiUseName = !vault.askNameOff;
      // Cleaned names need the shell's Gemma, as their row in Einstellungen.
      if (!IS_ANDROID && gemma?.supported) out.aiNames = !!vault.aiNamesOn;
      const order = vault.accountOrder ?? [];
      const place = (a: SerializedAccount) => {
        const i = order.indexOf(a.accountNumber);
        return i < 0 ? order.length : i;
      };
      out.accountOrder = f.accounts.map((a, i) => ({ a, i })).sort((x, y) => place(x.a) - place(y.a) || x.i - y.i).map((x) => x.a.accountNumber);
      // As Konten anordnen shows it: on the desktop "Keine" or "Eigene", on the phone its grouping.
      out.accountGrouping = IS_ANDROID ? vault.accountGrouping ?? 'type' : vault.accountGroupsOn ? 'own' : 'none';
      out.hiddenAccounts = [...(vault.accountsHidden ?? [])];
    }
    return out;
  };

  const write = <K extends SettingKey>(key: K, value: SettingsValues[K]) => {
    const v = value as never;
    switch (key) {
      case 'language': setLocale(v); break;
      case 'theme': setThemePref(v); break;
      case 'blackBackground': setBlack(v); break;
      case 'idleMinutes': f.setIdleMinutes(v as IdleMinutes); break;
      case 'balancesAtLogin': f.setBalancesAtLogin(v); break;
      case 'bookingsAtLogin': f.setBookingsAtLogin(v); break;
      case 'singleKeyShortcuts': f.setSingleKeyShortcuts(v); break;
      case 'companyLogos': f.setLogoConsent(v); break;
      // Only ever on through the API (lib/api/settings.ts): off deletes what is kept.
      case 'keepBalances': if (value === true) f.setKeepBalances(true); break;
      case 'keepBookings': if (value === true) void f.setKeepBookings(true); break;
      // As Einstellungen → Girovo AI: off forgets that "Girovo AI ist bereit" was seen.
      case 'ai': updateVault((vv) => {
        if (value === true) return flag(vv, 'askOff', false, true);
        const off = flag(vv, 'askOff', true, true);
        if (!off.askIntroSeen) return off;
        const rest = { ...off };
        delete rest.askIntroSeen;
        return rest;
      }); break;
      case 'aiTone': updateVault((vv) => flag(vv, 'askTone', value !== DEFAULT_TONE, value as VaultData['askTone'])); break;
      case 'aiLength': updateVault((vv) => flag(vv, 'askLength', value !== DEFAULT_LENGTH, value as VaultData['askLength'])); break;
      case 'aiUseName': updateVault((vv) => flag(vv, 'askNameOff', value === false, true)); break;
      case 'aiNames': updateVault((vv) => flag(vv, 'aiNamesOn', value === true, true)); break;
      case 'accountOrder': f.arrangeAccounts({ order: value as string[] }); break;
      case 'accountGrouping':
        // The desktop, as Konten anordnen: "Eigene" on, or off ("Keine") with
        // the groups kept and the phone's grouping left alone. The phone sets its grouping.
        if (!IS_ANDROID) updateVault((vv) => (value === 'own' ? withOwnGroupsOn(vv, f.accounts, msgs().insights.accounts.groups) : withOwnGroupsOff(vv)));
        else f.arrangeAccounts({ grouping: v });
        break;
      case 'hiddenAccounts': f.setAccountsHidden(value as string[]); break;
    }
  };

  const readOne = async (account: SerializedAccount, via: Via): Promise<RefreshStep> => {
    for (let attempt = 0; attempt < 4; attempt++) {
      // Behind whatever holds the line (a read, an approval), as the provider's own queue waits.
      const waitStart = Date.now();
      while (now.current.busy && Date.now() - waitStart < LINE_WAIT_MS) await sleep(250);
      const settled = await new Promise<{ outcome: string; error?: string }>((resolve) => {
        const timer = setTimeout(() => resolve({ outcome: 'failed' }), READ_MAX_MS);
        const onSettled = (outcome: string, error?: string) => {
          clearTimeout(timer);
          resolve({ outcome, error });
        };
        const p = now.current;
        if (via === 'statement') void p.loadTransactions(account, undefined, undefined, { force: true, quiet: true, onSettled });
        else if (via === 'portfolio') void p.loadPortfolio(account, { quiet: true, onSettled });
        else void p.loadBalance(account, { quiet: true, onSettled });
      });
      if (settled.outcome === 'busy') continue;
      const outcome = settled.outcome === 'applied' || settled.outcome === 'failed' || settled.outcome === 'cancelled' ? settled.outcome : 'skipped';
      return { key: account.accountNumber, outcome, ...(settled.error ? { error: settled.error } : {}) };
    }
    return { key: account.accountNumber, outcome: 'skipped' };
  };

  const refresh = async (key: string | null): Promise<RefreshReport> => {
    refreshing.count++;
    try {
      const p = now.current;
      const plan = refreshPlan(p.accounts, key, (a) => p.bankOf(a)?.state !== 'loggedOut');
      const steps: RefreshStep[] = [];
      for (const s of plan) {
        if (now.current.vaultStatus !== 'ready') break;
        const step = await readOne(s.account, s.via);
        steps.push(step);
        // The user called off a Freigabe: no further one is asked for, as "Alle Salden abrufen" stops.
        if (step.outcome === 'cancelled') break;
      }
      // The page draws what came before the router reads it.
      await sleep(80);
      return { steps };
    } finally {
      refreshing.count--;
    }
  };

  return { actions, settings: { values, offers: { ownGroups: !IS_ANDROID }, write }, refresh };
}
