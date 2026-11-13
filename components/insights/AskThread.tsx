'use client';

// Girovo Next, "Fragen": a conversation about the bookings (owner's pick
// "Gespräch", 2026-11-11; .impeccable/mocks/decision/next-ai/a-gespraech.png).
//
// The user's questions are bubbles in the tonal wash; Girovo's answers are
// tiles on the AI wash, a few plain sentences in which every figure is the
// app's own (lib/nano-ask.ts computeAnswer) and opens the bookings behind it.
// A follow-up keeps what it does not say again (lib/ask-followup.ts). On a
// phone the thread is a full-screen view over the app; on the desktop it
// docks at the sheet's right edge (AskPanel) while the page beside it shows
// what an answer is about.
//
// UI first: until the on-device writer lands, the sentences come from the
// templates in lib/i18n/messages/ask.ts (thread.say), read off the answer
// Girovo computed. The reading of a question is today's (Gemini Nano on the
// phone, the built-in model on the desktop).

import { Fragment, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { monthBefore } from '@/lib/ask-followup';
import { checkPlan, plannerInput, plannerSystem } from '@/lib/ask-planner';
import { readAsked } from '@/lib/ask-read';
import { intentOf, type AskIntent, type FactIntent } from '@/lib/ask-intents';
import { isFact } from '@/lib/ask-facts';
import { seriesTitle } from '@/lib/recurring';
import { setThemePref } from '@/lib/theme';
import { segments, usable, writerInput, writerSystem, type WriterLang } from '@/lib/gemma-writer';
import { bookingDay, periodTotals } from '@/lib/analytics';
import { categoryLabel, counterpartyName, type CategoryId } from '@/lib/categories';
import type { SerializedTransaction } from '@/lib/fints-types';
import { dayKey, fmtDate, fmtMonth, fmtRange } from '@/lib/format';
import { LOCALE_NAMES, activeLocale, intlLocale } from '@/lib/i18n/locale';
import { useLocale, useT } from '@/lib/i18n/react';
import {
  ASK_MAX_TOKENS, ASK_SYSTEM, askText, categoryFromQuestion, computeAnswer, nameFromPayees, parseAskAnswer, periodDays,
  questionTopic,
  type AskAnswer, type AskPeriod, type AskQuery, type NanoReading,
} from '@/lib/nano-ask';
import { IS_ANDROID } from '@/lib/platform';
import { useFints } from '../FintsProvider';
import { Money } from '../Money';
import { ArrowRightIcon, BackIcon, CloseIcon, AiMarkIcon, HistoryIcon, PlusIcon, TrashIcon } from '../icons';
import { usePhone } from '../shell/usePhone';
import { Button, Dialog, IconButton, Menu, MenuItem, MenuSeparator, Overlay, cx } from '../ui';
import { searchText, txText } from '../transactions/model';
import { openTxDetail } from '../transactions/detail-host';
import { useScopeData, type ScopeData } from './analysis-model';
import { AskTile } from './Ask';
import { ExplainAnswer } from './ask/ExplainAnswer';
import { AskNotes, thisMonth } from './ask/Notes';
import { ListLine, ListRows, RankLine, RankRows } from './ask/ListAnswer';
import { useCanAsk } from './ask-gate';
import { FactAnswer } from './ask/FactAnswers';
import {
  askInThread, clearAsk, closeAsk, currentConversation, deleteAllConversations, deleteConversation, dropCurrent, hiddenRecaps,
  newConversation, openAskWithRecap, settleOutcome, settleTurn, settleWritten, showConversation, updateTurnQuery, useAskThread, type Turn,
} from './ask-thread-store';
import { ReadingChips } from './ask/ReadingChips';
import { gemmaPrompt, gemmaUsable, useGemma } from './gemma';
import { useThemePref } from '../ThemeToggle';
import { useRecurringModel } from './recurring-model';
import { LoadHistoryButton, useShowInList } from './shared';

type AskCtx = Parameters<typeof computeAnswer>[2];
type Own = readonly { id: string; name: string }[];

/** Every loaded account's bookings: what a question is asked about. */
export function useAskScope(): ScopeData | null {
  const { activeAccount, accounts, transactions, txByAccount, statementInfo } = useFints();
  return useScopeData({ scope: 'all', activeAccount, accounts, transactions, txByAccount, statementInfo });
}

/** How the bookings are read for an answer: as the Umsätze list reads them, so both find the same ones. */
function useAskContext(currency: string): { ctx: AskCtx; own: Own } {
  const { categoryOf, noteOf, vault, brandNames } = useFints();
  const own = useMemo(
    () => (vault?.customCategories ?? []).map((c) => ({ id: c.id, name: c.name })),
    [vault?.customCategories],
  );
  const ctx = useMemo<AskCtx>(
    () => ({ categoryOf, shownText: searchText, noteOf, payeeOf: (tx: SerializedTransaction) => txText(tx).name, currency }),
    // brandNames: a brand that arrives later regroups a ranking.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [categoryOf, noteOf, brandNames, currency],
  );
  return { ctx, own };
}

/**
 * The desktop's reading of a question, in Nano's place: a name from the
 * payees in view, else the built-in model's category (as Ask.tsx does).
 */
async function builtInReading(
  question: string, payees: readonly string[], askCategory: (topic: string) => Promise<CategoryId | null>,
): Promise<NanoReading | null> {
  const search = nameFromPayees(question, payees);
  const topic = questionTopic(question);
  const category = search || !topic || categoryFromQuestion(question) ? null : await askCategory(topic);
  return search || category ? { dir: null, category, search } : null;
}

/**
 * Reads every question waiting in the thread, once each, and forgets the
 * conversations when the app logs out or asking is switched off. Mounted
 * once in each shell (components/Dashboard.tsx).
 */
export function AskReader() {
  const s = useAskThread();
  const data = useAskScope();
  const { askCategory, vault } = useFints();
  const gemma = useGemma();
  const gemmaReady = gemmaUsable(gemma);
  const { ctx, own } = useAskContext(data?.currency ?? 'EUR');
  const inflight = useRef(new Set<number>());
  // The live contracts by name: "Was kostet mich Netflix im Jahr?" asks Verträge & Abos only for one of them.
  const recurring = useRecurringModel();
  const contracts = useMemo(() => recurring.expense.flatMap((s) => [seriesTitle(s), s.name]), [recurring.expense]);
  const payees = useMemo(
    () => (IS_ANDROID || !data ? [] : [...new Set(data.txs.map((tx) => ctx.payeeOf?.(tx) ?? '').filter(Boolean))]),
    [data, ctx],
  );

  useEffect(() => {
    if (vault?.askOff) clearAsk();
  }, [vault?.askOff]);

  useEffect(() => {
    for (const c of s.conversations) {
      c.turns.forEach((turn, i) => {
        if (turn.state !== 'reading' || inflight.current.has(turn.id)) return;
        inflight.current.add(turn.id);
        // The question before it, as it was read: what a follow-up keeps.
        const prevTurn = [...c.turns.slice(0, i)].reverse().find((t) => t.query);
        const prev = prevTurn?.query ?? null;
        void (async () => {
          const q = turn.question;
          const today = dayKey(new Date());
          // Verträge & Abos, a setting, a change: by the rules, before any model reads it.
          const intent = intentOf(q, contracts);
          if (intent) {
            settleTurn(turn.id, { state: 'answered', intent });
            return;
          }
          const mobile = IS_ANDROID ? window.girovoMobile : undefined;
          if (IS_ANDROID && !mobile?.ask) {
            settleTurn(turn.id, { state: 'failed' });
            return;
          }
          // The desktop with Gemma: Gemma plans the whole question (and a follow-up with the
          // one before it); the checks keep only what can be true (lib/ask-planner.ts).
          if (!mobile?.ask && gemmaReady) {
            const ctx = { question: q, today, own, payees, prev: prevTurn?.query ? { question: prevTurn.question, query: prevTurn.query } : null };
            const planned = checkPlan(await gemmaPrompt(plannerSystem(today, own), plannerInput(ctx), 200, true), ctx);
            if (planned && 'offTopic' in planned) {
              settleTurn(turn.id, { state: 'offTopic' });
              return;
            }
            if (planned) {
              settleTurn(turn.id, { state: 'answered', query: planned.plan });
              return;
            }
          }
          // Otherwise (a phone with Gemini Nano, the desktop without Gemma, or no usable plan):
          // the model reads, the rules decide (lib/ask-read.ts).
          const raw = mobile?.ask ? await mobile.ask(ASK_SYSTEM, askText(q, own), ASK_MAX_TOKENS) : null;
          const reading = mobile?.ask ? parseAskAnswer(raw, own) : await builtInReading(q, payees, askCategory);
          const read = readAsked(q, prev, { today, own, reading, contracts });
          if ('offTopic' in read) settleTurn(turn.id, { state: 'offTopic' });
          else if ('query' in read) settleTurn(turn.id, { state: 'answered', query: read.query });
          else if ('intent' in read) settleTurn(turn.id, { state: 'answered', intent: read.intent });
          else settleTurn(turn.id, { state: mobile?.ask && raw == null ? 'failed' : 'notUnderstood' });
        })().finally(() => inflight.current.delete(turn.id));
      });
    }
  }, [s, own, payees, askCategory, gemmaReady, contracts]);
  return null;
}

/** Parts of a sentence, keyed for React. */
function Say({ parts }: { parts: ReactNode[] }) {
  return <>{parts.map((p, i) => <Fragment key={i}>{p}</Fragment>)}</>;
}

/** A figure inside an answer: the app's own, and a press opens the bookings it is made of. */
function Fig({ children, onShow, label }: { children: ReactNode; onShow?: () => void; label?: string }) {
  if (!onShow) return <span className="tnum font-medium whitespace-nowrap">{children}</span>;
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onShow}
      className="tnum rounded-[4px] font-medium whitespace-nowrap text-ink underline decoration-accent/70 decoration-dotted decoration-[1.5px] underline-offset-4 hover:bg-accent/10 focus-visible:bg-accent/10"
    >
      {children}
    </button>
  );
}

/** What a period is called in a sentence: a month by its name, a year by its number. */
function usePeriodText() {
  const words = useT().ask;
  return (period: AskPeriod): string => {
    const today = dayKey(new Date());
    const days = periodDays(period, today);
    return period.kind === 'all' || !days ? words.period.all
      : period.kind === 'today' ? words.period.today
        : period.kind === 'days' ? words.period.days(period.days)
          : period.kind === 'months' ? words.period.months(period.months)
            : period.kind === 'since' ? words.period.since(fmtMonth(period.month))
              : period.kind === 'range' ? fmtRange(days.from, days.to)
                : period.kind === 'month' || period.kind === 'lastMonth' || period.kind === 'thisMonth' ? fmtMonth(days.from.slice(0, 7))
                  : days.from.slice(0, 4);
  };
}

/** How a sentence opens on the period the question named; null for every loaded booking. */
function usePeriodLead() {
  const when = useT().ask.thread.say.when;
  return (period: AskPeriod): string | null => {
    const today = dayKey(new Date());
    const days = periodDays(period, today);
    if (period.kind === 'all' || !days) return null;
    if (period.kind === 'today') return when.today;
    if (period.kind === 'days') return when.days(period.days);
    if (period.kind === 'months') return when.months(period.months);
    if (period.kind === 'since') return when.since(fmtMonth(period.month));
    if (period.kind === 'range') return when.range(fmtRange(days.from, days.to));
    if (period.kind === 'month' || period.kind === 'lastMonth' || period.kind === 'thisMonth') return when.month(fmtMonth(days.from.slice(0, 7)));
    return when.year(days.from.slice(0, 4));
  };
}

/** A day in a sentence: "5. Oktober", with the year only when it is not this one. */
function dayInWords(day: string): string {
  const d = new Date(`${day}T12:00:00`);
  const thisYear = d.getFullYear() === new Date().getFullYear();
  return new Intl.DateTimeFormat(intlLocale(), { day: 'numeric', month: 'long', ...(thisYear ? {} : { year: 'numeric' }) }).format(d);
}

/**
 * Opens one booking's details from an answer: the Übersicht (which hosts the
 * drawer) comes forward, the drawer opens on the booking, with its own account
 * where it is not the active one.
 */
function useOpenBooking() {
  const { txByAccount, accounts, setTab } = useFints();
  return (tx: SerializedTransaction) => {
    const owner = Object.keys(txByAccount).find((key) => txByAccount[key]?.includes(tx));
    const account = accounts.find((a) => a.accountNumber === owner);
    setTab('overview');
    // On the next tick, once the Übersicht and its drawer host are there.
    setTimeout(() => openTxDetail(tx, false, account), 0);
  };
}

/** Girovo's answer to one question, said in sentences over the figures it computed. */
function AnswerText({ answer, own, show, scopeAll, onShown, written }: {
  answer: AskAnswer;
  own: Own;
  show: ReturnType<typeof useShowInList>;
  scopeAll: boolean;
  onShown: () => void;
  /** Gemma's sentences (passed the number guard); the template's when absent. */
  written?: string;
}) {
  const t = useT();
  const words = t.ask;
  const say = words.thread.say;
  const periodText = usePeriodText();
  const lead = usePeriodLead();
  const { query: q, currency } = answer;
  const when = lead(q.period);
  const across = scopeAll ? { acrossAccounts: true } : {};
  const openBooking = useOpenBooking();
  // One booking answers "Größte Ausgabe" and "Zuletzt": its details open, not a list of the period.
  const single = (q.kind === 'largest' || q.kind === 'last') && !!answer.tx;
  const open = (tx: SerializedTransaction | null, filter: AskAnswer['filter']) => {
    if (single && tx) openBooking(tx);
    else show(tx, { ...filter, ...across });
    onShown();
  };
  const nameOf = (id: CategoryId) => own.find((c) => c.id === id)?.name ?? categoryLabel(id);
  const atLeast = answer.partial ? `${words.atLeast} ` : '';
  const money = (cents: number, filter = answer.filter, tx: SerializedTransaction | null = null, partial = true) => (
    <Fig onShow={() => open(tx, filter)}>
      {partial ? atLeast : ''}
      <Money value={cents / 100} currency={currency} tone="plain" />
    </Fig>
  );
  const count = (n: number) => <Fig onShow={() => open(null, answer.filter)}>{n}</Fig>;
  const topic: ReactNode = q.category ? nameOf(q.category) : q.search ? `„${q.search}“` : null; // i18n-data
  const range = fmtRange(answer.from, answer.to);
  const aside = answer.compare ? answer.compare.a.otherCurrency + answer.compare.b.otherCurrency : answer.otherCurrency;

  const lines: ReactNode[][] = [];
  let extra: ReactNode = null;
  if (q.kind === 'compare' && answer.compare) {
    const { a, b } = answer.compare;
    const diff = a.cents - b.cents;
    lines.push(say.compare(periodText(q.period), money(a.cents, a.filter, null, a.partial), q.against ? periodText(q.against) : fmtRange(b.from, b.to), money(b.cents, b.filter, null, b.partial)));
    lines.push(diff === 0 ? [say.same] : say.diff(<Fig><Money value={Math.abs(diff) / 100} currency={currency} tone="plain" /></Fig>, diff > 0));
    if (a.outside || b.outside) lines.push([words.compareMissing]);
  } else if (q.kind === 'rank' && answer.rank) {
    // Every place or category, a row each (components/insights/ask/ListAnswer.tsx).
    if (!answer.rank.length) lines.push([words.none]);
    else {
      lines.push([<RankLine key="rank" answer={answer} when={when} nameOf={nameOf} />]);
      extra = <RankRows answer={answer} nameOf={nameOf} onOpen={(filter) => open(null, filter)} />;
    }
  } else if (answer.outside) {
    lines.push([words.outside]);
    extra = <LoadHistoryButton className="mt-3" layout="stacked" />;
  } else if (answer.count === 0) {
    lines.push([words.none]);
    if (!aside) lines.push([words.noneHint(range)]);
  } else if ((q.kind === 'largest' || q.kind === 'last') && answer.tx) {
    const tx = answer.tx;
    const amount = (
      <Fig onShow={() => open(tx, answer.filter)}>
        <Money value={Math.abs(tx.amount)} currency={tx.currency || currency} tone="plain" />
      </Fig>
    );
    const day = dayInWords(bookingDay(tx));
    // The name as the lists show it (tidied), not the bank's capitals.
    const name = txText(tx).name || counterpartyName(tx);
    lines.push(q.kind === 'last' ? say.last(name, amount, day)
      : tx.amount > 0 ? say.largestIn(name, amount, day) : say.largestOut(name, amount, day));
  } else if (q.kind === 'list') {
    // One line over the newest bookings; a row opens the booking.
    lines.push([<ListLine key="list" answer={answer} when={when} topic={topic} count={<Fig onShow={() => open(null, answer.filter)}>{atLeast}{words.bookings(answer.count)}</Fig>} amount={money(answer.cents)} />]);
    extra = <ListRows answer={answer} onOpen={(tx) => { openBooking(tx); onShown(); }} />;
  } else if (q.kind === 'count') {
    lines.push(say.count(when, <Fig onShow={() => open(null, answer.filter)}>{atLeast}{words.times(answer.count)}</Fig>, money(answer.cents), topic));
  } else if (q.kind === 'average' && answer.months > 0) {
    lines.push(say.average(<Fig onShow={() => open(null, answer.filter)}><Money value={Math.round(answer.monthCents / answer.months) / 100} currency={currency} tone="plain" /></Fig>, words.averageBasis(answer.months)));
  } else if (q.dir === 'all') {
    lines.push(say.both(when, money(answer.outCents), money(answer.inCents)));
  } else {
    if (q.kind === 'average') lines.push([words.noWholeMonth]);
    const make = q.dir === 'in'
      ? (q.category ? say.inCategory : q.search ? say.inName : null)
      : (q.category ? say.outCategory : q.search ? say.outName : null);
    lines.push(make && topic
      ? make(when, topic, money(answer.cents), count(answer.count), answer.count)
      : (q.dir === 'in' ? say.in : say.out)(when, money(answer.cents), count(answer.count), answer.count));
  }
  if (answer.partial) lines.push([words.partial(fmtDate(answer.from))]);
  if (aside > 0) lines.push([t.insights.analysis.foreignBookings(aside)]);

  return (
    <>
      <p className="text-[16px] leading-6 text-ink sm:text-[14px] sm:leading-[22px] [text-wrap:pretty]">
        {written ? <WrittenText text={written} answer={answer} open={open} />
          : lines.map((parts, i) => <Fragment key={i}>{i > 0 && ' '}<Say parts={parts} /></Fragment>)}
      </p>
      {extra}
      {answer.count > 0 && !answer.outside && q.kind !== 'rank' && q.kind !== 'compare' && (
        <Button variant="secondary" size="sm" className="mt-3" onClick={() => open(answer.tx, answer.filter)}>
          {/* One booking answers "Größte Ausgabe" and "Zuletzt": the button names it as one. */}
          {words.thread.show((q.kind === 'largest' || q.kind === 'last') && answer.tx ? 1 : answer.count)}
        </Button>
      )}
    </>
  );
}

/** The app's language as the writer's. */
const writerLang = (): WriterLang => (activeLocale() === 'en' ? 'en' : 'de');

/**
 * Gemma's sentences, every amount in them drawn by the app again: <Money>
 * (Beträge ausblenden hides it) and, where it is one of the answer's own
 * figures, a press that opens its bookings.
 */
function WrittenText({ text, answer, open }: {
  text: string;
  answer: AskAnswer;
  open: (tx: SerializedTransaction | null, filter: AskAnswer['filter']) => void;
}) {
  // Which bookings each figure of the answer is made of, by its amount.
  const filters = new Map<number, AskAnswer['filter']>();
  filters.set(answer.cents, answer.filter);
  if (answer.compare) {
    filters.set(answer.compare.a.cents, answer.compare.a.filter);
    filters.set(answer.compare.b.cents, answer.compare.b.filter);
  }
  for (const row of answer.rank ?? []) filters.set(row.cents, row.filter as AskAnswer['filter']);
  const tx = (answer.query.kind === 'largest' || answer.query.kind === 'last') && answer.tx ? answer.tx : null;
  let word = 0;
  return (
    <>
      {segments(text, writerLang()).map((seg, i) => {
        // Word by word, out of a blur, each a beat after the one before (the count runs on across pieces).
        if ('text' in seg) {
          return (
            <Fragment key={i}>
              {seg.text.split(/(\s+)/).map((w, j) => (/^\s*$/.test(w) ? w : <span key={j} className="ask-word" style={{ '--i': word++ } as CSSProperties}>{w}</span>))}
            </Fragment>
          );
        }
        const filter = filters.get(seg.cents) ?? (tx && Math.abs(Math.round(tx.amount * 100)) === seg.cents ? answer.filter : undefined);
        return (
          <span key={i} className="ask-word" style={{ '--i': word++ } as CSSProperties}>
            <Fig onShow={filter ? () => open(tx, filter) : undefined}>
              <Money value={seg.cents / 100} currency={answer.currency} tone="plain" />
            </Fig>
          </span>
        );
      })}
    </>
  );
}

/** What an answer's figures are: Gemma's sentences belong to these, and are written again when they change. */
// The language too: a sentence is said in the language it was written in, or written again.
const answerKey = (a: AskAnswer) => JSON.stringify([writerLang(), a.cents, a.count, a.from, a.to, a.partial, a.outside, a.outCents, a.inCents, a.rank?.length, a.rank?.slice(0, 5).map((r) => r.cents), a.latest?.[0]?.amount]);

/** Turns being written: each asked of Gemma once at a time. */
const writing = new Set<string>();

/**
 * Asks Gemma to say a turn's answer, once for each set of figures, and keeps
 * its sentences on the turn when they pass the number guard (lib/gemma-writer.ts);
 * otherwise the template says it. Nothing happens without the shell's Gemma.
 */
function useWriter(turn: Turn, answer: AskAnswer | null, ctx: AskCtx, own: Own, latest: boolean): { pending: boolean; text?: string } {
  const gemma = useGemma();
  const ready = gemmaUsable(gemma);
  const key = answer ? answerKey(answer) : '';
  const current = turn.writtenFor === key;
  useEffect(() => {
    // Only the newest turn is written: older ones keep what they had, so a new question never waits behind them.
    if (!ready || !answer || turn.seed || turn.edited || !turn.question || current || !latest) return;
    const job = `${turn.id}:${key}`;
    if (writing.has(job)) return;
    writing.add(job);
    const lang = writerLang();
    const nameOf = (id: CategoryId) => own.find((c) => c.id === id)?.name ?? categoryLabel(id);
    const input = writerInput(turn.question, answer, { lang, nameOf, payeeOf: (tx) => ctx.payeeOf?.(tx) || counterpartyName(tx) });
    void gemmaPrompt(writerSystem(lang), input.prompt, 160)
      .then((text) => settleWritten(turn.id, usable(text, input) ? text.trim() : false, key))
      .finally(() => writing.delete(job));
  }, [ready, answer, turn.id, turn.question, turn.seed, turn.edited, key, current, ctx, own, latest]);
  // A reading changed by a chip is said by the template: Gemma's sentences were about the question as asked.
  if (!ready || !answer || turn.seed || turn.edited) return { pending: false };
  if (!current) return { pending: latest };
  return { pending: false, text: turn.written || undefined };
}

/**
 * The month recap's figures, on the Analyse's own basis (lib/analytics.ts
 * periodTotals: a refund netted into its category, Umbuchungen left out), so
 * its "ausgegeben" is the Analyse's Ausgaben for that month. The answers'
 * filters only say which bookings a press opens.
 */
export function useRecap(data: ScopeData | null, ctx: AskCtx, month: string | null) {
  return useMemo(() => {
    if (!data || !month || !ctx.categoryOf) return null;
    const today = dayKey(new Date());
    const bounds = { from: data.from, to: data.to };
    const sumOf = (m: string, category: CategoryId | null = null) => computeAnswer(
      { kind: 'sum', dir: 'out', category, search: null, period: { kind: 'month', month: m } }, data.txs, ctx, bounds, today,
    );
    const totalsOf = (m: string) => {
      const days = periodDays({ kind: 'month', month: m }, today);
      return days ? periodTotals(data.txs, { categoryOf: ctx.categoryOf!, from: days.from, to: days.to, currency: data.currency }) : null;
    };
    const asked = sumOf(month);
    // Only a whole month, wholly loaded.
    if (asked.outside || asked.partial || asked.count === 0) return null;
    const totals = totalsOf(month);
    if (!totals || totals.expense <= 0) return null;
    const before = monthBefore({ kind: 'month', month }, today);
    const beforeAsked = before ? sumOf(before) : null;
    const beforeTotals = before && beforeAsked && !beforeAsked.outside && !beforeAsked.partial && beforeAsked.count > 0 ? totalsOf(before) : null;
    const first = totals.byCategory[0] ?? null;
    return {
      month,
      currency: data.currency,
      spent: { cents: Math.round(totals.expense * 100), filter: asked.filter },
      prev: beforeTotals ? { cents: Math.round(beforeTotals.expense * 100) } : null,
      top: first ? { category: first.id, cents: Math.round(first.amount * 100), filter: sumOf(month, first.id).filter } : null,
    };
  }, [data, ctx, month]);
}

/** The last month that is over: the recap's. */
export function lastMonth(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** The recap said in sentences: in the Analyse's tile and as a conversation's opening. */
export function RecapText({ recap, own, onShown }: { recap: NonNullable<ReturnType<typeof useRecap>>; own: Own; onShown?: () => void }) {
  const words = useT().ask.recap;
  const show = useShowInList();
  const { spent, prev, top, currency } = recap;
  const open = (filter: AskAnswer['filter']) => {
    show(null, { ...filter, acrossAccounts: true });
    onShown?.();
  };
  const money = (cents: number, filter?: AskAnswer['filter']) => (
    <Fig onShow={filter ? () => open(filter) : undefined}><Money value={cents / 100} currency={currency} tone="plain" /></Fig>
  );
  const diff = prev ? spent.cents - prev.cents : 0;
  const nameOf = (id: CategoryId) => own.find((c) => c.id === id)?.name ?? categoryLabel(id);
  return (
    <p className="text-[16px] leading-6 text-ink sm:text-[14px] sm:leading-[22px] [text-wrap:pretty]">
      <Say parts={words.spent(money(spent.cents, spent.filter), prev && diff !== 0 ? money(Math.abs(diff)) : null, diff > 0)} />
      {top && (
        <>
          {' '}
          <Say parts={words.top(nameOf(top.category), money(top.cents, top.filter))} />
        </>
      )}
    </p>
  );
}

/** A turn that is no sum of bookings: Verträge & Abos, a setting as it is, or a change asked first. */
function IntentAnswer({ turn, intent, onShown }: { turn: Turn; intent: AskIntent; onShown: () => void }) {
  if (intent.kind === 'contracts') return <ContractsAnswer onShown={onShown} />;
  if (intent.kind === 'read') return <SettingsAnswer setting={intent.setting} />;
  if (isFact(intent)) return <FactAnswer intent={intent} onShown={onShown} />;
  return <ChangeAnswer turn={turn} intent={intent} />;
}

/** "Welche Abos habe ich?": the live Verträge & Abos with their monthly sum, and the way to the page. */
function ContractsAnswer({ onShown }: { onShown: () => void }) {
  const words = useT().ask.actions;
  const model = useRecurringModel();
  const { setTab } = useFints();
  const live = model.expense;
  if (live.length === 0) return <p className="text-[16px] leading-6 sm:text-[14px]">{words.noContracts}</p>;
  const monthly = <Fig><Money value={model.totals.monthlyExpense} currency={model.totals.currency} tone="plain" /></Fig>;
  return (
    <>
      <p className="text-[16px] leading-6 text-ink sm:text-[14px] sm:leading-[22px]"><Say parts={words.contracts(live.length, monthly)} /></p>
      <ul className="mt-3 -mx-2 flex flex-col rounded-[12px] bg-[color-mix(in_srgb,var(--paper)_72%,transparent)] py-1">
        {live.slice(0, 8).map((s, i) => (
          <li key={s.id} className="ask-word flex min-h-11 items-center gap-3 px-3" style={{ '--i': i } as CSSProperties}>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-medium text-ink">{seriesTitle(s)}</span>
              <span className="block text-[12px] leading-4 text-ink-2">{s.cadenceLabel}</span>
            </span>
            <Money value={Math.abs(s.amount)} currency={s.currency} tone="plain" className="shrink-0 text-[14px] font-medium" />
          </li>
        ))}
      </ul>
      <Button
        variant="secondary"
        size="sm"
        className="mt-3"
        onClick={() => {
          setTab('contracts');
          onShown();
        }}
      >
        {words.openContracts}
      </Button>
    </>
  );
}

/** A setting as it is: the theme, the amounts, the language, the logout, or all four. */
function SettingsAnswer({ setting }: { setting: Extract<AskIntent, { kind: 'read' }>['setting'] }) {
  const words = useT().ask.actions;
  const theme = useThemePref();
  const { privacy, idleMinutes } = useFints();
  const { locale } = useLocale();
  const lines = {
    theme: words.readTheme(words.theme[theme]),
    privacy: words.readPrivacy(privacy),
    language: words.readLanguage(LOCALE_NAMES[locale]),
    idle: words.readIdle(idleMinutes),
  };
  const shown = setting === 'all' ? Object.values(lines) : [lines[setting]];
  return <p className="text-[16px] leading-6 text-ink sm:text-[14px] sm:leading-[22px]">{shown.join(' ')}</p>;
}

/**
 * A change, asked first: the question, "Ja, bitte" and "Abbrechen". Made only
 * on the yes; then what happened, in a word. Already so: said, nothing asked.
 */
function ChangeAnswer({ turn, intent }: { turn: Turn; intent: Exclude<AskIntent, { kind: 'contracts' } | { kind: 'read' } | FactIntent> }) {
  const words = useT().ask.actions;
  const theme = useThemePref();
  const { privacy, togglePrivacy, loadAllBalances } = useFints();
  const { locale, setLocale } = useLocale();
  const already = intent.kind === 'set' && (
    (intent.setting === 'theme' && intent.value === theme)
    || (intent.setting === 'privacy' && intent.value === privacy)
    || (intent.setting === 'language' && intent.value === locale)
  );
  const outcome = turn.outcome ?? (already ? 'already' : undefined);
  const question = intent.kind === 'refresh' ? words.askRefresh
    : intent.setting === 'theme' ? words.askTheme[intent.value]
      : intent.setting === 'privacy' ? words.askPrivacy(intent.value)
        : words.askLanguage(LOCALE_NAMES[intent.value]);
  if (outcome) {
    const said = outcome === 'already' ? words.already : outcome === 'cancelled' ? words.cancelled
      : intent.kind === 'refresh' ? words.refreshing
        : intent.setting === 'theme' ? words.doneTheme[intent.value]
          : intent.setting === 'privacy' ? words.donePrivacy(intent.value)
            // Said in the language just chosen: the app already speaks it.
            : intent.setting === 'language' ? words.doneLanguage : words.done;
    return <p className="text-[16px] leading-6 text-ink sm:text-[14px] sm:leading-[22px]">{said}</p>;
  }
  const make = () => {
    if (intent.kind === 'refresh') loadAllBalances();
    else if (intent.setting === 'theme') setThemePref(intent.value);
    else if (intent.setting === 'privacy') { if (privacy !== intent.value) togglePrivacy(); }
    else setLocale(intent.value);
    settleOutcome(turn.id, 'done');
  };
  return (
    <>
      <p className="text-[16px] leading-6 text-ink sm:text-[14px] sm:leading-[22px]">{question}</p>
      {intent.kind === 'refresh' && <p className="mt-1 text-[14px] leading-5 text-ink-2">{words.refreshNote}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" onClick={make}>{words.yes}</Button>
        <Button variant="tertiary" size="sm" onClick={() => settleOutcome(turn.id, 'cancelled')}>{words.no}</Button>
      </div>
    </>
  );
}

/** One of Girovo's turns: the tile on the AI wash. */
/** What Girovo is doing on a turn, while it does: reading the question, or writing the answer. */
type Phase = 'reading' | 'writing' | null;

/**
 * Girovo at work: the spark breathes, the step is named ("Liest deine Frage",
 * "Schreibt die Antwort", "Gemma startet" while the model loads), and after a
 * few seconds the seconds count, so a slow answer never looks stuck. Two
 * lines shimmer where the answer will stand.
 */
function Thinking({ phase }: { phase: Exclude<Phase, null> }) {
  const words = useT().ask.thread.thinking;
  const gemma = useGemma();
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const id = window.setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, []);
  const label = gemma?.starting ? words.starting : phase === 'reading' ? words.reading : words.writing;
  return (
    <div role="status" aria-live="polite">
      <p className="flex items-center gap-2 text-[14px] leading-5 font-medium text-ink-2">
        <span>{label}</span>
        {seconds >= 3 && <span className="tnum font-normal" aria-hidden>{words.seconds(seconds)}</span>}
      </p>
      <div className="mt-2.5 flex flex-col gap-2" aria-hidden>
        <span className="ask-line block w-[92%]" />
        <span className="ask-line block w-[64%]" />
      </div>
    </div>
  );
}

function GirovoTile({ children, phase = null }: { children: ReactNode; phase?: Phase }) {
  const words = useT().ask.thread;
  return (
    <div data-ai className="ask-tile rounded-[16px] px-4 pt-3 pb-3.5">
      <span className="sr-only">{words.girovo}</span>
      <AiMarkIcon size={16} className={cx('mb-1.5 block', phase && 'ask-breathe')} aria-hidden />
      {phase ? <Thinking phase={phase} /> : <div className="ask-reveal">{children}</div>}
    </div>
  );
}

function TurnView({ turn, data, ctx, own, onShown, latest }: {
  turn: Turn;
  /** The conversation's newest turn: the one Gemma writes. */
  latest: boolean;
  data: ScopeData | null;
  ctx: AskCtx;
  own: Own;
  onShown: () => void;
}) {
  const words = useT().ask;
  const show = useShowInList();
  const answer = useMemo(
    () => (turn.query && data ? computeAnswer(turn.query, data.txs, ctx, { from: data.from, to: data.to }, dayKey(new Date())) : null),
    [turn.query, data, ctx],
  );
  const recap = useRecap(data, ctx, turn.seed?.month ?? null);
  const writer = useWriter(turn, turn.state === 'answered' ? answer : null, ctx, own, latest);
  return (
    <li className="flex flex-col gap-3">
      {turn.question && (
        <div className="ask-sent ml-auto w-fit max-w-[85%] rounded-[20px] rounded-br-[4px] bg-accent-soft px-4 py-2.5 text-[16px] leading-6 text-[var(--tonal-ink)] sm:text-[14px] sm:leading-5">
          <span className="sr-only">{words.thread.you} </span>
          {turn.question}
        </div>
      )}
      <GirovoTile phase={turn.state === 'reading' ? 'reading' : writer.pending ? 'writing' : null}>
        {turn.seed && (recap ? <RecapText recap={recap} own={own} onShown={onShown} /> : <p className="text-[16px] leading-6 sm:text-[14px]">{data ? words.outside : words.thread.notLoaded}</p>)}
        {turn.seed && recap && <AskNotes data={data} ctx={ctx} own={own} month={recap.month} onShown={onShown} />}
        {turn.state === 'failed' && <p className="text-[16px] leading-6 sm:text-[14px]">{words.failed}</p>}
        {turn.state === 'notUnderstood' && <p className="text-[16px] leading-6 sm:text-[14px]">{IS_ANDROID ? words.notUnderstood : words.desktop.notUnderstood}</p>}
        {turn.state === 'offTopic' && <p className="text-[16px] leading-6 sm:text-[14px]">{words.thread.offTopic}</p>}
        {turn.state === 'answered' && turn.intent && <IntentAnswer turn={turn} intent={turn.intent} onShown={onShown} />}
        {turn.state === 'answered' && turn.explain && <ExplainAnswer turn={turn} onShown={onShown} />}
        {turn.state === 'answered' && !turn.seed && !turn.intent && !turn.explain && (answer
          ? <AnswerText answer={answer} own={own} show={show} scopeAll={data?.scope === 'all'} onShown={onShown} written={writer.text} />
          : <p className="text-[16px] leading-6 sm:text-[14px]">{words.thread.notLoaded}</p>)}
        {turn.state === 'answered' && !turn.seed && !turn.intent && answer && data && (
          <ReadingChips query={answer.query} loaded={data} own={own} onChange={(query) => updateTurnQuery(turn.id, query)} />
        )}
      </GirovoTile>
    </li>
  );
}

/** The next questions, built from the last answer: asked as they read. */
function useNextQuestions(last: AskQuery | null): string[] {
  const t = useT();
  const words = t.ask;
  if (!last) return words.suggestions;
  const out: string[] = [];
  const before = monthBefore(last.period, dayKey(new Date()));
  if (before) out.push(words.thread.next.monthBefore(fmtMonth(before)));
  // An average over one month is its sum: offered only where the period holds several.
  const days = periodDays(last.period, dayKey(new Date()));
  const months = days ? new Set([days.from.slice(0, 7), days.to.slice(0, 7)]).size : 2;
  // After both ways (a list) an average or "Größte Ausgabe" would be about another set than the answer.
  if (last.dir === 'all') return out;
  if (last.kind !== 'average' && months > 1) out.push(words.thread.next.perMonth);
  if (last.kind !== 'largest' && last.dir !== 'in') out.push(words.thread.next.largest);
  return out;
}

/** The thread itself, for either face: the phone's full-screen view or the desktop's panel. */
function Thread({ face, onClose }: { face: 'screen' | 'panel'; onClose: () => void }) {
  const t = useT();
  const words = t.ask.thread;
  const s = useAskThread();
  const conversation = currentConversation(s);
  const data = useAskScope();
  const { ctx, own } = useAskContext(data?.currency ?? 'EUR');
  const [draft, setDraft] = useState('');
  const fieldId = useId();
  const titleId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const turns = conversation?.turns ?? [];
  const last = [...turns].reverse().find((x) => x.query)?.query ?? null;
  const next = useNextQuestions(last);
  const busy = turns.some((x) => x.state === 'reading');

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [turns.length, turns.at(-1)?.state]);

  const ask = (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    askInThread(q);
    setDraft('');
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    ask(draft);
  };
  // On a phone the thread steps aside for the list an answer opens; the desktop's panel stays beside it.
  const onShown = face === 'screen' ? onClose : () => undefined;

  return (
    <section aria-labelledby={titleId} className="flex min-h-0 flex-1 flex-col">
      <header
        className={cx(
          'flex shrink-0 items-center gap-1',
          face === 'screen' ? 'h-[calc(64px+env(safe-area-inset-top,0px))] pt-[env(safe-area-inset-top,0px)] pr-1 pl-1' : 'h-14 pr-2 pl-5',
        )}
      >
        {face === 'screen' && (
          <IconButton size="md" aria-label={t.common.back} onClick={onClose}>
            <BackIcon size={22} />
          </IconButton>
        )}
        {face === 'panel' && <AiMarkIcon size={20} className="mr-2" aria-hidden />}
        <h2 id={titleId} className={cx('min-w-0 flex-1 truncate text-ink', face === 'screen' ? 'ml-1 text-[22px] leading-7' : 'text-[16px] leading-6 font-medium')}>
          {words.title}
        </h2>
        <Menu
          label={words.conversations}
          placement="bottom-end"
          trigger={(p) => (
            <IconButton {...p} size="md" aria-label={words.conversations}>
              <HistoryIcon size={22} />
            </IconButton>
          )}
        >
          {s.conversations.length === 0
            ? <MenuItem disabled onSelect={() => undefined}>{words.noConversations}</MenuItem>
            : s.conversations.map((c) => (
              <MenuItem key={c.id} onSelect={() => showConversation(c.id)}>
                <span className="block max-w-[260px] truncate">{c.title}</span>
              </MenuItem>
            ))}
          {s.conversations.length > 0 && <MenuSeparator />}
          {s.conversations.length > 0 && (
            <MenuItem tone="danger" onSelect={deleteAllConversations}>{words.deleteAll}</MenuItem>
          )}
        </Menu>
        {conversation && (
          <IconButton size="md" aria-label={words.deleteConversation} onClick={() => deleteConversation(conversation.id)}>
            <TrashIcon size={20} />
          </IconButton>
        )}
        <IconButton size="md" aria-label={words.newConversation} onClick={newConversation}>
          <PlusIcon size={22} />
        </IconButton>
        {face === 'panel' && (
          <IconButton size="md" aria-label={t.common.close} onClick={onClose}>
            <CloseIcon />
          </IconButton>
        )}
      </header>

      <div ref={listRef} className={cx('min-h-0 flex-1 overflow-y-auto overscroll-contain', face === 'screen' ? 'px-4' : 'px-5')}>
        {turns.length === 0 ? (
          <>
          <AskNotes data={data} ctx={ctx} own={own} month={thisMonth()} tile onShown={onShown} />
          <p className="mt-6 max-w-[34ch] text-[16px] leading-6 text-ink-2 sm:text-[14px] sm:leading-5">{words.empty}</p>
          </>
        ) : (
          <ol aria-live="polite" className="flex flex-col gap-5 pt-1 pb-4">
            {turns.map((turn, i) => <TurnView key={turn.id} turn={turn} data={data} ctx={ctx} own={own} onShown={onShown} latest={i === turns.length - 1} />)}
          </ol>
        )}
      </div>

      <div className={cx('shrink-0', face === 'screen' ? 'px-4 pt-2.5 pb-[max(1rem,env(safe-area-inset-bottom))]' : 'px-5 pt-3 pb-5')}>
        {next.length > 0 && (
          <div className="-mx-4 mb-2.5 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0 [&::-webkit-scrollbar]:hidden">
            {next.map((q) => (
              <button
                key={q}
                type="button"
                disabled={busy}
                onClick={() => ask(q)}
                className="h-8 shrink-0 rounded-[8px] bg-paper px-3.5 text-[14px] leading-5 font-medium whitespace-nowrap text-ink shadow-[inset_0_0_0_1px_var(--md-outline-variant)] disabled:opacity-50"
              >
                {q}
              </button>
            ))}
          </div>
        )}
        <form onSubmit={submit} noValidate role="search" className="flex h-14 items-center gap-2 rounded-full bg-inset pr-1.5 pl-5 sm:h-12">
          <label htmlFor={fieldId} className="sr-only">{turns.length ? words.followUp : words.placeholder}</label>
          <input
            id={fieldId}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={turns.length ? words.followUp : words.placeholder}
            enterKeyHint="send"
            autoComplete="off"
            maxLength={160}
            data-autofocus={IS_ANDROID ? '' : 'fine'}
            className="min-w-0 flex-1 bg-transparent text-[16px] leading-6 text-ink outline-none placeholder:text-ink-2 sm:text-[14px]"
          />
          <button
            type="submit"
            aria-label={words.send}
            disabled={!draft.trim() || busy}
            className="grid size-11 shrink-0 place-items-center rounded-full bg-accent text-accent-ink disabled:bg-[color-mix(in_srgb,var(--ink)_10%,transparent)] disabled:text-ink-3 sm:size-9"
          >
            <ArrowRightIcon size={20} />
          </button>
        </form>
      </div>

    </section>
  );
}

/**
 * Once, the first time the thread opens: what asking does. A sibling of the
 * thread's layer, never inside it, so it stacks above it and the thread's
 * inert page stays inert when it closes. "Später" leaves without asking: the
 * conversation it was opened with goes.
 */
function AskIntro() {
  const t = useT();
  const words = t.ask.thread.intro;
  const { vault, updateVault } = useFints();
  const [done, setDone] = useState(false);
  const later = () => {
    setDone(true);
    dropCurrent();
  };
  return (
    <Dialog
      open={!!vault && !vault.askIntroSeen && !done}
      onClose={later}
      title={words.title}
      icon={<AiMarkIcon size={22} />}
      actions={(
        <>
          <Button variant="tertiary" onClick={later}>{words.later}</Button>
          <Button
            onClick={() => {
              setDone(true);
              updateVault((v) => (v.askIntroSeen ? v : { ...v, askIntroSeen: true }));
            }}
          >
            {words.go}
          </Button>
        </>
      )}
    >
      <ul className="flex flex-col gap-2 text-[16px] leading-6 text-ink">
        <li>{words.sentences}</li>
        <li>{words.figures}</li>
      </ul>
    </Dialog>
  );
}

/** The phone's face (and the classic shell's at any width): a full-screen view over the app. */
export function AskThreadScreen() {
  const s = useAskThread();
  const canAsk = useCanAsk();
  const phone = usePhone();
  const t = useT();
  const open = s.open && canAsk;
  return (
    <>
      <Overlay open={open} onClose={closeAsk} align="right" label={t.ask.thread.title}>
        <div className={cx('anim-drawer flex h-dvh w-full flex-col bg-paper', !phone && 'max-w-[480px] shadow-[var(--shadow-pop)]')}>
          <Thread face="screen" onClose={closeAsk} />
        </div>
      </Overlay>
      {open && <AskIntro />}
    </>
  );
}

/** The desktop's face: docked at the sheet's right edge, beside the page it talks about. */
export function AskPanel() {
  const s = useAskThread();
  const canAsk = useCanAsk();
  if (!s.open || !canAsk) return null;
  return (
    <aside className="flex w-[420px] shrink-0 flex-col border-l border-line">
      <Thread face="panel" onClose={closeAsk} />
      <AskIntro />
    </aside>
  );
}

/** Analyse's head (Girovo Next): last month in two sentences, and the way into a conversation about it. */
export function MonthRecap({ narrower = false }: { narrower?: boolean }) {
  const t = useT();
  const words = t.ask.recap;
  const canAsk = useCanAsk();
  // Every loaded account, as the conversation it opens and the list a figure opens count.
  const data = useAskScope();
  const { ctx, own } = useAskContext(data?.currency ?? 'EUR');
  const month = lastMonth();
  const recap = useRecap(data, ctx, month);
  const [hidden, setHidden] = useState(() => hiddenRecaps.has(month));
  const titleId = useId();
  const s = useAskThread();
  const inThread = s.open && currentConversation(s)?.turns[0]?.seed?.month === month;
  if (!canAsk || !recap || hidden || inThread) return null;
  const name = fmtMonth(month).split(' ')[0];
  return (
    <section data-ai aria-labelledby={titleId} className="rounded-[16px] px-4 pt-3 pb-3.5 sm:px-5">
      <div className="mb-1.5 flex items-center gap-2">
        <AiMarkIcon size={16} aria-hidden />
        <h2 id={titleId} className="min-w-0 flex-1 text-[14px] leading-5 font-medium text-ink">{narrower ? words.titleAll(name) : words.title(name)}</h2>
        <IconButton
          size="sm"
          aria-label={words.hide}
          className="-mr-2"
          onClick={() => {
            hiddenRecaps.add(month);
            setHidden(true);
          }}
        >
          <CloseIcon size={16} />
        </IconButton>
      </div>
      <RecapText recap={recap} own={own} />
      <AskNotes data={data} ctx={ctx} own={own} month={month} />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => openAskWithRecap(month, words.conversation(name))}>{words.more}</Button>
      </div>
    </section>
  );
}

/**
 * The Analyse's head: the month recap where asking works; on an Android phone
 * where it does not (no Gemini Nano v4, or no Plus), today's tile that says
 * why. Nothing when asking is switched off.
 */
export function AnalysisAskHead({ data }: { data: ScopeData | null }) {
  const canAsk = useCanAsk();
  const { vault } = useFints();
  const all = useAskScope();
  // The page counts fewer accounts than the recap does (one account, or the ticked layers): the tile says so.
  if (canAsk) return <MonthRecap narrower={!!data && !!all && data.accounts.length < all.accounts.length} />;
  return IS_ANDROID && !vault?.askOff && data ? <AskTile data={data} /> : null;
}
