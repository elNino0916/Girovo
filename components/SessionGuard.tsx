'use client';

// The last minute before the automatic logout.
//
// The provider owns the clock: it extends the deadline on any input, holds it
// while a TAN or a transfer is in flight, and logs out (with its own toast)
// when it runs out. This dialog only makes the last 60 seconds visible, so
// someone who stepped away for a coffee does not come back to the login
// screen without warning.
//
// Input inside the dialog is neutral (IDLE_NEUTRAL_ATTR): a press on
// "Abmelden" or a Tab between the two buttons must not count as "still here",
// or the dialog would vanish under the finger before the click arrived. Only
// a choice decides — the button, Escape or the backdrop mean "Angemeldet
// bleiben", "Abmelden" means logging out.
//
// While an approval is still in flight the dialog stays away: the deadline is
// held then anyway. A failed or ended approval does not hold it (the provider
// logs out behind it as usual), so then the warning comes — on top of the
// approval dialog, which is still open and would otherwise hide it.

import { useEffect, useId, useRef, useState } from 'react';
import { IDLE_NEUTRAL_ATTR, useFints, waitHoldsSession } from './FintsProvider';
import { ClockIcon } from './icons';
import { Button, DialogActions, Overlay, Sheet } from './ui';
import { countdownWords, fmtCountdown, useCountdown } from './shell/session';

const WARN_MS = 60_000;
// Points at which a screen reader is told how long is left. Every second
// would drown out everything else.
const ANNOUNCE_AT = [60, 30, 10];

export function SessionGuard() {
  const { view, idleDeadline, wait } = useFints();
  const left = useCountdown(idleDeadline, view === 'dashboard');
  const open = left != null && left > 0 && left <= WARN_MS && !waitHoldsSession(wait);
  return open ? <Warning left={left} /> : null;
}

function Warning({ left }: { left: number }) {
  const { stayLoggedIn, logout } = useFints();
  const titleId = useId();
  const descId = useId();
  const seconds = Math.ceil(left / 1000);

  const [announced, setAnnounced] = useState('');
  const lastMark = useRef<number | null>(null);
  useEffect(() => {
    const mark = ANNOUNCE_AT.find((s) => seconds <= s && seconds > s - 5 && lastMark.current !== s);
    if (mark == null) return;
    lastMark.current = mark;
    setAnnounced(`Noch ${countdownWords(left)} bis zur automatischen Abmeldung.`);
  }, [seconds, left]);

  return (
    // Above every other layer (z-100), the approval dialog included: it is
    // rendered later in the page and would paint over this one.
    <Overlay open onClose={stayLoggedIn} labelledBy={titleId} describedBy={descId} className="z-110!">
      {/* display: contents — the panel stays the overlay's flex child; the
          backdrop around it stays outside the neutral zone. */}
      <div {...{ [IDLE_NEUTRAL_ATTR]: '' }} className="contents">
        <Sheet size="sm" band={{ icon: <ClockIcon size={24} />, tone: 'navy' }}>
          <h2 id={titleId} className="text-center text-[22px] leading-tight font-bold text-headline">
            Möchtest du angemeldet bleiben?
          </h2>
          <p id={descId} className="mt-2 text-center text-[15px] leading-snug text-ink-2">
            Du warst eine Weile nicht aktiv. Aus Sicherheitsgründen meldet dich die App gleich automatisch ab.
          </p>

          <div className="mt-5 flex flex-col items-center">
            <span role="timer" aria-label={`Noch ${countdownWords(left)}`} className="tnum text-[40px] leading-none font-bold text-headline">
              {fmtCountdown(left)}
            </span>
            <span aria-hidden className="mt-1.5 text-[13px] text-ink-3">bis zur Abmeldung</span>
            {/* A quiet bar that empties with the minute — the figure says how
                long, the bar says it is moving. */}
            <span aria-hidden className="mt-4 h-1 w-full max-w-[240px] overflow-hidden rounded-full bg-inset">
              <span
                className="block h-full rounded-full bg-accent transition-[width] duration-1000 ease-linear"
                style={{ width: `${Math.max(0, Math.min(100, (left / WARN_MS) * 100))}%` }}
              />
            </span>
          </div>
          <p className="sr-only" aria-live="polite">{announced}</p>

          <DialogActions align="center" className="mt-7">
            <Button variant="secondary" onClick={() => void logout('user')}>Abmelden</Button>
            <Button variant="primary" data-autofocus onClick={stayLoggedIn}>Angemeldet bleiben</Button>
          </DialogActions>
        </Sheet>
      </div>
    </Overlay>
  );
}
