'use client';

// Girovo Next, "Fragen": a conversation about the bookings (owner's pick
// "Gespräch", 2026-11-11; .impeccable/mocks/decision/next-ai/a-gespraech.png).
//
// The user's questions are bubbles in the tonal wash; Girovo's answers are
// tiles on Gemini's wash, a few plain sentences in which every figure is the
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
import type { FormEvent, ReactNode } from 'react';
import { followUp, monthBefore } from '@/lib/ask-followup';
import { segments, usable, writerInput, writerSystem, type WriterLang } from '@/lib/gemma-writer';
import { bookingDay, periodTotals } from '@/lib/analytics';
import { categoryLabel, counterpartyName, type CategoryId } from '@/lib/categories';
import type { SerializedTransaction } from '@/lib/fints-types';
import { dayKey, fmtDate, fmtMonth, fmtRange } from '@/lib/format';
import { activeLocale, intlLocale } from '@/lib/i18n/locale';
import { useT } from '@/lib/i18n/react';
import {
  ASK_MAX_TOKENS, ASK_SYSTEM, askText, categoryFromQuestion, computeAnswer, nameFromPayees, parseAskAnswer, periodDays,
  questionTopic, readQuestion,
  type AskAnswer, type AskPeriod, type AskQuery, type NanoReading,
} from '@/lib/nano-ask';
import { IS_ANDROID } from '@/lib/platform';
import { useFints } from '../FintsProvider';
import { Money } from '../Money';
import { ArrowRightIcon, BackIcon, CloseIcon, GeminiSparkIcon, HistoryIcon, PlusIcon } from '../icons';
import { usePhone } from '../shell/usePhone';
import { Button, Dialog, IconButton, Menu, MenuItem, Overlay, Spinner, cx } from '../ui';
import { searchText, txText } from '../transactions/model';
import { useScopeData, type ScopeData } from './analysis-model';
import { AskTile } from './Ask';
import { useCanAsk } from './ask-gate';
import {
  askInThread, clearAsk, closeAsk, currentConversation, dropCurrent, hiddenRecaps, newConversation, openAskWithRecap, settleTurn,
  settleWritten, showConversation, useAskThread, type Turn,
} from './ask-thread-store';
import { gemmaPrompt, gemmaUsable, useGemma } from './gemma';
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
        const prev = [...c.turns.slice(0, i)].reverse().find((t) => t.query)?.query ?? null;
        void (async () => {
          const q = turn.question;
          const today = dayKey(new Date());
          const mobile = IS_ANDROID ? window.girovoMobile : undefined;
          if (IS_ANDROID && !mobile?.ask) {
            settleTurn(turn.id, { state: 'failed' });
            return;
          }
          const raw = mobile?.ask ? await mobile.ask(ASK_SYSTEM, askText(q, own), ASK_MAX_TOKENS) : null;
          // The desktop with Gemma: Gemma reads the question (the prompt Nano reads on a phone),
          // a payee's name the question names is taken from the loaded bookings, and the rules
          // put what the question says plainly over both (readQuestion). Without an answer from
          // Gemma, the built-in model reads it as before.
          const fromGemma = !mobile?.ask && gemmaReady ? parseAskAnswer(await gemmaPrompt(ASK_SYSTEM, askText(q, own), ASK_MAX_TOKENS), own) : null;
          const reading = mobile?.ask ? parseAskAnswer(raw, own)
            : fromGemma ? { ...fromGemma, search: fromGemma.search ?? nameFromPayees(q, payees) }
              : await builtInReading(q, payees, askCategory);
          const read = readQuestion(q, reading, today, own);
          if (!read) {
            settleTurn(turn.id, { state: mobile?.ask && raw == null ? 'failed' : 'notUnderstood' });
            return;
          }
          settleTurn(turn.id, { state: 'answered', query: followUp(prev, q, read, today) });
        })().finally(() => inflight.current.delete(turn.id));
      });
    }
  }, [s, own, payees, askCategory, gemmaReady]);
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
  const open = (tx: SerializedTransaction | null, filter: AskAnswer['filter']) => {
    show(tx, { ...filter, ...across });
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
    const rank = q.rank!;
    const first = answer.rank[0];
    if (!first) lines.push([words.none]);
    else {
      const name = (row: typeof first) => (row.category ? nameOf(row.category) : row.name ?? '');
      lines.push(say.rank(words.rankTitle[rank.by][rank.metric][q.dir === 'in' ? 'in' : 'out'], name(first), money(first.cents, first.filter as AskAnswer['filter'])));
      extra = (
        <ol className="mt-3 -mx-2 flex flex-col rounded-[12px] bg-[color-mix(in_srgb,var(--paper)_72%,transparent)] py-1">
          {answer.rank.slice(0, 5).map((row, i) => (
            <li key={row.key}>
              <button
                type="button"
                className="flex min-h-12 w-full items-center gap-3 rounded-[12px] px-3 text-left"
                onClick={() => open(null, row.filter as AskAnswer['filter'])}
              >
                <span className="tnum w-4 shrink-0 text-[14px] text-ink-2">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-ink">{name(row)}</span>
                <Money value={row.cents / 100} currency={currency} tone="plain" className="shrink-0 text-[14px] font-medium" />
              </button>
            </li>
          ))}
        </ol>
      );
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
  return (
    <>
      {segments(text, writerLang()).map((seg, i) => {
        if ('text' in seg) return <Fragment key={i}>{seg.text}</Fragment>;
        const filter = filters.get(seg.cents) ?? (tx && Math.abs(Math.round(tx.amount * 100)) === seg.cents ? answer.filter : undefined);
        return (
          <Fig key={i} onShow={filter ? () => open(tx, filter) : undefined}>
            <Money value={seg.cents / 100} currency={answer.currency} tone="plain" />
          </Fig>
        );
      })}
    </>
  );
}

/** What an answer's figures are: Gemma's sentences belong to these, and are written again when they change. */
// The language too: a sentence is said in the language it was written in, or written again.
const answerKey = (a: AskAnswer) => JSON.stringify([writerLang(), a.cents, a.count, a.from, a.to, a.partial, a.outside, a.outCents, a.inCents, a.rank?.slice(0, 5).map((r) => r.cents)]);

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
    if (!ready || !answer || turn.seed || !turn.question || current || !latest) return;
    const job = `${turn.id}:${key}`;
    if (writing.has(job)) return;
    writing.add(job);
    const lang = writerLang();
    const nameOf = (id: CategoryId) => own.find((c) => c.id === id)?.name ?? categoryLabel(id);
    const input = writerInput(turn.question, answer, { lang, nameOf, payeeOf: (tx) => ctx.payeeOf?.(tx) || counterpartyName(tx) });
    void gemmaPrompt(writerSystem(lang), input.prompt, 160)
      .then((text) => settleWritten(turn.id, usable(text, input) ? text.trim() : false, key))
      .finally(() => writing.delete(job));
  }, [ready, answer, turn.id, turn.question, turn.seed, key, current, ctx, own, latest]);
  if (!ready || !answer || turn.seed) return { pending: false };
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

/** One of Girovo's turns: the tile on Gemini's wash. */
function GirovoTile({ children, busy }: { children: ReactNode; busy?: boolean }) {
  const words = useT().ask.thread;
  return (
    <div data-gemini className="rounded-[16px] px-4 pt-3 pb-3.5">
      <span className="sr-only">{words.girovo}</span>
      <GeminiSparkIcon size={16} className="mb-1.5 block" aria-hidden />
      {busy ? <span className="flex h-6 items-center"><Spinner size={16} /></span> : children}
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
        <div className="ml-auto w-fit max-w-[85%] rounded-[20px] rounded-br-[4px] bg-accent-soft px-4 py-2.5 text-[16px] leading-6 text-[var(--tonal-ink)] sm:text-[14px] sm:leading-5">
          <span className="sr-only">{words.thread.you} </span>
          {turn.question}
        </div>
      )}
      <GirovoTile busy={turn.state === 'reading' || writer.pending}>
        {turn.seed && (recap ? <RecapText recap={recap} own={own} onShown={onShown} /> : <p className="text-[16px] leading-6 sm:text-[14px]">{data ? words.outside : words.thread.notLoaded}</p>)}
        {turn.state === 'failed' && <p className="text-[16px] leading-6 sm:text-[14px]">{words.failed}</p>}
        {turn.state === 'notUnderstood' && <p className="text-[16px] leading-6 sm:text-[14px]">{IS_ANDROID ? words.notUnderstood : words.desktop.notUnderstood}</p>}
        {turn.state === 'answered' && !turn.seed && (answer
          ? <AnswerText answer={answer} own={own} show={show} scopeAll={data?.scope === 'all'} onShown={onShown} written={writer.text} />
          : <p className="text-[16px] leading-6 sm:text-[14px]">{words.thread.notLoaded}</p>)}
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
        {face === 'panel' && <GeminiSparkIcon size={20} className="mr-2" aria-hidden />}
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
        </Menu>
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
          <p className="mt-6 max-w-[34ch] text-[16px] leading-6 text-ink-2 sm:text-[14px] sm:leading-5">{words.empty}</p>
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
      icon={<GeminiSparkIcon size={22} />}
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
    <section data-gemini aria-labelledby={titleId} className="rounded-[16px] px-4 pt-3 pb-3.5 sm:px-5">
      <div className="mb-1.5 flex items-center gap-2">
        <GeminiSparkIcon size={16} aria-hidden />
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
