// Girovo API: the settings an app may read and change (docs/girovo-api.md,
// settings.get and settings.set). An explicit allowlist, built from what
// Einstellungen offers, each key with its own check: nothing that is not on
// it can be read or set, whatever an app asks for.
//
// Never through the API (NEVER_KEYS answer `not_permitted` with reason
// "never"): the PIN, Windows Hello, security keys, "Weitere Banken mit
// anmelden", forgetting the device, deleting or resetting saved data,
// restoring a backup, the Girovo API's own switch and grants, the update
// channel and update installs; and, beyond the spec's list, the consent to
// usage data (the user's own word), "Neue Umsätze melden" (it keeps PINs and
// asks the system for permission) and the sync between devices (it pairs
// devices and may hold a password).
//
// Switches that delete what is kept when turned off ("Letzte Salden
// behalten", "Umsätze behalten") may only be turned on: off would delete
// data, and Einstellungen asks before that, so the API refuses it
// (`not_permitted`, reason "deletes_data"). Company logos may only be turned
// off: on sends shop names to Girovo's logo service, which is the user's own
// consent to give (reason "consent").
//
// Pure and node-test-safe: the host (components/api/ApiHost.tsx) reads the
// values and writes them through the same setters Einstellungen uses.

import type { MethodOutcome, ApiData } from './methods.ts';
import { accountId } from './methods.ts';

export const SETTING_KEYS = [
  'language',
  'theme',
  'blackBackground',
  'idleMinutes',
  'balancesAtLogin',
  'bookingsAtLogin',
  'keepBalances',
  'keepBookings',
  'companyLogos',
  'ai',
  'aiTone',
  'aiLength',
  'aiUseName',
  'aiNames',
  'singleKeyShortcuts',
  'accountOrder',
  'accountGrouping',
  'hiddenAccounts',
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];

export const isSettingKey = (v: unknown): v is SettingKey => typeof v === 'string' && (SETTING_KEYS as readonly string[]).includes(v);

/**
 * Asked for by name, refused every time: the spec's list, then what Girovo
 * adds to it. Spelled as an app would likely try them.
 */
export const NEVER_KEYS = [
  'pin',
  'windowsHello',
  'securityKeys',
  'linkedUnlock',
  'forgetDevice',
  'deviceRemembered',
  'deleteData',
  'resetData',
  'wipeData',
  'resetHistory',
  'restoreBackup',
  'backup',
  'api',
  'apiOn',
  'apiGrants',
  'updateChannel',
  'earlyUpdates',
  'autoUpdates',
  'installUpdate',
  'usageData',
  'backgroundChecks',
  'sync',
] as const;

export const IDLE_CHOICES = [5, 10, 15, 30] as const;

/** Every value as the host has it (accounts by their session key); a key the app does not offer here is absent. */
export type SettingsValues = {
  language: 'de' | 'en';
  theme: 'light' | 'dark' | 'system';
  blackBackground: boolean;
  idleMinutes: (typeof IDLE_CHOICES)[number];
  balancesAtLogin: boolean;
  bookingsAtLogin: boolean;
  keepBalances: boolean;
  keepBookings: boolean;
  companyLogos: boolean;
  ai: boolean;
  aiTone: 'friendly' | 'plain';
  aiLength: 'short' | 'long';
  aiUseName: boolean;
  aiNames: boolean;
  singleKeyShortcuts: boolean;
  accountOrder: string[];
  /** As Konten anordnen offers it: on the desktop none or own (the user's own groups, lib/account-groups.ts), on the phone type, bank or none. */
  accountGrouping: 'type' | 'bank' | 'none' | 'own';
  hiddenAccounts: string[];
};

export type SettingsHost = {
  /** The current values; a key missing here is not offered in this app right now (and can't be set). */
  values: () => Partial<SettingsValues>;
  /** Values of a key this app offers beside the usual ones: the desktop's own account groups. */
  offers?: { ownGroups?: boolean };
  /** Writes one, as Einstellungen' own control would. */
  write: <K extends SettingKey>(key: K, value: SettingsValues[K]) => void;
};

type Parsed<T> = { value: T } | { invalid: string };

type Def<K extends SettingKey> = {
  /** The app's value to the host's (account ids to keys); `invalid` with a reason when it does not fit. */
  parse: (v: unknown, data: ApiData) => Parsed<SettingsValues[K]>;
  /** The host's value as the app sees it. */
  show?: (v: SettingsValues[K], data: ApiData) => unknown;
  /** A change the API may not make, and why (answered `not_permitted`). */
  refuse?: (next: SettingsValues[K], current: SettingsValues[K]) => string | null;
};

const oneOf = <T extends string | number>(list: readonly T[]) => (v: unknown): Parsed<T> =>
  (list as readonly unknown[]).includes(v) ? { value: v as T } : { invalid: 'value' };
const bool = (v: unknown): Parsed<boolean> => (typeof v === 'boolean' ? { value: v } : { invalid: 'value' });

/** Account ids the app knows (accounts.list) to the session's keys; each once, every one on screen. */
function accountKeys(v: unknown, data: ApiData): Parsed<string[]> {
  if (!Array.isArray(v) || v.length > 200) return { invalid: 'value' };
  const keys: string[] = [];
  for (const id of v) {
    const a = data.accounts.find((x) => accountId(x.key) === id);
    if (!a || keys.includes(a.key)) return { invalid: 'value' };
    keys.push(a.key);
  }
  return { value: keys };
}

const showAccounts = (keys: string[], data: ApiData) =>
  keys.filter((k) => data.accounts.some((a) => a.key === k)).map(accountId);

const DEFS: { [K in SettingKey]: Def<K> } = {
  language: { parse: oneOf(['de', 'en'] as const) },
  theme: { parse: oneOf(['light', 'dark', 'system'] as const) },
  blackBackground: { parse: bool },
  idleMinutes: { parse: oneOf(IDLE_CHOICES) },
  balancesAtLogin: { parse: bool },
  bookingsAtLogin: { parse: bool },
  keepBalances: { parse: bool, refuse: (next, cur) => (cur && !next ? 'deletes_data' : null) },
  keepBookings: { parse: bool, refuse: (next, cur) => (cur && !next ? 'deletes_data' : null) },
  companyLogos: { parse: bool, refuse: (next, cur) => (!cur && next ? 'consent' : null) },
  ai: { parse: bool },
  aiTone: { parse: oneOf(['friendly', 'plain'] as const) },
  aiLength: { parse: oneOf(['short', 'long'] as const) },
  aiUseName: { parse: bool },
  aiNames: { parse: bool },
  singleKeyShortcuts: { parse: bool },
  accountOrder: {
    parse: (v, data) => {
      const out = accountKeys(v, data);
      // The whole order: every account on screen once, as "Konten anordnen" sets it.
      if ('value' in out && out.value.length !== data.accounts.length) return { invalid: 'value' };
      return out;
    },
    show: showAccounts,
  },
  accountGrouping: { parse: oneOf(['type', 'bank', 'none', 'own'] as const) },
  hiddenAccounts: {
    parse: (v, data) => {
      const out = accountKeys(v, data);
      // At least one account stays shown, as the sidebar keeps one ticked.
      if ('value' in out && data.accounts.length > 0 && out.value.length >= data.accounts.length) return { invalid: 'value' };
      return out;
    },
    show: showAccounts,
  },
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function shown<K extends SettingKey>(key: K, value: SettingsValues[K], data: ApiData): unknown {
  const def = DEFS[key] as Def<K>;
  return def.show ? def.show(value, data) : value;
}

/** `settings.get` → every setting on the list that this app offers now, and which of them may be changed. */
export function settingsGet(data: ApiData, host: SettingsHost): MethodOutcome {
  const values = host.values();
  const settings: Record<string, unknown> = {};
  for (const key of SETTING_KEYS) {
    const v = values[key];
    if (v !== undefined) settings[key] = shown(key, v as never, data);
  }
  return {
    result: {
      settings,
      // On only, off only: the rest may be set either way.
      onlyOn: ['keepBalances', 'keepBookings'].filter((k) => k in settings),
      onlyOff: ['companyLogos'].filter((k) => k in settings),
    },
  };
}

/** `settings.set { key, value }` → the setting changed (or already so), or why not. */
export function settingsSet(data: ApiData, host: SettingsHost, params: unknown): MethodOutcome {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return { invalid: 'params' };
  const { key, value } = params as { key?: unknown; value?: unknown };
  if (typeof key !== 'string') return { invalid: 'key' };
  if ((NEVER_KEYS as readonly string[]).includes(key)) return { fail: 'not_permitted', data: { key, reason: 'never' } };
  if (!isSettingKey(key)) return { invalid: 'key' };
  const values = host.values();
  const current = values[key];
  if (current === undefined) return { invalid: 'key', data: { reason: 'unavailable' } };
  const def = DEFS[key] as Def<typeof key>;
  const parsed = def.parse(value, data);
  if ('invalid' in parsed) return { invalid: 'value', data: { key } };
  // The choices Konten anordnen has: on the desktop "Keine" and "Eigene"
  // (none, own), on the phone by kind, by bank or none.
  if (key === 'accountGrouping') {
    const desk = !!host.offers?.ownGroups;
    if (desk ? parsed.value === 'type' || parsed.value === 'bank' : parsed.value === 'own') {
      return { invalid: 'value', data: { key, reason: 'unavailable' } };
    }
  }
  const reason = def.refuse?.(parsed.value as never, current as never);
  if (reason) return { fail: 'not_permitted', data: { key, reason } };
  const changed = !same(parsed.value, current);
  if (changed) host.write(key, parsed.value as never);
  return { result: { key, value: shown(key, parsed.value as never, data), changed } };
}
