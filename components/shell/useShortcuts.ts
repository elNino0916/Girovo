'use client';

// The dashboard's keyboard shortcuts.
//
// Single keys only act when nobody is typing and nothing is open on top of
// the page: a "b" typed into the search box or a transfer's Verwendungszweck
// is a letter, not a command, and a shortcut must never reach past a dialog
// to the page behind it. Modified keys avoid everything the desktop shell and
// the browser already use (Strg+R, Strg+0/±, F11, Strg+Shift+I, the
// clipboard keys) — see ShortcutsHelp for the list as the user sees it, and
// for the switch that turns the single keys off (WCAG 2.1.4).
//
// A single key never starts a bank read: a stray "2" must not put an
// approval request on someone's phone. And what a key changes without a
// visible trace near the eye — every amount masked at once — it says.

import { useEffect, useRef } from 'react';
import type { DashboardTab } from '@/lib/app-types';
import type { SerializedAccount } from '@/lib/fints-types';
import { msgs } from '@/lib/i18n';
import { useFints, type FintsApi } from '../FintsProvider';
import type { ShellActions } from './actions';

/** What switching "Beträge ausblenden" from a key or the palette says. */
export function privacyNotice(hidden: boolean, singleKeys: boolean): string {
  const say = msgs().shell.amounts;
  if (!hidden) return say.shown;
  return singleKeys ? say.hiddenB : say.hidden;
}

/**
 * The account a digit names, when switching there costs nothing: its
 * Umsätze are loaded for the applied range (or, without Umsätze, its balance
 * is known or cannot be asked for). Anything else would be a read from the
 * bank — perhaps an approval — on one unmodified key, so the key says so and
 * offers the read as a deliberate press, the way the account list does.
 */
function switchByKey(f: FintsApi, account: SerializedAccount) {
  const label = f.accountLabel(account);
  const t = msgs();
  const say = t.shell.switchByKey;
  if (f.busy) {
    f.toast(say.busy(label), 'info');
    return;
  }
  const free = account.canStatements
    ? f.isLoadedForAppliedRange(account.accountNumber)
    : !account.canBalance || !!f.balances[account.accountNumber];
  if (free) {
    f.selectAccount(account);
    return;
  }
  const acct = account.accountNumber;
  const failed = !!(f.txErrors[acct] ?? f.balanceErrors[acct]);
  const elsewhere = !failed && !!f.txByAccount[acct];
  f.toast(
    failed ? say.failed(label) : elsewhere ? say.otherPeriod(label) : say.notLoaded(label),
    'info',
    10_000,
    { label: failed ? t.common.retry : say.loadNow, run: () => f.selectAccount(account) },
  );
}

/** Where a keystroke is text, not a command. */
export function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  const type = (el as HTMLInputElement).type;
  return !['button', 'checkbox', 'radio', 'range', 'reset', 'submit', 'color', 'file', 'image'].includes(type);
}

/**
 * Something is layered over the page — a dialog, a drawer, the palette, an
 * open menu or popover. Read from the DOM rather than from provider flags,
 * because several layers (menus, confirm dialogs, the TAN overlay) keep their
 * open state to themselves.
 */
export function layerOpen(): boolean {
  return !!document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]');
}

const TAB_KEYS: Record<string, DashboardTab> = { Digit1: 'overview', Digit2: 'analysis', Digit3: 'contracts' };
const G_TABS: Record<string, DashboardTab> = { a: 'analysis', v: 'contracts', u: 'overview', ü: 'overview', o: 'overview' };
const G_WINDOW_MS = 1200;

export function useGlobalShortcuts(actions: ShellActions) {
  const fints = useFints();
  // One listener for the dashboard's lifetime; it reads the latest state
  // through this ref instead of being re-attached on every render.
  const latest = useRef({ fints, actions });
  latest.current = { fints, actions };
  const gPressedAt = useRef(0);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const { fints: f, actions: a } = latest.current;
      if (f.view !== 'dashboard') return;

      // Strg+K / ⌘K: the palette. Also from inside the page's own fields
      // (a modified key never collides with typing), but never past a layer —
      // the palette's own input handles the key while it is open.
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        if (layerOpen()) return;
        e.preventDefault();
        f.setPaletteOpen(true);
        return;
      }

      if (isTypingTarget(e.target) || layerOpen()) return;
      if (e.ctrlKey || e.metaKey) return;

      // Alt+1…3: the tabs. By physical key, so ⌥1 on a Mac (which types "¡") works too.
      if (e.altKey) {
        const t = TAB_KEYS[e.code];
        if (t && !e.shiftKey) {
          e.preventDefault();
          f.setTab(t);
        }
        return;
      }

      // Everything below is a single unmodified key, and those can be
      // switched off (Tastenkürzel dialog): a dictated word or an unsteady
      // hand must not toggle the amounts or switch accounts.
      if (!f.singleKeyShortcuts) {
        gPressedAt.current = 0;
        return;
      }

      const key = e.key;

      // "G, then A/V/Ü" — the two-key form for people who know it from mail apps.
      if (Date.now() - gPressedAt.current < G_WINDOW_MS) {
        gPressedAt.current = 0;
        const t = G_TABS[key.toLowerCase()];
        if (t) {
          e.preventDefault();
          f.setTab(t);
          return;
        }
      }
      if (e.repeat) return;

      switch (key) {
        case '/':
          e.preventDefault();
          a.focusSearch();
          return;
        case '?':
          e.preventDefault();
          f.setShortcutsOpen(true);
          return;
        case 'g':
        case 'G':
          gPressedAt.current = Date.now();
          return;
        case 'n':
        case 'N':
          if (!a.canTransfer) return;
          e.preventDefault();
          a.transfer();
          return;
        case 'b':
        case 'B':
          e.preventDefault();
          f.togglePrivacy();
          // Every figure changes at once, far from the masthead's own button.
          f.toast(privacyNotice(!f.privacy, true), 'info');
          return;
      }

      // 1–9: the n-th account in the list, as AccountList orders them.
      if (/^[1-9]$/.test(key) && !e.shiftKey) {
        const account = f.accounts[Number(key) - 1];
        if (!account) return;
        e.preventDefault();
        if (account.accountNumber !== f.activeAccount?.accountNumber) switchByKey(f, account);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
