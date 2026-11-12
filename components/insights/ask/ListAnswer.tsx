'use client';

// Girovo Next, Girovo AI: answers that are lists (components/insights/AskThread.tsx AnswerText).
//
// A ranking ("In welchen Restaurants war ich im August?", "Wofür geb ich am
// meisten aus?") is one line, how many and the first, over every place or
// category as a row: its name, how often, how much. A row opens its bookings
// in the Umsätze list. Eight show at first, "Alle N zeigen" opens the rest in
// place. A list ("Zeig alle Zahlungen an Amazon") is one line over the newest
// bookings; a row opens that booking. Every amount is <Money>, so "Beträge
// ausblenden" hides it. What is said and how many rows show: lib/ask-list.ts.

import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { bookingDay } from '@/lib/analytics';
import { listWords, rankShown, rankWords, RANK_SHOWN } from '@/lib/ask-list';
import { counterpartyName, type CategoryId } from '@/lib/categories';
import type { SerializedTransaction } from '@/lib/fints-types';
import { intlLocale } from '@/lib/i18n/locale';
import { useT } from '@/lib/i18n/react';
import type { AskAnswer } from '@/lib/nano-ask';
import { Money } from '../../Money';
import { txText } from '../../transactions/model';
import { Button, cx } from '../../ui';

type Filter = AskAnswer['filter'];

const ROWS = '-mx-2 flex flex-col rounded-[12px] bg-[color-mix(in_srgb,var(--paper)_72%,transparent)] py-1';
const ROW = 'flex min-h-11 w-full items-center gap-3 rounded-[12px] px-3 text-left';

/** A ranking's line: "Im August warst du in 6 Restaurants, am häufigsten bei Pinos Pizza." */
export function RankLine({ answer, when, nameOf }: { answer: AskAnswer; when: string | null; nameOf: (id: CategoryId) => string }) {
  const words = useT().ask.list.rank;
  const rows = answer.rank ?? [];
  const first = rows[0];
  if (!first) return null;
  const name = first.category ? nameOf(first.category) : first.name ?? '';
  return <>{words[rankWords(answer.query)](when, rows.length, name, answer.query.rank?.metric === 'count')}</>;
}

/** Every place or category of a ranking, a row each; a press opens its bookings. */
export function RankRows({ answer, nameOf, onOpen }: {
  answer: AskAnswer;
  nameOf: (id: CategoryId) => string;
  onOpen: (filter: Filter) => void;
}) {
  const t = useT().ask;
  const [open, setOpen] = useState(false);
  const all = answer.rank ?? [];
  const { rows } = rankShown(all, open);
  if (!all.length) return null;
  // A long ranking only: opened, it offers to fold again.
  const foldable = rankShown(all, false).hidden > 0;
  return (
    <>
      <ul className={cx(ROWS, 'mt-3')}>
        {rows.map((row, i) => (
          // The rows a press reveals come in from the first again, not after the ones before them.
          <li key={row.key} className="ask-word" style={{ '--i': i % RANK_SHOWN } as CSSProperties}>
            <button type="button" className={ROW} onClick={() => onOpen(row.filter as Filter)}>
              <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-ink">{row.category ? nameOf(row.category) : row.name}</span>
              <span className="tnum min-w-[3.5em] shrink-0 text-right text-[13px] text-ink-2">{t.times(row.count)}</span>
              <Money value={row.cents / 100} currency={answer.currency} tone="plain" className="shrink-0 text-[14px] font-medium" />
            </button>
          </li>
        ))}
      </ul>
      {foldable && (
        <Button variant="tertiary" size="sm" className="mt-1" onClick={() => setOpen(!open)}>
          {open ? t.list.showLess : t.list.showAll(all.length)}
        </Button>
      )}
    </>
  );
}

/** A list's line: "Du hast 23 Umsätze mit „Amazon“, zusammen 812,40 €." */
export function ListLine({ answer, when, topic, count, amount }: {
  answer: AskAnswer;
  when: string | null;
  /** The name or category asked about, as the sentence shows it. */
  topic: ReactNode;
  /** "23 Umsätze", as a figure that opens them. */
  count: ReactNode;
  amount: ReactNode;
}) {
  const words = useT().ask.list;
  const q = answer.query;
  const { words: which, total } = listWords(q);
  const sum = total ? amount : null;
  const parts = which === 'withName' && topic ? words.withName(when, count, topic, sum)
    : which === 'withCategory' && topic ? words.withCategory(when, count, topic, sum, q.dir === 'in')
      : words.plain(when, count, sum);
  return <>{parts.map((p, i) => <span key={i}>{p}</span>)}</>;
}

/** A booking's day in a row: "12.10.", with the year when it is not this one. */
function shortDay(day: string): string {
  const d = new Date(`${day}T12:00:00`);
  const thisYear = d.getFullYear() === new Date().getFullYear();
  return new Intl.DateTimeFormat(intlLocale(), { day: '2-digit', month: '2-digit', ...(thisYear ? {} : { year: '2-digit' }) }).format(d);
}

/** The newest bookings of a list, a row each: the day, the name, the amount; a press opens the booking. */
export function ListRows({ answer, onOpen }: { answer: AskAnswer; onOpen: (tx: SerializedTransaction) => void }) {
  const words = useT().ask.list;
  const latest = answer.latest ?? [];
  if (!latest.length) return null;
  return (
    <>
      {answer.count > latest.length && <p className="mt-3 text-[13px] leading-5 font-medium text-ink-2">{words.newest(latest.length)}</p>}
      <ul className={cx(ROWS, answer.count > latest.length ? 'mt-1' : 'mt-3')}>
        {latest.map((tx, i) => (
          <li key={`${bookingDay(tx)}:${i}`} className="ask-word" style={{ '--i': i } as CSSProperties}>
            <button type="button" className={ROW} onClick={() => onOpen(tx)}>
              <span className="tnum min-w-[4.5em] shrink-0 text-[13px] text-ink-2">{shortDay(bookingDay(tx))}</span>
              <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-ink">{txText(tx).name || counterpartyName(tx)}</span>
              <Money value={tx.amount} currency={tx.currency || answer.currency} signed tone="credit" className="shrink-0 text-[14px] font-medium" />
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
