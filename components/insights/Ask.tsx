'use client';

// "Frag deine Umsätze": a question about the bookings on view, at the head of
// the Analyse — on Android, where the phone has Gemini Nano.
//
// Gemini Nano only reads the question into a search (lib/nano-ask.ts): what
// kind of answer, in or out, a category, a name, a period. Girovo works the
// answer out from the bookings this Analyse counts — its accounts, its loaded
// days — and says it in its own words; Nano never states a figure. What the
// question was read as is shown above the answer, so a misreading is seen at
// once, and "Umsätze zeigen" opens the list on exactly the bookings counted.
// A period before the loaded days is said as such ("mind.", "Geladen erst
// ab …"), with the way to load more where nothing at all is loaded.
//
// Nothing leaves the phone: AICore runs Nano on it.

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { bookingDay } from '@/lib/analytics';
import type { SerializedTransaction } from '@/lib/fints-types';
import { categoryLabel, counterpartyName, type CategoryId } from '@/lib/categories';
import { dayKey, fmtDate, fmtMonth, fmtRange } from '@/lib/format';
import { rich, useT } from '@/lib/i18n/react';
import {
  ASK_MAX_TOKENS, ASK_MIN_NANO, ASK_SYSTEM, askText, asksWith, computeAnswer, parseAskAnswer, periodDays, readQuestion,
  type AskAnswer, type AskPeriod, type AskQuery,
} from '@/lib/nano-ask';
import { IS_ANDROID } from '@/lib/platform';
import { askAllowed } from '@/lib/plus';
import { useFints } from '../FintsProvider';
import { Money } from '../Money';
import { ArrowRightIcon, GeminiSparkIcon } from '../icons';
import { Button, Chip, DotList, IconButton, Input, Spinner, Tag, TileHeader } from '../ui';
import { PlusTeaser } from '../android/PlusTeaser';
import { searchText, txText } from '../transactions/model';
import type { ScopeData } from './analysis-model';
import { LoadHistoryButton, RoundMoney, useShowInList } from './shared';

/**
 * What AICore says of Nano on this phone: undefined off Android, null until
 * it has answered. Asked again on the return to Girovo — from Google Play,
 * say, after updating AICore.
 */
function useNanoStatus(): GirovoNanoStatus | null | undefined {
  const [status, setStatus] = useState<GirovoNanoStatus | null | undefined>(undefined);
  useEffect(() => {
    const mobile = IS_ANDROID ? window.girovoMobile : undefined;
    if (!mobile?.ask || !mobile.categories) return;
    const categories = mobile.categories;
    let live = true;
    setStatus(null);
    const check = () => void categories.status().then((s) => live && setStatus(s));
    check();
    const off = categories.onStatus((s) => live && setStatus(s));
    const back = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', back);
    return () => {
      live = false;
      off();
      document.removeEventListener('visibilitychange', back);
    };
  }, []);
  return status;
}

/** Whether this phone can take questions (Gemini Nano v4); undefined while unknown. */
export function useAskable(): boolean | undefined {
  const status = useNanoStatus();
  return status ? status.state === 'available' && asksWith(status.askModel ?? status.model) : undefined;
}

/**
 * A question typed into the search (components/CommandPalette.tsx), handed to
 * the Analyse's "Frag deine Umsätze": asked there once it is on screen, as if
 * typed into its own field. The search names the Analyse; the form takes it.
 */
let handedOver: string | null = null;
const takers = new Set<() => void>();
export function askInAnalysis(question: string): void {
  handedOver = question;
  for (const take of takers) take();
}

type Phase = 'idle' | 'reading' | 'failed' | 'notUnderstood' | 'answered';

export function AskTile({ data }: { data: ScopeData }) {
  const status = useNanoStatus();
  const { plus } = useFints();
  if (!status) return null;
  // Questions need Gemini Nano v4: an older one, or none, says so — and what may
  // help. Plus can't fix that, so it is said before Plus is asked for.
  if (status.state !== 'available' || !asksWith(status.askModel ?? status.model)) return <AskUnsupported status={status} />;
  if (!askAllowed(plus.state)) return <AskLocked />;
  return <AskForm data={data} />;
}

/** "Frag deine Umsätze" in the Play build without Plus: what it does, and the way to Plus. */
function AskLocked() {
  const t = useT();
  const titleId = useId();
  return (
    <section className="panel" aria-labelledby={titleId}>
      <TileHeader
        titleId={titleId}
        title={(
          <span className="inline-flex items-center gap-2">
            <GeminiSparkIcon size={22} />
            {t.ask.title}
          </span>
        )}
      />
      <div className="px-4 pb-4 sm:px-5">
        <PlusTeaser text={t.plus.askTeaser} />
      </div>
    </section>
  );
}

/** "Frag deine Umsätze" on a phone without Nano v4: why, and the way to AICore's update. */
function AskUnsupported({ status }: { status: GirovoNanoStatus }) {
  const t = useT();
  const words = t.ask.unsupported;
  const titleId = useId();
  const model = status.askModel ?? status.model;
  const why = status.state === 'available' ? (model ? words.tooOld(model, ASK_MIN_NANO) : words.unnamed(ASK_MIN_NANO))
    : status.state === 'downloading' || status.state === 'downloadable' ? words.loading
      : status.reason === 'update' ? words.systemUpdate
        : status.reason === 'aicore' ? words.aicore
          : words.none;
  return (
    <section className="panel" aria-labelledby={titleId}>
      <TileHeader
        titleId={titleId}
        title={(
          <span className="inline-flex items-center gap-2">
            <GeminiSparkIcon size={22} />
            {t.ask.title}
          </span>
        )}
        actions={<Tag className="mt-1 mr-1">{words.tag}</Tag>}
      />
      <div className="px-4 pb-4 sm:px-5">
        <p className="text-[14px] leading-snug text-ink">{why}</p>
        {status.state !== 'downloading' && (
          <>
            <p className="mt-1 text-[13px] leading-snug text-ink-2">{words.hint}</p>
            <Button variant="secondary" size="sm" className="mt-3" onClick={() => void window.girovoMobile?.openAICore()}>
              {words.update}
            </Button>
          </>
        )}
      </div>
    </section>
  );
}

function AskForm({ data }: { data: ScopeData }) {
  const { categoryOf, noteOf, vault, brandNames } = useFints();
  const t = useT();
  const words = t.ask;
  const titleId = useId();
  const fieldId = useId();
  const [question, setQuestion] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [query, setQuery] = useState<AskQuery | null>(null);
  const generation = useRef(0);
  const openOn = useShowInList();

  const own = useMemo(
    () => (vault?.customCategories ?? []).map((c) => ({ id: c.id, name: c.name })),
    [vault?.customCategories],
  );
  // The search reads what the Umsätze list reads, so both find the same bookings.
  // A ranking groups payees by the lists' own name — Nano's brand on the phone ("eBay"), tidied by rule elsewhere.
  // brandNames: a brand that arrives later regroups the ranking.
  const ctx = useMemo(
    () => ({ categoryOf, shownText: searchText, noteOf, payeeOf: (tx: SerializedTransaction) => txText(tx).name }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [categoryOf, noteOf, brandNames],
  );
  // Worked out again whenever the bookings in view change: the reading stays, the figure follows.
  const answer = useMemo<AskAnswer | null>(
    () => (query ? computeAnswer(query, data.txs, ctx, { from: data.from, to: data.to }, dayKey(new Date())) : null),
    [query, data, ctx],
  );

  const ask = async (text: string) => {
    const q = text.trim();
    const mobile = window.girovoMobile;
    if (!q || !mobile?.ask) return;
    const gen = ++generation.current;
    setPhase('reading');
    const raw = await mobile.ask(ASK_SYSTEM, askText(q, own), ASK_MAX_TOKENS);
    // A newer question was asked meanwhile: this answer is for nobody.
    if (gen !== generation.current) return;
    // Nano's reading, with what the question says plainly over it; the rules alone where Nano gave none.
    const read = readQuestion(q, parseAskAnswer(raw, own), dayKey(new Date()), own);
    if (!read) {
      setQuery(null);
      setPhase(raw == null ? 'failed' : 'notUnderstood');
      return;
    }
    setQuery(read);
    setPhase('answered');
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void ask(question);
  };

  // A question handed over by the search: on arrival, or at once when the
  // Analyse was already open.
  const askRef = useRef(ask);
  askRef.current = ask;
  useEffect(() => {
    const take = () => {
      const q = handedOver;
      if (!q) return;
      handedOver = null;
      setQuestion(q);
      void askRef.current(q);
    };
    takers.add(take);
    take();
    return () => {
      takers.delete(take);
    };
  }, []);

  return (
    <section className="panel" aria-labelledby={titleId}>
      <TileHeader
        titleId={titleId}
        title={(
          <span className="inline-flex items-center gap-2">
            <GeminiSparkIcon size={22} />
            {words.title}
          </span>
        )}
      />
      <form onSubmit={submit} noValidate className="px-4 sm:px-5" role="search">
        <label htmlFor={fieldId} className="sr-only">{words.title}</label>
        <Input
          id={fieldId}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={words.placeholder}
          enterKeyHint="search"
          autoComplete="off"
          maxLength={160}
          trailing={(
            // Enter submits the form (its one field); the button asks the same.
            <IconButton aria-label={words.ask} disabled={!question.trim() || phase === 'reading'} onClick={() => void ask(question)}>
              <ArrowRightIcon size={20} />
            </IconButton>
          )}
        />
      </form>

      {phase === 'idle' && (
        // Questions to start from: one press asks it.
        <div className="flex gap-2 overflow-x-auto px-4 pt-3 pb-1 [scrollbar-width:none] sm:px-5 [&::-webkit-scrollbar]:hidden">
          {words.suggestions.map((s) => (
            <Chip
              key={s}
              onClick={() => {
                setQuestion(s);
                void ask(s);
              }}
            >
              {s}
            </Chip>
          ))}
        </div>
      )}

      <div role="status" aria-live="polite" className="px-4 pt-3 pb-2 empty:p-0 sm:px-5">
        {phase === 'reading' && (
          <p className="flex items-center gap-2 text-[14px] leading-snug text-ink-2">
            <Spinner size={16} /> {words.reading}
          </p>
        )}
        {phase === 'failed' && <p className="text-[14px] leading-snug text-ink-2">{words.failed}</p>}
        {phase === 'notUnderstood' && <p className="text-[14px] leading-snug text-ink-2">{words.notUnderstood}</p>}
        {phase === 'answered' && answer && (
          <Answer answer={answer} scopeAll={data.scope === 'all'} onShow={openOn} own={own} />
        )}
      </div>
    </section>
  );
}

/** The answer, on Gemini's wash: what was searched, the figure, its basis, the way to the bookings. */
function Answer({ answer, scopeAll, onShow, own }: {
  answer: AskAnswer;
  scopeAll: boolean;
  onShow: ReturnType<typeof useShowInList>;
  own: readonly { id: string; name: string }[];
}) {
  const t = useT();
  const words = t.ask;
  const { query: q } = answer;
  const today = dayKey(new Date());
  const range = fmtRange(answer.from, answer.to);

  // What the question was read as. A month by its name, a year by its number — as the question put it.
  const periodText = (period: AskPeriod): string => {
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
  const nameOf = (id: CategoryId) => own.find((c) => c.id === id)?.name ?? categoryLabel(id);
  const read = [
    words.dir[q.dir],
    q.category ? nameOf(q.category) : null,
    q.search ? `„${q.search}“` : null, // i18n-data
    q.kind === 'rank' && q.rank ? words.rankBy[q.rank.by] : null,
    periodText(q.period),
    q.kind === 'compare' && q.against ? words.versus(periodText(q.against)) : null,
  ].filter(Boolean);

  const atLeast = answer.partial ? <span className="text-[15px] font-normal text-ink-2">{words.atLeast} </span> : null;
  const figure = (cents: number) => (
    <p className="text-[24px] leading-tight font-bold text-ink">
      {atLeast}
      <Money value={cents / 100} tone="plain" />
    </p>
  );
  const bookingLine = (
    <p className="tnum mt-0.5 text-[13px] leading-snug text-ink-2">
      <DotList items={[words.bookings(answer.count), range]} />
    </p>
  );

  let body;
  if (q.kind === 'compare' && answer.compare) {
    const { a, b } = answer.compare;
    const diff = a.cents - b.cents;
    const pct = b.cents > 0 ? Math.round((Math.abs(diff) / b.cents) * 100) : null;
    const side = (x: AskAnswer) => (
      <div className="flex items-baseline justify-between gap-3">
        <span className="tnum min-w-0 text-[14px] text-ink-2">{fmtRange(x.from, x.to)}</span>
        <span className="shrink-0 text-[17px] font-bold text-ink">
          {x.partial && <span className="text-[13px] font-normal text-ink-2">{words.atLeast} </span>}
          <Money value={x.cents / 100} tone="plain" />
        </span>
      </div>
    );
    body = (
      <>
        <p className="text-[24px] leading-tight font-bold text-ink">
          {diff === 0 ? words.same : (
            <>
              <Money value={Math.abs(diff) / 100} tone="plain" />
              <span className="text-[15px] font-normal text-ink-2"> {diff > 0 ? words.more : words.less}{pct != null ? ` (${pct} %)` : ''}</span>
            </>
          )}
        </p>
        <div className="mt-2 flex flex-col gap-1">
          {side(a)}
          {side(b)}
        </div>
        {(a.outside || b.outside) && <p className="mt-1 text-[13px] leading-snug text-ink-2">{words.compareMissing}</p>}
      </>
    );
  } else if (q.kind === 'rank' && answer.rank) {
    const rank = q.rank!;
    body = answer.rank.length === 0 ? (
      <p className="text-[15px] leading-snug font-semibold text-ink">{words.none}</p>
    ) : (
      <>
        <p className="text-[13px] leading-snug font-medium text-ink-2">{words.rankTitle[rank.by][rank.metric][q.dir === 'in' ? 'in' : 'out']}</p>
        <ol className="mt-1 flex flex-col">
          {answer.rank.map((row, i) => (
            <li key={row.key}>
              {/* The name gets the width; its share (or how often) goes under it. */}
              <button
                type="button"
                className="flex w-full items-baseline gap-3 rounded-[10px] py-1.5 text-left"
                onClick={() => onShow(null, { ...row.filter, ...(scopeAll ? { acrossAccounts: true } : {}) })}
              >
                <span className="tnum w-4 shrink-0 text-[13px] text-ink-2">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] leading-snug text-ink">{row.category ? nameOf(row.category) : row.name}</span>
                  <span className="tnum block text-[12.5px] leading-snug text-ink-2">
                    {rank.metric === 'count' ? words.times(row.count) : `${Math.round(row.share * 100)} %`}
                  </span>
                </span>
                <Money value={row.cents / 100} tone="plain" className="shrink-0 text-[15px] font-semibold" />
              </button>
            </li>
          ))}
        </ol>
        {bookingLine}
      </>
    );
  } else if (answer.outside) {
    body = (
      <>
        <p className="text-[15px] leading-snug text-ink">{words.outside}</p>
        <LoadHistoryButton className="mt-2" layout="stacked" />
      </>
    );
  } else if (answer.count === 0) {
    body = (
      <>
        <p className="text-[15px] leading-snug font-semibold text-ink">{words.none}</p>
        <p className="mt-0.5 text-[13px] leading-snug text-ink-2">{words.noneHint(range)}</p>
      </>
    );
  } else if ((q.kind === 'largest' || q.kind === 'last') && answer.tx) {
    const tx = answer.tx;
    body = (
      <>
        <p className="text-[13px] leading-snug font-medium text-ink-2">
          {q.kind === 'last' ? words.last(fmtDate(bookingDay(tx))) : tx.amount > 0 ? words.largestIn : words.largestOut}
        </p>
        <div className="mt-1 flex items-baseline justify-between gap-3">
          <span className="min-w-0 truncate text-[15px] leading-snug font-semibold text-ink">{counterpartyName(tx)}</span>
          <Money value={tx.amount} signed tone="credit" className="shrink-0 text-[17px] font-bold" />
        </div>
        <p className="tnum mt-0.5 text-[13px] leading-snug text-ink-2">{fmtDate(bookingDay(tx))}</p>
      </>
    );
  } else if (q.kind === 'count') {
    body = (
      <>
        <p className="text-[24px] leading-tight font-bold text-ink">{atLeast}{words.times(answer.count)}</p>
        <p className="tnum mt-0.5 text-[13px] leading-snug text-ink-2">
          <DotList items={[rich(words.together(<Money value={answer.cents / 100} tone="plain" />)), range]} />
        </p>
      </>
    );
  } else if (q.kind === 'average') {
    body = answer.months > 0 ? (
      <>
        <p className="text-[24px] leading-tight font-bold text-ink">
          <span className="text-[15px] font-normal text-ink-2">{words.approx} </span>
          <RoundMoney value={answer.cents / answer.months / 100} />
          <span className="text-[15px] font-normal text-ink-2"> {words.perMonth}</span>
        </p>
        <p className="mt-0.5 text-[13px] leading-snug text-ink-2">{words.averageBasis(answer.months)}</p>
      </>
    ) : (
      <>
        <p className="mb-1 text-[13px] leading-snug text-ink-2">{words.noWholeMonth}</p>
        {figure(answer.cents)}
        {bookingLine}
      </>
    );
  } else if (q.dir === 'all') {
    body = (
      <>
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[14px] text-ink-2">{words.spent}</span>
          <span className="text-[17px] font-bold text-ink">{atLeast}<Money value={answer.outCents / 100} tone="plain" /></span>
        </div>
        <div className="mt-1 flex items-baseline justify-between gap-3">
          <span className="text-[14px] text-ink-2">{words.received}</span>
          <span className="text-[17px] font-bold text-ink">{atLeast}<Money value={answer.inCents / 100} tone="plain" /></span>
        </div>
        {bookingLine}
      </>
    );
  } else {
    body = (
      <>
        <p className="text-[13px] leading-snug font-medium text-ink-2">{q.dir === 'in' ? words.received : words.spent}</p>
        {figure(answer.cents)}
        {bookingLine}
      </>
    );
  }

  return (
    <div data-gemini className="rounded-[16px] p-4">
      <p className="text-[12.5px] leading-snug font-medium text-ink-2">{words.understood}</p>
      <DotList items={read} className="mt-0.5 text-[14px] leading-snug text-ink" />
      <div className="mt-3">{body}</div>
      {answer.partial && <p className="mt-2 text-[13px] leading-snug text-ink-2">{words.partial(fmtDate(answer.from))}</p>}
      {answer.count > 0 && !answer.outside && q.kind !== 'rank' && (
        <Button
          variant="tertiary"
          size="sm"
          className="mt-2 -ml-4"
          onClick={() => onShow(answer.tx, { ...answer.filter, ...(scopeAll ? { acrossAccounts: true } : {}) })}
        >
          {words.show}
        </Button>
      )}
      <p className="mt-2 flex items-center gap-1.5 text-[12.5px] leading-snug text-ink-2">
        <GeminiSparkIcon size={14} />
        {words.basis}
      </p>
    </div>
  );
}
