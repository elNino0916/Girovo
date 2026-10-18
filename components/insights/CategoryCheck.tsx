'use client';

// The Kategorie-Check (lib/category-check.ts): how the automatic categories
// fare with the user's own bookings. A line at the foot of "Ausgaben nach
// Kategorie" and a drawer behind it — a check, not a dashboard: what the app
// filed on its own and how much of it the user left, what the user changed
// (automatic → their choice), and what still has no category, with the
// category menu right there to file it.
//
// It covers what the Analyse's toolbar covers — the accounts in scope, the
// period picked — and every booking in it, money in and out. Worked out on
// this machine from what is loaded; none of it is sent anywhere, not even as
// a count.

import { useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { categoryCheck, type CategoryCheck, type ChangeGroup, type OpenGroup } from '@/lib/category-check';
import { categoryLabel, type CategoryId } from '@/lib/categories';
import type { SerializedTransaction } from '@/lib/fints-types';
import { dayKey } from '@/lib/format';
import { intlLocale, type Messages } from '@/lib/i18n';
import { useT } from '@/lib/i18n/react';
import { useFints } from '../FintsProvider';
import { ChevronIcon } from '../icons';
import { Money } from '../Money';
import { Button, DotList, Drawer, Menu, MenuGroup, MenuItem } from '../ui';
import { txText } from '../transactions/model';
import { menuGroups } from '../transactions/TxDetail';
import { CounterpartyAvatar, fmtDayKey } from './shared';

/** Rows a list shows before it says how many more there are. */
const MAX_ROWS = 30;

/** The check over `txs`, kept as long as the bookings and the user's choices are. */
export function useCategoryCheck(txs: readonly SerializedTransaction[]): CategoryCheck {
  const { categoryOf, categoryGuessOf } = useFints();
  return useMemo(() => categoryCheck(txs, { categoryOf, guessOf: categoryGuessOf }), [txs, categoryOf, categoryGuessOf]);
}

/** The foot of "Ausgaben nach Kategorie": the check in one line, and the way in. */
export function CategoryCheckSummary({ check, onOpen }: { check: CategoryCheck; onOpen: () => void }) {
  const t = useT();
  const words = t.budgets.check;
  // A list row: the check's name, what is left open, the way in.
  return (
    <button type="button" onClick={onOpen} className="row-focus flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left">
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] leading-6 text-ink">{words.open}</span>
        {check.open > 0 && <span className="tnum block text-[14px] leading-5 text-ink-2">{words.openCount(check.open)}</span>}
      </span>
      <ChevronIcon dir="right" size={18} className="shrink-0 text-ink-2" />
    </button>
  );
}

export function CategoryCheckDrawer({
  open, onClose, check, basis,
}: {
  open: boolean;
  onClose: () => void;
  check: CategoryCheck;
  /** What the check covers, as the Analyse's toolbar line says it: accounts, period. */
  basis: ReactNode[];
}) {
  const t = useT();
  const words = t.budgets.check;
  const auto = check.auto.rules.filed + check.auto.model.filed;
  const changed = check.auto.rules.changed + check.auto.model.changed;
  // Said once a booking has been filed from here — its row leaves the list.
  // Kept as what was filed, not as the sentence: that is said in the language on screen.
  const [filed, setFiled] = useState<{ tx: SerializedTransaction; id: CategoryId } | null>(null);
  const facts: [string, number][] = [
    [words.facts.filed, auto],
    [words.facts.kept, check.kept],
    [words.facts.changed, changed],
    [words.facts.byYou, check.byYou],
    [words.facts.open, check.open],
  ];

  return (
    <Drawer open={open} onClose={onClose} title={words.title} width="lg" bodyClassName="px-4 pt-5 pb-8 sm:px-6">
      <p className="text-[15px] leading-relaxed text-ink-2">{words.intro}</p>
      <p className="tnum mt-2 text-[13px] leading-relaxed text-ink-3">
        <DotList items={[...basis, t.insights.count.bookings(check.total)]} />
      </p>

      {/* The facts, as a statement's summary: label left, figure right. */}
      <dl className="mt-4 rounded-[8px] bg-inset px-4 py-1.5">
        {facts.map(([label, n]) => (
          <div key={label} className="flex items-baseline justify-between gap-3 py-1.5">
            <dt className="text-[14px] text-ink-2">{label}</dt>
            <dd className="tnum text-[15px] font-semibold text-ink">{n.toLocaleString(intlLocale())}</dd>
          </div>
        ))}
      </dl>

      {/* Where they came from, once both sources have filed something: with
          one, the facts above already say it. */}
      {check.auto.rules.filed > 0 && check.auto.model.filed > 0 && (
        <table className="mt-4 w-full border-collapse text-[14px]">
          <caption className="sr-only">{words.sources.caption}</caption>
          <thead>
            <tr className="border-b border-line text-left text-[13px] text-ink-3">
              <th scope="col" className="py-2 pr-3 font-semibold">{words.sources.source}</th>
              <th scope="col" className="px-2 py-2 text-right font-semibold">{words.sources.filed}</th>
              <th scope="col" className="py-2 pl-2 text-right font-semibold">{words.sources.changed}</th>
            </tr>
          </thead>
          <tbody>
            {(['rules', 'model'] as const).map((source) => (
              <tr key={source} className="border-b border-line last:border-b-0">
                <th scope="row" className="py-2.5 pr-3 text-left font-normal text-ink">{words.sources[source]}</th>
                <td className="tnum px-2 py-2.5 text-right text-ink">{check.auto[source].filed}</td>
                <td className="tnum py-2.5 pl-2 text-right text-ink">{check.auto[source].changed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <OpenList groups={check.uncategorised} onFiled={setFiled} />
      <ChangeList groups={check.changes} />

      <p className="sr-only" aria-live="polite">{filed ? words.filed(txText(filed.tx).name || t.insights.noName, categoryLabel(filed.id)) : ''}</p>
    </Drawer>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="mt-6 border-t border-line pt-5">
      {/* Focusable without joining the Tab order: where focus goes when the list's last row leaves. */}
      <h3 id={id} tabIndex={-1} className="text-[15px] font-bold text-headline outline-none">{title}</h3>
      {children}
    </section>
  );
}

/** "4 Umsätze · zuletzt 28.09.2026". */
function lastFacts(txs: readonly SerializedTransaction[], words: Messages): string {
  const newest = txs[0];
  const day = newest ? dayKey(newest.entryDate || newest.valueDate) : '';
  return [words.insights.count.bookings(txs.length), day && words.budgets.check.lastOn(fmtDayKey(day))].filter(Boolean).join(' · ');
}

/**
 * What nobody has filed yet, one row per counterparty, newest first among the
 * equally many. The menu files them all with a rule — the counterparty's
 * future bookings too, as the hint above says — or the one booking where
 * there is no counterparty to carry a rule.
 */
function OpenList({ groups, onFiled }: { groups: OpenGroup[]; onFiled: (what: { tx: SerializedTransaction; id: CategoryId }) => void }) {
  const { setCategory } = useFints();
  const t = useT();
  const words = t.budgets.check;
  const shown = groups.slice(0, MAX_ROWS);

  const file = (g: OpenGroup, id: CategoryId, row: HTMLElement | null) => {
    const tx = g.txs[0];
    setCategory(tx, id, g.ruleable ? { rule: true } : {});
    onFiled({ tx, id });
    // The row leaves the list: focus moves on to its neighbour, else the heading.
    const next = row?.nextElementSibling ?? row?.previousElementSibling;
    const heading = row?.closest('section')?.querySelector<HTMLElement>('h3') ?? null;
    setTimeout(() => {
      const target = next?.querySelector<HTMLElement>('button') ?? heading;
      if (target?.isConnected) target.focus();
      else heading?.focus();
    }, 0);
  };

  return (
    <Section title={words.openTitle}>
      {groups.length === 0 ? (
        <p className="mt-2 text-[14px] text-ink-2">{words.openEmpty}</p>
      ) : (
        <>
          <p className="mt-1 text-[13px] leading-snug text-ink-3">{words.openHint}</p>
          <ul className="mt-2">
            {shown.map((g) => <OpenRow key={g.key} group={g} onPick={file} />)}
          </ul>
          {groups.length > shown.length && (
            <p className="mt-2 text-[13px] text-ink-3">{words.more(groups.length - shown.length)}</p>
          )}
        </>
      )}
    </Section>
  );
}

function OpenRow({ group, onPick }: { group: OpenGroup; onPick: (g: OpenGroup, id: CategoryId, row: HTMLElement | null) => void }) {
  const t = useT();
  const words = t.budgets.check;
  const tx = group.txs[0];
  const name = txText(tx).name || t.insights.noName;
  const credit = tx.amount > 0;
  const row = useRef<HTMLLIElement | null>(null);
  return (
    <li ref={row} className="flex items-center gap-3 border-b border-line py-2.5 last:border-b-0">
      <CounterpartyAvatar tx={tx} name={name} credit={credit} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] leading-snug font-semibold text-ink">{name}</span>
        <span className="block truncate text-[13px] leading-snug text-ink-3">
          {lastFacts(group.txs, t)}
          {group.txs.length === 1 && (
            <>
              {' · '}
              <Money value={tx.amount} currency={tx.currency || 'EUR'} signed tone="credit" />
            </>
          )}
        </span>
      </span>
      <Menu
        placement="bottom-end"
        label={words.assignFor(name)}
        minWidth={280}
        trigger={(p) => (
          <Button {...p} size="xs" variant="secondary" aria-label={words.assignFor(name)}>
            {words.assign}
            <ChevronIcon size={14} strokeWidth={2} className="-mr-1" />
          </Button>
        )}
      >
        {menuGroups(credit, t).map((mg) => (
          <MenuGroup key={mg.label} label={mg.label}>
            {mg.ids.map((id) => (
              <MenuItem key={id} onSelect={() => onPick(group, id, row.current)}>{categoryLabel(id)}</MenuItem>
            ))}
          </MenuGroup>
        ))}
      </Menu>
    </li>
  );
}

/** What the user filed elsewhere than the app had: automatic → their choice, and how. */
function ChangeList({ groups }: { groups: ChangeGroup[] }) {
  const t = useT();
  const words = t.budgets.check;
  const shown = groups.slice(0, MAX_ROWS);
  return (
    <Section title={words.changedTitle}>
      {groups.length === 0 ? (
        <p className="mt-2 text-[14px] text-ink-2">{words.changedEmpty}</p>
      ) : (
        <>
          <ul className="mt-2">
            {shown.map((g) => {
              const name = txText(g.tx).name || t.insights.noName;
              const from = categoryLabel(g.from);
              const to = categoryLabel(g.to);
              return (
                <li key={g.key} className="flex items-center gap-3 border-b border-line py-2.5 last:border-b-0">
                  <CounterpartyAvatar tx={g.tx} name={name} credit={g.tx.amount > 0} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] leading-snug font-semibold text-ink">{name}</span>
                    <span className="block text-[13px] leading-snug text-ink-2">
                      <span aria-hidden>{words.fromTo(from, to)}</span>
                      <span className="sr-only">{words.fromToSpoken(from, to)}</span>
                    </span>
                    <span className="block text-[13px] leading-snug text-ink-3">
                      {t.insights.count.bookings(g.count)} · {words.by[g.by]}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
          {groups.length > shown.length && (
            <p className="mt-2 text-[13px] text-ink-3">{words.more(groups.length - shown.length)}</p>
          )}
        </>
      )}
    </Section>
  );
}
