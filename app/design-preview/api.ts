// A stand-in for the Girovo API's shell side (window.electronGirovoApi) in
// the design preview: the consent dialog and Einstellungen → Girovo API
// without the Tauri shell, a pipe or another program. ?api=<scenario> on any
// view; the vault has "Girovo API zulassen" on.
//
//   consent          a verified app says hello (Haushaltsbuch, Beispiel GmbH),
//                    an unknown one waits behind it (tool.exe from Downloads)
//   consent-unknown  the unknown one first
//   consent-mcp      Claude (Anthropic PBC) through Girovo MCP
//   apps             no request: three allowed apps and a Verlauf
//   transfer         phase 2: Haushaltsbuch (allowed already) asks for a transfer;
//                    Girovo's own sheet opens filled in, "Angefragt von …" on it
//   writes           phase 2: Haushaltsbuch changes a category, a note, a budget and
//                    settings, is refused the PIN and "Letzte Salden behalten" off,
//                    then reads new data from the bank (bank.refresh);
//                    open Einstellungen → Girovo API (?page=api) to see the Verlauf
// Every scenario's settings page shows "Mit KI-Assistenten verbinden" with
// Girovo MCP's path and Claude Desktop's configuration (phase 3).
//
// The dialog's answers go through the real router (lib/api/router.ts); the
// fake sends an app's calls one after the other, each once the last was
// answered, and logs every reply and notification to the console.

import type { ApiCall, ApiClient, ApiGrant, ApiLogEntry } from '@/lib/api/types';
import { clientKey } from '@/lib/api/grants';
import type { VaultData } from '@/lib/app-types';
import type { GirovoApiBridge } from '@/types/electron-window';

export const API_SCENARIOS = ['consent', 'consent-unknown', 'consent-mcp', 'apps', 'transfer', 'writes'] as const;
export type ApiScenario = (typeof API_SCENARIOS)[number];
export const isApiScenario = (s: string): s is ApiScenario => (API_SCENARIOS as readonly string[]).includes(s);

const SHA = 'c0ffee'.repeat(10) + 'c0ff';
const WRITE_PERMISSIONS = ['accounts.read', 'transactions.read', 'categories.write', 'notes.write', 'budgets.write', 'settings.read', 'settings.write', 'bank.refresh'] as const;

// i18n-data-start: the fake programs' names, as their files would carry them.
export const FAKE_VERIFIED: ApiClient = {
  pid: 4120, exe: 'C:\\Program Files\\Haushaltsbuch\\Haushaltsbuch.exe', sha256: SHA, name: 'Haushaltsbuch',
  publisher: { kind: 'verified', name: 'Beispiel GmbH', thumbprint: '3F2A' },
};
export const FAKE_UNKNOWN: ApiClient = {
  pid: 5310, exe: 'C:\\Users\\Nino\\Downloads\\konto-export\\konto-export.exe', sha256: SHA.replace(/c/g, 'd'), name: 'konto-export.exe',
  publisher: { kind: 'unknown' },
};
export const FAKE_MCP: ApiClient = {
  pid: 6001, exe: 'C:\\Program Files\\Girovo\\girovo-mcp.exe', sha256: SHA.replace(/f/g, 'a'), name: 'Girovo MCP',
  publisher: { kind: 'mtmedia', name: 'MT-Media', thumbprint: 'AB12' },
  parent: {
    pid: 5999, exe: 'C:\\Users\\Nino\\AppData\\Local\\AnthropicClaude\\claude.exe', sha256: SHA.replace(/0/g, '1'), name: 'Claude',
    publisher: { kind: 'verified', name: 'Anthropic PBC' },
  },
};

const HELLOS: Record<string, { app: string; version: string; permissions: string[]; reason?: string }> = {
  verified: { app: 'Haushaltsbuch', version: '3.2', permissions: ['accounts.read', 'transactions.read', 'insights.read'], reason: 'Damit dein Haushaltsbuch deine Umsätze selbst einträgt und dein Monatsbudget zeigt.' },
  unknown: { app: 'Konto Export Pro', version: '0.9', permissions: ['transactions.read'], reason: 'Exportiert deine Umsätze als CSV.' },
  mcp: { app: 'Claude', version: '1.0', permissions: ['accounts.read', 'transactions.read', 'insights.read', 'ask'], reason: 'Damit Claude Fragen zu deinen Finanzen beantworten kann.' },
};

/** Phase 2's fake calls: a step's params may be made from the answer before it. */
type Step = { method: string; params?: unknown | ((last: unknown) => unknown) };
const PHASE2: Record<'transfer' | 'writes', Step[]> = {
  transfer: [
    { method: 'girovo.hello', params: { app: 'Haushaltsbuch', version: '3.2', permissions: ['accounts.read', 'transfers.request'] } },
    { method: 'girovo.events.subscribe', params: { kinds: ['transfer.updated'] } },
    {
      method: 'girovo.transfers.request',
      params: { iban: 'DE89 3704 0044 0532 0130 00', name: 'Stadtwerke Musterstadt', cents: 8450, purpose: 'Abschlag Dezember Kundennr. 40213' },
    },
  ],
  writes: [
    { method: 'girovo.hello', params: { app: 'Haushaltsbuch', version: '3.2', permissions: WRITE_PERMISSIONS } },
    { method: 'girovo.transactions.list', params: { limit: 1 } },
    {
      method: 'girovo.categories.set',
      params: (last: unknown) => ({ booking: (last as { result?: { transactions?: { id: string }[] } })?.result?.transactions?.[0]?.id, category: 'leisure' }),
    },
    { method: 'girovo.budgets.set', params: { category: 'groceries', cents: 35000 } },
    { method: 'girovo.settings.set', params: { key: 'aiTone', value: 'plain' } },
    { method: 'girovo.settings.set', params: { key: 'keepBalances', value: false } },
    { method: 'girovo.settings.set', params: { key: 'pin', value: '1234' } },
    { method: 'girovo.settings.get' },
    { method: 'girovo.bank.refresh' },
  ],
};
// i18n-data-end

/** A plain coloured tile with a letter: the fake executable's icon. */
function tile(letter: string, color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="11" fill="${color}"/><text x="24" y="32" font-family="Segoe UI,Arial" font-size="24" font-weight="600" fill="#fff" text-anchor="middle">${letter}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const ICONS: Record<string, string> = {
  [FAKE_VERIFIED.exe]: tile('H', '#2f7d4f'),
  [FAKE_MCP.parent!.exe]: tile('C', '#c96442'),
};

/** What the vault holds in the scenario: for `apps` the grants and a Verlauf. The switch is the fake shell's (status's `on`). */
export function apiVault(scenario: ApiScenario, now = Date.now()): Partial<VaultData> {
  const ago = (min: number) => new Date(now - min * 60_000).toISOString();
  if (scenario === 'transfer' || scenario === 'writes') {
    return {
      apiGrants: [{
        exe: FAKE_VERIFIED.exe, publisher: { kind: 'verified', name: 'Beispiel GmbH' }, name: 'Haushaltsbuch',
        permissions: scenario === 'transfer' ? ['accounts.read', 'transfers.request'] : [...WRITE_PERMISSIONS], at: ago(60 * 24 * 9), used: ago(60),
      }],
    };
  }
  if (scenario !== 'apps') return {};
  const grants: ApiGrant[] = [
    {
      exe: FAKE_VERIFIED.exe, publisher: { kind: 'verified', name: 'Beispiel GmbH' }, name: 'Haushaltsbuch',
      permissions: ['accounts.read', 'transactions.read', 'insights.read'], at: ago(60 * 24 * 9), used: ago(4),
    },
    {
      exe: FAKE_MCP.parent!.exe, publisher: { kind: 'verified', name: 'Anthropic PBC' }, name: 'Claude', viaMcp: true,
      permissions: ['accounts.read', 'insights.read'], at: ago(60 * 24 * 2), used: ago(60 * 3),
    },
    { exe: FAKE_UNKNOWN.exe, sha256: FAKE_UNKNOWN.sha256, name: 'konto-export.exe', permissions: ['transactions.read'], at: ago(60 * 26) },
  ];
  const line = (client: ApiClient, name: string, method: string, min: number, code?: ApiLogEntry['code']): ApiLogEntry => ({
    at: ago(min), app: clientKey(client), name, method, ok: !code, ...(code ? { code } : {}),
  });
  const log: ApiLogEntry[] = [
    line(FAKE_UNKNOWN, 'konto-export.exe', 'hello', 60 * 26),
    line(FAKE_MCP, 'Claude', 'hello', 60 * 3 + 2),
    line(FAKE_MCP, 'Claude', 'accounts.list', 60 * 3 + 1),
    line(FAKE_MCP, 'Claude', 'transactions.list', 60 * 3, 'not_permitted'),
    line(FAKE_VERIFIED, 'Haushaltsbuch', 'hello', 6),
    line(FAKE_VERIFIED, 'Haushaltsbuch', 'accounts.list', 5),
    line(FAKE_VERIFIED, 'Haushaltsbuch', 'transactions.list', 4),
    line(FAKE_VERIFIED, 'Haushaltsbuch', 'insights.month', 4),
  ];
  return { apiGrants: grants, apiLog: log };
}

export function installFakeApi(scenario: ApiScenario | null) {
  if (typeof window === 'undefined') return;
  if (!scenario) {
    delete window.electronGirovoApi;
    return;
  }
  const calls = new Set<(c: ApiCall) => void>();
  let sent = false;
  let id = 0;
  // Phase 2: one call after the other, each once the last was answered.
  const steps = scenario === 'transfer' || scenario === 'writes' ? [...PHASE2[scenario]] : [];
  const sendNext = (last: unknown) => {
    const step = steps.shift();
    if (!step) return;
    const params = typeof step.params === 'function' ? (step.params as (l: unknown) => unknown)(last) : step.params;
    const call: ApiCall = { id: ++id, connection: 'p9', client: FAKE_VERIFIED, method: step.method, params };
    setTimeout(() => calls.forEach((listener) => listener(call)), 250);
  };
  const hello = (client: ApiClient, which: keyof typeof HELLOS, connection: string): ApiCall => ({
    id: ++id, connection, client, method: 'girovo.hello', params: HELLOS[which],
  });
  const queue: ApiCall[] = scenario === 'consent'
    ? [hello(FAKE_VERIFIED, 'verified', 'p1'), hello(FAKE_UNKNOWN, 'unknown', 'p2')]
    : scenario === 'consent-unknown'
      ? [hello(FAKE_UNKNOWN, 'unknown', 'p2'), hello(FAKE_VERIFIED, 'verified', 'p1')]
      : scenario === 'consent-mcp' ? [hello(FAKE_MCP, 'mcp', 'p3')] : [];
  const bridge: GirovoApiBridge = {
    setEnabled: async (on) => ({ running: on, address: on ? '\\\\.\\pipe\\girovo-api-preview' : null }),
    status: async () => ({ on: true, running: true, address: '\\\\.\\pipe\\girovo-api-preview', connections: queue.length }),
    icon: async (exe) => ICONS[exe] ?? null,
    onCall: (fn) => {
      calls.add(fn);
      // The requests arrive once the page listens, as an app's would after the pipe opened.
      if (!sent && queue.length) {
        sent = true;
        setTimeout(() => queue.forEach((c) => calls.forEach((listener) => listener(c))), 300);
      }
      if (!sent && steps.length) {
        sent = true;
        // Once the page has loaded the accounts the calls read.
        setTimeout(() => sendNext(null), 1500);
      }
      return () => calls.delete(fn);
    },
    onClosed: () => () => {},
    reply: async (callId, payload) => {
      console.info('[design-preview] Girovo API reply', callId, JSON.stringify(payload));
      sendNext(payload);
      return true;
    },
    notify: async (connection, method, params) => {
      console.info('[design-preview] Girovo API notification', connection, method, JSON.stringify(params));
      return true;
    },
    focus: async () => true,
    // Phase 3: Einstellungen → Girovo API shows where Girovo MCP lies.
    mcpPath: async () => FAKE_MCP.exe,
  };
  window.electronGirovoApi = bridge;
}
