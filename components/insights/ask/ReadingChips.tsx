'use client';

// Girovo Next, Girovo AI: "Verstanden als", one quiet line of chips under a
// booking answer that says how Girovo read the question ("Ausgaben · Essen &
// Trinken · August 2026 · nach Ort · nach Betrag"). Each chip is a menu that
// changes its part of the reading in place: the topic (a category, or the name
// looked for taken away), the money's way, the period, the period a comparison
// is set against, and what a ranking orders by. The thread's store keeps the
// changed reading on the turn (ask-thread-store.ts updateTurnQuery) and the
// answer is worked out again from it. Labels and changes: lib/ask-chips.ts.

import { Fragment, useId, type ReactNode } from 'react';
import {
  categoryName, dirChoices, periodChoices, periodLabel, readingChips, samePeriod, sentenceCase, topicChoices,
  withAgainst, withDir, withPeriod, withRank, withTopic, type ChipSlot, type OwnCategories, type ReadingChip,
} from '@/lib/ask-chips';
import { dayKey } from '@/lib/format';
import { useT } from '@/lib/i18n/react';
import type { AskPeriod, AskQuery, AskRank } from '@/lib/nano-ask';
import { FilterChip, Menu, MenuItem, MenuItemRadio, MenuSeparator } from '../../ui';

const RANK_BY: readonly AskRank['by'][] = ['payee', 'category'];
const METRICS: readonly AskRank['metric'][] = ['sum', 'count'];

export function ReadingChips({ query, loaded, own, onChange }: {
  /** The reading the answer was worked out from (the answer's own, so a name that found nothing reads as the category used instead). */
  query: AskQuery;
  /** The days the loaded bookings cover: their months are the period menu's. */
  loaded: { from: string; to: string };
  own: OwnCategories;
  onChange: (query: AskQuery) => void;
}) {
  const words = useT().ask;
  const titleId = useId();
  const today = dayKey(new Date());
  const chips = readingChips(query, today, own);
  return (
    <div role="group" aria-labelledby={titleId} className="mt-3 flex flex-wrap items-center gap-1.5">
      <span id={titleId} className="mr-0.5 text-[12.5px] leading-4 text-ink-2">{words.chips.title}</span>
      {chips.map((chip) => (
        <ChipMenu key={chip.slot} chip={chip} change={words.chips.change[chip.slot]}>
          <SlotItems slot={chip.slot} query={query} loaded={loaded} own={own} today={today} onChange={onChange} />
        </ChipMenu>
      ))}
    </div>
  );
}

/** One chip and the menu it opens; its name says what it changes and what it says now. */
function ChipMenu({ chip, change, children }: { chip: ReadingChip; change: string; children: ReactNode }) {
  const words = useT().ask.chips;
  return (
    <Menu
      label={change}
      minWidth={chip.slot === 'topic' || chip.slot === 'period' || chip.slot === 'against' ? 240 : 200}
      trigger={(p) => (
        <FilterChip {...p} menu aria-label={words.aria(change, chip.label)} className="max-w-full">
          <span className="block max-w-[220px] truncate">{chip.label}</span>
        </FilterChip>
      )}
    >
      {children}
    </Menu>
  );
}

/** A menu's choices for one part of the reading, the one set checked. */
function SlotItems({ slot, query, loaded, own, today, onChange }: {
  slot: ChipSlot;
  query: AskQuery;
  loaded: { from: string; to: string };
  own: OwnCategories;
  today: string;
  onChange: (query: AskQuery) => void;
}) {
  const words = useT().ask;
  if (slot === 'dir') {
    return dirChoices(query).map((dir) => (
      <MenuItemRadio key={dir} checked={query.dir === dir} onSelect={() => onChange(withDir(query, dir))}>{words.dir[dir]}</MenuItemRadio>
    ));
  }
  if (slot === 'topic') {
    return (
      <>
        {query.search && (
          <>
            <MenuItem onSelect={() => onChange(withTopic(query, null))}>{words.chips.removeName(query.search)}</MenuItem>
            <MenuSeparator />
          </>
        )}
        <MenuItemRadio checked={!query.category && !query.search} onSelect={() => onChange(withTopic(query, null))}>
          {sentenceCase(words.chips.allCategories)}
        </MenuItemRadio>
        <MenuSeparator />
        {topicChoices(own).map((id) => (
          <MenuItemRadio key={id} checked={!query.search && query.category === id} onSelect={() => onChange(withTopic(query, id))}>
            {categoryName(id, own)}
          </MenuItemRadio>
        ))}
      </>
    );
  }
  if (slot === 'period' || slot === 'against') {
    const against = slot === 'against';
    const current = against ? query.against : query.period;
    if (!current) return null;
    const choices = periodChoices(current, loaded, today).filter((p) => !against || !samePeriod(p, query.period, today));
    const pick = (p: AskPeriod) => onChange(against ? withAgainst(query, p) : withPeriod(query, p));
    return choices.map((p, i) => (
      <Fragment key={JSON.stringify(p)}>
        <MenuItemRadio checked={samePeriod(p, current, today)} onSelect={() => pick(p)}>
          {sentenceCase(periodLabel(p, today, against))}
        </MenuItemRadio>
        {/* The months of the loaded bookings, apart from the quick choices above them. */}
        {p.kind === 'all' && i < choices.length - 1 && <MenuSeparator />}
      </Fragment>
    ));
  }
  if (slot === 'rankBy') {
    return RANK_BY.map((by) => (
      <MenuItemRadio key={by} checked={query.rank?.by === by} onSelect={() => onChange(withRank(query, { by }))}>
        {sentenceCase(words.chips.rankBy[by])}
      </MenuItemRadio>
    ));
  }
  return METRICS.map((metric) => (
    <MenuItemRadio key={metric} checked={query.rank?.metric === metric} onSelect={() => onChange(withRank(query, { metric }))}>
      {sentenceCase(words.chips.metric[metric])}
    </MenuItemRadio>
  ));
}
