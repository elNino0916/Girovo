'use client';

// Mitteilungen: what the bank said at login, and what this session did —
// and, in the desktop app, a newer version of the app itself. In that order:
// the bank's words are the content, the app's own news is housekeeping and
// comes last, so it is always clear who is speaking.
//
// Bank messages arrive with the login synchronisation (HIRMG/HIRMS texts) —
// there is no mailbox behind them and nothing is fetched here. Their text is
// the bank's and therefore untrusted: plain text only, line breaks kept.
//
// Opening the drawer marks everything read (the masthead's dot goes out), but
// the drawer remembers what was new when it opened, so the messages that
// brought you here stay marked while you read them.

import { useEffect, useId, useRef, useState } from 'react';
import type { ActivityEntry, InboxMessage } from '@/lib/app-types';
import { copyText } from '@/lib/clipboard';
import { fmtShortIban } from '@/lib/format';
import { answerBeyondOutcome } from '@/lib/session-log';
import { useFints } from './FintsProvider';
import { Money } from './Money';
import { AlertTriangleIcon, CheckIcon, ChevronIcon, CopyIcon, HelpIcon, TransferIcon } from './icons';
import { Alert, Button, CountBadge, Dot, Drawer, EmptyState, Tag, cx } from './ui';
import { fmtSince } from './shell/session';
import { updates } from './updates/store';
import { UpdateInboxCard, useUpdateNotice } from './updates/UpdateNotices';

// The drawer is also opened from places that do not outlive it — the
// overview's teaser goes once everything is read, a toast times out — so
// focus then returns to the masthead's bell, which is always there.
const inboxTrigger = () => document.querySelector<HTMLElement>('[data-inbox-trigger]');

export function Inbox() {
  const { inboxOpen, setInboxOpen } = useFints();
  return (
    <Drawer open={inboxOpen} onClose={() => setInboxOpen(false)} title="Mitteilungen" fallbackFocus={inboxTrigger}>
      <InboxBody />
    </Drawer>
  );
}

function InboxBody() {
  const { messages, activity, markAllRead, setInboxOpen } = useFints();
  const update = useUpdateNotice();
  // What was unread at the moment the drawer opened.
  const [fresh] = useState(() => new Set(messages.filter((m) => !m.read).map((m) => m.id)));
  useEffect(() => {
    markAllRead();
    updates.markSeen();
  }, [markAllRead]);

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="inbox-bank">
        <SectionHead id="inbox-bank" title="Mitteilungen deiner Bank" count={messages.length} />
        {messages.length ? (
          <>
            <ul className="-mx-4 border-y border-line sm:-mx-6">
              {messages.map((m) => (
                <MessageItem key={m.id} message={m} isNew={fresh.has(m.id)} defaultOpen={messages.length === 1} />
              ))}
            </ul>
            <p className="mt-3 text-[13px] leading-snug text-ink-3">
              Erhalten bei der Anmeldung um {fmtSince(Date.parse(messages[0].receivedAt))}. Mitteilungen werden nicht
              gespeichert – nach dem Abmelden sind sie hier nicht mehr zu sehen.
            </p>
          </>
        ) : (
          <EmptyState illustration="inbox" compact title="Keine Mitteilungen">
            Deine Bank hat bei dieser Anmeldung nichts mitgeteilt. Mitteilungen kommen nur mit der vollständigen
            Synchronisation beim Anmelden – neue siehst du also erst nach der nächsten Anmeldung.
          </EmptyState>
        )}
      </section>

      <section aria-labelledby="inbox-activity">
        <SectionHead id="inbox-activity" title="Vorgänge dieser Sitzung" count={activity.length} />
        {activity.length ? (
          <ul className="-mx-4 border-y border-line sm:-mx-6">
            {activity.map((entry) => <ActivityItem key={entry.id} entry={entry} />)}
          </ul>
        ) : (
          <p className="rounded-[8px] bg-inset px-4 py-3.5 text-[14px] leading-snug text-ink-2">
            Noch keine Überweisungen in dieser Sitzung. Ausgeführte, abgelehnte und unklare Aufträge stehen hier, bis du
            dich abmeldest.
          </p>
        )}
      </section>

      {update && (
        <section aria-labelledby="inbox-update">
          <SectionHead id="inbox-update" title="Diese App" count={0} />
          <UpdateInboxCard
            notice={update}
            onOpen={() => {
              setInboxOpen(false);
              updates.openDialog();
            }}
          />
        </section>
      )}
    </div>
  );
}

function SectionHead({ id, title, count }: { id: string; title: string; count: number }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <h3 id={id} className="text-[16px] font-bold text-headline">{title}</h3>
      {count > 0 && <CountBadge count={count} />}
    </div>
  );
}

function MessageItem({ message: m, isNew, defaultOpen }: { message: InboxMessage; isNew: boolean; defaultOpen: boolean }) {
  const id = useId();
  const subjectId = `${id}-subject`;
  const body = m.text.trim();
  // A message whose text only repeats its subject has nothing to unfold.
  const expandable = !!body && body !== m.subject.trim();
  const [open, setOpen] = useState(defaultOpen && expandable);

  const head = (
    <>
      <span className="flex w-3 shrink-0 justify-center pt-[7px]">{isNew && <Dot />}</span>
      <span className="min-w-0 flex-1">
        {/* Semibold whether new or not: the orange dot says "new". */}
        <span id={subjectId} className="block text-[15px] leading-snug font-semibold text-ink">
          {m.subject}
          {isNew && <span className="sr-only"> (neu)</span>}
        </span>
        {/* A preview for the eye; the button is named by its subject alone,
            not by the whole of a bank's Sonderbedingungen. */}
        {expandable && !open && (
          <span aria-hidden className="mt-0.5 line-clamp-2 text-[14px] leading-snug text-ink-2">{body}</span>
        )}
      </span>
    </>
  );

  return (
    <li className="border-b border-line last:border-b-0">
      {expandable ? (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          aria-labelledby={subjectId}
          onClick={() => setOpen((o) => !o)}
          className="row-focus flex w-full items-start gap-3 px-4 py-3.5 text-left hover:bg-inset sm:px-6"
        >
          {head}
          <ChevronIcon size={16} className="chev mt-1 shrink-0 text-ink-3" data-open={open} />
        </button>
      ) : (
        <div className="flex items-start gap-3 px-4 py-3.5 sm:px-6">{head}</div>
      )}
      {expandable && (
        <div id={id} hidden={!open} className="px-4 pb-3 pl-[46px] sm:px-6 sm:pl-[54px]">
          {/* The bank's own words, as text: never markup. */}
          <p className="text-[14.5px] leading-relaxed whitespace-pre-line text-ink [overflow-wrap:anywhere]">{body}</p>
          <CopyMessage text={`${m.subject}\n\n${body}`} />
        </div>
      )}
    </li>
  );
}

/**
 * Messages are not kept after the logout, so a notice like "Neue
 * Sonderbedingungen" can be taken along: subject and text, as the bank sent
 * them, onto the clipboard.
 */
function CopyMessage({ text }: { text: string }) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    const ok = await copyText(text);
    setState(ok ? 'done' : 'failed');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 1600);
  };
  return (
    <>
      <Button
        variant="tertiary"
        size="xs"
        className="mt-1.5 -ml-3.5"
        iconLeft={state === 'done' ? <CheckIcon size={15} strokeWidth={2.2} /> : <CopyIcon size={15} />}
        onClick={() => void copy()}
      >
        {state === 'done' ? 'Kopiert' : 'Text kopieren'}
      </Button>
      <span className="sr-only" aria-live="polite">
        {state === 'done' ? 'Mitteilung kopiert' : state === 'failed' ? 'Kopieren nicht möglich' : ''}
      </span>
    </>
  );
}

const OUTCOME = {
  executed: { label: 'Ausgeführt', tone: 'positive', icon: CheckIcon, disc: 'bg-green-soft text-green' },
  failed: { label: 'Nicht ausgeführt', tone: 'negative', icon: AlertTriangleIcon, disc: 'bg-red-soft text-red' },
  unknown: { label: 'Status unklar', tone: 'emphasis', icon: HelpIcon, disc: 'bg-inset text-ink-2' },
} as const;

function ActivityItem({ entry: e }: { entry: ActivityEntry }) {
  const { accounts, accountLabel, showTransactions, setInboxOpen } = useFints();
  const o = OUTCOME[e.outcome];
  const account = accounts.find((a) => a.accountNumber === e.accountNumber);
  const short = fmtShortIban(e.iban);
  // What the bank said beyond the tag beside it ("Auftrag ausgeführt." under "Ausgeführt").
  const answer = answerBeyondOutcome(e);
  const at = new Date(e.at);
  const time = `${at.getHours()}:${String(at.getMinutes()).padStart(2, '0')} Uhr`;

  return (
    <li className="flex items-start gap-3 border-b border-line px-4 py-4 last:border-b-0 sm:px-6">
      <span aria-hidden className={cx('relative mt-0.5 grid size-9 shrink-0 place-items-center rounded-full', o.disc)}>
        <TransferIcon size={17} />
        <span className="absolute -right-1 -bottom-1 grid size-[18px] place-items-center rounded-full bg-raised">
          <o.icon size={12} strokeWidth={2.4} />
        </span>
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="min-w-0 truncate text-[15px] leading-snug font-semibold text-ink">
            <span className="sr-only">Überweisung an </span>
            {e.name || 'Unbekannter Empfänger'}
          </p>
          <Money value={-e.amount} signed tone="credit" className="shrink-0 text-[15px] font-semibold" />
        </div>
        <p className="mt-0.5 text-[13px] leading-snug text-ink-3">
          <span className="tnum">{time}</span>
          {short.tail && <> · <span className="iban">{short.head} <span className="id-tail">{short.tail}</span></span></>}
          {account && <> · von {accountLabel(account)}</>}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Tag tone={o.tone} size="sm">{o.label}</Tag>
          {e.instant && <Tag size="sm">Echtzeit</Tag>}
        </div>
        {answer && (
          <p className="mt-2 text-[13.5px] leading-snug whitespace-pre-line text-ink-2 [overflow-wrap:anywhere]">{answer}</p>
        )}
        {/* A caution, not information: the warning's inset with the orange edge. */}
        {e.outcome === 'unknown' && (
          <Alert tone="warn" className="mt-2.5">
            Ob die Bank den Auftrag ausgeführt hat, ist nicht bekannt. Prüfe deine Umsätze, bevor du ihn wiederholst.
          </Alert>
        )}
        {e.outcome === 'unknown' && e.iban && (
          <Button
            variant="tertiary"
            size="xs"
            className="mt-1.5 -ml-3"
            onClick={() => {
              setInboxOpen(false);
              showTransactions({ query: e.iban });
            }}
          >
            Umsätze mit diesem Empfänger
          </Button>
        )}
      </div>
    </li>
  );
}
