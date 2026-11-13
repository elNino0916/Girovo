'use client';

// Girovo AI's notes without asking (Girovo Next): at most three short things
// that stand out (lib/ask-notes.ts), under the month recap and as the first
// tile of a fresh conversation. Each opens its bookings or its place in the
// app, and each can be closed; a closed note stays away for the session
// (kept with the hidden recaps, forgotten at logout like them). Every amount
// goes through <Money>, so Beträge ausblenden hides it. Nothing at all is
// the normal case: then nothing is drawn.

import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { askNotes, type AskNote } from '@/lib/ask-notes';
import type { CategoryOf } from '@/lib/analytics';
import { categoryLabel, type CategoryId } from '@/lib/categories';
import { dayKey, displayName, fmtIban, fmtMonth } from '@/lib/format';
import { intlLocale } from '@/lib/i18n/locale';
import { useT } from '@/lib/i18n/react';
import { seriesTitle } from '@/lib/recurring';
import { useFints } from '../../FintsProvider';
import { Money } from '../../Money';
import { AiMarkIcon, CloseIcon } from '../../icons';
import { Button, IconButton, cx } from '../../ui';
import type { ScopeData } from '../analysis-model';
import { hiddenRecaps } from '../ask-thread-store';
import { useContractNotices } from '../contract-notices';
import { useRecurringModel } from '../recurring-model';
import { useShowInList } from '../shared';

/** A closed note, among the session's hidden recaps (ask-thread-store.ts): a month there never starts with this. */
const hiddenKey = (key: string) => `note:${key}`;

/** The month that is running: what a fresh conversation's notes are about. */
export const thisMonth = (): string => dayKey(new Date()).slice(0, 7);

/** The notes for `month` over the loaded bookings, without the ones closed this session. */
function useNotes(data: ScopeData | null, categoryOf: CategoryOf | undefined, month: string, closed: number): AskNote[] {
  const model = useRecurringModel();
  const { notices } = useContractNotices();
  const budgets = useFints().vault?.budgets;
  return useMemo(() => {
    if (!data || !categoryOf) return [];
    return askNotes({
      txs: data.txs,
      categoryOf,
      currency: data.currency,
      from: data.from,
      to: data.to,
      month,
      today: dayKey(new Date()),
      series: [...model.income, ...model.expense, ...model.ended, ...model.dismissed],
      live: model.expense,
      noticed: notices.filter((n) => n.kind === 'price').map((n) => n.seriesId),
      dismissed: { has: (key) => hiddenRecaps.has(hiddenKey(key)) },
      budgets,
    });
    // closed: a note closed just now goes, and the next one may take its place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, categoryOf, month, model.income, model.expense, model.ended, model.dismissed, notices, closed, budgets]);
}

/** Two days in a sentence: "3. und 4. November", the month once where both share it. */
function twoDays(a: string, b: string): [string, string | null] {
  const da = new Date(`${a}T12:00:00`);
  const db = new Date(`${b}T12:00:00`);
  const year = da.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' as const };
  const full = (d: Date) => new Intl.DateTimeFormat(intlLocale(), { day: 'numeric', month: 'long', ...year }).format(d);
  if (a === b) return [full(da), null];
  const sameMonth = a.slice(0, 7) === b.slice(0, 7);
  return [sameMonth ? new Intl.DateTimeFormat(intlLocale(), { day: 'numeric' }).format(da) : full(da), full(db)];
}

/** An amount in a note: the app's own, tabular, hidden with Beträge ausblenden. */
function Amount({ cents, currency }: { cents: number; currency: string }) {
  return <span className="tnum font-medium whitespace-nowrap"><Money value={cents / 100} currency={currency} tone="plain" /></span>;
}

/** One note's sentence. */
function NoteText({ note, currency, own }: { note: AskNote; currency: string; own: readonly { id: string; name: string }[] }) {
  const t = useT();
  const words = t.ask.notes;
  const money = (cents: number, cur = currency) => <Amount cents={cents} currency={cur} />;
  let parts: ReactNode[];
  if (note.kind === 'spike') {
    const when = note.month === thisMonth() ? words.thisMonth : words.inMonth(fmtMonth(note.month).split(' ')[0]);
    const nameOf = (id: CategoryId) => own.find((c) => c.id === id)?.name ?? categoryLabel(id);
    const name = note.payee ? displayName(note.payee.name) || t.insights.noName : nameOf(note.category!);
    parts = note.times
      ? [words.times(when, name, note.times, !!note.payee)]
      : words.more(when, name, !!note.payee, money(note.cents), money(note.usualCents));
  } else if (note.kind === 'budget') {
    const nameOf = (id: CategoryId) => own.find((c) => c.id === id)?.name ?? categoryLabel(id);
    const past = note.month < thisMonth();
    parts = note.over
      ? words.budgetOver(past ? words.inMonth(fmtMonth(note.month).split(' ')[0]) : words.thisMonth, nameOf(note.category), money(note.rest), past)
      : words.budgetNear(nameOf(note.category), money(note.rest));
  } else if (note.kind === 'newContract') {
    const s = note.series;
    const per = s.everyDays === 28 ? words.per.fourWeekly : words.per[s.cadence];
    parts = words.newContract(seriesTitle(s) || t.insights.noName, money(note.cents, s.currency), per, s.variable);
  } else {
    const [a, b] = twoDays(note.days[0], note.days[1]);
    parts = words.double(money(note.cents), displayName(note.name) || t.insights.noName, b ? words.twoDays(a, b) : words.oneDay(a));
  }
  return <>{parts.map((p, i) => <span key={i}>{p}</span>)}</>;
}

/**
 * The notes for `month`. `tile`: on its own Girovo tile, as the head of a
 * fresh conversation; otherwise rows inside the tile it stands in (the recap).
 */
export function AskNotes({ data, ctx, own, month, tile = false, onShown }: {
  data: ScopeData | null;
  ctx: { categoryOf?: CategoryOf };
  own: readonly { id: string; name: string }[];
  month: string;
  tile?: boolean;
  onShown?: () => void;
}) {
  const t = useT();
  const words = t.ask.notes;
  const [closed, setClosed] = useState(0);
  const notes = useNotes(data, ctx.categoryOf, month, closed);
  const show = useShowInList();
  const { setTab, setAnalysisPeriod } = useFints();
  if (!data || notes.length === 0) return null;
  const across = data.scope === 'all' ? { acrossAccounts: true } : {};

  const open = (note: AskNote) => {
    if (note.kind === 'newContract') setTab('contracts');
    else if (note.kind === 'budget') {
      // The Analyse on the note's month, where the budget tile measures it.
      setAnalysisPeriod(note.month);
      setTab('analysis');
    } else if (note.kind === 'double') {
      show(note.tx, { dir: 'out', category: null, query: note.iban ? fmtIban(note.iban) : note.name, from: note.days[0], to: note.days[1], ...across });
    } else if (note.payee) {
      // As the Analyse's payee list opens one: by IBAN where it has one, both ways where a refund is netted in.
      show(null, { dir: note.payee.refunds ? 'all' : 'out', category: null, query: note.payee.iban ? fmtIban(note.payee.iban) : note.payee.name, from: note.from, to: note.to, ...across });
    } else show(null, { dir: 'out', category: note.category, query: '', from: note.from, to: note.to, ...across });
    onShown?.();
  };
  const close = (note: AskNote) => {
    hiddenRecaps.add(hiddenKey(note.key));
    setClosed((n) => n + 1);
  };

  const list = (
    <ul aria-label={words.label} className={cx('flex flex-col gap-2', !tile && 'mt-3')}>
      {notes.map((note) => (
        <li key={note.key} className="flex items-start gap-1 rounded-[12px] bg-[color-mix(in_srgb,var(--paper)_72%,transparent)] py-2.5 pr-1 pl-3">
          <div className="min-w-0 flex-1">
            <p className="text-[16px] leading-6 text-ink sm:text-[14px] sm:leading-5 [text-wrap:pretty]">
              <NoteText note={note} currency={data.currency} own={own} />
            </p>
            <Button variant="tertiary" size="sm" className="mt-1" onClick={() => open(note)}>
              {note.kind === 'newContract' ? t.ask.actions.openContracts : note.kind === 'budget' ? words.showBudget : words.show}
            </Button>
          </div>
          <IconButton size="sm" aria-label={words.hide} onClick={() => close(note)}>
            <CloseIcon size={16} />
          </IconButton>
        </li>
      ))}
    </ul>
  );
  if (!tile) return list;
  return (
    <div data-ai className="ask-tile mt-1 rounded-[16px] px-4 pt-3 pb-3.5">
      <span className="sr-only">{t.ask.thread.girovo}</span>
      <AiMarkIcon size={16} className="mb-1.5 block" aria-hidden />
      {list}
    </div>
  );
}
