'use client';

import { useFints } from './FintsProvider';
import { VopBadge } from './VopResult';
import { Alert, Button, Overlay, Sheet, Spinner, cx } from './ui';

/**
 * The decoupled approval beat: the user leaves for their banking app and comes
 * back. The elapsed counter is deliberate — a spinner alone gives no sense of
 * whether the request has stalled.
 */
export function TanWaitOverlay() {
  const { wait, retryWait, cancelWait } = useFints();
  if (!wait.open) return null;

  const waiting = wait.phase === 'waiting';
  const confirmed = wait.phase === 'confirmed';

  return (
    <Overlay open labelledBy="tanwait-title">
      <Sheet className="text-center">
        <PhonePulse settled={!waiting} ok={confirmed} />

        <h2 id="tanwait-title" className="font-display text-[20px] font-semibold tracking-tight">
          {confirmed ? 'Freigabe bestätigt' : wait.title}
        </h2>
        <p className="mt-1.5 text-sm text-ink-2">{confirmed ? 'Daten werden geladen …' : wait.text}</p>

        {/* The bank kept the challenge alive through its Namensabgleich, so
            the result rides along with the approval prompt. */}
        {wait.vop && <VopBadge vop={wait.vop} />}

        {wait.challenge && (
          <p className="num mx-auto mt-3.5 max-w-[340px] rounded-[9px] bg-inset px-3.5 py-2.5 text-[13px] text-ink-2">
            {wait.challenge}
          </p>
        )}

        {waiting && (
          <p className="mt-4 flex items-center justify-center gap-2.5 text-sm text-ink-2">
            <Spinner className="text-accent" />
            <span>Warte auf Bestätigung</span>
            <span className="num text-ink-3">{formatElapsed(wait.elapsed)}</span>
          </p>
        )}

        {!confirmed && (
          <div className="mt-5 flex justify-center gap-2.5">
            {wait.canRetry && <Button variant="primary" onClick={retryWait}>Erneut versuchen</Button>}
            <Button onClick={() => void cancelWait()}>Abbrechen</Button>
          </div>
        )}

        {wait.error && <Alert>{wait.error}</Alert>}
      </Sheet>
    </Overlay>
  );
}

const formatElapsed = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function PhonePulse({ settled, ok }: { settled: boolean; ok: boolean }) {
  return (
    <div className="relative mx-auto mt-1 mb-5 size-21" aria-hidden>
      {/* Waiting is the accent's job; green is kept for the moment it actually
          came back confirmed. */}
      {!settled && (
        <>
          <span
            className="absolute inset-0 rounded-full border-2 border-accent opacity-0"
            style={{ animation: 'ping-ring 2.2s ease-out infinite' }}
          />
          <span
            className="absolute inset-0 rounded-full border-2 border-accent opacity-0"
            style={{ animation: 'ping-ring 2.2s ease-out infinite', animationDelay: '1.1s' }}
          />
        </>
      )}
      <span
        className={cx(
          'absolute inset-3.5 grid place-items-center rounded-full',
          ok ? 'bg-green-soft text-green' : 'bg-accent-soft text-accent',
        )}
      >
        {ok ? (
          <svg viewBox="0 0 24 24" width="28" height="28">
            <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="28" height="28">
            <rect x="6" y="2.5" width="12" height="19" rx="3" fill="none" stroke="currentColor" strokeWidth="1.7" />
            <path d="M10 18.5h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
        )}
      </span>
    </div>
  );
}
