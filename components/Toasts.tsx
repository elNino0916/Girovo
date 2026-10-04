'use client';

// Short-lived confirmations and notices, bottom right on a desktop and bottom
// centre on a phone (above the bottom bar).
//
// The provider only queues toasts; their lifetime is decided here, because
// only here is it known whether someone is reading one. A toast's clock stops
// while the pointer is on it, while focus is in it (someone tabbed to its
// action), while the window is in the background and while it is not the
// focused window — a message that expires unseen was never sent. How long it
// runs is lib/toast-time.ts: long enough to read, longer for an error, and
// longer again for one with an action to reach.
//
// The stack sits at the end of the page, dozens of Tab stops away, so F6
// jumps to the newest toast's button and F6 (or Escape) goes back to where
// the user was. A toast with an action says so in what a screen reader hears.
// F6 is left alone while a dialog is open: its focus stays in the dialog.
//
// What a screen reader hears is kept apart from what is drawn: two persistent
// live regions (polite, and role=alert for errors) carry the text, so an
// error is announced once and assertively, and the visible stack can stay a
// plain region of buttons.

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { toastLifetime } from '@/lib/toast-time';
import { useFints } from './FintsProvider';
import type { Toast } from './FintsProvider';
import { AlertTriangleIcon, CheckCircleIcon, CloseIcon, InfoIcon } from './icons';
import { Button, IconButton, cx } from './ui';

const LEAVE_MS = 160;
const MAX_VISIBLE = 4;
/** The key that moves focus to the newest toast and back (as in Windows apps that have one). */
export const TOAST_KEY = 'F6';

const TONES = {
  info: { rule: 'var(--info)', icon: 'text-info', Glyph: InfoIcon },
  success: { rule: 'var(--green)', icon: 'text-green', Glyph: CheckCircleIcon },
  error: { rule: 'var(--red)', icon: 'text-red', Glyph: AlertTriangleIcon },
} as const;

/** Where focus was before F6 moved it into the stack — and goes back to. */
let returnTo: HTMLElement | null = null;

/** Gives focus back to where F6 took it from, if that is still there. True once it has. */
function giveFocusBack(): boolean {
  const el = returnTo;
  returnTo = null;
  if (!el?.isConnected) return false;
  el.focus({ preventScroll: true });
  return document.activeElement === el;
}

/** A modal layer holds focus (the Overlay traps it); toasts are then out of reach. */
const modalOpen = () => !!document.querySelector('[aria-modal="true"]');

export function Toasts() {
  const { toasts, dismissToast } = useFints();
  const visible = toasts.slice(-MAX_VISIBLE);
  const polite = useAnnouncement(toasts, false);
  const urgent = useAnnouncement(toasts, true);
  const stackRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== TOAST_KEY || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.defaultPrevented) return;
      const stack = stackRef.current;
      if (!stack) return;
      if (stack.contains(document.activeElement)) {
        e.preventDefault();
        giveFocusBack();
        return;
      }
      if (modalOpen()) return;
      // The newest toast is the last one; its action first, else its close button.
      const cards = stack.querySelectorAll<HTMLElement>('[data-toast]');
      const newest = cards[cards.length - 1];
      const target = newest?.querySelector<HTMLElement>('[data-toast-action]') ?? newest?.querySelector<HTMLElement>('button');
      if (!target) return;
      e.preventDefault();
      returnTo = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
        ? document.activeElement
        : null;
      target.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <>
      <div className="sr-only" aria-live="polite">
        {polite && <p key={polite.id}>{spoken(polite)}</p>}
      </div>
      <div className="sr-only" role="alert">
        {urgent && <p key={urgent.id}>{spoken(urgent)}</p>}
      </div>

      {visible.length > 0 && (
        <section
          ref={stackRef}
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

/** What a screen reader hears: the message, and for a toast with a button, how to reach it. */
function spoken(t: Toast): string {
  return t.action ? `${t.message} Mit ${TOAST_KEY} zur Schaltfläche „${t.action.label}“.` : t.message;
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

/** Whether nobody can be reading: the page is hidden, or another window has the focus. */
function useAway(): boolean {
  const read = () => typeof document !== 'undefined' && (document.hidden || !document.hasFocus());
  const [away, setAway] = useState(read);
  useEffect(() => {
    const update = () => setAway(read());
    update();
    document.addEventListener('visibilitychange', update);
    window.addEventListener('blur', update);
    window.addEventListener('focus', update);
    return () => {
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('blur', update);
      window.removeEventListener('focus', update);
    };
  }, []);
  return away;
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  const [leaving, setLeaving] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const away = useAway();
  const lifetime = toastLifetime({ tone: toast.tone, ms: toast.ms, message: toast.message, hasAction: !!toast.action });
  const remaining = useRef(lifetime);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  const cardRef = useRef<HTMLDivElement>(null);

  // Plays the exit, then tells the provider. A toast the provider removes on
  // its own (replaced by the same message, say) simply goes. Focus that was
  // inside goes back to where F6 took it from.
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => {
      const hadFocus = !!cardRef.current?.contains(document.activeElement);
      dismissRef.current(toast.id);
      if (hadFocus) giveFocusBack();
    }, LEAVE_MS);
    return () => clearTimeout(t);
  }, [leaving, toast.id]);

  const paused = hovered || focused || away;
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

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    setLeaving(true);
  };

  return (
    <div
      ref={cardRef}
      data-toast
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
      onKeyDown={onKeyDown}
      className={cx(
        'pointer-events-auto flex w-full max-w-[420px] items-start gap-3 rounded-[12px] bg-raised py-3 pr-2 pl-4 text-ink sm:w-[380px]',
        leaving ? 'anim-toast-out' : 'anim-toast',
      )}
      // The tone's 3px inner edge, as on an inline alert.
      style={{ boxShadow: `inset 3px 0 0 ${tone.rule}, var(--shadow-pop)` }}
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
            data-toast-action
            // The pill is taller than a line of text; the negative margin
            // keeps it from pushing a one-line toast taller.
            className="-my-1 ml-auto"
            aria-keyshortcuts={TOAST_KEY}
            onClick={() => {
              // Reached with F6: focus goes home first, so a layer the action
              // opens hands it back there when it closes — not to this toast.
              if (cardRef.current?.contains(document.activeElement)) giveFocusBack();
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
