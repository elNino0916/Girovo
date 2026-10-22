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
import { categoryLabel, counterpartyName } from '@/lib/categories';
import { dayKey, fmtDate, fmtMonth, fmtRange } from '@/lib/format';
import { rich, useT } from '@/lib/i18n/react';
import {
  ASK_MAX_TOKENS, ASK_MIN_NANO, ASK_SYSTEM, askText, asksWith, computeAnswer, parseAskAnswer, periodDays, readQuestion,
  type AskAnswer, type AskQuery,
} from '@/lib/nano-ask';
import { IS_ANDROID } from '@/lib/platform';
import { useFints } from '../FintsProvider';
import { Money } from '../Money';
import { ArrowRightIcon, GeminiSparkIcon } from '../icons';
import { Button, Chip, DotList, IconButton, Input, Spinner, Tag, TileHeader } from '../ui';
import { searchText } from '../transactions/model';
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

type Phase = 'idle' | 'reading' | 'failed' | 'notUnderstood' | 'answered';

export function AskTile({ data }: { data: ScopeData }) {
  const status = useNanoStatus();
  if (!status) return null;
  // Questions need Gemini Nano v4: an older one, or none, says so — and what may help.
  if (status.state !== 'available' || !asksWith(status.askModel ?? status.model)) return <AskUnsupported status={status} />;
  return <AskForm data={data} />;
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
  const { categoryOf, noteOf, vault } = useFints();
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
  const ctx = useMemo(() => ({ categoryOf, shownText: searchText, noteOf }), [categoryOf, noteOf]);
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

  // What the question was read as.
  const days = periodDays(q.period, today);
  // A month by its name, a year by its number — as the question put it.
  const periodText = q.period.kind === 'all' || !days ? words.period.all
    : q.period.kind === 'today' ? words.period.today
      : q.period.kind === 'days' ? words.period.days(q.period.days)
        : q.period.kind === 'months' ? words.period.months(q.period.months)
          : q.period.kind === 'since' ? words.period.since(fmtMonth(q.period.month))
            : q.period.kind === 'month' || q.period.kind === 'lastMonth' || q.period.kind === 'thisMonth' ? fmtMonth(days.from.slice(0, 7))
              : days.from.slice(0, 4);
  const ownName = q.category ? own.find((c) => c.id === q.category)?.name : undefined;
  const read = [
    words.dir[q.dir],
    q.category ? ownName ?? categoryLabel(q.category) : null,
    q.search ? `„${q.search}“` : null, // i18n-data
    periodText,
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
  if (answer.outside) {
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
      {answer.count > 0 && !answer.outside && (
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
