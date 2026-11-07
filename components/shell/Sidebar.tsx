'use client';

// The frame's sidebar (components/shell/frame.ts): M3 Expressive's expanded
// navigation rail, as Google's desktop apps draw it, on the canvas beside the
// sheet. At its head Überweisen, M3E's extended FAB in primary container;
// then the three places as M3E nav items lying horizontal; then what the
// place works with — the month and the accounts as layers (Übersicht,
// Zahlungen, Analyse) or Einstellungen's sections — and Einstellungen at the
// foot. Folded (the title bar's menu button, or a narrow window) it is a rail
// of the same items, icon over label, without the month and the accounts.
// Which place is current is the app's state, never the item's own.

import { M3eFab } from '@m3e/react/fab';
import { M3eNavItem } from '@m3e/react/nav-bar';
import { M3eNavMenu, M3eNavMenuItem } from '@m3e/react/nav-menu';
import { createElement, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { DashboardTab } from '@/lib/app-types';
import { dayKey, isoDate } from '@/lib/format';
import { useT } from '@/lib/i18n/react';
import { useFints } from '../FintsProvider';
import { useRecurringModel, useUpcoming } from '../insights/recurring-model';
import { AccountLayers } from '../overview/AccountLayers';
import { useLayers } from '../overview/layers';
import { useSettingsPages } from '../settings/Settings';
import { BackIcon, ChartIcon, GearIcon, HomeIcon, TransferIcon } from '../icons';
import { IconButton, cx } from '../ui';
import type { ShellActions } from './actions';
import { PLACE_ROOT_EVENT } from './frame';
import { MiniMonth } from './MiniMonth';

/** Which place is current is the app's to say: M3E would select an item on its own click. */
const keepPlace = (e: Event) => e.preventDefault();

export function Sidebar({ open, actions }: { open: boolean; actions: ShellActions }) {
  const { tab, setTab, openSettings, closeAccount, closeOrders } = useFints();
  const t = useT();
  const go = (place: DashboardTab) => () => {
    if (place === 'overview' && tab === 'overview') closeAccount();
    if (place === 'contracts' && tab === 'contracts') closeOrders();
    if (place === tab) window.dispatchEvent(new CustomEvent(PLACE_ROOT_EVENT, { detail: place }));
    setTab(place);
  };
  const settings = tab === 'settings' && open;
  // The payments due in the next 30 days from the ticked accounts: Zahlungen's badge.
  const { shown } = useLayers();
  const model = useRecurringModel();
  const upcoming = useUpcoming(model, 30);
  const dueCount = useMemo(() => {
    const own = new Set(shown.map((a) => a.accountNumber));
    return upcoming.filter((u) => u.series.amount < 0 && own.has(model.accountOf(u.series) ?? '')).length;
  }, [upcoming, model, shown]);

  return (
    <nav
      aria-label={t.shell.bottomBar.label}
      data-frame-side
      data-open={open || undefined}
      className="flex w-[var(--frame-side)] shrink-0 flex-col overflow-x-hidden overflow-y-auto pt-2 pb-4 [scrollbar-width:thin] transition-[width] duration-200"
    >
      {settings ? (
        <SettingsSections />
      ) : (
        <>
          {actions.canTransfer && (
            <M3eFab
              variant="primary-container"
              size="small"
              extended={open}
              lowered
              aria-label={open ? undefined : t.shell.transfer}
              title={open ? undefined : t.shell.transfer}
              onClick={actions.transfer}
              // Open: on the sidebar's edge with the places. Folded: centred in the rail, over its items.
              className={cx('mb-4 shrink-0', open ? 'ml-4 self-start' : 'self-center')}
            >
              <TransferIcon size={24} strokeWidth={2} />
              {open && <span slot="label">{t.shell.transfer}</span>}
            </M3eFab>
          )}
          {open ? (
            // Open: M3E's navigation drawer items, their pill the sidebar's width.
            <M3eNavMenu className="block">
              <MenuPlace icon={<HomeIcon size={24} filled={tab === 'overview'} />} label={t.common.nav.overview} current={tab === 'overview'} onClick={go('overview')} />
              <MenuPlace icon={<TransferIcon size={24} filled={tab === 'contracts'} />} label={t.shell.bottomBar.contracts} current={tab === 'contracts'} onClick={go('contracts')} badge={dueCount > 0 ? t.shell.frame.dueBadge(dueCount) : undefined} />
              <MenuPlace icon={<ChartIcon size={24} filled={tab === 'analysis'} />} label={t.common.nav.analysis} current={tab === 'analysis'} onClick={go('analysis')} />
            </M3eNavMenu>
          ) : (
            // Folded: M3E's rail items, icon over label.
            <div className="flex flex-col gap-3">
              <Place icon={<HomeIcon size={24} filled={tab === 'overview'} />} label={t.common.nav.overview} current={tab === 'overview'} onClick={go('overview')} />
              <Place icon={<TransferIcon size={24} filled={tab === 'contracts'} />} label={t.shell.bottomBar.contracts} current={tab === 'contracts'} onClick={go('contracts')} />
              <Place icon={<ChartIcon size={24} filled={tab === 'analysis'} />} label={t.common.nav.analysis} current={tab === 'analysis'} onClick={go('analysis')} />
            </div>
          )}
          {open && <PlaceMonth />}
          {open && <AccountLayers />}
        </>
      )}
      {open ? (
        // On Einstellungen the sidebar's head already says where you are: the foot stays quiet there.
        <M3eNavMenu className="mt-auto block pt-3">
          <MenuPlace icon={<GearIcon size={24} />} label={t.common.nav.settings} current={tab === 'settings' && !settings} onClick={() => openSettings()} />
        </M3eNavMenu>
      ) : (
        <div className="mt-auto flex flex-col pt-3">
          <Place icon={<GearIcon size={24} />} label={t.common.nav.settings} current={tab === 'settings'} onClick={() => openSettings()} />
        </div>
      )}
    </nav>
  );
}

/** A place in the folded rail: M3E's nav item, icon over label. */
function Place({ icon, label, current, onClick }: {
  icon: ReactNode; label: string; current?: boolean; onClick: () => void;
}) {
  return (
    <M3eNavItem
      selected={!!current}
      orientation="vertical"
      data-nav-item
      onBeforeInput={keepPlace}
      onClick={onClick}
    >
      <span slot="icon" className="inline-flex">{icon}</span>
      {label}
    </M3eNavItem>
  );
}

/**
 * A place in the open sidebar: M3E's navigation drawer item, its pill the
 * sidebar's width, a badge at its end (Zahlungen: "3 fällig").
 */
function MenuPlace({ icon, label, current, onClick, badge }: {
  icon: ReactNode; label: string; current?: boolean; onClick: () => void;
  badge?: string;
}) {
  return (
    <M3eNavMenuItem selected={!!current} aria-current={current ? 'page' : undefined} data-nav-item onClick={onClick}>
      <span slot="icon" className="inline-flex">{icon}</span>
      <span slot="label">{label}</span>
      {badge && <span slot="badge">{badge}</span>}
    </M3eNavMenuItem>
  );
}

/**
 * The month for the place: the days a payment is due marked (Übersicht,
 * Zahlungen), a day picked narrowing the Übersicht's bookings to it; in
 * Analyse the analysis's month as a range, a day picked choosing its month.
 */
function PlaceMonth() {
  const { tab, analysisPeriod, setAnalysisPeriod, txByAccount, txFilter, setTxFilter } = useFints();
  // A day picked is the bookings' own filter (one day, from and to), shared by the ledger and an account's page.
  const pickedDay = txFilter.from && txFilter.from === txFilter.to ? txFilter.from : null;
  const pick = (day: string) => {
    const off = day === pickedDay;
    setTxFilter((f) => ({ ...f, from: off ? '' : day, to: off ? '' : day, acrossAccounts: undefined }));
  };
  const t = useT();
  const { shown } = useLayers();
  const model = useRecurringModel();
  const upcoming = useUpcoming(model, 62);
  const dueDays = useMemo(() => {
    const own = new Set(shown.map((a) => a.accountNumber));
    return new Set(upcoming.filter((u) => own.has(model.accountOf(u.series) ?? '')).map((u) => u.date));
  }, [upcoming, model, shown]);
  // The days the ticked accounts have a booking on (the Übersicht's month).
  const bookingDays = useMemo(() => {
    const out = new Set<string>();
    if (tab !== 'overview') return out;
    for (const a of shown) for (const tx of txByAccount[a.accountNumber] ?? []) out.add(dayKey(tx.entryDate || tx.valueDate));
    return out;
  }, [tab, shown, txByAccount]);
  const today = isoDate(new Date());

  if (tab === 'analysis') {
    // Until the user picks one, Analyse opens on the last complete month.
    const last = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1);
    const fallback = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}`;
    const month = analysisPeriod == null ? fallback : /^\d{4}-\d{2}$/.test(analysisPeriod) ? analysisPeriod : null;
    const range = month ? { from: `${month}-01`, to: isoDate(new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)) } : null;
    return (
      <div className="mt-3">
        <MiniMonth
          label={t.shell.frame.month}
          range={range}
          startAt={range?.from ?? today}
          onSelect={(day) => setAnalysisPeriod(day.slice(0, 7))}
        />
      </div>
    );
  }
  return (
    <div className="mt-3">
      <MiniMonth
        label={t.shell.frame.month}
        dueDays={dueDays}
        bookingDays={bookingDays}
        selected={tab === 'overview' ? pickedDay : null}
        startAt={pickedDay ?? today}
        onSelect={tab === 'overview' ? pick : undefined}
      />
    </div>
  );
}

/**
 * Einstellungen in the sidebar: the way back, its name and its pages
 * (components/settings/Settings.tsx useSettingsPages), listed as the places
 * are — a glyph and a name, the page on the sheet in the secondary container
 * with its glyph filled. A click shows that page.
 */
function SettingsSections() {
  const { leaveSettings, settingsPage, setSettingsPage } = useFints();
  const t = useT();
  const pages = useSettingsPages();
  const current = (pages.find((p) => p.id === settingsPage) ?? pages[0])?.id;

  return (
    <>
      <div className="flex items-center gap-2 pt-1 pr-4 pb-3 pl-3">
        <IconButton size="md" aria-label={t.common.back} onClick={leaveSettings}>
          <BackIcon size={22} />
        </IconButton>
        <span className="truncate text-[22px] leading-7 font-medium">{t.common.nav.settings}</span>
      </div>
      <ul aria-label={t.shell.frame.sections} className="flex flex-col gap-0.5 px-3">
        {pages.map((p) => {
          const on = current === p.id;
          return (
            <li key={p.id}>
              <button
                type="button"
                aria-current={on ? 'page' : undefined}
                onClick={() => setSettingsPage(p.id)}
                className={cx(
                  'row-focus flex h-10 w-full items-center gap-3 rounded-full px-4 text-left text-[14px] leading-5 font-medium transition-colors duration-150',
                  on ? 'bg-[var(--md-secondary-container)] text-[var(--md-on-secondary-container)]' : 'text-ink hover:bg-[var(--md-surface-container)]',
                )}
              >
                {createElement(p.Icon, { size: 22, filled: on, className: cx('shrink-0', !on && 'text-ink-2') })}
                <span className="min-w-0 flex-1 truncate">{p.title}</span>
                {p.alert && <span aria-hidden className="size-2 shrink-0 rounded-full bg-red" />}
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
