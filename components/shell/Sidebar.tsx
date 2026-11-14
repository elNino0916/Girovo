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
import { createElement, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { DashboardTab } from '@/lib/app-types';
import { dayKey, isoDate } from '@/lib/format';
import { useLocale, useT } from '@/lib/i18n/react';
import { scoreEntry } from '@/lib/palette';
import { PAGE_CLUSTERS, PAGE_OF, type SettingsPage } from '@/lib/settings-pages';
import { useFints } from '../FintsProvider';
import { useRecurringModel, useUpcoming } from '../insights/recurring-model';
import { AccountLayers } from '../overview/AccountLayers';
import { ArrangeSheet } from '../overview/ArrangeSheet';
import { useLayers } from '../overview/layers';
import { useSettingsPages, type PageEntry } from '../settings/Settings';
import { findWords, useSettingFinds } from '../settings/finds';
import { BackIcon, ChartIcon, CloseIcon, GearIcon, HistoryIcon, HomeIcon, SearchIcon, TransferIcon, TrashIcon } from '../icons';
import { IconButton, cx } from '../ui';
import type { ShellActions } from './actions';
import { PLACE_ROOT_EVENT } from './frame';
import { MiniMonth } from './MiniMonth';
import { useCanAsk } from '../insights/ask-gate';
import { deleteConversation, showConversation, useAskThread } from '../insights/ask-thread-store';

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
  const settings = tab === 'settings';
  // "Konten anordnen" is opened from the account list, which is only here while the sidebar is open: kept
  // here, so the sheet stays when the window narrows and the sidebar folds under it.
  const [arranging, setArranging] = useState(false);
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
        <SettingsSections open={open} />
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
          {open && <AccountLayers onArrange={() => setArranging(true)} />}
          {open && <Conversations />}
        </>
      )}
      {settings ? null : open ? (
        // On Einstellungen the sidebar's head says where you are and leads back: no Einstellungen at its foot.
        <M3eNavMenu className="mt-auto block pt-3">
          <MenuPlace icon={<GearIcon size={24} />} label={t.common.nav.settings} current={false} onClick={() => openSettings()} />
        </M3eNavMenu>
      ) : (
        <div className="mt-auto flex flex-col pt-3">
          <Place icon={<GearIcon size={24} />} label={t.common.nav.settings} onClick={() => openSettings()} />
        </div>
      )}
      {arranging && <ArrangeSheet flat onClose={() => setArranging(false)} />}
    </nav>
  );
}

/** A place in the folded rail: M3E's nav item, icon over label; `title`, a longer name as its tooltip. */
function Place({ icon, label, current, onClick, title }: {
  icon: ReactNode; label: string; current?: boolean; onClick: () => void; title?: string;
}) {
  return (
    <M3eNavItem
      selected={!!current}
      orientation="vertical"
      data-nav-item
      title={title}
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
 * Einstellungen in the sidebar (owner's pick B, 2026-11-14,
 * .impeccable/mocks/decision/settings-nav/): the way back and its name, a
 * search over Einstellungen alone, then its pages
 * (components/settings/Settings.tsx useSettingsPages) in the clusters a phone
 * draws apart, each a block of rows on the sheet's tone. A row is a disc with
 * the page's glyph, its name and one line of what is on it, as the phone's
 * list; the page on the sheet in the primary container, its disc in the
 * primary. Girovo AI's and Girovo API's marks keep their colours on a tinted
 * disc. While something is typed the blocks give way to what it finds: pages
 * and single settings (components/settings/finds.tsx), a setting opened on its
 * page with its control focused.
 */
function SettingsSections({ open }: { open: boolean }) {
  const { leaveSettings, settingsPage, setSettingsPage, openSettings } = useFints();
  const t = useT();
  const { locale } = useLocale();
  const pages = useSettingsPages();
  const finds = useSettingFinds();
  const current = (pages.find((p) => p.id === settingsPage) ?? pages[0])?.id;
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo<SideResult[]>(() => {
    const q = query.trim();
    if (!q) return [];
    const scored: (SideResult & { score: number })[] = [];
    for (const p of pages) {
      const score = scoreEntry({ label: p.title, keywords: [p.short, p.summary] }, q);
      if (score > 0) scored.push({ key: `page-${p.id}`, score, title: p.title, summary: p.summary, page: p, run: () => setSettingsPage(p.id) });
    }
    for (const f of finds) {
      const page = pages.find((p) => p.id === PAGE_OF[f.target]);
      if (!page) continue;
      const entry = findWords(t, locale, f.name, f.words);
      const score = scoreEntry(entry, q);
      if (score > 0) scored.push({ key: `setting-${f.target}`, score, title: entry.label, summary: page.title, glyph: f.icon, run: () => openSettings(f.target) });
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, 8);
  }, [query, pages, finds, t, locale, setSettingsPage, openSettings]);

  // Folded, the rail: the way back, then each page as a rail item, its glyph
  // over a word, its full name as the tooltip.
  if (!open) {
    return (
      <div className="flex flex-col gap-3">
        <IconButton size="md" aria-label={t.common.back} title={t.common.back} onClick={leaveSettings} className="self-center">
          <BackIcon size={22} />
        </IconButton>
        {pages.map((p) => (
          <Place
            key={p.id}
            icon={(
              <span className="relative inline-flex">
                {createElement(p.Icon, MARK_DISC[p.id] ? { size: 24 } : { size: 24, filled: current === p.id })}
                {p.alert && <span aria-hidden className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-red" />}
              </span>
            )}
            label={p.short}
            title={p.alert ? `${p.title} – ${t.session.vaultUnreadable}` : p.title}
            current={current === p.id}
            onClick={() => setSettingsPage(p.id)}
          />
        ))}
      </div>
    );
  }

  const choose = (r: SideResult) => {
    setQuery('');
    r.run();
  };
  const clusters = PAGE_CLUSTERS
    .map((ids) => pages.filter((p) => ids.includes(p.id)))
    .filter((c) => c.length);
  const searching = query.trim() !== '';

  return (
    <div className="flex flex-col px-4">
      <div className="-ml-1.5 flex items-center gap-2 pt-1 pb-2">
        <IconButton size="md" aria-label={t.common.back} onClick={leaveSettings}>
          <BackIcon size={22} />
        </IconButton>
        <span className="truncate text-[22px] leading-7 font-medium">{t.common.nav.settings}</span>
      </div>
      <div
        className="mb-3.5 flex h-10 shrink-0 items-center gap-2.5 rounded-full bg-[var(--md-surface-container-high)] pr-1 pl-3.5 text-ink-2 transition-colors duration-150 hover:bg-[var(--md-surface-container-highest)]"
        onMouseDown={(e) => {
          // A press beside the text (the glyph, the padding) still means the field.
          if (e.target !== inputRef.current && !(e.target as HTMLElement).closest('button')) {
            e.preventDefault();
            inputRef.current?.focus();
          }
        }}
      >
        <SearchIcon size={20} className="shrink-0" />
        <input
          ref={inputRef}
          type="search"
          data-bare
          value={query}
          aria-label={t.settings.sideSearch.placeholder}
          placeholder={t.settings.sideSearch.placeholder}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && results[0]) {
              e.preventDefault();
              choose(results[0]);
            } else if (e.key === 'Escape' && query) {
              // Esc empties the field first; only an empty field lets it go on.
              e.preventDefault();
              e.stopPropagation();
              setQuery('');
            }
          }}
          className="h-full min-w-0 flex-1 bg-transparent text-[14px] leading-5 text-ink outline-none placeholder:text-ink-2 [&::-webkit-search-cancel-button]:hidden"
        />
        {query && (
          <IconButton size="sm" aria-label={t.settings.sideSearch.clear} onClick={() => { setQuery(''); inputRef.current?.focus(); }}>
            <CloseIcon size={18} />
          </IconButton>
        )}
      </div>
      {searching ? (
        results.length ? (
          <ul aria-label={t.settings.sideSearch.results} className="flex flex-col gap-0.5 overflow-hidden rounded-[16px]">
            {results.map((r) => (
              <li key={r.key}>
                <SideRow page={r.page} glyph={r.glyph} title={r.title} summary={r.summary} onClick={() => choose(r)} />
              </li>
            ))}
          </ul>
        ) : (
          <p role="status" className="px-1 text-[14px] leading-5 text-ink-2">{t.settings.sideSearch.none}</p>
        )
      ) : (
        <div role="group" aria-label={t.shell.frame.sections} className="flex flex-col gap-2.5">
          {clusters.map((cluster) => (
            <ul key={cluster[0].id} className="flex flex-col gap-0.5 overflow-hidden rounded-[16px]">
              {cluster.map((p) => (
                <li key={p.id}>
                  <SideRow
                    page={p}
                    title={p.title}
                    summary={p.summary}
                    on={current === p.id}
                    alert={p.alert ? t.session.vaultUnreadable : undefined}
                    onClick={() => setSettingsPage(p.id)}
                  />
                </li>
              ))}
            </ul>
          ))}
        </div>
      )}
    </div>
  );
}

/** What the sidebar's search found: a page, or one setting on its page. */
type SideResult = {
  key: string;
  title: string;
  summary: string;
  page?: PageEntry;
  glyph?: (p: { size?: number; className?: string }) => ReactNode;
  run: () => void;
};

/** Girovo AI's and Girovo API's marks keep their colour, on a disc of it. */
const MARK_DISC: Partial<Record<SettingsPage, string>> = {
  ask: 'bg-[color-mix(in_srgb,var(--ai-mark)_18%,transparent)]',
  api: 'bg-[color-mix(in_srgb,var(--api-mark)_18%,transparent)]',
};

/** A row of Einstellungen in the sidebar: a disc with the glyph, the name, one line under it. */
function SideRow({ page, glyph, title, summary, on, alert, onClick }: {
  page?: PageEntry;
  glyph?: SideResult['glyph'];
  title: string;
  summary: string;
  on?: boolean;
  /** Something on the page needs a look: said after its name. */
  alert?: string;
  onClick: () => void;
}) {
  const mark = page ? MARK_DISC[page.id] : undefined;
  const ink = on ? 'text-[var(--md-on-primary)]' : 'text-ink-2';
  return (
    <button
      type="button"
      aria-current={on ? 'page' : undefined}
      onClick={onClick}
      className={cx(
        'row-focus flex h-14 w-full items-center gap-3 px-3 text-left transition-colors duration-150',
        on
          ? 'bg-[var(--md-primary-container)] text-[var(--md-on-primary-container)]'
          : 'bg-[var(--frame-sheet)] text-ink hover:bg-[color-mix(in_srgb,var(--md-on-surface)_6%,var(--frame-sheet))]',
      )}
    >
      <span
        className={cx(
          'grid size-9 shrink-0 place-items-center rounded-full',
          mark ?? (on ? 'bg-[var(--md-primary)]' : 'bg-[var(--md-surface-container-high)]'),
        )}
      >
        {page
          // The marks are pictures with no filled form: only the glyphs take one.
          ? createElement(page.Icon, mark ? { size: 20 } : { size: 20, filled: on, className: ink })
          : glyph?.({ size: 20, className: 'text-ink-2' })}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[14px] leading-5 font-medium">{title}</span>
        <span className={cx('truncate text-[12px] leading-4', on ? 'text-[var(--md-on-primary-container)]' : 'text-ink-2')}>{summary}</span>
      </span>
      {alert && (
        <>
          <span aria-hidden className="size-2 shrink-0 rounded-full bg-red" />
          <span className="sr-only">{`, ${alert}`}</span>
        </>
      )}
    </button>
  );
}

/** Girovo Next: this session's conversations (components/insights/AskThread.tsx), newest first; a press shows one in the panel. */
function Conversations() {
  const t = useT();
  const s = useAskThread();
  const canAsk = useCanAsk();
  if (!canAsk || s.conversations.length === 0) return null;
  return (
    <section aria-label={t.ask.thread.conversations} className="pt-5">
      <h2 className="px-7 pb-1.5 text-[14px] leading-5 font-medium text-ink-2">{t.ask.thread.conversations}</h2>
      <ul className="flex flex-col gap-0.5 px-3">
        {s.conversations.slice(0, 5).map((c) => {
          const on = s.open && s.current === c.id;
          return (
            <li key={c.id} className="group relative">
              <button
                type="button"
                aria-current={on ? 'true' : undefined}
                onClick={() => showConversation(c.id)}
                className={cx(
                  'row-focus flex h-10 w-full items-center gap-3 rounded-full pr-11 pl-4 text-left text-[14px] leading-5 font-medium transition-colors duration-150',
                  on ? 'bg-[var(--md-secondary-container)] text-[var(--md-on-secondary-container)]' : 'text-ink hover:bg-[var(--md-surface-container)]',
                )}
              >
                <HistoryIcon size={20} className={cx('shrink-0', !on && 'text-ink-2')} />
                <span className="min-w-0 flex-1 truncate">{c.title}</span>
              </button>
              {/* Its own way out, shown with the row's hover or focus (and always to a keyboard). */}
              <span className="absolute top-1/2 right-1 -translate-y-1/2 opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100">
                <IconButton size="sm" aria-label={`${t.ask.thread.deleteConversation}: ${c.title}`} onClick={() => deleteConversation(c.id)}>
                  <TrashIcon size={16} />
                </IconButton>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
