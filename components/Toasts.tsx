'use client';

// Short-lived confirmations and notices, bottom right on a desktop and bottom
// centre on a phone (above the bottom bar).
//
// The provider only queues toasts; their lifetime is decided here, because
// only here is it known whether someone is reading one. A toast's clock stops
// while the pointer is on it, while focus is in it (someone tabbed to its
// action) and while the window is in the background — a message that expires
// unseen was never sent. Errors stay at least eight seconds.
//
// What a screen reader hears is kept apart from what is drawn: two persistent
// live regions (polite, and role=alert for errors) carry the text, so an
// error is announced once and assertively, and the visible stack can stay a
// plain region of buttons.

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useFints } from './FintsProvider';
import type { Toast } from './FintsProvider';
import { AlertTriangleIcon, CheckCircleIcon, CloseIcon, InfoIcon } from './icons';
import { Button, IconButton, cx } from './ui';

const MIN_ERROR_MS = 8000;
const LEAVE_MS = 160;
const MAX_VISIBLE = 4;

const TONES = {
  info: { rule: 'var(--info)', icon: 'text-info', Glyph: InfoIcon },
  success: { rule: 'var(--green)', icon: 'text-green', Glyph: CheckCircleIcon },
  error: { rule: 'var(--red)', icon: 'text-red', Glyph: AlertTriangleIcon },
} as const;

export function Toasts() {
  const { toasts, dismissToast } = useFints();
  const visible = toasts.slice(-MAX_VISIBLE);
  const polite = useAnnouncement(toasts, false);
  const urgent = useAnnouncement(toasts, true);

  return (
    <>
      <div className="sr-only" aria-live="polite">
        {polite && <p key={polite.id}>{polite.message}</p>}
      </div>
      <div className="sr-only" role="alert">
        {urgent && <p key={urgent.id}>{urgent.message}</p>}
      </div>

      {visible.length > 0 && (
        <section
          aria-label="Benachrichtigungen"
          className={cx(
            'pointer-events-none fixed inset-x-0 z-200 flex flex-col items-center gap-2 px-4',
            'bottom-[calc(var(--bottombar-h)+12px)] sm:inset-x-auto sm:right-6 sm:bottom-6 sm:items-end sm:px-0',
          )}
          style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
        >
          {visible.map((t) => (
            <ToastCard key={t.id} toast={t} onDismiss={dismissToast} />
          ))}
        </section>
      )}
    </>
  );
}

/**
 * The toast a live region should be holding: the newest of its kind, and
 * only while it is the newest ever seen. When it is dismissed the region
 * empties instead of falling back to an older toast — which a screen reader
 * would otherwise read out a second time.
 */
function useAnnouncement(toasts: Toast[], errors: boolean): Toast | null {
  const newestSeen = useRef(0);
  let newest: Toast | null = null;
  for (const t of toasts) if ((t.tone === 'error') === errors && (!newest || t.id > newest.id)) newest = t;
  const current = newest && newest.id >= newestSeen.current ? newest : null;
  useEffect(() => {
    if (newest && newest.id > newestSeen.current) newestSeen.current = newest.id;
  });
  return current;
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  const [leaving, setLeaving] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [backgrounded, setBackgrounded] = useState(() => typeof document !== 'undefined' && document.hidden);
  const lifetime = toast.tone === 'error' ? Math.max(toast.ms, MIN_ERROR_MS) : toast.ms;
  const remaining = useRef(lifetime);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    const onVis = () => setBackgrounded(document.hidden);
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // Plays the exit, then tells the provider. A toast the provider removes on
  // its own (replaced by the same message, say) simply goes.
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => dismissRef.current(toast.id), LEAVE_MS);
    return () => clearTimeout(t);
  }, [leaving, toast.id]);

  const paused = hovered || focused || backgrounded;
  useEffect(() => {
    if (paused || leaving) return;
    const startedAt = Date.now();
    const t = setTimeout(() => setLeaving(true), Math.max(0, remaining.current));
    return () => {
      clearTimeout(t);
      remaining.current -= Date.now() - startedAt;
    };
  }, [paused, leaving]);

  const tone = TONES[toast.tone] ?? TONES.info;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
      className={cx(
        'pointer-events-auto flex w-full max-w-[420px] items-start gap-3 rounded-[12px] bg-raised py-3 pr-2 pl-4 text-ink sm:w-[380px]',
        leaving ? 'anim-toast-out' : 'anim-toast',
      )}
      style={{ boxShadow: `inset 4px 0 0 ${tone.rule}, var(--shadow-pop)` }}
    >
      <span className={cx('mt-[3px] shrink-0', tone.icon)}>
        <tone.Glyph size={18} />
      </span>
      {/* Message and action share a wrapping row: a short message keeps its
          action beside it, a longer one gets the full width and the action
          drops below, right-aligned. Squeezing both into one line is what
          used to split "Zeitüberschreitung" mid-word. The words wrap at spaces
          (German hyphenation where the engine has it); only a token longer
          than the whole line, an IBAN say, is broken anywhere. */}
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-2 py-px">
        <p
          lang="de"
          className="min-w-0 flex-[1_1_auto] text-[14.5px] leading-snug whitespace-pre-line hyphens-auto wrap-anywhere"
        >
          {toast.message}
        </p>
        {toast.action && (
          <Button
            variant="tertiary"
            size="xs"
            // The pill is taller than a line of text; the negative margin
            // keeps it from pushing a one-line toast taller.
            className="-my-1 ml-auto"
            onClick={() => {
              toast.action?.run();
              setLeaving(true);
            }}
          >
            {toast.action.label}
          </Button>
        )}
      </div>
      {/* Pulled in: the pill and the 32px hit area both carry their own
          air, so the row's full gap here would only cost the message width. */}
      <IconButton aria-label="Hinweis schließen" onClick={() => setLeaving(true)} className="-my-0.5 -ml-2">
        <CloseIcon size={15} />
      </IconButton>
    </div>
  );
}
