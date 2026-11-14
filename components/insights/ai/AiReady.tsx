'use client';

// Girovo Next: "Girovo AI ist bereit", the owner's pick "B · Aufgang"
// (.impeccable/mocks/decision/ai-ready/b-phone.png, b-desk.png). A moment over
// the app the first time Girovo AI can answer, and again each time it is
// switched on after being off: on a phone the whole screen, on the desktop a
// card over the scrim. The violet wash opens out of the mark, the mark draws
// itself, then three questions from the user's own bookings (lib/ai-welcome.ts)
// rise in; a tap on one asks it in the conversation. The motion lives in
// app/material.css (.ai-ready-*); with less motion asked for, the moment is
// simply there.
//
// When it shows: Girovo AI usable (ask-gate.ts useCanAsk) and the vault's
// askIntroSeen not set. Closing it in any way sets it; switching Girovo AI off
// (components/settings/AskSettings.tsx) and deleting the desktop's model clear
// it, so the next "on" or "ready" shows it again. Mounted once in each shell
// (components/Dashboard.tsx), so never over the login or the demo's start.

import { useEffect, useId, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { AI_MARK_ARMS, AI_MARK_BAR_WIDTH, AI_MARK_DIAGONALS, AI_MARK_DIAGONAL_WIDTH } from '../../icons';
import { AiWordmark } from '../../shell/BrandMark';
import { useAskStyle } from '../ask/useAskStyle';
import { welcomeQuestions, type WelcomeBooking } from '@/lib/ai-welcome';
import { bookingDay } from '@/lib/analytics';
import { dayKey, tidyName } from '@/lib/format';
import { useLocale, useT } from '@/lib/i18n/react';
import { useFints } from '../../FintsProvider';
import { merchantFor, txText } from '../../transactions/model';
import { Button, Overlay } from '../../ui';
import { useCanAsk } from '../ask-gate';
import { newConversation, openAsk } from '../ask-thread-store';
import { useAskScope } from '../AskThread';
import { useRecurringModel } from '../recurring-model';

/** The mark's four arms, each drawn from the centre out, and its two diagonals (components/icons.tsx). */
const ARMS = AI_MARK_ARMS;
const DIAGONALS = AI_MARK_DIAGONALS.split(/(?=M)/);

/** When a part starts to move, in seconds after the moment opens (app/material.css reads --ai-ready-delay). */
const at = (s: number) => ({ '--ai-ready-delay': `${s}s` }) as CSSProperties;

export function AiReady() {
  const canAsk = useCanAsk();
  const { vault, updateVault } = useFints();
  const recurring = useRecurringModel();
  const seen = !!vault?.askIntroSeen;
  // Gone at once on close, before the vault's write lands; ready again once it has.
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    if (seen) setClosed(false);
  }, [seen]);
  // Not while the first bookings are on their way: the questions are made from them.
  if (!canAsk || !vault || seen || closed || recurring.loading) return null;
  return (
    <Moment
      onDone={() => {
        setClosed(true);
        updateVault((v) => (v.askIntroSeen ? v : { ...v, askIntroSeen: true }));
      }}
    />
  );
}

/** The three questions from the bookings in view, Verträge & Abos and their days to cancel by. */
function useQuestions(): string[] {
  const data = useAskScope();
  const { categoryOf, vault, merchants } = useFints();
  const recurring = useRecurringModel();
  const { locale } = useLocale();
  const reminders = vault?.contractReminders;
  return useMemo(() => {
    const today = dayKey(new Date());
    const bookings: WelcomeBooking[] = (data?.txs ?? []).map((tx) => ({
      // The brand where Girovo knows it ("dm"), else the list's name: a bank's raw line reads badly in a question.
      day: bookingDay(tx), amount: tx.amount, payee: merchantFor(merchants, tx)?.label || tidyName(txText(tx).name), category: categoryOf(tx).id,
    }));
    const cancelDate = recurring.expense.some((s) => (reminders?.[s.id]?.by ?? '') >= today);
    return welcomeQuestions({ bookings, today, contracts: recurring.expense.length, cancelDate });
    // locale: the questions are in the app's language.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, categoryOf, merchants, recurring.expense, reminders, locale]);
}

/** Focus the conversation's field once it is on the page ("Selbst fragen"). */
function focusAskField(tries = 12) {
  requestAnimationFrame(() => {
    const field = document.querySelector<HTMLInputElement>('[data-ask-field]');
    if (field && !field.closest('[inert]')) field.focus({ preventScroll: true });
    else if (tries > 0) focusAskField(tries - 1);
  });
}

function Moment({ onDone }: { onDone: () => void }) {
  const t = useT();
  const words = t.ask.welcome;
  // Greets by first name where Girovo AI may use it (Einstellungen → Girovo AI → Anrede).
  const style = useAskStyle();
  const titleId = useId();
  const leadId = useId();
  // Made once, as the moment opens: a booking arriving meanwhile does not swap a row under the finger.
  const live = useQuestions();
  const [questions] = useState(live);

  const ask = (question: string) => {
    onDone();
    openAsk({ question, fresh: true });
  };
  const askOwn = () => {
    onDone();
    newConversation();
    focusAskField();
  };

  return (
    <Overlay open onClose={onDone} labelledBy={titleId} describedBy={leadId} className="ai-ready-layer">
      <div className="ai-ready">
        <div className="ai-ready-body">
          <Button variant="tertiary" size="sm" className="ai-ready-skip" onClick={onDone}>{words.skip}</Button>
          <div className="ai-ready-hero">
            <div className="ai-ready-halo">
              <Mark drawn />
            </div>
            <h2 id={titleId} className="ai-ready-title ai-ready-rise" style={at(0.95)}>{words.title(<AiWordmark key="name" />)}</h2>
            <p id={leadId} className="ai-ready-lead ai-ready-rise" style={at(1.05)}>{style.name ? words.leadNamed(style.name) : words.lead}</p>
          </div>
          <ul className="ai-ready-list" aria-label={words.examples}>
            {questions.map((q, i) => (
              <li key={q} className="ai-ready-rise" style={at(1.2 + i * 0.08)}>
                <button type="button" className="ai-ready-ex" onClick={() => ask(q)}>
                  <Mark />
                  <span className="min-w-0 flex-1">{q}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="ai-ready-end ai-ready-fade" style={at(1.5)}>
            <span className="ai-ready-fine">{words.fine}</span>
            <Button variant="primary" onClick={askOwn}>{words.ask}</Button>
          </div>
        </div>
      </div>
    </Overlay>
  );
}

/**
 * Girovo's AI mark (icons.tsx AiMarkIcon) with each arm its own path, so the
 * halo's can draw itself arm by arm and its diagonals twinkle after. A row's
 * is the four arms alone, still.
 */
function Mark({ drawn = false }: { drawn?: boolean }) {
  return (
    <svg className="ai-ready-mark" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" aria-hidden="true">
      {ARMS.map((d, i) => (
        <path key={d} d={d} pathLength={1} strokeWidth={AI_MARK_BAR_WIDTH} className="ai-ready-arm" style={drawn ? at(0.25 + i * 0.1) : undefined} />
      ))}
      {drawn && DIAGONALS.map((d) => <path key={d} d={d} strokeWidth={AI_MARK_DIAGONAL_WIDTH} className="ai-ready-dia" style={at(0.85)} />)}
    </svg>
  );
}
