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
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { DashboardTab } from '@/lib/app-types';
import { dayKey, isoDate } from '@/lib/format';
import { useT } from '@/lib/i18n/react';
import { useFints } from '../FintsProvider';
import { useRecurringModel, useUpcoming } from '../insights/recurring-model';
import { AccountLayers } from '../overview/AccountLayers';
import { useLayers } from '../overview/layers';
import { BackIcon, ChartIcon, GearIcon, HomeIcon, TransferIcon } from '../icons';
import { IconButton, cx } from '../ui';
import type { ShellActions } from './actions';
import { MiniMonth } from './MiniMonth';

/** Which place is current is the app's to say: M3E would select an item on its own click. */
const keepPlace = (e: Event) => e.preventDefault();

export function Sidebar({ open, actions, onPickDay, pickedDay }: {
  open: boolean;
  actions: ShellActions;
  /** The Übersicht's day filter (components/overview/Ledger.tsx), set from the month. */
  onPickDay: (day: string | null) => void;
  pickedDay: string | null;
}) {
  const { tab, setTab, openSettings, closeAccount, closeOrders } = useFints();
  const t = useT();
  const go = (place: DashboardTab) => () => {
    if (place === 'overview' && tab === 'overview') closeAccount();
    if (place === 'contracts' && tab === 'contracts') closeOrders();
    setTab(place);
  };
  const orientation = open ? 'horizontal' : 'vertical';
  const settings = tab === 'settings' && open;

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
              className={cx('mb-4 shrink-0 self-start', open ? 'ml-4' : 'ml-3')}
            >
              <TransferIcon size={24} strokeWidth={2} />
              {open && <span slot="label">{t.shell.transfer}</span>}
            </M3eFab>
          )}
          <div className={cx('flex flex-col', open ? 'gap-0.5 px-3' : 'gap-3')}>
            <Place orientation={orientation} icon={<HomeIcon size={24} filled={tab === 'overview'} />} label={t.common.nav.overview} current={tab === 'overview'} onClick={go('overview')} />
            <Place orientation={orientation} icon={<TransferIcon size={24} filled={tab === 'contracts'} />} label={t.shell.bottomBar.contracts} current={tab === 'contracts'} onClick={go('contracts')} />
            <Place orientation={orientation} icon={<ChartIcon size={24} filled={tab === 'analysis'} />} label={t.common.nav.analysis} current={tab === 'analysis'} onClick={go('analysis')} />
          </div>
          {open && <PlaceMonth onPickDay={onPickDay} pickedDay={pickedDay} />}
          {open && <AccountLayers />}
        </>
      )}
      <div className={cx('mt-auto flex flex-col pt-3', open ? 'px-3' : '')}>
        <Place orientation={orientation} icon={<GearIcon size={24} />} label={t.common.nav.settings} current={tab === 'settings'} onClick={() => openSettings()} />
      </div>
    </nav>
  );
}

function Place({ icon, label, current, onClick, orientation }: {
  icon: ReactNode; label: string; current?: boolean; onClick: () => void; orientation: 'horizontal' | 'vertical';
}) {
  return (
    <M3eNavItem
      selected={!!current}
      orientation={orientation}
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
 * The month for the place: the days a payment is due marked (Übersicht,
 * Zahlungen), a day picked narrowing the Übersicht's bookings to it; in
 * Analyse the analysis's month as a range, a day picked choosing its month.
 */
function PlaceMonth({ onPickDay, pickedDay }: { onPickDay: (day: string | null) => void; pickedDay: string | null }) {
  const { tab, analysisPeriod, setAnalysisPeriod, txByAccount } = useFints();
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
        onSelect={tab === 'overview' ? (day) => onPickDay(day === pickedDay ? null : day) : undefined}
      />
    </div>
  );
}

/**
 * Einstellungen in the sidebar: the way back, its name and its sections —
 * read from the page (each SettingsGroup marks itself), a click bringing a
 * section into view, the one in view marked.
 */
function SettingsSections() {
  const { leaveSettings } = useFints();
  const t = useT();
  const [sections, setSections] = useState<{ key: string; title: string }[]>([]);
  const [current, setCurrent] = useState<string | null>(null);

  useEffect(() => {
    const main = document.getElementById('main');
    const scroller = document.querySelector<HTMLElement>('[data-scroll-root]');
    if (!main) return;
    const all = () => [...main.querySelectorAll<HTMLElement>('[data-settings-section]')];
    let sig = '';
    const read = () => {
      const list = all().map((el) => ({ key: el.getAttribute('aria-labelledby') ?? '', title: el.dataset.settingsSection ?? '' }));
      const next = list.map((s) => s.title).join('|');
      if (next !== sig) {
        sig = next;
        setSections(list);
      }
    };
    const mark = () => {
      const top = (scroller?.getBoundingClientRect().top ?? 0) + 96;
      let on: string | null = null;
      for (const el of all()) if (el.getBoundingClientRect().top <= top) on = el.getAttribute('aria-labelledby');
      setCurrent(on ?? all()[0]?.getAttribute('aria-labelledby') ?? null);
    };
    read();
    mark();
    const mo = new MutationObserver(read);
    mo.observe(main, { childList: true, subtree: true });
    scroller?.addEventListener('scroll', mark, { passive: true });
    return () => {
      mo.disconnect();
      scroller?.removeEventListener('scroll', mark);
    };
  }, []);

  const show = (key: string) => {
    const el = document.querySelector<HTMLElement>(`[data-settings-section][aria-labelledby="${CSS.escape(key)}"]`);
    el?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    setCurrent(key);
  };

  return (
    <>
      <div className="flex items-center gap-2 pt-1 pr-4 pb-3 pl-3">
        <IconButton size="md" aria-label={t.common.back} onClick={leaveSettings}>
          <BackIcon size={22} />
        </IconButton>
        <span className="truncate text-[22px] leading-7 font-medium">{t.common.nav.settings}</span>
      </div>
      <ul aria-label={t.shell.frame.sections} className="flex flex-col gap-0.5 px-3">
        {sections.map((s) => (
          <li key={s.key}>
            <button
              type="button"
              aria-current={current === s.key ? 'location' : undefined}
              onClick={() => show(s.key)}
              className={cx(
                'row-focus flex h-10 w-full items-center rounded-full px-4 text-left text-[14px] leading-5 font-medium transition-colors duration-150',
                current === s.key ? 'bg-[var(--md-secondary-container)] text-[var(--md-on-secondary-container)]' : 'text-ink hover:bg-[var(--md-surface-container)]',
              )}
            >
              <span className="truncate">{s.title}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
