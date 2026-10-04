'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { bankAnswerLines, formatBankAnswer, refusalReference } from '@/lib/bank-answer';
import { fmtIban } from '@/lib/format';
import type { SerializedTanMethod } from '@/lib/fints-types';
import { useFints, type WaitKind, type WaitOrder, type WaitState } from './FintsProvider';
import { AlertTriangleIcon, BoltIcon, CheckCircleIcon, ClockIcon, CloseIcon, InfoIcon, PhoneIcon } from './icons';
import { Money } from './Money';
import { VopBadge } from './VopResult';
import { Alert, Button, Dialog, DialogActions, Overlay, Sheet, Spinner, Tag, cx } from './ui';

/**
 * The decoupled approval beat: the user leaves for their banking app and comes
 * back. The elapsed counter is deliberate — a spinner alone gives no sense of
 * whether the request has stalled — and where the bank has said how long it
 * will wait, a thin bar shows how much of that is used up.
 *
 * Not dismissable by Escape or the backdrop: the only ways out are the
 * explicit buttons, because leaving abandons the bank's request.
 */
export function TanWaitOverlay() {
  const { wait } = useFints();
  if (!wait.open) return null;
  return <TanWait />;
}

/**
 * What each approval is called while it is waited for — in the app's own
 * words, so an approval right after another one never looks like the first
 * one again. What it covers (account, from-date) goes in the sentence below,
 * not in the title.
 */
const WAIT_TITLE: Record<WaitKind, string> = {
  login: 'Anmeldung freigeben',
  statements: 'Umsatzabruf freigeben',
  pending: 'Vorgemerkte Umsätze freigeben',
  balance: 'Saldoabfrage freigeben',
  transfer: 'Überweisung freigeben',
};

/** What the screen behind is about to do once the approval is in. */
const AFTER_CONFIRM: Record<WaitKind, string> = {
  login: 'Deine Konten werden geladen …',
  statements: 'Umsätze werden geladen …',
  pending: 'Vorgemerkte Umsätze werden geladen …',
  balance: 'Der Saldo wird abgerufen …',
  // The transfer sheet already shows the bank's answer by now.
  transfer: 'Die Überweisung ist freigegeben.',
};

/**
 * The bank refused: the user pressed "Ablehnen" in the app, or the bank said
 * no. A transfer never ends up here — its sheet has a step of its own for a
 * refusal — but the entry keeps the map complete.
 */
const REFUSED: Record<WaitKind, { title: string; text: string }> = {
  login: { title: 'Anmeldung nicht freigegeben', text: 'Deine Bank hat die Anmeldung abgelehnt:' },
  statements: { title: 'Umsatzabruf nicht freigegeben', text: 'Deine Bank hat den Abruf abgelehnt:' },
  pending: { title: 'Abruf nicht freigegeben', text: 'Deine Bank hat den Abruf abgelehnt:' },
  balance: { title: 'Saldoabfrage nicht freigegeben', text: 'Deine Bank hat die Abfrage abgelehnt:' },
  transfer: { title: 'Überweisung nicht ausgeführt', text: 'Deine Bank hat den Auftrag abgelehnt:' },
};

function TanWait() {
  const { wait, retryWait, cancelWait, selectedMethod, tanMethods } = useFints();
  const uid = useId();
  const titleId = `tanwait${uid}-title`;
  const textId = `tanwait${uid}-text`;
  const helpId = `tanwait${uid}-help`;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [confirmAbort, setConfirmAbort] = useState(false);
  /** Null until the user opens or closes the help — from then on their choice holds. */
  const [helpChoice, setHelpChoice] = useState<boolean | null>(null);

  const kind = wait.kind ?? 'statements';
  const waiting = wait.phase === 'waiting';
  const confirmed = wait.phase === 'confirmed';
  const failed = wait.phase === 'error';
  const refused = wait.phase === 'refused';

  // The method this approval runs on — the same one the provider attributes a
  // mid-session approval to.
  const method: SerializedTanMethod | null =
    selectedMethod ?? tanMethods.find((m) => m.isDecoupled) ?? null;
  // Where to look: the device the bank named for this very challenge, else
  // the method's only active medium. With several and none named, nothing —
  // a guess would send the user to the wrong phone.
  const device =
    wait.tanMediaName?.trim()
    || (method?.activeTanMedia?.length === 1 ? method.activeTanMedia[0] : null);
  const limit = bankWaitLimit(method);
  // Past the bank's own limit the bar would only say "full" while the counter
  // runs on: the wait says so instead, and offers what is honest.
  const overdue = useOverdue(wait.startedAt, limit, waiting);
  // Opens by itself once the limit has passed, unless the user decided.
  const helpOpen = helpChoice ?? overdue;

  const title = confirmed ? 'Freigabe bestätigt'
    : failed ? 'Freigabe konnte nicht geprüft werden'
      : refused ? REFUSED[kind].title
        : wait.title || WAIT_TITLE[kind];
  const text = confirmed
    ? AFTER_CONFIRM[kind]
    : failed
      ? 'Ob die Freigabe angekommen ist, ließ sich nicht feststellen.'
      : refused
        ? REFUSED[kind].text
        : wait.text;

  // Each new state of the dialog is read out from its title: focus moves
  // there on open (initialFocus) and again when the phase changes, so focus
  // is never left on a button that just disappeared. Focus already in another
  // dialog stays there: a screen that opened over this one with the result —
  // the transfer sheet's done step — has placed it on its own heading.
  const firstPhase = useRef(true);
  useEffect(() => {
    if (firstPhase.current) { firstPhase.current = false; return; }
    const heading = headingRef.current;
    const active = document.activeElement;
    const own = heading?.closest('[role="dialog"]');
    if (active?.closest('[role="dialog"]') && !own?.contains(active)) return;
    heading?.focus({ preventScroll: true });
  }, [wait.phase, wait.title]);

  // The question only makes sense while the approval can still arrive.
  useEffect(() => { if (!waiting) setConfirmAbort(false); }, [waiting]);

  const cancel = () => {
    // Abandoning a transfer's approval leaves the order's fate unknown — the
    // bank may already have it. Make that a decision, not a reflex.
    if (wait.kind === 'transfer' && waiting) {
      setConfirmAbort(true);
      return;
    }
    void cancelWait();
  };

  const challenge = wait.challenge ? plainChallenge(wait.challenge) : '';
  const live = waiting || confirmed;
  // The bank's own words, without their return codes (lib/bank-answer.ts). A
  // refusal is told by its reason alone, as the login screen tells an error;
  // anything else keeps every line the bank sent.
  const answerLines = refused ? formatBankAnswer(wait.error).lines : bankAnswerLines(wait.error);
  const reference = refused ? refusalReference(wait.error) : '';
  // A new request is offered once this one is over — or overdue. Never for a
  // transfer: an order is not sent twice behind the user's back.
  const offerRetry = wait.canRetry && kind !== 'transfer' && (!waiting || overdue);
  const methodName = method?.name ?? null;

  return (
    <>
      <Overlay open labelledBy={titleId} describedBy={textId} initialFocus={headingRef}>
        <Sheet
          size="sm"
          band={{ icon: <BandIcon phase={wait.phase} />, tone: 'navy' }}
          // Below the scrolling body: the wait's status (the counter, the
          // bank's limit, "Frist abgelaufen") and "Abbrechen" stay in view
          // together in a short window or at 200 %, while the order to
          // compare and the bank's request scroll.
          footer={
            <>
              {live && (
                <WaitProgress
                  startedAt={wait.startedAt}
                  settledAt={wait.settledAt}
                  limit={limit}
                  done={confirmed}
                  overdue={overdue}
                  className={confirmed ? undefined : 'mb-5 short:mb-3'}
                />
              )}
              {!confirmed && (
                <DialogActions align="center" className="">
                  <Button onClick={cancel}>{waiting ? 'Abbrechen' : 'Schließen'}</Button>
                  {offerRetry && (
                    <Button variant="primary" onClick={retryWait}>
                      {refused || waiting ? 'Neue Anfrage senden' : 'Erneut versuchen'}
                    </Button>
                  )}
                </DialogActions>
              )}
            </>
          }
        >
          <div className="text-center">
            {/* Title and sentence are the live part; the ticking counter below
                is deliberately outside it, or it would talk every second. */}
            <div role="status" aria-live="polite" aria-atomic="true">
              <h2
                ref={headingRef}
                id={titleId}
                tabIndex={-1}
                className="text-[22px] leading-tight font-bold text-headline outline-none"
              >
                {title}
              </h2>
              <p id={textId} className="mx-auto mt-1.5 max-w-[36ch] text-[15px] leading-snug text-ink-2">{text}</p>
              {wait.note && waiting && (
                <p className="mx-auto mt-2.5 flex max-w-[40ch] items-start justify-center gap-1.5 text-left text-[13.5px] leading-snug text-ink-2">
                  <InfoIcon size={16} className="mt-px shrink-0 text-info" />
                  <span>{wait.note}</span>
                </p>
              )}
              {overdue && <span className="sr-only">Die Frist deiner Bank ist abgelaufen.</span>}
            </div>

            {/* Where to look, and what the bank says — while there is still
                something to confirm, and through the short confirmed beat
                so the dialog does not collapse under the user's eyes. */}
            {device && live && (
              <p className="mt-3 inline-flex max-w-full items-center gap-1.5 text-[13.5px] text-ink-3">
                <PhoneIcon size={16} className="shrink-0" />
                <span className="truncate">
                  Gerät: <span className="font-semibold text-ink-2">{device}</span>
                </span>
              </p>
            )}

            {/* The bank kept the challenge alive through its Namensabgleich, or
                the user went ahead after seeing it: the result rides along
                with the approval prompt. */}
            {wait.vop && <VopBadge vop={wait.vop} />}

            {wait.order && live && <OrderToCompare order={wait.order} method={methodName} />}

            {challenge && live && (
              <figure className="mt-4 text-left">
                {wait.order && <figcaption className="mb-1.5 text-[13px] font-semibold text-ink-2">Anfrage deiner Bank</figcaption>}
                <p className="rounded-[var(--radius-chip)] bg-inset px-4 py-3 text-[14px] leading-relaxed text-balance whitespace-pre-line text-ink-2">
                  {challenge}
                </p>
              </figure>
            )}

            {waiting && (
              <div className="mt-4 text-left">
                <Button
                  variant="tertiary"
                  size="xs"
                  className="-ml-3"
                  aria-expanded={helpOpen}
                  aria-controls={helpId}
                  onClick={() => setHelpChoice(!helpOpen)}
                >
                  Keine Anfrage bekommen?
                </Button>
                <ul
                  id={helpId}
                  hidden={!helpOpen}
                  className="mt-1.5 list-disc space-y-1 pl-5 text-[13.5px] leading-snug text-ink-2 marker:text-ink-3"
                >
                  <li>
                    {methodName
                      ? <>Öffne „{methodName}“ selbst, auch wenn keine Mitteilung erschienen ist.</>
                      : 'Öffne deine Banking-App selbst, auch wenn keine Mitteilung erschienen ist.'}
                  </li>
                  <li>
                    {device
                      ? <>Sieh auf dem Gerät nach, das deine Bank angefragt hat: „{device}“.</>
                      : 'Hast du mehrere Geräte für die Freigabe eingerichtet, sieh auf allen nach.'}
                  </li>
                  <li>Prüfe, ob die App auf deinem Telefon Mitteilungen senden darf.</li>
                </ul>
              </div>
            )}

            {refused && answerLines.length > 0 && (
              <figure className="mt-4 text-left">
                <ul className="rounded-[var(--radius-chip)] bg-inset px-4 py-3 text-[14px] leading-relaxed break-words text-ink">
                  {answerLines.map((l) => <li key={l}>{l}</li>)}
                </ul>
                {reference && (
                  <figcaption className="mt-1.5 text-[12.5px] text-ink-3">
                    Rückmeldung der Bank: <span className="tnum">{reference}</span>
                  </figcaption>
                )}
              </figure>
            )}

            {failed && answerLines.length > 0 && (
              <Alert className="mt-5 text-left">
                {answerLines.length === 1 ? answerLines[0] : (
                  <ul className="space-y-0.5">{answerLines.map((l) => <li key={l}>{l}</li>)}</ul>
                )}
              </Alert>
            )}
          </div>
        </Sheet>
      </Overlay>

      <Dialog
        open={confirmAbort && waiting}
        onClose={() => setConfirmAbort(false)}
        title="Freigabe abbrechen?"
        description={
          <>
            Die Überweisung wurde vielleicht schon ausgeführt. Brichst du jetzt ab, bleibt ihr Status unklar –
            prüfe deine Umsätze, bevor du sie noch einmal sendest.
          </>
        }
        actions={
          <>
            <Button
              onClick={() => {
                setConfirmAbort(false);
                void cancelWait();
              }}
            >
              Trotzdem abbrechen
            </Button>
            <Button variant="primary" data-autofocus onClick={() => setConfirmAbort(false)}>
              Weiter warten
            </Button>
          </>
        }
      />
    </>
  );
}

/**
 * The transfer being approved, in the app's own words — so the comparison
 * with the banking app does not depend on what the bank's challenge text
 * happens to include. The full IBAN, as the banking app shows it. The amount
 * is shown whatever "Beträge ausblenden" says: it is what is being checked,
 * as on the review step.
 */
function OrderToCompare({ order, method }: { order: WaitOrder; method: string | null }) {
  return (
    <div className="mt-4">
      <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
        <Money value={order.amount} currency="EUR" masked={false} className="text-[24px] leading-tight font-bold text-headline" />
        {order.instant && <Tag tone="info" size="sm" icon={<BoltIcon size={12} />}>Echtzeit</Tag>}
      </p>
      <p className="mt-0.5 text-[15px] leading-snug font-semibold break-words text-ink">an {order.name}</p>
      <p className="iban mt-0.5 overflow-x-auto text-[14px] text-ink-2 [scrollbar-width:none]">{fmtIban(order.iban)}</p>
      <p className="mx-auto mt-2 max-w-[36ch] text-[13.5px] leading-snug text-ink-3">
        {method ? <>Vergleiche das mit der Anzeige in „{method}“.</> : 'Vergleiche das mit der Anzeige in deiner Banking-App.'}
      </p>
    </div>
  );
}

/**
 * Whether the bank's own time limit for this approval has passed while it is
 * still being waited for. One timer, one re-render — the ticking counter lives
 * in WaitProgress and stays there.
 */
function useOverdue(startedAt: number, limit: number | null, active: boolean): boolean {
  // The wait (known by its start) whose limit has passed.
  const [passedFor, setPassedFor] = useState<number | null>(null);
  useEffect(() => {
    if (!active || !limit) return;
    const t = setTimeout(() => setPassedFor(startedAt), Math.max(0, startedAt + limit * 1000 - Date.now()));
    return () => clearTimeout(t);
  }, [startedAt, limit, active]);
  return active && !!limit && passedFor === startedAt;
}

/**
 * How long the bank says it will wait for the approval, in seconds: the pause
 * before its first status answer plus pause × number of status requests it
 * accepts. Null when it did not say, or said something implausible (some
 * banks send placeholder maxima) — then no bar, just the counter.
 */
function bankWaitLimit(method: SerializedTanMethod | null): number | null {
  const d = method?.decoupled;
  if (!d || !(d.waitBetween > 0) || !(d.maxStatusRequests > 0)) return null;
  const total = Math.max(0, d.waitBeforeFirst || 0) + d.waitBetween * d.maxStatusRequests;
  return total >= 20 && total <= 30 * 60 ? total : null;
}

const fmtClock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

// Whole minutes rounded down: "bis zu" is a promise about the latest moment,
// so it never names a minute the bank will not wait for.
const fmtLimit = (s: number) => (s < 120 ? `${Math.round(s)} Sekunden` : `${Math.floor(s / 60)} Minuten`);

/**
 * Whole seconds from `startedAt` to now, or to `settledAt` once the wait has
 * stopped. The clock ticks here, in the one component that shows it: kept in
 * the provider it would re-render the whole dashboard every second of every
 * approval. Each tick lands just after the next whole second since the start,
 * so the counter never skips or repeats one.
 */
function useSecondsSince(startedAt: number, settledAt: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (settledAt != null) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      const n = Date.now();
      setNow(n);
      const into = (((n - startedAt) % 1000) + 1000) % 1000;
      timer = setTimeout(tick, 1000 - into + 15);
    };
    tick();
    return () => clearTimeout(timer);
  }, [startedAt, settledAt]);
  return Math.max(0, Math.floor(((settledAt ?? now) - startedAt) / 1000));
}

/**
 * The wait's status line, counter and the bank's limit. It lives in the
 * sheet's pinned footer, above the buttons, so a short window never hides it
 * below the fold while the bank's deadline runs out. In a short window the
 * limit's note gives up its line; the bar still shows how much is used, and
 * the overdue line replaces both once it has passed.
 */
function WaitProgress({ startedAt, settledAt, limit, done, overdue, className }: {
  startedAt: number;
  settledAt: number | null;
  limit: number | null;
  done: boolean;
  /** Still waiting, past the bank's limit. */
  overdue: boolean;
  className?: string;
}) {
  const elapsed = useSecondsSince(startedAt, settledAt);
  const share = done ? 1 : limit ? Math.min(1, elapsed / limit) : 0;
  return (
    <div className={cx('text-left', className)}>
      <div className="flex items-center justify-between gap-3 text-[14px]">
        {done ? (
          <span className="flex items-center gap-2.5 font-semibold text-green">
            <CheckCircleIcon size={17} />
            Bestätigt
          </span>
        ) : (
          <span className="flex items-center gap-2.5 font-semibold text-ink-2">
            <Spinner size={16} className="text-headline" />
            {overdue ? 'Noch keine Bestätigung' : 'Warte auf Bestätigung'}
          </span>
        )}
        <span className="tnum text-ink-3">
          <span className="sr-only">Seit </span>
          {fmtClock(elapsed)}
        </span>
      </div>
      {limit && (overdue ? (
        <p className="mt-2.5 flex items-start gap-1.5 text-[13px] leading-snug text-ink-2">
          <AlertTriangleIcon size={15} className="mt-px shrink-0 text-emphasis" />
          <span>Die Frist deiner Bank von {fmtLimit(limit)} ist abgelaufen.</span>
        </p>
      ) : (
        <>
          <div aria-hidden className="mt-2.5 h-1 overflow-hidden rounded-full bg-inset">
            <div
              // Navy, not Signal Blue: like every progress fill, it cannot be pressed.
              className={cx('h-full rounded-full transition-[width] duration-1000 ease-linear', done ? 'bg-green' : 'bg-headline')}
              style={{ width: `${(share * 100).toFixed(2)}%` }}
            />
          </div>
          <p className="mt-2 text-[12.5px] leading-snug text-ink-3 short:sr-only">
            {done ? 'Rechtzeitig angekommen.' : `Deine Bank wartet bis zu ${fmtLimit(limit)} auf die Freigabe.`}
          </p>
        </>
      ))}
    </div>
  );
}

/** The band's pictogram: a phone that pulses while the bank waits on it. */
function BandIcon({ phase }: { phase: WaitState['phase'] }) {
  let glyph: ReactNode;
  if (phase === 'confirmed') {
    glyph = (
      <svg viewBox="0 0 24 24" width={26} height={26} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
        <path
          d="M5 12.5l4.5 4.5L19 7.5"
          strokeDasharray={24}
          style={{ ['--check-len' as string]: 24, animation: 'check-draw .38s cubic-bezier(.2,.8,.2,1) both' }}
        />
      </svg>
    );
  } else if (phase === 'ended') {
    glyph = <ClockIcon size={24} />;
  } else if (phase === 'error') {
    glyph = <AlertTriangleIcon size={24} />;
  } else if (phase === 'refused') {
    glyph = <CloseIcon size={24} />;
  } else {
    glyph = <PhoneIcon size={24} />;
  }
  return (
    // Confirmed fills the disc green — the one moment green belongs here.
    // The check is drawn in the surface colour, which clears 3:1 on the
    // green of either theme.
    <span className={cx('relative grid size-12 place-items-center rounded-full', phase === 'confirmed' && 'bg-green text-surface')}>
      {phase === 'waiting' && (
        <>
          <span
            className="absolute inset-0 rounded-full border-2 border-[color-mix(in_srgb,var(--stage-ink)_55%,transparent)] opacity-0"
            style={{ animation: 'ping-ring 2.2s ease-out infinite' }}
          />
          <span
            className="absolute inset-0 rounded-full border-2 border-[color-mix(in_srgb,var(--stage-ink)_55%,transparent)] opacity-0"
            style={{ animation: 'ping-ring 2.2s ease-out infinite', animationDelay: '1.1s' }}
          />
        </>
      )}
      {glyph}
    </span>
  );
}

/**
 * Bank text is untrusted and plain: it is rendered as text, never markup. Some
 * banks still put HTML line breaks or simple tags into the challenge; those
 * become real line breaks or go, so the sentence reads as one.
 */
function plainChallenge(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]{1,40}>/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
