'use client';

// Letting Girovo keep its data on an unsafe phone anyway (lib/device-integrity.ts
// mayAllowSaving): rooted, unlocked or unprovable, running the genuine app.
//
// Hidden on purpose: held for 10 seconds, the Gerätesicherheit dialog's
// "Schließen" opens it — a tap still just closes. What opens is no dialog but
// the whole screen in Soll Red, the warning sign large, what can happen said
// plainly, and nothing allowed until "Ich verstehe das Risiko" is ticked; the
// safe answer, "Nichts speichern", leads. Focus starts at the heading, so the
// warning is read from its top. The
// choice starts the app afresh (mobile/bridges/integrity.ts chooseSaving).

import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { DeviceVerdict } from '@/lib/device-integrity';
import { useT } from '@/lib/i18n/react';
import { AlertTriangleIcon } from '../icons';
import { Button, Checkbox, Overlay } from '../ui';
import { haptic } from './haptics';

/** How long "Schließen" must be held. */
export const HOLD_MS = 10_000;
/** The fill shows only after this: a tap, or a slow one, shows nothing. */
const HOLD_SHOWN_AFTER_MS = 1_000;

/**
 * A button that does its click on a tap and `onHeld` when held for HOLD_MS.
 * Its fill sweeps across while held, from the first second on; let go early
 * and it is gone. The wrapper takes the pointer: M3E's button gets the click.
 */
export function HoldButton({ onHeld, onClick, children }: { onHeld: () => void; onClick: () => void; children: ReactNode }) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The click that follows a completed hold is not a tap.
  const held = useRef(false);

  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  };
  useEffect(() => stop, []);

  return (
    <span
      className="relative inline-flex overflow-hidden rounded-full select-none [-webkit-touch-callout:none] [touch-action:manipulation]"
      onPointerDown={() => {
        held.current = false;
        stop();
        setHolding(true);
        timer.current = setTimeout(() => {
          held.current = true;
          setHolding(false);
          haptic('threshold');
          onHeld();
        }, HOLD_MS);
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onPointerLeave={stop}
      // A long press must not open the WebView's own menu.
      onContextMenu={(e) => e.preventDefault()}
    >
      <Button
        variant="primary"
        data-autofocus
        onClick={() => {
          if (held.current) {
            held.current = false;
            return;
          }
          onClick();
        }}
      >
        {children}
      </Button>
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 origin-left bg-red/45"
        style={{
          transform: holding ? 'scaleX(1)' : 'scaleX(0)',
          transition: holding ? `transform ${HOLD_MS - HOLD_SHOWN_AFTER_MS}ms linear ${HOLD_SHOWN_AFTER_MS}ms` : 'none',
        }}
      />
    </span>
  );
}

/** The whole screen in red: what keeping data on this phone means, and the choice. */
export function SaveAnywayWarning({ verdict, onCancel }: { verdict: DeviceVerdict; onCancel: () => void }) {
  const t = useT();
  const w = t.android.integrity.saveAnyway;
  const titleId = useId();
  const [understood, setUnderstood] = useState(false);
  // Focus starts on the heading, at the top: the warning is read before the choice.
  const heading = useRef<HTMLHeadingElement>(null);

  return (
    <Overlay open onClose={onCancel} onBackdrop={() => {}} labelledBy={titleId} initialFocus={heading}>
      <div className="fixed inset-0 overflow-y-auto bg-red text-red-ink">
        <div className="mx-auto flex min-h-full max-w-[560px] flex-col px-5 pt-[calc(2.5rem+env(safe-area-inset-top))] pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
          <AlertTriangleIcon size={88} strokeWidth={2.25} aria-hidden className="-ml-1" />
          <p className="mt-4 text-[13px] font-bold tracking-[0.12em] uppercase">{w.kicker}</p>
          <h2 id={titleId} ref={heading} tabIndex={-1} className="mt-1 text-[30px] leading-[1.1] font-extrabold outline-none">{w.title}</h2>
          <p className="mt-3 text-[17px] leading-snug font-semibold">{verdict === 'modified' ? w.leadModified : w.leadUnknown}</p>
          <ul className="mt-4 flex list-disc flex-col gap-2 pl-5 text-[15px] leading-snug">
            {w.risks.map((r) => <li key={r}>{r}</li>)}
          </ul>
          <p className="mt-4 text-[15px] leading-snug">{w.still}</p>

          {/* The choice on the panel's own surface, so its controls read as they do everywhere. */}
          <div className="mt-auto pt-6">
            <div className="rounded-[20px] bg-surface p-4 text-ink">
              <Checkbox checked={understood} onChange={(e) => setUnderstood(e.target.checked)} label={w.understood} />
              <p className="mt-2 text-[13px] leading-snug text-ink-2">{w.restart}</p>
              <div className="mt-4 flex flex-col gap-2">
                <Button variant="primary" block onClick={onCancel}>{w.cancel}</Button>
                <Button
                  variant="danger"
                  block
                  disabled={!understood}
                  onClick={() => window.girovoMobile?.chooseSaving(verdict)}
                >
                  {w.allow}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Overlay>
  );
}
