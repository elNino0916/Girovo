'use client';

// Design preview — the whole app on mock data, one URL per surface, so every
// screen can be looked at (and screenshotted) without a bank session.
// Development only: production builds answer 404.
//
//   /design-preview?view=overview            any of VIEWS below; ?view=index lists them
//                  &theme=light|dark          applied, not stored
//                  &privacy=1                 Beträge ausblenden
//                  &preset=default|empty|past-range|unverified|loading|error   (&empty=1 = preset empty)
//                  &range=90d|365d|all        statement range loaded at start
//                  &tan=confirm|hold|ended|error   how simulated approvals end
//                  &acct=giro|tagesgeld|karte  start on another account
//                  &still=0|1                 settle animations (default: on under Electron)
//                  &q=rewe                    Umsätze search
//                  &toasts=1                  one toast of each tone
//                  &update=available|ready|…  a fake desktop updater (./updater.ts)
//                  &updateDialog=1            …with its dialog open
//                  &y=800                     scroll the page there once loaded
//
// The real components render inside the same print:hidden structure as
// app/page.tsx, on <MockFintsProvider> (./mock.tsx). Whatever the provider
// owns (tab, open launchers, privacy, the transfer prefill) is part of the
// mock's first frame. States that live inside a component — the transfer's
// review step, an open detail drawer — are reached the way a person reaches
// them: a small script clicks the buttons, nothing is filled in behind the
// component's back. `window.__previewReady` says when that has settled (see
// Readiness below) so a screenshot never catches a state half-way.

import { notFound } from 'next/navigation';
import { use, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useFints, type FintsApi } from '@/components/FintsProvider';
import { Segmented } from '@/components/ui';
import { Dashboard } from '@/components/Dashboard';
import { Login } from '@/components/Login';
import { Statement } from '@/components/Statement';
import { TanMethodPicker } from '@/components/TanMethodPicker';
import { TanWaitOverlay } from '@/components/TanWaitOverlay';
import { Toasts } from '@/components/Toasts';
import { UpdateLayer } from '@/components/updates/UpdateNotices';
import { presetRange } from '@/lib/format';
import { applyTheme } from '@/lib/theme';
import { ACCT, MOCK_PAYEES } from './data';
import { MockFintsProvider, type MockOptions, type MockPreset } from './mock';
import { installFakeUpdater, isUpdateScenario, type UpdateScenario } from './updater';

// ---------------------------------------------------------------------------
// Scripts: how each view gets from "logged in" to the state it shows

type Ctx = {
  /** The live provider value — always the latest render's. */
  api: () => FintsApi;
  sleep: (ms: number) => Promise<void>;
  /** Clicks the first (or last) visible, enabled button whose label matches. */
  click: (label: RegExp, opts?: { within?: 'dialog' | 'page'; last?: boolean; timeout?: number }) => Promise<boolean>;
  /** Waits until `get` returns something (or the timeout passes: null). */
  poll: <T>(get: () => T | null | undefined | false, timeout?: number) => Promise<T | null>;
  /** Waits until the predicate on the live mock holds. */
  until: (pred: (api: FintsApi) => boolean, timeout?: number) => Promise<boolean>;
};

type Script = (c: Ctx) => Promise<void> | void;

type ViewDef = {
  label: string;
  group: 'Dashboard' | 'Anmeldung' | 'Überweisung' | 'Dialoge' | 'Updates';
  preset?: MockPreset;
  options?: MockOptions;
  /** The desktop updater this view shows (a fake, ./updater.ts), and whether its dialog is open. */
  update?: { scenario: UpdateScenario; dialog?: boolean };
  script?: Script;
};

/**
 * The default draft: an amount nobody was paid in the mock data, so the review
 * step shows no duplicate warning ('transfer-duplicate' has that one).
 */
const TRANSFER_DRAFT = { amount: '120,00', purpose: 'Zuschuss Klassenfahrt' };

/** The transfer sheet, open from the first frame with a payee filled in. */
const transferWith = (
  payee: { name: string; iban: string },
  extra: MockOptions = {},
  draft: { amount: string; purpose: string } = TRANSFER_DRAFT,
): MockOptions => ({
  open: 'transfer', transferPrefill: { name: payee.name, iban: payee.iban, ...draft }, ...extra,
});

/** From the filled form on to the review step, as a person would: "Weiter". */
async function toReview(c: Ctx) {
  await c.click(/^(weiter|prüfen|weiter zur prüfung|überweisung prüfen|zur prüfung)/i, { within: 'dialog' });
  // The review step's own primary button marks its arrival.
  await c.poll(() => findButton(SUBMIT, 'dialog', true), 4000);
}

/** Types into a field the way a person would, so React sees the change. */
function typeInto(el: HTMLInputElement, text: string) {
  el.focus();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, text);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

/** "Bank wählen" with `q` typed into the search, once its answer is there (the real search route). */
const searchFor = (q: string): Script => async (c) => {
  const input = await c.poll(() => document.querySelector<HTMLInputElement>('input[role="combobox"]'), 6000);
  if (!input) return;
  typeInto(input, q);
  await c.poll(() => {
    const said = document.querySelector('main p[role="status"]')?.textContent?.trim();
    return said && said !== 'Suche …' ? said : null;
  }, 6000);
};

/**
 * "Anmelden" with this login name (the mock answers by name: fehler,
 * gesperrt, wartung, langsam), then until the answer is on screen.
 */
const loginAs = (name: string, waitMs?: number): Script => async (c) => {
  const login = await c.poll(() => document.querySelector<HTMLInputElement>('input[autocomplete="username"]'), 6000);
  const pin = document.querySelector<HTMLInputElement>('input[autocomplete="current-password"]');
  if (!login || !pin) return;
  typeInto(login, name);
  typeInto(pin, '12345');
  await c.click(/^Anmelden$/);
  if (waitMs) await c.sleep(waitMs);
  else await c.poll(() => document.querySelector('main [role="alert"]'), 8000);
};

/** On the review step: the primary action that sends the order. */
const SUBMIT = /(freigeben|senden|ausführen|jetzt überweisen|^überweisen$|überweisung absenden)/i;

/**
 * Review, then send — the order goes to the (simulated) bank. Returns once the
 * mock has answered: an approval is waiting, or the order is settled.
 */
async function sendOrder(c: Ctx) {
  await toReview(c);
  await c.sleep(200);
  await c.click(SUBMIT, { within: 'dialog', last: true });
  await c.until((f) => f.busy || f.wait.open, 3000);
  await c.until((f) => f.wait.open || !f.busy, 6000);
}

/** sendOrder, then on until the approval (if any) has run its course. */
async function completeOrder(c: Ctx) {
  await sendOrder(c);
  await c.until((f) => !f.busy && !f.wait.open, 8000);
  await c.sleep(300);
}

const VIEWS: Record<string, ViewDef> = {
  overview: { label: 'Übersicht', group: 'Dashboard' },
  analysis: { label: 'Analyse', group: 'Dashboard', options: { tab: 'analysis' } },
  contracts: { label: 'Verträge & Abos', group: 'Dashboard', options: { tab: 'contracts' } },
  empty: { label: 'Ohne Umsätze', group: 'Dashboard', preset: 'empty' },
  detail: {
    label: 'Umsatzdetails',
    group: 'Dashboard',
    async script(c) {
      // A row of the Umsätze list: `data-tx-row` when the list marks its rows,
      // else the first row button under the "Umsätze" heading.
      const row = await c.poll(() => document.querySelector<HTMLElement>('[data-tx-row]')
        ?? findUnderHeading(/^umsätze$/i, 'li > button, li [role="button"]'), 6000);
      if (!row) {
        console.warn('[design-preview] no transaction row found');
        return;
      }
      row.click();
      await c.poll(() => [...document.querySelectorAll('[role="dialog"]')].some(visible), 4000);
    },
  },
  inbox: { label: 'Mitteilungen', group: 'Dialoge', options: { open: 'inbox' } },
  palette: { label: 'Befehle (Strg K)', group: 'Dialoge', options: { open: 'palette' } },
  shortcuts: { label: 'Tastenkürzel', group: 'Dialoge', options: { open: 'shortcuts' } },
  'session-warning': { label: 'Abmeldung in 45 s', group: 'Dialoge', options: { idleInMs: 45_000 } },
  share: { label: 'Geld anfordern', group: 'Dialoge', options: { open: 'share' } },
  tanwait: {
    label: 'Freigabe (Umsatzabruf)',
    group: 'Dialoge',
    options: { tan: 'hold' },
    // A year of history needs an approval at most banks — so does the mock.
    async script(c) {
      c.api().applyRange(presetRange('365d'));
      await c.until((f) => f.wait.open, 3000);
    },
  },

  update: { label: 'Update verfügbar', group: 'Updates', update: { scenario: 'available', dialog: true } },
  'update-downloading': { label: 'Download läuft', group: 'Updates', update: { scenario: 'downloading', dialog: true } },
  'update-ready': { label: 'Bereit zur Installation', group: 'Updates', update: { scenario: 'ready', dialog: true } },
  'update-current': { label: 'Auf dem neuesten Stand', group: 'Updates', update: { scenario: 'current', dialog: true } },
  'update-installed': { label: 'Nach dem Update', group: 'Updates', update: { scenario: 'installed' } },
  'update-error': { label: 'Download fehlgeschlagen', group: 'Updates', update: { scenario: 'error', dialog: true } },
  'update-manual': { label: 'Nur Download-Seite', group: 'Updates', update: { scenario: 'manual', dialog: true } },
  'update-portable': { label: 'Portable Version', group: 'Updates', update: { scenario: 'portable', dialog: true } },
  'update-inbox': { label: 'In Mitteilungen', group: 'Updates', options: { open: 'inbox' }, update: { scenario: 'available' } },
  'update-login': { label: 'Bei der Anmeldung', group: 'Updates', options: { view: 'login' }, update: { scenario: 'ready' } },
  'update-session': {
    label: 'Im Sitzungsmenü',
    group: 'Updates',
    update: { scenario: 'available' },
    async script(c) {
      await c.click(/^Sitzung/, { within: 'page' });
      await c.poll(() => document.querySelector('[role="dialog"], [data-popover]'), 2000);
    },
  },

  login: { label: 'Bank wählen', group: 'Anmeldung', options: { view: 'login' } },
  credentials: {
    label: 'Zugangsdaten',
    group: 'Anmeldung',
    options: { view: 'login', bankChosen: true },
  },
  tanmethod: { label: 'Sicherheitsverfahren', group: 'Anmeldung', options: { view: 'tanmethod' } },
  tanmedia: {
    label: 'Gerät wählen',
    group: 'Anmeldung',
    options: { view: 'tanmethod' },
    async script(c) {
      void c.api().chooseTanMethod(c.api().tanMethods[0]);
      await c.until((f) => !!f.mediaChoice, 3000);
    },
  },
  'tanwait-login': {
    label: 'Freigabe (Anmeldung)',
    group: 'Anmeldung',
    options: { view: 'tanmethod', tan: 'hold' },
    async script(c) {
      const m = c.api().tanMethods[0];
      void c.api().chooseTanMethod(m, m.activeTanMedia[0]);
      await c.until((f) => f.wait.open, 3000);
    },
  },
  'login-help': {
    label: 'Was brauche ich?',
    group: 'Anmeldung',
    options: { view: 'login' },
    async script(c) {
      const summary = await c.poll(() => document.querySelector<HTMLElement>('main details > summary'), 6000);
      summary?.click();
    },
  },
  'login-iban': { label: 'Suche per IBAN', group: 'Anmeldung', options: { view: 'login' }, script: searchFor('DE89 3704 0044 0532 0130 00') },
  'login-blz-miss': { label: 'BLZ ohne Treffer', group: 'Anmeldung', options: { view: 'login' }, script: searchFor('123 456 78') },
  'login-no-fints': { label: 'Bank ohne FinTS', group: 'Anmeldung', options: { view: 'login' }, script: searchFor('N26') },
  'login-shared-name': { label: 'Gleichnamige Banken', group: 'Anmeldung', options: { view: 'login' }, script: searchFor('comdirect') },
  'login-stale': { label: 'Bank nicht mehr gelistet', group: 'Anmeldung', options: { view: 'login', staleBank: true } },
  'credentials-error': {
    label: 'Zugangsdaten falsch', group: 'Anmeldung', options: { view: 'login', bankChosen: true }, script: loginAs('fehler'),
  },
  'credentials-locked': {
    label: 'Zugang gesperrt', group: 'Anmeldung', options: { view: 'login', bankChosen: true }, script: loginAs('gesperrt'),
  },
  'credentials-outage': {
    label: 'Bank antwortet nicht', group: 'Anmeldung', options: { view: 'login', bankChosen: true }, script: loginAs('wartung'),
  },
  'credentials-slow': {
    label: 'Anmeldung dauert (Abbrechen)',
    group: 'Anmeldung',
    options: { view: 'login', bankChosen: true },
    // "Abbrechen" shows after 8 s without an answer.
    script: loginAs('langsam', 8600),
  },
  'tanmethod-typed': { label: 'Nur TAN-Eingabe', group: 'Anmeldung', options: { view: 'tanmethod', methods: 'typed' } },

  transfer: { label: 'Erfassen', group: 'Überweisung', options: { open: 'transfer' } },
  'transfer-filled': { label: 'Erfassen (ausgefüllt)', group: 'Überweisung', options: transferWith(MOCK_PAYEES.lea) },
  'transfer-review': { label: 'Prüfen', group: 'Überweisung', options: transferWith(MOCK_PAYEES.lea), script: toReview },
  'transfer-duplicate': {
    label: 'Prüfen (schon überwiesen)',
    group: 'Überweisung',
    // 50,00 € to Lea went out earlier in this session (the mock's activity log).
    options: transferWith(MOCK_PAYEES.lea, {}, { amount: '50,00', purpose: 'Taschengeld Oktober' }),
    script: toReview,
  },
  'transfer-vop': {
    label: 'Namensabgleich', group: 'Überweisung', options: transferWith(MOCK_PAYEES.closeMatch), script: sendOrder,
  },
  'tanwait-transfer': {
    label: 'Freigabe', group: 'Überweisung', options: transferWith(MOCK_PAYEES.lea, { tan: 'hold' }), script: sendOrder,
  },
  'transfer-done': {
    label: 'Fertig', group: 'Überweisung', options: transferWith(MOCK_PAYEES.lea, { tanMs: 900 }), script: completeOrder,
  },
  'transfer-unknown': {
    label: 'Status unklar',
    group: 'Überweisung',
    // "Unklar" in the payee name: the bank ends the dialog before the approval lands.
    options: transferWith({ name: 'Unklar GmbH', iban: MOCK_PAYEES.max.iban }, { tanMs: 900 }),
    script: completeOrder,
  },
  'transfer-error': {
    label: 'Abgelehnt',
    group: 'Überweisung',
    // "Fehler" in the payee name: the bank refuses the order.
    options: transferWith({ name: 'Fehler GmbH', iban: MOCK_PAYEES.max.iban }),
    script: sendOrder,
  },
};

/** A clickable element in the section a heading introduces. */
function findUnderHeading(heading: RegExp, selector: string): HTMLElement | null {
  const h = [...document.querySelectorAll<HTMLElement>('h1, h2, h3')].find((el) => heading.test(el.textContent?.trim() ?? ''));
  const section = h?.closest('section, [role="region"], article') ?? h?.parentElement?.parentElement ?? null;
  return section?.querySelector<HTMLElement>(selector) ?? null;
}

const visible = (el: Element) => (el as HTMLElement).getClientRects().length > 0;

/** A visible, enabled button whose label matches — in the topmost dialog, or anywhere. */
function findButton(label: RegExp, within: 'dialog' | 'page', last: boolean): HTMLElement | null {
  const dialogs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].filter(visible);
  const scope: ParentNode = within === 'dialog' ? (dialogs[dialogs.length - 1] ?? document) : document;
  const hits = [...scope.querySelectorAll<HTMLElement>('button, [role="button"], a[href]')].filter((b) => {
    if (!visible(b) || (b as HTMLButtonElement).disabled || b.getAttribute('aria-disabled') === 'true') return false;
    const text = (b.getAttribute('aria-label') || b.textContent || '').replace(/\s+/g, ' ').trim();
    return label.test(text);
  });
  return (last ? hits[hits.length - 1] : hits[0]) ?? null;
}

function makeCtx(api: () => FintsApi): Ctx {
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const poll = async <T,>(get: () => T | null | undefined | false, timeout = 4000): Promise<T | null> => {
    const end = Date.now() + timeout;
    for (;;) {
      const v = get();
      if (v) return v;
      if (Date.now() > end) return null;
      await sleep(80);
    }
  };
  return {
    api,
    sleep,
    poll,
    until: async (pred, timeout = 4000) => (await poll(() => pred(api()), timeout)) === true,
    async click(label, { within = 'page', last = false, timeout = 6000 } = {}) {
      const el = await poll(() => findButton(label, within, last), timeout);
      if (!el) {
        console.warn(`[design-preview] no button matching ${label}`);
        return false;
      }
      el.click();
      return true;
    },
  };
}

// ---------------------------------------------------------------------------
// Readiness — so a screenshot can wait for a scripted state instead of
// guessing. `window.__previewReady` resolves (and <html data-preview-ready>
// is set) once the view's script has settled. With the helper:
//   -Js "(async()=>{for(let i=0;i<100&&!window.__previewReady;i++)await new Promise(r=>setTimeout(r,100));await window.__previewReady})()"

type PreviewWindow = Window & { __previewReady?: Promise<string> };

let markReady: (state: string) => void = () => {};
if (typeof window !== 'undefined') {
  (window as PreviewWindow).__previewReady = new Promise<string>((resolve) => {
    markReady = (state) => {
      document.documentElement.dataset.previewReady = state;
      resolve(state);
    };
  });
}

// ---------------------------------------------------------------------------

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

const PRESETS: readonly MockPreset[] = ['default', 'empty', 'past-range', 'unverified', 'loading', 'error'];
const RANGES = ['90d', '365d', 'all'] as const;
const TANS = ['confirm', 'hold', 'ended', 'error'] as const;
const ACCOUNTS: Record<string, string> = { giro: ACCT.giro, tagesgeld: ACCT.tagesgeld, karte: ACCT.karte };

const noopSubscribe = () => () => {};

/** The fake updater is set up once per view (the same key as the mock session below). */
let updaterKey: string | null = null;
function prepareUpdater(key: string, scenario: UpdateScenario | null, dialog: boolean) {
  if (updaterKey === key) return;
  updaterKey = key;
  installFakeUpdater(scenario, { dialog });
}

export default function DesignPreview({ searchParams }: { searchParams: Promise<Search> }) {
  if (process.env.NODE_ENV === 'production') notFound();
  const params = use(searchParams);
  // Client only: the mock data is built from "now", and the server's now is
  // not the browser's — rendering on both would only produce a hydration diff.
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  if (!mounted) return null;

  const viewId = one(params.view) || 'overview';
  if (viewId === 'index') return <Index />;
  const def = VIEWS[viewId] ?? VIEWS.overview;

  // Before anything below subscribes to the updater: they attach to the fake.
  const updateParam = one(params.update);
  prepareUpdater(
    JSON.stringify(params),
    isUpdateScenario(updateParam) ? updateParam : def.update?.scenario ?? null,
    def.update?.dialog || one(params.updateDialog) === '1',
  );

  const presetParam = one(params.preset) as MockPreset;
  const preset = PRESETS.includes(presetParam) ? presetParam
    : one(params.empty) === '1' ? 'empty'
      : def.preset ?? 'default';
  const rangeParam = one(params.range) as (typeof RANGES)[number];
  const tanParam = one(params.tan) as (typeof TANS)[number];
  const account = ACCOUNTS[one(params.acct)];
  const options: MockOptions = {
    ...def.options,
    ...(RANGES.includes(rangeParam) ? { range: rangeParam } : {}),
    ...(TANS.includes(tanParam) ? { tan: tanParam } : {}),
    ...(one(params.privacy) === '1' ? { privacy: true } : {}),
    ...(account ? { account } : {}),
    ...(one(params.q) ? { query: one(params.q) } : {}),
  };

  const theme = one(params.theme);
  const setup: Setup = {
    theme: theme === 'light' || theme === 'dark' ? theme : null,
    toasts: one(params.toasts) === '1',
    scrollY: Number(one(params.y)) || 0,
  };

  // Still frames (settled animations, see mock.tsx): on by default under
  // Electron, ?still=0|1 decides otherwise.
  const stillParam = one(params.still);
  const still = stillParam ? stillParam === '1' : undefined;

  return (
    // Keyed by the whole query: another view is another session, not a
    // transition of this one.
    <MockFintsProvider key={JSON.stringify(params)} preset={preset} still={still} {...options}>
      {/* Only the printable sheet reaches paper — same structure as app/page.tsx. */}
      <div className="print:hidden">
        <App />
        <TanWaitOverlay />
        <UpdateLayer />
        <Toasts />
      </div>
      <Statement />
      <Driver setup={setup} script={def.script} />
    </MockFintsProvider>
  );
}

function App() {
  const { view } = useFints();
  if (view === 'dashboard') return <Dashboard />;
  if (view === 'tanmethod') return <TanMethodPicker />;
  return <Login />;
}

type Setup = {
  theme: 'light' | 'dark' | null;
  toasts: boolean;
  scrollY: number;
};

/** Runs the view's script once, after the first paint, against the live mock. */
function Driver({ setup, script }: { setup: Setup; script?: Script }) {
  const api = useFints();
  const apiRef = useRef(api);
  apiRef.current = api;

  // Before paint: a screenshot must never catch the other theme.
  useLayoutEffect(() => {
    if (setup.theme) applyTheme(setup.theme);
  }, [setup.theme]);
  // Once per mount — React's doubled effects in development would otherwise
  // open a sheet twice or click through a step that is no longer there.
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const c = makeCtx(() => apiRef.current);
    void (async () => {
      if (setup.toasts) {
        const t = c.api().toast;
        t('2 Mitteilungen deiner Bank', 'info', 600_000, { label: 'Anzeigen', run: () => apiRef.current.setInboxOpen(true) });
        t('Überweisung an Lea Becker ausgeführt.', 'success', 600_000);
        t(
          'Die Verbindung zur Bank wurde unterbrochen (Zeitüberschreitung). Bitte versuche es erneut.',
          'error', 600_000, { label: 'Erneut versuchen', run: () => {} },
        );
      }
      // The dashboard's first frame — the mock data is synchronous, but the
      // components below may still be loading their chunks.
      await c.poll(() => document.querySelector('main, [data-scroll-root], form, h1'), 8000);
      try {
        await script?.(c);
      } catch (err) {
        console.warn('[design-preview] script failed', err);
      }
      if (setup.scrollY) {
        await c.sleep(300);
        // Instant: a smooth scroll is an animation, and the capture window
        // never advances those (see `still`).
        const root = document.querySelector<HTMLElement>('[data-scroll-root]');
        (root ?? window).scrollTo({ top: setup.scrollY, behavior: 'instant' });
      }
      // Let the last state change paint before calling it done.
      await c.sleep(250);
      markReady('ready');
    })();
  }, [setup, script]);

  return null;
}

// ---------------------------------------------------------------------------

const GROUPS: ViewDef['group'][] = ['Dashboard', 'Anmeldung', 'Überweisung', 'Dialoge', 'Updates'];

const PRESET_LABELS: Record<MockPreset, string> = {
  default: 'Standard',
  empty: 'Ohne Umsätze',
  'past-range': 'Vergangener Zeitraum',
  unverified: 'Salden ungeprüft',
  loading: 'Erster Abruf läuft',
  error: 'Abruf fehlgeschlagen',
};

const EXTRAS: { q: string; label: string }[] = [
  { q: 'view=overview&range=all', label: '13 Monate geladen' },
  { q: 'view=analysis&range=all', label: 'Analyse über 13 Monate' },
  { q: 'view=contracts&range=all', label: 'Verträge über 13 Monate' },
  { q: 'view=overview&acct=karte', label: 'Kreditkarte aktiv' },
  { q: 'view=overview&privacy=1', label: 'Beträge ausgeblendet' },
  { q: 'view=overview&toasts=1', label: 'Hinweise' },
  { q: 'view=tanwait&tan=ended', label: 'Freigabe abgelaufen' },
  { q: 'view=tanwait&tan=error', label: 'Freigabe-Fehler' },
];

/** ?view=index — every view and data situation, one click each. */
function Index() {
  // The theme the links open in. Applied here too (not stored), so the index
  // itself previews the choice.
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  useLayoutEffect(() => { applyTheme(theme); }, [theme]);

  const items = (list: { q: string; label: string }[]) => (
    <ul className="mt-3 flex flex-wrap gap-2">
      {list.map(({ q, label }) => (
        <li key={q}>
          <a
            href={`/design-preview?${q}&theme=${theme}`}
            className="inline-flex min-h-9 items-center rounded-[var(--radius-chip)] border border-line px-3 text-[13.5px]
                       font-semibold text-accent transition-colors duration-150 hover:border-accent hover:bg-accent-soft"
          >
            {label}
          </a>
        </li>
      ))}
    </ul>
  );

  return (
    <main className="min-h-dvh bg-paper px-4 py-10 text-ink sm:px-8">
      <div className="mx-auto max-w-[960px]">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[28px] leading-tight font-bold text-headline">Design-Vorschau</h1>
            <p className="mt-1 max-w-[56ch] text-[14px] text-ink-2">
              Die echte Oberfläche auf Beispieldaten, ohne Bankverbindung. Nur in der Entwicklung erreichbar.
            </p>
          </div>
          <Segmented
            aria-label="Darstellung der Vorschau"
            size="sm"
            value={theme}
            onChange={setTheme}
            options={[{ value: 'light', label: 'Hell' }, { value: 'dark', label: 'Dunkel' }]}
          />
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {GROUPS.map((group) => (
            <section key={group} className="panel p-5" aria-labelledby={`grp-${group}`}>
              <h2 id={`grp-${group}`} className="text-[15px] font-semibold">{group}</h2>
              {items(Object.entries(VIEWS)
                .filter(([, v]) => v.group === group)
                .map(([id, v]) => ({ q: `view=${id}`, label: v.label })))}
            </section>
          ))}
          <section className="panel p-5 sm:col-span-2" aria-labelledby="grp-data">
            <h2 id="grp-data" className="text-[15px] font-semibold">Datenlagen</h2>
            {items([
              ...PRESETS.map((p) => ({ q: `view=overview&preset=${p}`, label: PRESET_LABELS[p] })),
              ...EXTRAS,
            ])}
          </section>
        </div>

        <p className="mt-6 text-[12.5px] text-ink-3">
          Weitere Parameter: <code className="num">privacy=1</code>, <code className="num">preset=…</code>,{' '}
          <code className="num">range=90d|365d|all</code>, <code className="num">tan=hold|ended|error</code>,{' '}
          <code className="num">acct=tagesgeld|karte</code>, <code className="num">q=…</code>,{' '}
          <code className="num">y=…</code>, <code className="num">still=0|1</code>,{' '}
          <code className="num">update=available|ready|current|…</code>, <code className="num">updateDialog=1</code>.
        </p>
      </div>
    </main>
  );
}
