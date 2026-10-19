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
//                  &tan=confirm|hold|ended|error|refused|again   how simulated approvals end
//                  &method=app|flicker|photo|manual|sms   the TAN method approvals run on
//                  &acct=giro|tagesgeld|karte  start on another account
//                  &logos=unasked|on|off|unavailable   company logos: the user's answer, or a build without them
//                  &still=0|1                 settle animations (default: on under Electron)
//                  &q=rewe                    Umsätze search
//                  &fail=1                    every statement load and balance enquiry fails
//                  &toasts=1                  one toast of each tone
//                  &unclear=1                 this session's log holds a "Status unklar" transfer
//                  &second=linked|loggedOut|remembered   a second bank in the view (Weitere Bank anmelden)
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
import { PENDING_PANEL_ID } from '@/components/transactions/PendingPanel';
import { Toasts } from '@/components/Toasts';
import { UpdateLayer } from '@/components/updates/UpdateNotices';
import { txKey } from '@/lib/categories';
import { addDaysKey, isoDate, presetRange } from '@/lib/format';
import { applyTheme } from '@/lib/theme';
import { ACCT, MOCK_PAYEES, MOCK_TAN_KIND, MOCK_TAN_KINDS, SECOND_BANK, type MockTanKind } from './data';
import { buildEpcPayload } from '@/lib/girocode';
import { qrMatrix, qrPngBlob } from '@/lib/qr';
import { MockFintsProvider, type MockOptions, type MockPreset } from './mock';
import { PrintPreview, type PrintPreviewKind } from './print';
import { installFakeUpdater, isUpdateScenario, type UpdateScenario } from './updater';
import { USAGE_SCENARIOS, installFakeTelemetry } from './telemetry';

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
  group: 'Dashboard' | 'Anmeldung' | 'Überweisung' | 'TAN-Verfahren' | 'Dialoge' | 'Banken' | 'Updates' | 'Dokumente';
  preset?: MockPreset;
  options?: MockOptions;
  /** The desktop updater this view shows (a fake, ./updater.ts), and whether its dialog is open. */
  update?: { scenario: UpdateScenario; dialog?: boolean };
  /** A printed document, shown on screen in place of the app (./print.tsx). */
  print?: PrintPreviewKind;
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

/** On the method step: picks the mock bank's method of this kind, and waits for its approval to open. */
const approveWith = (kind: MockTanKind): Script => async (c) => {
  const m = c.api().tanMethods.find((x) => MOCK_TAN_KIND[x.id] === kind) ?? c.api().tanMethods[0];
  void c.api().chooseTanMethod(m, m.activeTanMedia[0]);
  await c.until((f) => f.wait.open, 3000);
};

/** Types a TAN into the approval's field and sends it, as a person would. */
async function enterTan(c: Ctx, tan = '482913') {
  const input = await c.poll(() => document.querySelector<HTMLInputElement>('input[autocomplete="one-time-code"]'), 4000);
  if (!input) return;
  typeInto(input, tan);
  await c.click(/^(TAN senden|Send TAN)$/, { within: 'dialog' });
}

/** The methods by kind, as the index names them. */
const TAN_KIND_LABELS: Record<MockTanKind, string> = {
  app: 'App-Freigabe',
  flicker: 'chipTAN optisch',
  photo: 'photoTAN / QR',
  manual: 'chipTAN manuell',
  sms: 'smsTAN',
};

/**
 * Every TAN method, at the login and at a transfer: the approval as it opens.
 * With a typed TAN the dialog waits for it — type any digits and send to see
 * the rest; &tan=refused|again|error|ended decides how the bank answers.
 */
const TAN_METHOD_VIEWS: Record<string, ViewDef> = Object.fromEntries(MOCK_TAN_KINDS.flatMap((kind) => [
  [`tan-${kind}-login`, {
    label: `${TAN_KIND_LABELS[kind]}: Anmeldung`,
    group: 'TAN-Verfahren',
    options: { view: 'tanmethod', method: kind, ...(kind === 'app' ? { tan: 'hold' } : {}) },
    script: approveWith(kind),
  }],
  [`tan-${kind}-transfer`, {
    label: `${TAN_KIND_LABELS[kind]}: Überweisung`,
    group: 'TAN-Verfahren',
    options: transferWith(MOCK_PAYEES.lea, { method: kind, ...(kind === 'app' ? { tan: 'hold' } : {}) }),
    script: sendOrder,
  }],
] satisfies [string, ViewDef][]));

/** On the review step: the primary action that sends the order ("Trotzdem überweisen" after a duplicate hint). */
const SUBMIT = /(freigeben|senden|ausführen|jetzt überweisen|trotzdem überweisen|^überweisen$|überweisung absenden|dauerauftrag einrichten|terminüberweisung anlegen|trotzdem einrichten|trotzdem anlegen)/i;

/** The transfer sheet's "Termin": "An einem Datum" or "Regelmäßig", as a person picks it. */
const pickWhen = (label: RegExp): Script => async (c) => {
  await c.click(label, { within: 'dialog' });
  await c.sleep(150);
};

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

/**
 * "Weitere Bank anmelden" with the second bank chosen, its login name filled
 * in, as the offer after a login opens it — then "Anmelden" with `name`.
 */
const addSecondBank = (name: string): Script => async (c) => {
  c.api().openAddBank({ bank: SECOND_BANK, userId: name });
  await loginAs(name, 300)(c);
};

/** "Alle Salden abrufen", pressed the way a person presses it, until the last answer is in. */
/** The Sitzung panel, opened from the masthead chip. */
async function openSession(c: Ctx) {
  await c.click(/^Sitzung/, { within: 'page' });
  await c.poll(() => document.querySelector('[role="dialog"], [data-popover]'), 2000);
}

/** The Einstellungen page (a view with tab: 'settings'), scrolled to "Umsätze auf diesem Rechner behalten". */
async function settingsAtKeep(c: Ctx): Promise<HTMLElement | null> {
  const label = await c.poll(
    () => [...document.querySelectorAll<HTMLLabelElement>('label')].find((l) => /^Umsätze auf diesem Rechner/.test(l.textContent ?? '')),
    3000,
  );
  label?.scrollIntoView({ block: 'center' });
  await c.sleep(150);
  return label ? document.getElementById(label.htmlFor) : null;
}

/**
 * Where a 'saved' preview's kept part ends: the day before the bank's ninety
 * days (lib/history.ts planFetch). The list narrowed to the fortnight around
 * it shows the line that says where the kept Umsätze begin.
 */
const KEPT_EDGE = addDaysKey(isoDate(new Date()), -91);

/** "Abmelden" in the Sitzung panel's footer. */
async function pressLogout(c: Ctx) {
  await openSession(c);
  await c.click(/^Abmelden$/, { within: 'dialog' });
}

/** Types into the palette's field, once it is there, until its answer has settled. */
const paletteQuery = (q: string): Script => async (c) => {
  const input = await c.poll(() => document.querySelector<HTMLInputElement>('[role="dialog"] input[role="combobox"]'), 4000);
  if (!input) return;
  typeInto(input, q);
  await c.sleep(500);
};

/** One key, pressed on the page itself (not in a field), as a person would. */
function pressKey(key: string) {
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key, code: /^\d$/.test(key) ? `Digit${key}` : '', bubbles: true }));
}

async function fetchAllBalances(c: Ctx) {
  await c.click(/^alle salden abrufen/i, { within: 'page' });
  await c.until((f) => f.loadingAllBalances, 2000);
  await c.until((f) => !f.loadingAllBalances, 8000);
}

// ---------------------------------------------------------------------------
// Umsätze: finding a booking, narrowing to a month, filing it

/** Last month — always inside the default 90 days. */
const LAST_MONTH = presetRange('lastMonth');
const LAST_MONTH_NAME = new Intl.DateTimeFormat('de-DE', { month: 'long' }).format(new Date(`${LAST_MONTH.from}T12:00:00`));

/**
 * The Umsätze tile. Its rows are not the first `[data-tx-row]` in the
 * document: the summaries' wrapper (Vorgemerkt among them) comes before it in
 * the reading order, so a lookup must be scoped to the tile.
 */
function umsaetzeSection(): HTMLElement | null {
  const h = [...document.querySelectorAll<HTMLElement>('h2')].find((el) => /^umsätze$/i.test(el.textContent?.trim() ?? ''));
  return h?.closest<HTMLElement>('section') ?? null;
}

/** The booking rows of the Umsätze list, never the Vorgemerkt panel's. */
const listRows = (): HTMLElement[] => [...(umsaetzeSection()?.querySelectorAll<HTMLElement>('[data-tx-row]') ?? [])];

/** Scrolls the Umsätze tile to the top of the window, so a search or a month narrowing shows its result. */
async function showList(c: Ctx) {
  const section = await c.poll(() => umsaetzeSection(), 6000);
  if (!section) return;
  section.scrollIntoView({ block: 'start' });
  await c.sleep(150);
}

/** Opens the drawer on the first booking row the (already filtered) Umsätze list shows. */
async function openFirstRow(c: Ctx): Promise<HTMLElement | null> {
  const row = await c.poll(() => listRows()[0], 6000);
  if (!row) {
    console.warn('[design-preview] no transaction row found');
    return null;
  }
  row.click();
  await c.poll(() => [...document.querySelectorAll('[role="dialog"]')].some(visible), 4000);
  return row;
}

/** In the open drawer: "Ändern", then a category — the offer to apply it to all follows. */
async function pickCategory(c: Ctx, label: RegExp) {
  await c.click(/^Kategorie ändern/, { within: 'dialog' });
  await c.poll(() => document.querySelector('[role="menu"]'), 3000);
  await c.click(label, { within: 'dialog' });
  await c.sleep(200);
}

/** In the open drawer: the Kategorie section scrolled to the top, so its offer or its rules are in view. */
async function showCategorySection(c: Ctx) {
  const drawer = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].filter(visible).at(-1);
  const heading = [...(drawer?.querySelectorAll<HTMLElement>('h3') ?? [])].find((h) => h.textContent?.trim() === 'Kategorie');
  heading?.closest('section')?.scrollIntoView({ block: 'start' });
  await c.sleep(150);
}

/** In the open drawer: the section under `title` scrolled to the top (the note, the category). */
async function showDrawerSection(c: Ctx, title: RegExp) {
  const drawer = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].filter(visible).at(-1);
  const heading = [...(drawer?.querySelectorAll<HTMLElement>('h3') ?? [])].find((h) => title.test(h.textContent?.trim() ?? ''));
  heading?.closest('section')?.scrollIntoView({ block: 'start' });
  await c.sleep(150);
}

/** Types into a textarea the way a person would, so React sees the change. */
function typeIntoArea(el: HTMLTextAreaElement, text: string) {
  el.focus();
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(el, text);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

/** The current month and the one a 90-day range starts in (partial). */
const THIS_MONTH = presetRange('90d').to.slice(0, 7);
const FIRST_LOADED_MONTH = presetRange('90d').from.slice(0, 7);

/** The Umsätze tile's Export menu, open — scrolled to, so the menu is in view. */
async function openExportMenu(c: Ctx) {
  const trigger = await c.poll(() => findButton(/^Export$/, 'page', false), 6000);
  if (!trigger) return;
  trigger.scrollIntoView({ block: 'center' });
  await c.sleep(100);
  trigger.click();
  await c.poll(() => document.querySelector('[role="menu"]'), 3000);
}

/**
 * The desktop app's Save-As (window.electronFiles, electron/preload.cjs),
 * answering as given — so the toast that follows a written file, or a
 * refusal, can be seen without the shell.
 */
function fakeFileSave(answer: { ok: true } | { ok: false; canceled: true } | { ok: false; error: string }) {
  window.electronFiles = { save: async () => answer };
}

const VIEWS: Record<string, ViewDef> = {
  overview: { label: 'Übersicht', group: 'Dashboard' },
  'overview-single': { label: 'Nur ein Konto', group: 'Dashboard', options: { oneAccount: true } },
  'overview-balances': { label: 'Alle Salden abgerufen', group: 'Dashboard', script: fetchAllBalances },
  'overview-balances-error': {
    label: 'Saldenabruf fehlgeschlagen', group: 'Dashboard', options: { fail: true }, script: fetchAllBalances,
  },
  analysis: { label: 'Analyse', group: 'Dashboard', options: { tab: 'analysis' } },
  history: {
    label: 'Gespeicherte Umsätze',
    group: 'Dashboard',
    // The list on "Alles Gespeicherte", narrowed to the days around where the
    // kept part begins — the divider in view.
    options: { history: 'saved', filter: { from: addDaysKey(KEPT_EDGE, -6), to: addDaysKey(KEPT_EDGE, 7) } },
    script: showList,
  },
  'history-period': {
    label: 'Zeitraum mit gespeicherten Umsätzen',
    group: 'Dashboard',
    options: { history: 'saved' },
    async script(c) {
      await showList(c);
      const trigger = await c.poll(() => findButton(/^Zeitraum: /, 'page', false), 4000);
      trigger?.click();
      await c.poll(() => document.querySelector('[role="menu"]'), 3000);
    },
  },
  'history-past': {
    label: 'Vergangener Monat nur aus gespeicherten Umsätzen',
    group: 'Dashboard',
    options: { history: 'saved' },
    // A month before the bank's free window, all kept: no bank call at all.
    async script(c) {
      const d = new Date();
      const from = isoDate(new Date(d.getFullYear(), d.getMonth() - 6, 1));
      const to = isoDate(new Date(d.getFullYear(), d.getMonth() - 5, 0));
      c.api().applyRange({ from, to });
      await c.until((f) => f.statementInfo[f.activeAccount?.accountNumber ?? '']?.from === from, 4000);
    },
  },
  'history-analysis': { label: 'Analyse mit gespeicherten Umsätzen', group: 'Dashboard', options: { history: 'saved', tab: 'analysis' } },
  'history-contracts': { label: 'Verträge mit gespeicherten Umsätzen', group: 'Dashboard', options: { history: 'saved', tab: 'contracts' } },
  contracts: { label: 'Verträge & Abos', group: 'Dashboard', options: { tab: 'contracts' } },
  // Monatsbudgets: the last complete month (the Analyse's default), the
  // running one, the one the 90 days start in (partial), the whole range.
  'analysis-budgets': { label: 'Analyse: Budgets', group: 'Dashboard', options: { tab: 'analysis', budgets: true } },
  'analysis-budgets-running': {
    label: 'Budgets, laufender Monat', group: 'Dashboard', options: { tab: 'analysis', budgets: true, analysisPeriod: THIS_MONTH },
  },
  'analysis-budgets-partial': {
    label: 'Budgets, Monat nicht ganz geladen', group: 'Dashboard',
    options: { tab: 'analysis', budgets: true, analysisPeriod: FIRST_LOADED_MONTH },
  },
  'analysis-budgets-range': {
    label: 'Budgets, gesamter Zeitraum', group: 'Dashboard', options: { tab: 'analysis', budgets: true, analysisPeriod: 'all' },
  },
  'budgets-dialog': {
    label: 'Budgets bearbeiten', group: 'Dialoge', options: { tab: 'analysis', budgets: true },
    script: async (c) => {
      await c.click(/^(Monatsbudgets bearbeiten|Edit monthly budgets)$/);
      await c.poll(() => [...document.querySelectorAll('[role="dialog"]')].some(visible), 4000);
    },
  },
  'budgets-set': {
    label: 'Budgets festlegen (noch keine)', group: 'Dialoge', options: { tab: 'analysis' },
    script: async (c) => {
      await c.click(/^(Budgets festlegen|Set budgets)$/);
      await c.poll(() => [...document.querySelectorAll('[role="dialog"]')].some(visible), 4000);
    },
  },
  // The Kategorie-Check over the whole range, with a rule, a booking refiled
  // by hand and notes in the vault.
  'category-check': {
    label: 'Kategorie-Check', group: 'Dashboard', options: { tab: 'analysis', personal: true, analysisPeriod: 'all' },
    script: async (c) => {
      // The summary row's name runs on into its count ("Kategorie-Check12 Umsätze ohne Kategorie").
      await c.click(/^(Kategorie-Check|Category check)/);
      await c.poll(() => [...document.querySelectorAll('[role="dialog"]')].some(visible), 4000);
    },
  },
  'overview-notes': { label: 'Umsätze mit Notizen', group: 'Dashboard', options: { personal: true } },
  // A note found by the search, then read in its drawer.
  'detail-note': {
    label: 'Umsatzdetails mit Notiz', group: 'Dashboard', options: { personal: true, query: 'Grillfest' },
    async script(c) {
      await openFirstRow(c);
      await showDrawerSection(c, /^(Notiz|Note)$/);
    },
  },
  'detail-receipt': {
    label: 'Umsatzdetails mit Beleg', group: 'Dashboard', options: { docs: true, query: 'REWE' },
    async script(c) {
      await c.until((f) => f.docs.some((d) => d.kind === 'receipt'), 4000);
      await openFirstRow(c);
      await showDrawerSection(c, /^(Belege|Receipts)$/);
    },
  },
  // The Amazon order the personal set splits between "Geschenke" (an own
  // category) and Shopping: its drawer, and the dialog that changes the split.
  'detail-split': {
    label: 'Umsatzdetails, aufgeteilt', group: 'Dashboard', options: { personal: true, query: 'Kopfhörer' },
    async script(c) {
      await openFirstRow(c);
      await showCategorySection(c);
    },
  },
  'split-dialog': {
    label: 'Umsatz aufteilen', group: 'Dashboard', options: { personal: true, query: 'Kopfhörer' },
    async script(c) {
      await openFirstRow(c);
      await c.click(/^(Aufteilung ändern|Change split)$/, { within: 'dialog' });
      await c.sleep(250);
    },
  },
  // The Analyse's tax tile and its drawer, the year put together.
  'tax-year': {
    label: 'Jahresübersicht für die Steuer', group: 'Dashboard', options: { tab: 'analysis', personal: true, analysisPeriod: 'all' },
    async script(c) {
      await c.click(/^(Zusammenstellen|Put together)/);
      await c.poll(() => [...document.querySelectorAll('[role="dialog"]')].some(visible), 4000);
    },
  },
  'settings-categories': {
    label: 'Einstellungen: eigene Kategorien', group: 'Dashboard', options: { tab: 'settings', personal: true },
    async script(c) {
      const section = await c.poll(() => document.querySelector<HTMLElement>('[data-setting="categories"]'), 3000);
      section?.scrollIntoView({ block: 'start' });
      await c.sleep(150);
    },
  },
  depot: {
    label: 'Depot',
    group: 'Dashboard',
    options: { depot: true, account: ACCT.depot },
    async script(c) {
      const depot = c.api().accounts.find((a) => a.accountNumber === ACCT.depot);
      if (depot) void c.api().loadPortfolio(depot);
      await c.until((f) => !!f.portfolios[ACCT.depot], 4000);
    },
  },
  'depot-unread': { label: 'Depot (noch nicht abgerufen)', group: 'Dashboard', options: { depot: true, account: ACCT.depot } },
  'bank-statements': {
    label: 'Kontoauszüge der Bank',
    group: 'Dashboard',
    options: { docs: true },
    async script(c) {
      await c.click(/^(Exportieren|Export)$/);
      await c.click(/(Auszüge deiner Bank|Your bank’s statements)/);
      await c.poll(() => document.querySelector('[role="dialog"]'), 3000);
    },
  },
  'bank-statements-fetched': {
    label: 'Kontoauszüge abgerufen',
    group: 'Dashboard',
    options: { docs: true, tanMs: 600 },
    async script(c) {
      await c.click(/^(Exportieren|Export)$/);
      await c.click(/(Auszüge deiner Bank|Your bank’s statements)/);
      await c.click(/^(Auszüge abrufen|Load statements)$/, { within: 'dialog' });
      await c.until((f) => !!f.statementFetches[ACCT.giro], 6000);
    },
  },
  'transfer-invoice': {
    label: 'Prüfen (Rechnung per GiroCode)',
    group: 'Überweisung',
    async script(c) {
      // An invoice as a file, its GiroCode read by the real reader — as when it is shared to the app.
      const payload = buildEpcPayload({ name: 'Stadtwerke Musterstadt GmbH', iban: 'DE12500105170648489890', amount: 86.4, purpose: 'Rechnung 2026-4711' });
      const png = await qrPngBlob(qrMatrix(payload));
      c.api().openTransfer({ girocode: { file: new File([png], 'Rechnung Stadtwerke.png', { type: 'image/png' }) } });
      await c.poll(() => document.querySelector<HTMLInputElement>('[role="dialog"] input[name="amount"], [role="dialog"] input[inputmode="decimal"]')?.value || null, 6000);
      await toReview(c);
    },
  },
  'detail-note-edit': {
    label: 'Notiz schreiben', group: 'Dashboard',
    async script(c) {
      await openFirstRow(c);
      await c.click(/^(Notiz hinzufügen|Add note)$/, { within: 'dialog' });
      const area = await c.poll(() => document.querySelector<HTMLTextAreaElement>('[role="dialog"] textarea'), 3000);
      if (area) typeIntoArea(area, 'Für die Steuererklärung aufheben');
      await showDrawerSection(c, /^(Notiz|Note)$/);
    },
  },
  empty: { label: 'Ohne Umsätze', group: 'Dashboard', preset: 'empty' },
  detail: {
    label: 'Umsatzdetails',
    group: 'Dashboard',
    async script(c) {
      // A row of the Umsätze list (not the Vorgemerkt panel's, which comes
      // first in the DOM): `data-tx-row` when the list marks its rows, else
      // the first row button under the "Umsätze" heading.
      const row = await c.poll(() => listRows()[0]
        ?? findUnderHeading(/^umsätze$/i, 'li > button, li [role="button"]'), 6000);
      if (!row) {
        console.warn('[design-preview] no transaction row found');
        return;
      }
      row.click();
      await c.poll(() => [...document.querySelectorAll('[role="dialog"]')].some(visible), 4000);
    },
  },
  'detail-pending': {
    label: 'Umsatzdetails, vorgemerkt',
    group: 'Dashboard',
    // The Vorgemerkt panel's first entry, opened from the panel itself.
    async script(c) {
      const row = await c.poll(() => document.querySelector<HTMLElement>(`#${PENDING_PANEL_ID} [data-tx-row]`), 6000);
      if (!row) {
        console.warn('[design-preview] no pending row found');
        return;
      }
      row.click();
      await c.poll(() => [...document.querySelectorAll('[role="dialog"]')].some(visible), 4000);
    },
  },
  'logo-consent': { label: 'Firmenlogos-Frage', group: 'Dashboard', options: { logos: 'unasked' } },
  'detail-privacy': {
    label: 'Umsatzdetails ausgeblendet',
    group: 'Dashboard',
    options: { privacy: true },
    // A Visa Debit payment in dollars: its record carries the original
    // amount, the rate and the fee — all of them masked.
    async script(c) {
      const rows = await c.poll(() => {
        const all = listRows();
        return all.length ? all : null;
      }, 6000);
      const row = rows?.find((r) => /Fremdwährung/.test(r.textContent ?? '')) ?? rows?.[0];
      if (!row) return;
      row.click();
      await c.poll(() => [...document.querySelectorAll('[role="dialog"]')].some(visible), 4000);
    },
  },
  session: {
    label: 'Sitzungsmenü',
    group: 'Dialoge',
    script: openSession,
  },
  settings: { label: 'Einstellungen', group: 'Dashboard', options: { tab: 'settings' } },
  'settings-history': {
    label: 'Einstellungen: Umsätze behalten',
    group: 'Dashboard',
    options: { history: 'saved', tab: 'settings' },
    async script(c) { await settingsAtKeep(c); },
  },
  'settings-history-unreadable': {
    label: 'Einstellungen: gespeicherte Umsätze nicht lesbar',
    group: 'Dashboard',
    options: { history: 'unreadable', tab: 'settings' },
    async script(c) { await settingsAtKeep(c); },
  },
  'history-off': {
    label: 'Gespeicherte Umsätze löschen?',
    group: 'Dialoge',
    options: { history: 'saved', tab: 'settings' },
    // Switching it off asks first: it deletes what is kept.
    async script(c) {
      const sw = await settingsAtKeep(c);
      sw?.click();
      await c.poll(() => [...document.querySelectorAll('[role="dialog"] h2')].find((h) => /Umsätze löschen/.test(h.textContent ?? '')), 3000);
    },
  },
  'logout-notice': {
    label: 'Abgemeldet (Hinweis)',
    group: 'Dialoge',
    // The login screen after "Abmelden": the notice, with the PIN clause once the server answered.
    async script(c) {
      await pressLogout(c);
      await c.until((f) => f.view === 'login', 3000);
      await c.poll(() => [...document.querySelectorAll('[data-toast] p')].find((p) => /PIN verworfen/.test(p.textContent ?? '')), 3000);
    },
  },
  'logout-confirm': {
    label: 'Abmelden bei unklarer Überweisung',
    group: 'Dialoge',
    options: { unclear: true },
    async script(c) {
      await pressLogout(c);
      await c.poll(() => [...document.querySelectorAll('[role="dialog"] h2')].find((h) => /Trotzdem abmelden/.test(h.textContent ?? '')), 3000);
    },
  },
  'search-month': {
    label: 'Suche mit Monat',
    group: 'Dashboard',
    // A month word matches its month and its text — the count line says so.
    options: { query: `rewe ${LAST_MONTH_NAME.toLowerCase()}` },
    script: showList,
  },
  'search-none': {
    label: 'Suche ohne Treffer',
    group: 'Dashboard',
    // A typo: the empty state names the word that found nothing.
    options: { query: `rewe ${LAST_MONTH_NAME.toLowerCase()}x` },
    script: showList,
  },
  'search-pending': {
    label: 'Suche trifft Vorgemerkte',
    group: 'Dashboard',
    // The pending Amazon order matches too: one line in the list, first in the panel.
    options: { query: 'amazon' },
  },
  'month-filter': {
    label: 'Liste auf einen Monat',
    group: 'Dashboard',
    options: { filter: { from: LAST_MONTH.from, to: LAST_MONTH.to } },
    script: showList,
  },
  export: {
    label: 'Export-Menü (gefiltert)',
    group: 'Dashboard',
    // A month and a search: the filtered file names its days and "gefiltert".
    options: { filter: { from: LAST_MONTH.from, to: LAST_MONTH.to }, query: 'rewe' },
    script: openExportMenu,
  },
  'export-saved': {
    label: 'CSV gespeichert (Desktop-App)',
    group: 'Dashboard',
    async script(c) {
      fakeFileSave({ ok: true });
      await openExportMenu(c);
      await c.click(/^Alle Umsätze als CSV/);
      await c.sleep(300);
    },
  },
  'export-busy': {
    label: 'CSV nicht gespeichert (Datei offen)',
    group: 'Dashboard',
    async script(c) {
      fakeFileSave({
        ok: false,
        error: 'Die Datei ist noch in einem anderen Programm geöffnet, zum Beispiel in Excel. Schließe sie dort oder wähle einen anderen Namen.',
      });
      await openExportMenu(c);
      await c.click(/^Alle Umsätze als CSV/);
      await c.sleep(300);
    },
  },
  'detail-category': {
    label: 'Kategorie geändert',
    group: 'Dashboard',
    // Found by its category label, filed by hand — then the offer for the others.
    options: { query: 'lebensmittel' },
    async script(c) {
      if (!(await openFirstRow(c))) return;
      await pickCategory(c, /^Shopping$/);
      await showCategorySection(c);
    },
  },
  'detail-rules': {
    label: 'Kategorie mit Regel',
    group: 'Dashboard',
    // The shop's name finds its bookings whatever they are filed under.
    options: { query: 'aldi' },
    async script(c) {
      const row = await c.poll(() => listRows()[0], 6000);
      const key = row?.dataset.txKey;
      const tx = Object.values(c.api().txByAccount).flat().find((t) => txKey(t) === key);
      if (!row || !tx) return;
      // A rule for this shop, as "Für alle übernehmen" would set it.
      c.api().setCategory(tx, 'shopping', { rule: true });
      await c.sleep(100);
      await openFirstRow(c);
      await c.click(/^Deine Regeln/, { within: 'dialog' });
      await showCategorySection(c);
    },
  },
  'detail-refund': {
    label: 'Erstattung (ohne Zurücküberweisen)',
    group: 'Dashboard',
    options: { query: 'erstattung' },
    script: async (c) => { await openFirstRow(c); },
  },
  'detail-card': {
    label: 'Kartenzahlung in USD',
    group: 'Dashboard',
    // Found by the words of its second line, which the bank never wrote.
    options: { query: 'fremdwährung' },
    script: async (c) => { await openFirstRow(c); },
  },
  'analysis-all': {
    label: 'Analyse aller Konten',
    group: 'Dashboard',
    options: { tab: 'analysis', analysisScope: 'all' },
  },
  'analysis-drill': {
    label: 'Analyse → Umsätze',
    group: 'Dashboard',
    // A category of a month over every account: the list opens on that month
    // and says it holds one account.
    options: { tab: 'analysis', analysisScope: 'all' },
    async script(c) {
      await c.click(/Umsätze anzeigen$/, { within: 'page' });
      await c.poll(() => document.querySelector('[data-tx-row]'), 4000);
    },
  },
  'contracts-error': {
    label: 'Verträge, Konto fehlgeschlagen',
    group: 'Dashboard',
    preset: 'error',
    options: { tab: 'contracts' },
  },
  inbox: { label: 'Mitteilungen', group: 'Dialoge', options: { open: 'inbox' } },
  palette: { label: 'Suche (Strg K)', group: 'Dialoge', options: { open: 'palette' } },
  // "ab" no longer reaches Abmelden; "abm" does, last, under "Sitzung".
  'palette-ab': { label: 'Suche „ab“', group: 'Dialoge', options: { open: 'palette' }, script: paletteQuery('ab') },
  'palette-logout': { label: 'Suche „abm“', group: 'Dialoge', options: { open: 'palette' }, script: paletteQuery('abm') },
  shortcuts: { label: 'Tastenkürzel', group: 'Dialoge', options: { open: 'shortcuts' } },
  'session-warning': { label: 'Abmeldung in 45 s', group: 'Dialoge', options: { idleInMs: 45_000 } },
  'session-warning-unclear': {
    label: 'Abmeldung, Überweisung unklar', group: 'Dialoge', options: { idleInMs: 45_000, unclear: true },
  },
  'inbox-unclear': { label: 'Mitteilungen, Status unklar', group: 'Dialoge', options: { open: 'inbox', unclear: true } },
  // "Umsätze mit diesem Empfänger" for a transfer from the Tagesgeld, whose
  // Umsätze are not loaded: no bank read — the list stays on the Girokonto and says so.
  'unclear-elsewhere': {
    label: 'Status unklar: anderes Konto',
    group: 'Dialoge',
    options: { open: 'inbox', unclear: 'tagesgeld' },
    async script(c) {
      await c.click(/^Umsätze mit diesem Empfänger$/, { within: 'dialog' });
      await showList(c);
    },
  },
  // The same from the Girokonto, sent after its list was fetched: the list cannot hold it yet.
  'unclear-stale': {
    label: 'Status unklar: Liste von davor',
    group: 'Dialoge',
    options: { open: 'inbox', unclear: 'recent' },
    async script(c) {
      await c.click(/^Umsätze mit diesem Empfänger$/, { within: 'dialog' });
      await showList(c);
    },
  },
  'pending-with-statements': {
    label: 'Vorgemerkte mit den Umsätzen (Sparkasse)',
    group: 'Dashboard',
    // No HKVMK: the list came with the Umsätze — no fetch button, no refresh.
    options: { pendingWithStatements: true },
  },
  'pending-error': {
    label: 'Vorgemerkte: Abruf fehlgeschlagen',
    group: 'Dashboard',
    options: { failPending: true, tanMs: 600 },
    async script(c) {
      await c.click(/^Vorgemerkte Umsätze abrufen$/, { within: 'page' });
      await c.until((f) => Object.keys(f.pendingErrors).length > 0, 5000);
    },
  },
  'range-cancelled': {
    label: 'Zeitraum: Freigabe abgebrochen',
    group: 'Dashboard',
    options: { tan: 'hold' },
    async script(c) {
      c.api().applyRange(presetRange('365d'));
      await c.until((f) => f.wait.open, 3000);
      await c.click(/^Abbrechen$/, { within: 'dialog' });
      await c.poll(() => [...document.querySelectorAll('[data-toast] p')].find((p) => /nicht abgerufen/.test(p.textContent ?? '')), 3000);
    },
  },
  'shortcut-keys': {
    label: 'Einzeltasten: 2 und B',
    group: 'Dialoge',
    // "2" names an account not fetched yet: a hint, no bank read. "B" says what it did.
    async script(c) {
      pressKey('2');
      await c.sleep(150);
      pressKey('b');
      await c.sleep(300);
    },
  },
  'toasts-keyboard': {
    label: 'Hinweis per F6',
    group: 'Dialoge',
    async script(c) {
      // A toast the app really raises (the bank's messages have none since the login toast went).
      // Its action opens the confirmation, as in the app — F6 lands on it, Enter only asks.
      c.api().toast('Gerät gemerkt – künftige Anmeldungen brauchen seltener eine Freigabe.', 'info', 600_000, {
        label: 'Gerät vergessen …',
        run: () => c.api().setForgetDeviceOpen(true),
      });
      await c.poll(() => document.querySelector('[data-toast]'), 2000);
      pressKey('F6');
      await c.sleep(200);
    },
  },
  share: { label: 'Geld anfordern', group: 'Dialoge', options: { open: 'share' } },

  // More than one bank in one view (Weitere Bank anmelden).
  banks: { label: 'Zwei Banken', group: 'Banken', options: { secondBank: 'linked' } },
  'banks-account': {
    label: 'Zwei Banken, Konto der zweiten', group: 'Banken', options: { secondBank: 'linked', account: ACCT.spk },
  },
  'banks-remembered': {
    label: 'Zweite Bank gemerkt (Angebot)', group: 'Banken', options: { secondBank: 'remembered' },
  },
  'banks-logged-out': {
    label: 'Zweite Bank abgemeldet', group: 'Banken', options: { secondBank: 'loggedOut' },
  },
  'banks-add': {
    label: 'Weitere Bank: Bank wählen',
    group: 'Banken',
    async script(c) {
      c.api().openAddBank();
      await c.poll(() => document.querySelector('[role="dialog"] input[role="combobox"]'), 4000);
    },
  },
  'banks-add-credentials': {
    label: 'Weitere Bank: Zugangsdaten',
    group: 'Banken',
    options: { secondBank: 'remembered' },
    // "Auch bei … anmelden" from the account list: the login name is there already.
    async script(c) {
      await c.click(/^Auch bei /, { within: 'page' });
      await c.poll(() => document.querySelector('[role="dialog"] input[autocomplete="current-password"]'), 4000);
    },
  },
  'banks-add-approval': {
    label: 'Weitere Bank: Freigabe',
    group: 'Banken',
    options: { tan: 'hold' },
    async script(c) {
      await addSecondBank('nino.b')(c);
      await c.until((f) => f.wait.open, 6000);
    },
  },
  'banks-added': {
    label: 'Weitere Bank: angemeldet',
    group: 'Banken',
    options: { tanMs: 600 },
    async script(c) {
      await addSecondBank('nino.b')(c);
      await c.until((f) => f.links.length === 1 && !f.addBank, 8000);
      await c.until((f) => !f.busy && !f.wait.open, 6000);
    },
  },
  'banks-collision': {
    label: 'Weitere Bank: Kontonummer doppelt',
    group: 'Banken',
    // "doppelt" in the login name: the bank lists an account under the Girokonto's number.
    options: { tanMs: 600 },
    async script(c) {
      await addSecondBank('doppelt')(c);
      await c.until((f) => !!f.addBank?.error, 8000);
    },
  },
  'banks-session': { label: 'Sitzungsmenü mit zwei Banken', group: 'Banken', options: { secondBank: 'linked' }, script: openSession },
  'banks-remove': {
    label: 'Bank entfernen',
    group: 'Banken',
    options: { secondBank: 'linked' },
    async script(c) {
      await openSession(c);
      await c.click(/entfernen/i, { within: 'dialog' });
      await c.poll(() => [...document.querySelectorAll('[role="dialog"] h2')].find((h) => /Bank entfernen/.test(h.textContent ?? '')), 3000);
    },
  },
  'banks-inbox': { label: 'Mitteilungen von zwei Banken', group: 'Banken', options: { secondBank: 'linked', open: 'inbox' } },
  'banks-transfer': {
    label: 'Überweisung, Konten zweier Banken', group: 'Banken', options: { secondBank: 'linked', open: 'transfer' },
  },
  'banks-analysis': {
    label: 'Analyse aller Konten, zwei Banken',
    group: 'Banken',
    options: { secondBank: 'linked', tab: 'analysis', analysisScope: 'all' },
  },
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
  'tanwait-overdue': {
    label: 'Freigabe (Frist abgelaufen)',
    group: 'Dialoge',
    // Started 3:10 ago — past the mock bank's 2 minutes.
    options: { tan: 'hold', tanElapsedMs: 190_000 },
    async script(c) {
      c.api().applyRange(presetRange('365d'));
      await c.until((f) => f.wait.open, 3000);
      await c.sleep(200);
    },
  },

  update: { label: 'Update verfügbar', group: 'Updates', update: { scenario: 'available', dialog: true } },
  'update-downloading': { label: 'Download läuft', group: 'Updates', update: { scenario: 'downloading', dialog: true } },
  'update-ready': { label: 'Bereit zur Installation', group: 'Updates', update: { scenario: 'ready', dialog: true } },
  // The restart is a logout: over an unclear transfer, looking comes first.
  'update-ready-unclear': {
    label: 'Bereit, Überweisung unklar', group: 'Updates', options: { unclear: true }, update: { scenario: 'ready', dialog: true },
  },
  'update-current': { label: 'Auf dem neuesten Stand', group: 'Updates', update: { scenario: 'current', dialog: true } },
  'update-installed': { label: 'Nach dem Update', group: 'Updates', update: { scenario: 'installed' } },
  'update-error': { label: 'Download fehlgeschlagen', group: 'Updates', update: { scenario: 'error', dialog: true } },
  'update-manual': { label: 'Nur Download-Seite', group: 'Updates', update: { scenario: 'manual', dialog: true } },
  'update-portable': { label: 'Portable Version', group: 'Updates', update: { scenario: 'portable', dialog: true } },
  'update-inbox': { label: 'In Mitteilungen', group: 'Updates', options: { open: 'inbox' }, update: { scenario: 'available' } },
  'update-login': { label: 'Bei der Anmeldung', group: 'Updates', options: { view: 'login' }, update: { scenario: 'ready' } },
  'update-settings': {
    label: 'In den Einstellungen',
    group: 'Updates',
    options: { tab: 'settings' },
    update: { scenario: 'available' },
  },
  'update-background': {
    label: 'Im Hintergrund geladen',
    group: 'Updates',
    update: { scenario: 'available', dialog: true },
    // "Herunterladen", "Im Hintergrund laden" — and the toast once the file is there.
    async script(c) {
      await c.click(/^Herunterladen/, { within: 'dialog' });
      await c.click(/^Im Hintergrund laden$/, { within: 'dialog' });
      await c.poll(() => [...document.querySelectorAll('[data-toast] p')].find((p) => /heruntergeladen/.test(p.textContent ?? '')), 8000);
    },
  },
  'update-settings-downloading': {
    label: 'Download in den Einstellungen',
    group: 'Updates',
    options: { tab: 'settings' },
    update: { scenario: 'downloading' },
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
  'tanwait-login-refused': {
    label: 'Anmeldung abgelehnt',
    group: 'Anmeldung',
    // "Ablehnen" pressed in the app.
    options: { view: 'tanmethod', tan: 'refused', tanMs: 600 },
    async script(c) {
      const m = c.api().tanMethods[0];
      void c.api().chooseTanMethod(m, m.activeTanMedia[0]);
      await c.until((f) => f.wait.phase === 'refused', 4000);
    },
  },
  'tanwait-second': {
    label: 'Zweite Freigabe nach der Anmeldung',
    group: 'Anmeldung',
    options: { view: 'tanmethod', secondApproval: true, tanMs: 600 },
    async script(c) {
      const m = c.api().tanMethods[0];
      void c.api().chooseTanMethod(m, m.activeTanMedia[0]);
      await c.until((f) => f.wait.kind === 'statements' && f.wait.phase === 'waiting', 6000);
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

  ...TAN_METHOD_VIEWS,
  'tan-sent': {
    label: 'TAN gesendet, Bank prüft',
    group: 'TAN-Verfahren',
    options: transferWith(MOCK_PAYEES.lea, { method: 'flicker', tan: 'hold' }),
    async script(c) {
      await sendOrder(c);
      await enterTan(c);
      await c.until((f) => !!f.wait.entry?.sending, 3000);
    },
  },
  'tan-again': {
    label: 'Weitere TAN verlangt',
    group: 'TAN-Verfahren',
    options: transferWith(MOCK_PAYEES.lea, { method: 'photo', tan: 'again', tanMs: 600 }),
    async script(c) {
      await sendOrder(c);
      await enterTan(c);
      await c.until((f) => !!f.wait.entry?.again, 3000);
    },
  },
  'tan-wrong': {
    label: 'TAN falsch (Anmeldung)',
    group: 'TAN-Verfahren',
    options: { view: 'tanmethod', method: 'sms', tan: 'refused', tanMs: 600 },
    async script(c) {
      await approveWith('sms')(c);
      await enterTan(c, '000000');
      await c.until((f) => f.wait.phase === 'refused', 3000);
    },
  },
  'tan-done': {
    label: 'Überweisung per TAN ausgeführt',
    group: 'TAN-Verfahren',
    options: transferWith(MOCK_PAYEES.lea, { method: 'manual', tanMs: 600 }),
    async script(c) {
      await sendOrder(c);
      await enterTan(c);
      await c.until((f) => !f.busy && !f.wait.open, 6000);
      await c.sleep(300);
    },
  },

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
  'transfer-earlier': {
    label: 'Prüfen (unklar aus früherer Sitzung)',
    group: 'Überweisung',
    // 75,00 € to Max Mustermann ended "Status unklar" yesterday — remembered in the vault's two-week log.
    options: transferWith(MOCK_PAYEES.max, {}, { amount: '75,00', purpose: 'Rechnung 2026-117' }),
    script: toReview,
  },
  'transfer-dispo': {
    label: 'Prüfen (Dispo)',
    group: 'Überweisung',
    // Covered by Verfügbar, but the Kontostand ends below zero.
    options: transferWith(MOCK_PAYEES.lea, {}, { amount: '2.000,00', purpose: 'Miete Oktober' }),
    script: toReview,
  },
  'transfer-over': {
    label: 'Prüfen (mehr als verfügbar)',
    group: 'Überweisung',
    options: transferWith(MOCK_PAYEES.lea, {}, { amount: '5.000,00', purpose: 'Anzahlung Küche' }),
    script: toReview,
  },
  'transfer-vop': {
    label: 'Namensabgleich', group: 'Überweisung', options: transferWith(MOCK_PAYEES.closeMatch), script: sendOrder,
  },
  'transfer-vop-nomatch': {
    label: 'Namensabgleich (keine Übereinstimmung)',
    group: 'Überweisung',
    // "Schmidt" in the payee name: the bank holds another name for the IBAN.
    options: transferWith({ name: 'Erika Schmidt', iban: MOCK_PAYEES.max.iban }),
    script: sendOrder,
  },
  'transfer-vop-none': {
    label: 'Namensabgleich (nicht möglich)',
    group: 'Überweisung',
    // "Kiosk" in the payee name: the payee's bank gives no result.
    options: transferWith({ name: 'Kiosk am Markt', iban: MOCK_PAYEES.max.iban }),
    script: sendOrder,
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
  'transfer-unknown-checked': {
    label: 'Status unklar (nachgesehen)',
    group: 'Überweisung',
    options: transferWith({ name: 'Unklar GmbH', iban: MOCK_PAYEES.max.iban }, { tanMs: 900 }),
    // "Jetzt nachsehen": the Umsätze, then the Vorgemerkte (an approval in the mock).
    async script(c) {
      await completeOrder(c);
      await c.click(/^jetzt nachsehen$/i, { within: 'dialog' });
      await c.poll(() => [...document.querySelectorAll('[role="dialog"] p')].find((p) => /bitte nicht erneut senden|gefunden/i.test(p.textContent ?? '')), 9000);
    },
  },
  'transfer-error': {
    label: 'Abgelehnt (vor der Freigabe)',
    group: 'Überweisung',
    // "Fehler" in the payee name: the bank refuses the order.
    options: transferWith({ name: 'Fehler GmbH', iban: MOCK_PAYEES.max.iban }),
    script: sendOrder,
  },
  'transfer-refused': {
    label: 'Abgelehnt (in der App)',
    group: 'Überweisung',
    // "Abgelehnt" in the payee name: the approval is refused in the app.
    options: transferWith({ name: 'Abgelehnt GmbH', iban: MOCK_PAYEES.max.iban }, { tanMs: 900 }),
    script: completeOrder,
  },

  // Terminüberweisung and Dauerauftrag: the same sheet, with "Termin".
  'transfer-dated': {
    label: 'Termin: an einem Datum', group: 'Überweisung', options: transferWith(MOCK_PAYEES.lea), script: pickWhen(/^an einem datum$/i),
  },
  'transfer-standing': {
    label: 'Termin: regelmäßig (Dauerauftrag)', group: 'Überweisung', options: transferWith(MOCK_PAYEES.lea), script: pickWhen(/^regelmäßig$/i),
  },
  'transfer-standing-review': {
    label: 'Dauerauftrag prüfen',
    group: 'Überweisung',
    options: transferWith(MOCK_PAYEES.lea, {}, { amount: '50,00', purpose: 'Taschengeld' }),
    async script(c) { await pickWhen(/^regelmäßig$/i)(c); await toReview(c); },
  },
  'transfer-dated-review': {
    label: 'Terminüberweisung prüfen',
    group: 'Überweisung',
    options: transferWith(MOCK_PAYEES.lea),
    async script(c) { await pickWhen(/^an einem datum$/i)(c); await toReview(c); },
  },
  'transfer-standing-duplicate': {
    label: 'Dauerauftrag prüfen (besteht schon)',
    group: 'Überweisung',
    // The Girokonto's list was read: 850,00 € to the Hausverwaltung, monthly.
    options: transferWith(
      MOCK_PAYEES.landlord,
      { ordersLoaded: true },
      { amount: '850,00', purpose: 'Miete Wohnung 3. OG links' },
    ),
    async script(c) { await pickWhen(/^regelmäßig$/i)(c); await toReview(c); },
  },
  'tanwait-standing': {
    label: 'Freigabe (Dauerauftrag)',
    group: 'Überweisung',
    options: transferWith(MOCK_PAYEES.lea, { tan: 'hold' }, { amount: '50,00', purpose: 'Taschengeld' }),
    async script(c) { await pickWhen(/^regelmäßig$/i)(c); await sendOrder(c); },
  },
  'transfer-standing-done': {
    label: 'Dauerauftrag eingerichtet',
    group: 'Überweisung',
    options: transferWith(MOCK_PAYEES.lea, { tanMs: 900 }, { amount: '50,00', purpose: 'Taschengeld' }),
    async script(c) { await pickWhen(/^regelmäßig$/i)(c); await completeOrder(c); },
  },
  'transfer-dated-unknown': {
    label: 'Terminüberweisung: Status unklar',
    group: 'Überweisung',
    options: transferWith({ name: 'Unklar GmbH', iban: MOCK_PAYEES.max.iban }, { tanMs: 900 }),
    async script(c) { await pickWhen(/^an einem datum$/i)(c); await completeOrder(c); },
  },
  'transfer-no-orders': {
    label: 'Ohne Termin (Bank bietet keinen)', group: 'Überweisung', options: transferWith(MOCK_PAYEES.lea, { noOrders: true }),
  },
  'contracts-orders': {
    label: 'Daueraufträge bei der Bank',
    group: 'Dashboard',
    options: { tab: 'contracts', ordersLoaded: true },
    async script(c) {
      const tile = await c.poll(() => document.getElementById('bank-orders'), 6000);
      tile?.scrollIntoView({ block: 'start' });
      await c.sleep(150);
    },
  },
  'contracts-orders-unread': {
    label: 'Daueraufträge (nicht abgerufen)',
    group: 'Dashboard',
    options: { tab: 'contracts' },
    async script(c) {
      const tile = await c.poll(() => document.getElementById('bank-orders'), 6000);
      tile?.scrollIntoView({ block: 'start' });
      await c.sleep(150);
    },
  },
  'order-delete': {
    label: 'Dauerauftrag löschen?',
    group: 'Dialoge',
    options: { tab: 'contracts', ordersLoaded: true },
    async script(c) {
      const tile = await c.poll(() => document.getElementById('bank-orders'), 6000);
      tile?.scrollIntoView({ block: 'start' });
      await c.click(/^dauerauftrag an .+ löschen …$/i, { within: 'page' });
      await c.poll(() => [...document.querySelectorAll('[role="dialog"]')].some(visible), 3000);
    },
  },
  'order-change': {
    label: 'Dauerauftrag ändern',
    group: 'Dialoge',
    options: { tab: 'contracts', ordersLoaded: true },
    async script(c) {
      const tile = await c.poll(() => document.getElementById('bank-orders'), 6000);
      tile?.scrollIntoView({ block: 'start' });
      await c.click(/^dauerauftrag an .+ ändern …$/i, { within: 'page' });
      await c.poll(() => [...document.querySelectorAll('[role="dialog"]')].some(visible), 3000);
    },
  },
  'order-deleted': {
    label: 'Dauerauftrag gelöscht',
    group: 'Dashboard',
    options: { tab: 'contracts', ordersLoaded: true, tanMs: 900 },
    async script(c) {
      const tile = await c.poll(() => document.getElementById('bank-orders'), 6000);
      tile?.scrollIntoView({ block: 'start' });
      await c.click(/^dauerauftrag an .+ löschen …$/i, { within: 'page' });
      await c.poll(() => [...document.querySelectorAll('[role="dialog"]')].some(visible), 3000);
      await c.click(/^dauerauftrag löschen$/i, { within: 'dialog' });
      await c.until((f) => f.wait.open, 3000);
      await c.until((f) => !f.wait.open && !f.busy, 8000);
      document.getElementById('bank-orders')?.scrollIntoView({ block: 'start' });
      await c.sleep(300);
    },
  },

  // The printed documents, at A4 width (./print.tsx). The data situations
  // apply to them too: &preset=past-range|empty, &range=365d, &acct=karte.
  'print-statement': { label: 'Kontoauszug', group: 'Dokumente', print: 'statement', script: sheetShown },
  'print-statement-card': {
    label: 'Kontoauszug Kreditkarte', group: 'Dokumente', print: 'statement', options: { account: ACCT.karte },
    script: sheetShown,
  },
  'print-statement-no-opening': {
    label: 'Kontoauszug ohne Anfangssaldo', group: 'Dokumente', print: 'statement-no-opening', script: sheetShown,
  },
  'print-statement-difference': {
    label: 'Kontoauszug mit Differenz', group: 'Dokumente', print: 'statement-difference', script: sheetShown,
  },
  'print-receipt': { label: 'Beleg: Lastschrift', group: 'Dokumente', print: 'receipt', script: sheetShown },
  'print-receipt-credit': { label: 'Beleg: Gutschrift', group: 'Dokumente', print: 'credit', script: sheetShown },
  'print-receipt-card': { label: 'Beleg: Visa Debit', group: 'Dokumente', print: 'card', script: sheetShown },
  'print-receipt-ahead': { label: 'Beleg: noch nicht gebucht', group: 'Dokumente', print: 'ahead', script: sheetShown },
  'print-receipt-pending': { label: 'Beleg: vorgemerkt', group: 'Dokumente', print: 'pending', script: sheetShown },
  'print-message': { label: 'Mitteilung der Bank', group: 'Dokumente', print: 'message', script: sheetShown },
  'print-tax-year': {
    label: 'Jahresübersicht (Steuer)', group: 'Dokumente', print: 'tax-year', options: { personal: true }, script: sheetShown,
  },
  'print-message-short': { label: 'Mitteilung, kurz', group: 'Dokumente', print: 'message-short', script: sheetShown },
  'print-message-long': { label: 'Mitteilung über zwei Seiten', group: 'Dokumente', print: 'message-long', script: sheetShown },
};

/** A document view is ready once its sheet is sealed and on the page. */
async function sheetShown(c: Ctx) {
  await c.poll(() => document.querySelector('.doc-paper'), 6000);
}

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
const TANS = ['confirm', 'hold', 'ended', 'error', 'refused', 'again'] as const;
const ACCOUNTS: Record<string, string> = { giro: ACCT.giro, tagesgeld: ACCT.tagesgeld, karte: ACCT.karte, spk: ACCT.spk };
const SECONDS = ['linked', 'loggedOut', 'remembered'] as const;
const LOGOS = ['unasked', 'on', 'off', 'unavailable'] as const;

const noopSubscribe = () => () => {};

/** The fake updater is set up once per view (the same key as the mock session below). */
let updaterKey: string | null = null;
function prepareUpdater(key: string, scenario: UpdateScenario | null, dialog: boolean) {
  if (updaterKey === key) return;
  updaterKey = key;
  installFakeUpdater(scenario, { dialog });
}

/** Likewise the fake telemetry bridge (?usage=…). */
let telemetryKey: string | null = null;
function prepareTelemetry(key: string, consent: (typeof USAGE_SCENARIOS)[number] | null) {
  if (telemetryKey === key) return;
  telemetryKey = key;
  installFakeTelemetry(consent);
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
  const usageParam = one(params.usage) as (typeof USAGE_SCENARIOS)[number];
  prepareTelemetry(JSON.stringify(params), USAGE_SCENARIOS.includes(usageParam) ? usageParam : null);

  const presetParam = one(params.preset) as MockPreset;
  const preset = PRESETS.includes(presetParam) ? presetParam
    : one(params.empty) === '1' ? 'empty'
      : def.preset ?? 'default';
  const rangeParam = one(params.range) as (typeof RANGES)[number];
  const tanParam = one(params.tan) as (typeof TANS)[number];
  const methodParam = one(params.method) as MockTanKind;
  const account = ACCOUNTS[one(params.acct)];
  const logosParam = one(params.logos) as (typeof LOGOS)[number];
  const secondParam = one(params.second) as (typeof SECONDS)[number];
  const options: MockOptions = {
    ...def.options,
    ...(RANGES.includes(rangeParam) ? { range: rangeParam } : {}),
    ...(TANS.includes(tanParam) ? { tan: tanParam } : {}),
    ...(MOCK_TAN_KINDS.includes(methodParam) ? { method: methodParam } : {}),
    ...(one(params.privacy) === '1' ? { privacy: true } : {}),
    ...(account ? { account } : {}),
    ...(one(params.q) ? { query: one(params.q) } : {}),
    ...(LOGOS.includes(logosParam) ? { logos: logosParam } : {}),
    ...(one(params.fail) === '1' ? { fail: true } : {}),
    ...(one(params.unclear) === '1' ? { unclear: true } : {}),
    ...(SECONDS.includes(secondParam) ? { secondBank: secondParam } : {}),
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
      {def.print ? (
        <PrintPreview kind={def.print} />
      ) : (
        <div className="print:hidden">
          <App />
          <TanWaitOverlay />
          <UpdateLayer />
          <Toasts />
        </div>
      )}
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
        // The app has no "Mitteilungen" toast any more (the bell and the tile announce them).
        t('Gerät gemerkt – künftige Anmeldungen brauchen seltener eine Freigabe.', 'info', 600_000, { label: 'Gerät vergessen …', run: () => {} });
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

const GROUPS: ViewDef['group'][] = ['Dashboard', 'Anmeldung', 'Überweisung', 'TAN-Verfahren', 'Dialoge', 'Banken', 'Updates', 'Dokumente'];

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
  { q: 'view=overview&acct=karte&privacy=1', label: 'Kreditkarte, Beträge ausgeblendet' },
  { q: 'view=overview-single&preset=error', label: 'Ein Konto, Abruf fehlgeschlagen' },
  { q: 'view=overview&privacy=1', label: 'Beträge ausgeblendet' },
  { q: 'view=overview&acct=karte&privacy=1', label: 'Kreditkarte ausgeblendet' },
  { q: 'view=settings&logos=on', label: 'Einstellungen: Firmenlogos an' },
  { q: 'view=settings&logos=unavailable', label: 'Einstellungen: ohne Firmenlogos' },
  { q: 'view=session&unclear=1', label: 'Sitzung: Überweisung unklar' },
  { q: 'view=palette-logout&unclear=1', label: 'Suche „abm“, Überweisung unklar' },
  { q: 'view=login&logos=on', label: 'Anmeldung: Firmenlogos an' },
  { q: 'view=credentials&logos=off', label: 'Anmeldung: Firmenlogos aus' },
  { q: 'view=overview&toasts=1', label: 'Hinweise' },
  { q: 'view=tanwait&tan=ended', label: 'Freigabe abgelaufen' },
  { q: 'view=tanwait&tan=error', label: 'Freigabe-Fehler' },
  { q: 'view=tanwait&tan=refused', label: 'Freigabe abgelehnt' },
  ...MOCK_TAN_KINDS.filter((k) => k !== 'app').map((k) => ({ q: `view=tanwait&method=${k}`, label: `Umsatzabruf per ${TAN_KIND_LABELS[k]}` })),
  { q: 'view=print-statement&range=365d', label: 'Kontoauszug über 12 Monate' },
  { q: 'view=print-statement&preset=past-range', label: 'Kontoauszug, vergangener Zeitraum' },
  { q: 'view=print-statement&preset=empty', label: 'Kontoauszug ohne Umsätze' },
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
          <code className="num">range=90d|365d|all</code>, <code className="num">tan=hold|ended|error|refused|again</code>,{' '}
          <code className="num">method=app|flicker|photo|manual|sms</code>,{' '}
          <code className="num">acct=tagesgeld|karte</code>, <code className="num">q=…</code>,{' '}
          <code className="num">logos=unasked|on|off|unavailable</code>,{' '}
          <code className="num">fail=1</code>, <code className="num">unclear=1</code>,{' '}
          <code className="num">y=…</code>, <code className="num">still=0|1</code>,{' '}
          <code className="num">update=available|ready|current|…</code>, <code className="num">updateDialog=1</code>.
        </p>
      </div>
    </main>
  );
}
