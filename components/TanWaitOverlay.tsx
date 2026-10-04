'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { SerializedTanMethod } from '@/lib/fints-types';
import { useFints, type WaitKind, type WaitState } from './FintsProvider';
import { AlertTriangleIcon, CheckCircleIcon, ClockIcon, PhoneIcon } from './icons';
import { VopBadge } from './VopResult';
import { Alert, Button, Dialog, DialogActions, Overlay, Sheet, Spinner, cx } from './ui';

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

/** What the screen behind is about to do once the approval is in. */
const AFTER_CONFIRM: Record<WaitKind, string> = {
  login: 'Deine Konten werden geladen …',
  statements: 'Umsätze werden geladen …',
  pending: 'Vorgemerkte Umsätze werden geladen …',
  transfer: 'Das Ergebnis wird abgerufen …',
};

function TanWait() {
  const { wait, retryWait, cancelWait, selectedMethod, tanMethods } = useFints();
  const uid = useId();
  const titleId = `tanwait${uid}-title`;
  const textId = `tanwait${uid}-text`;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [confirmAbort, setConfirmAbort] = useState(false);

  const waiting = wait.phase === 'waiting';
  const confirmed = wait.phase === 'confirmed';
  const failed = wait.phase === 'error';

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

  const title = confirmed ? 'Freigabe bestätigt' : failed ? 'Freigabe konnte nicht geprüft werden' : wait.title;
  const text = confirmed
    ? AFTER_CONFIRM[wait.kind ?? 'statements']
    : failed
      ? 'Ob die Freigabe angekommen ist, ließ sich nicht feststellen.'
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

  return (
    <>
      <Overlay open labelledBy={titleId} describedBy={textId} initialFocus={headingRef}>
        <Sheet size="sm" band={{ icon: <BandIcon phase={wait.phase} />, tone: 'navy' }}>
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
            </div>

            {/* Where to look, and what the bank says — while there is still
                something to confirm, and through the short confirmed beat
                so the dialog does not collapse under the user's eyes. */}
            {device && (waiting || confirmed) && (
              <p className="mt-3 inline-flex max-w-full items-center gap-1.5 text-[13.5px] text-ink-3">
                <PhoneIcon size={16} className="shrink-0" />
                <span className="truncate">
                  Gerät: <span className="font-semibold text-ink-2">{device}</span>
                </span>
              </p>
            )}

            {/* The bank kept the challenge alive through its Namensabgleich, so
                the result rides along with the approval prompt. */}
            {wait.vop && <VopBadge vop={wait.vop} />}

            {challenge && (waiting || confirmed) && (
              <p className="mt-4 rounded-[10px] bg-inset px-4 py-3 text-left text-[14px] leading-relaxed text-balance whitespace-pre-line text-ink-2">
                {challenge}
              </p>
            )}

            {(waiting || confirmed) && (
              <WaitProgress startedAt={wait.startedAt} settledAt={wait.settledAt} limit={limit} done={confirmed} />
            )}

            {wait.error && <Alert className="mt-5 text-left">{wait.error}</Alert>}

            {!confirmed && (
              <DialogActions align="center">
                <Button onClick={cancel}>{waiting ? 'Abbrechen' : 'Schließen'}</Button>
                {wait.canRetry && <Button variant="primary" onClick={retryWait}>Erneut versuchen</Button>}
              </DialogActions>
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
            Die Überweisung wurde vielleicht schon ausgeführt. Brichst du jetzt ab, bleibt ihr Status offen –
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

function WaitProgress({ startedAt, settledAt, limit, done }: {
  startedAt: number;
  settledAt: number | null;
  limit: number | null;
  done: boolean;
}) {
  const elapsed = useSecondsSince(startedAt, settledAt);
  const share = done ? 1 : limit ? Math.min(1, elapsed / limit) : 0;
  return (
    <div className="mt-6 text-left">
      <div className="flex items-center justify-between gap-3 text-[14px]">
        {done ? (
          <span className="flex items-center gap-2.5 font-semibold text-green">
            <CheckCircleIcon size={17} />
            Bestätigt
          </span>
        ) : (
          <span className="flex items-center gap-2.5 font-semibold text-ink-2">
            <Spinner size={16} className="text-accent" />
            Warte auf Bestätigung
          </span>
        )}
        <span className="tnum text-ink-3">
          <span className="sr-only">Seit </span>
          {fmtClock(elapsed)}
        </span>
      </div>
      {limit && (
        <>
          <div aria-hidden className="mt-2.5 h-1 overflow-hidden rounded-full bg-inset">
            <div
              className={cx('h-full rounded-full transition-[width] duration-1000 ease-linear', done ? 'bg-green' : 'bg-accent')}
              style={{ width: `${(share * 100).toFixed(2)}%` }}
            />
          </div>
          <p className="mt-2 text-[12.5px] leading-snug text-ink-3">
            {done ? 'Rechtzeitig angekommen.' : `Deine Bank wartet bis zu ${fmtLimit(limit)} auf die Freigabe.`}
          </p>
        </>
      )}
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
