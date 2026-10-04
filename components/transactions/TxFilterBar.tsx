'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { bookingDay, daysLabel, monthPartNote, type CalendarMonth } from '@/lib/analytics';
import type { TxFilter } from '@/lib/app-types';
import { CATEGORIES, categoryLabel, type CategoryId } from '@/lib/categories';
import type { SerializedTransaction } from '@/lib/fints-types';
import { fmtRange } from '@/lib/format';
import { useFints } from '../FintsProvider';
import { CalendarIcon, CategoryIcon, CloseIcon, SearchIcon } from '../icons';
import {
  FilterChip, IconButton, Input, Kbd, Menu, MenuGroup, MenuItemRadio, MenuSeparator, cx,
} from '../ui';

/** The search field's id — the shell's "/" shortcut focuses it. */
export const TX_SEARCH_ID = 'umsatz-suche';

/** How long typing rests before the filter (and every view reading it) updates. */
const SEARCH_SETTLE_MS = 140;

export function activeFilterCount(f: TxFilter): number {
  return (f.dir !== 'all' ? 1 : 0) + (f.category ? 1 : 0) + (f.query.trim() ? 1 : 0) + (f.from || f.to ? 1 : 0);
}

/** The filter with `patch` applied by the user — which ends a deep link's notes ("all accounts", "another account"). */
const edited = (f: TxFilter, patch: Partial<TxFilter>): TxFilter => ({
  ...f, ...patch, acrossAccounts: undefined, lookup: undefined,
});

/**
 * Search, direction chips, the category menu and the month. The filter itself
 * lives in the provider (`txFilter`) so the palette, the Analyse and the
 * Verträge tab can deep-link into a narrowed list; this only edits it. The
 * way back ("Zurücksetzen") sits with the count above the list, where it is
 * always in view.
 *
 * The month narrows what is loaded and never fetches: loading another period
 * is the Zeitraum control's job, and what it shows as selected is what was
 * fetched.
 *
 * The search box keeps its own draft and hands it over once typing rests:
 * every provider update re-renders the whole dashboard, and doing that per
 * keystroke would make typing feel sticky on a long statement.
 */
export function TxFilterBar({
  filter, setFilter, facetSource, monthSource, months, loaded, categoryOf, listId,
}: {
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
  categoryOf: (tx: SerializedTransaction) => { id: CategoryId };
  /** The list the search controls. */
  listId: string;
}) {
  const { singleKeyShortcuts: singleKeys } = useFints();
  const [draft, setDraft] = useState(filter.query);
  // The query this field last handed to the provider. A provider query that
  // differs from it was set from elsewhere.
  const pushed = useRef(filter.query);
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  const hintId = useId();

  // A query set from elsewhere (a deep link, the palette, "Zurücksetzen")
  // replaces the draft — and wins over typing that has not been handed over yet.
  useEffect(() => {
    if (filter.query === pushed.current) return;
    clearTimeout(settle.current);
    pushed.current = filter.query;
    setDraft(filter.query);
  }, [filter.query]);

  useEffect(() => () => clearTimeout(settle.current), []);

  const commitQuery = useCallback((q: string) => {
    clearTimeout(settle.current);
    pushed.current = q;
    setFilter((f) => (f.query === q ? f : edited(f, { query: q })));
  }, [setFilter]);

  const onType = (q: string) => {
    setDraft(q);
    clearTimeout(settle.current);
    settle.current = setTimeout(() => commitQuery(q), SEARCH_SETTLE_MS);
  };

  const counts = useMemo(() => {
    const m = new Map<CategoryId, number>();
    for (const tx of facetSource) {
      const id = categoryOf(tx).id;
      m.set(id, (m.get(id) ?? 0) + 1);
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
  const menuCategories = CATEGORIES.filter((c) => counts.has(c.id) || c.id === filter.category);
  const newestMonths = useMemo(() => [...months].reverse(), [months]);
  const days = filter.from || filter.to ? daysLabel(filter.from, filter.to) : '';
  const setDir = (dir: TxFilter['dir']) => setFilter((f) => edited(f, { dir }));
  const setDays = (from?: string, to?: string) => setFilter((f) => edited(f, { from, to }));

  return (
    <div className="flex flex-col gap-3">
      <div role="search" className="relative">
        <Input
          ref={inputRef}
          id={TX_SEARCH_ID}
          type="search"
          value={draft}
          onChange={(e) => onType(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && draft) {
              e.preventDefault();
              e.stopPropagation();
              setDraft('');
              commitQuery('');
            } else if (e.key === 'Enter') {
              commitQuery(draft);
            }
          }}
          placeholder="Name, Zweck, Kategorie, Betrag, Monat"
          aria-label="Umsätze durchsuchen"
          aria-describedby={hintId}
          aria-controls={listId}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
          leading={<SearchIcon size={18} />}
          trailing={
            draft ? (
              <IconButton
                aria-label="Suche leeren"
                onClick={() => {
                  setDraft('');
                  commitQuery('');
                  inputRef.current?.focus();
                }}
              >
                <CloseIcon size={16} />
              </IconButton>
            ) : singleKeys ? (
              // Says where the "/" shortcut goes; a keyboard hint, so only
              // where there is likely a keyboard — and only while single-key
              // shortcuts are on.
              <span aria-hidden className="pointer-events-none mr-2 hidden desk:inline-flex">
                <Kbd>/</Kbd>
              </span>
            ) : undefined
          }
          className="[&::-webkit-search-cancel-button]:hidden"
        />
        <p id={hintId} className="sr-only">
          Sucht im Namen, Verwendungszweck, in der Kategorie und IBAN. Beträge wie 12,99, über 100 als &gt;100, von 50 bis
          100 als 50-100, ein Tag wie 28.09. und ein Monat wie August.
        </p>
      </div>

      {/* One scrolling row on a phone rather than a wrap: the chips keep their
          order and the list starts at the same height whatever is selected.
          The vertical padding is room for the focus ring, which a scroller
          would otherwise clip. */}
      <div className="-mx-4 -my-1 flex items-center gap-2 overflow-x-auto px-4 py-1 [scrollbar-width:none] sm:-mx-5 sm:px-5">
        <div role="group" aria-label="Richtung" className="flex shrink-0 gap-2">
          <FilterChip selected={filter.dir === 'all'} onClick={() => setDir('all')}>Alle</FilterChip>
          <FilterChip selected={filter.dir === 'in'} onClick={() => setDir('in')}>Eingänge</FilterChip>
          <FilterChip selected={filter.dir === 'out'} onClick={() => setDir('out')}>Ausgänge</FilterChip>
        </div>
        <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-line" />
        <Menu
          label="Kategorie"
          minWidth={280}
          trigger={(p) => (
            <FilterChip
              {...p}
              menu
              selected={!!filter.category}
              icon={filter.category ? <CategoryIcon id={filter.category} size={16} /> : undefined}
              aria-label={filter.category ? `Kategorie: ${categoryLabel(filter.category)}` : 'Kategorie wählen'}
              className="shrink-0"
            >
              {filter.category ? categoryLabel(filter.category) : 'Kategorie'}
            </FilterChip>
          )}
        >
          <MenuItemRadio checked={!filter.category} onSelect={() => setFilter((f) => edited(f, { category: null }))}>
            Alle Kategorien
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
            label="Monat"
            minWidth={264}
            trigger={(p) => (
              <FilterChip
                {...p}
                menu
                selected={!!days}
                icon={<CalendarIcon size={16} />}
                aria-label={days ? `Zeitraum der Liste: ${days}` : 'Monat wählen'}
                className={cx(days && 'rounded-r-none border-r-0 pr-2')}
              >
                {days || 'Monat'}
              </FilterChip>
            )}
          >
            <MenuItemRadio
              checked={!days}
              description={loaded ? fmtRange(loaded.from, loaded.to) : undefined}
              onSelect={() => setDays(undefined, undefined)}
            >
              Ganzer geladener Zeitraum
            </MenuItemRadio>
            {newestMonths.length > 0 && <MenuSeparator />}
            <MenuGroup label="Monat im geladenen Zeitraum">
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
            <button
              type="button"
              aria-label={`${days} entfernen`}
              title={`${days} entfernen`}
              onClick={() => setDays(undefined, undefined)}
              className="grid h-9 w-8 shrink-0 place-items-center rounded-r-[var(--radius-chip)] border border-l-0 border-accent bg-accent-soft text-accent transition-colors duration-150 hover:bg-[color-mix(in_srgb,var(--accent)_18%,transparent)]"
            >
              <CloseIcon size={14} />
            </button>
          )}
        </span>
      </div>
    </div>
  );
}
