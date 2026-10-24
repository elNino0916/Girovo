'use client';

import { useMemo } from 'react';
import { bookingDay, daysLabel, monthPartNote, type CalendarMonth } from '@/lib/analytics';
import type { TxFilter } from '@/lib/app-types';
import { allCategories, categoryLabel, type CategoryId } from '@/lib/categories';
import type { SerializedTransaction } from '@/lib/fints-types';
import { fmtRange } from '@/lib/format';
import { useT } from '@/lib/i18n/react';
import { useFints } from '../FintsProvider';
import { CalendarIcon, CategoryIcon, CloseIcon, SearchIcon } from '../icons';
import { FilterChip, IconButton, Menu, MenuGroup, MenuItemRadio, MenuSeparator } from '../ui';

export function activeFilterCount(f: TxFilter): number {
  return (f.dir !== 'all' ? 1 : 0) + (f.category ? 1 : 0) + (f.query.trim() ? 1 : 0) + (f.from || f.to ? 1 : 0);
}

/** The filter with `patch` applied by the user — which ends a deep link's notes ("all accounts", "another account"). */
const edited = (f: TxFilter, patch: Partial<TxFilter>): TxFilter => ({
  ...f, ...patch, acrossAccounts: undefined, lookup: undefined,
});

/**
 * The chips over the Umsätze: direction, the category menu and the month,
 * one row that scrolls sideways. The filter itself lives in the provider
 * (`txFilter`) so the search, the Analyse and the Verträge tab can deep-link
 * into a narrowed list; this only edits it. The way back ("Zurücksetzen")
 * sits with the count above the list, where it is always in view.
 *
 * There is no search field here: the search is the Übersicht's head (the
 * search bar, then the search view, components/CommandPalette.tsx) — the
 * phone's first, every width's since the desktop followed it (2026-10-24).
 * A search handed over from there shows as a chip that takes it away again.
 *
 * The month narrows what is loaded and never fetches: loading another period
 * is the Zeitraum control's job, and what it shows as selected is what was
 * fetched.
 */
export function TxFilterBar({
  filter, setFilter, facetSource, monthSource, months, loaded, categoryOf, leading, trailing,
}: {
  /** Before the chips (Vorgemerkt). */
  leading?: React.ReactNode;
  /** After them (the period, the refresh, the export). */
  trailing?: React.ReactNode;
  filter: TxFilter;
  setFilter: (f: TxFilter | ((f: TxFilter) => TxFilter)) => void;
  /** The loaded bookings narrowed by everything except the category — for the menu's counts. */
  facetSource: readonly SerializedTransaction[];
  /** The loaded bookings narrowed by everything except the days — for the month menu's counts. */
  monthSource: readonly SerializedTransaction[];
  /** The calendar months of the loaded range, oldest first. */
  months: readonly CalendarMonth[];
  /** The loaded range, for "Ganzer geladener Zeitraum". */
  loaded: { from: string; to: string } | undefined;
  categoryOf: (tx: SerializedTransaction) => { id: CategoryId; parts?: readonly { id: CategoryId }[] };
}) {
  const { setPaletteOpen } = useFints();
  const t = useT();
  const words = t.transactions.filter;
  const clearQuery = () => setFilter((f) => edited(f, { query: '' }));

  const counts = useMemo(() => {
    const m = new Map<CategoryId, number>();
    for (const tx of facetSource) {
      // A split booking is found under each of its categories (lib/analytics.ts filterTransactions).
      const r = categoryOf(tx);
      for (const id of r.parts?.length ? r.parts.map((p) => p.id) : [r.id]) m.set(id, (m.get(id) ?? 0) + 1);
    }
    return m;
  }, [facetSource, categoryOf]);

  const monthCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const tx of monthSource) {
      const month = bookingDay(tx).slice(0, 7);
      m.set(month, (m.get(month) ?? 0) + 1);
    }
    return m;
  }, [monthSource]);

  // Only categories that occur (plus the selected one, so it can be seen and
  // unselected) — a menu of sixteen where twelve lead nowhere is a chore.
  const menuCategories = allCategories().filter((c) => counts.has(c.id) || c.id === filter.category);
  const newestMonths = useMemo(() => [...months].reverse(), [months]);
  const days = filter.from || filter.to ? daysLabel(filter.from, filter.to) : '';
  const setDir = (dir: TxFilter['dir']) => setFilter((f) => edited(f, { dir }));
  const setDays = (from?: string, to?: string) => setFilter((f) => edited(f, { from, to }));

  return (
    <div className="flex flex-col gap-3">
      {/* One scrolling row on a phone rather than a wrap: the chips keep their
          order and the list starts at the same height whatever is selected.
          The vertical padding is room for the focus ring, which a scroller
          would otherwise clip. A wide window wraps instead: a mouse has no
          sideways swipe, and a scrollbar-less row would hide its end. */}
      <div className="-mx-4 -my-1 flex items-center gap-2 overflow-x-auto px-4 py-1 [scrollbar-width:none] sm:-mx-5 sm:flex-wrap sm:overflow-x-visible sm:px-5">
        {leading}
        {/* A search handed over from the search view: shown, and taken away in one press. */}
        {filter.query.trim() && (
          <span className="inline-flex shrink-0 items-center">
            <FilterChip selected icon={<SearchIcon size={16} />} aria-label={words.searchLabel} onClick={() => setPaletteOpen(true)}>
              „{filter.query.trim()}“
            </FilterChip>
            <IconButton aria-label={words.clear} onClick={clearQuery}>
              <CloseIcon size={16} />
            </IconButton>
          </span>
        )}
        {/* In or out, each a toggle: pressed again, the list is whole again. */}
        <div role="group" aria-label={words.direction} className="flex shrink-0 gap-2">
          <FilterChip selected={filter.dir === 'in'} onClick={() => setDir(filter.dir === 'in' ? 'all' : 'in')}>{t.common.booking.incoming}</FilterChip>
          <FilterChip selected={filter.dir === 'out'} onClick={() => setDir(filter.dir === 'out' ? 'all' : 'out')}>{t.common.booking.outgoing}</FilterChip>
        </div>
        <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-line" />
        <Menu
          label={t.transactions.category}
          minWidth={280}
          trigger={(p) => (
            <FilterChip
              {...p}
              menu
              selected={!!filter.category}
              icon={filter.category ? <CategoryIcon id={filter.category} size={16} /> : undefined}
              aria-label={filter.category ? words.categoryIs(categoryLabel(filter.category)) : t.transactions.chooseCategory}
              className="shrink-0"
            >
              {filter.category ? categoryLabel(filter.category) : t.transactions.category}
            </FilterChip>
          )}
        >
          <MenuItemRadio checked={!filter.category} onSelect={() => setFilter((f) => edited(f, { category: null }))}>
            {words.allCategories}
          </MenuItemRadio>
          <MenuSeparator />
          <MenuGroup>
            {menuCategories.map((c) => (
              <MenuItemRadio
                key={c.id}
                checked={filter.category === c.id}
                icon={<CategoryIcon id={c.id} />}
                onSelect={() => setFilter((f) => edited(f, { category: c.id }))}
              >
                <span className="flex items-baseline justify-between gap-3">
                  <span>{c.label}</span>
                  <span className="tnum text-[13px] text-ink-3">{counts.get(c.id) ?? 0}</span>
                </span>
              </MenuItemRadio>
            ))}
          </MenuGroup>
        </Menu>

        {/* The month: a view of what is loaded. Removable in one press when set. */}
        <span className="inline-flex shrink-0 items-center">
          <Menu
            label={words.month}
            minWidth={264}
            trigger={(p) => (
              <FilterChip
                {...p}
                menu
                selected={!!days}
                icon={<CalendarIcon size={16} />}
                aria-label={days ? words.daysAre(days) : words.chooseMonth}
              >
                {days || words.month}
              </FilterChip>
            )}
          >
            <MenuItemRadio
              checked={!days}
              description={loaded ? fmtRange(loaded.from, loaded.to) : undefined}
              onSelect={() => setDays(undefined, undefined)}
            >
              {words.wholePeriod}
            </MenuItemRadio>
            {newestMonths.length > 0 && <MenuSeparator />}
            <MenuGroup label={words.monthsInPeriod}>
              {newestMonths.map((m) => {
                const n = monthCounts.get(m.month) ?? 0;
                return (
                  <MenuItemRadio
                    key={m.month}
                    checked={filter.from === m.from && filter.to === m.to}
                    description={monthPartNote(m.from, m.to) || undefined}
                    onSelect={() => setDays(m.from, m.to)}
                  >
                    <span className="flex items-baseline justify-between gap-3">
                      <span>{m.title}</span>
                      <span className="tnum text-[13px] text-ink-3">{n}</span>
                    </span>
                  </MenuItemRadio>
                );
              })}
            </MenuGroup>
          </Menu>
          {days && (
            <IconButton aria-label={words.remove(days)} onClick={() => setDays(undefined, undefined)}>
              <CloseIcon size={16} />
            </IconButton>
          )}
        </span>
        {trailing && (
          <>
            <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-line" />
            {trailing}
          </>
        )}
      </div>
    </div>
  );
}
