'use client';

// Girovo AI's notes without asking as one quiet line on the desktop's
// Übersicht (Girovo Next): under the balance, above the bookings, on Girovo
// AI's wash with its mark. It says the running month's most pressing note
// (lib/ask-notes.ts) in one short sentence, and "+2" where there are more.
// A press opens the booking for a note about one booking (a double debit),
// else Girovo AI's panel on a fresh conversation, where every note stands.
// Its cross closes the notes it counts on this device (vault aiNotesClosed,
// lib/ask-notes-line.ts): the line comes back with a note it has not shown.
// Nothing at all while Girovo AI cannot answer or there is no note. The
// phone and Android keep the notes under the recap and in the conversation.

import { useMemo } from 'react';
import type { SerializedTransaction } from '@/lib/fints-types';
import { lineNote, withClosedNotes } from '@/lib/ask-notes-line';
import { useT } from '@/lib/i18n/react';
import { useFints } from '../FintsProvider';
import { AiMarkIcon, CloseIcon } from '../icons';
import { IconButton, cx } from '../ui';
import { useAskScope } from '../insights/AskThread';
import { useCanAsk } from '../insights/ask-gate';
import { currentConversation, newConversation, useAskThread } from '../insights/ask-thread-store';
import { NoteText, thisMonth, useNotes } from '../insights/ask/Notes';
import { useDesktopFrame } from '../shell/frame';
import { openTxDetail } from '../transactions/detail-host';

export function AiNoteLine({ className }: { className?: string }) {
  const frame = useDesktopFrame();
  const canAsk = useCanAsk();
  const t = useT();
  const words = t.ask.notes.line;
  const { vault, updateVault, categoryOf, txByAccount, accounts } = useFints();
  const data = useAskScope();
  const own = useMemo(
    () => (vault?.customCategories ?? []).map((c) => ({ id: c.id, name: c.name })),
    [vault?.customCategories],
  );
  // Every loaded account, as the conversation it opens counts them.
  const notes = useNotes(frame && canAsk ? data : null, categoryOf, thisMonth(), 0);
  const thread = useAskThread();
  const line = lineNote(notes, vault?.aiNotesClosed);
  if (!frame || !canAsk || !data || !line) return null;
  // The panel open on a fresh conversation shows every note already, beside the line.
  if (thread.open && !currentConversation(thread)) return null;
  const { note, more, keys } = line;

  const open = () => {
    if (note.kind === 'double') {
      const tx: SerializedTransaction = note.tx;
      const owner = Object.keys(txByAccount).find((key) => txByAccount[key]?.includes(tx));
      openTxDetail(tx, false, accounts.find((a) => a.accountNumber === owner));
      return;
    }
    newConversation();
  };
  const close = () => updateVault((v) => ({ ...v, aiNotesClosed: withClosedNotes(v.aiNotesClosed, keys) }));

  return (
    <div
      data-ai
      data-ai-note-line
      title={t.ask.thread.mistakes}
      className={cx('flex h-[52px] items-center gap-1 rounded-[16px] p-1 pr-2', className)}
    >
      <button
        type="button"
        onClick={open}
        className="flex h-full min-w-0 flex-1 items-center gap-3 rounded-[12px] pr-2 pl-3 text-left hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] active:bg-[color-mix(in_srgb,var(--ink)_10%,transparent)]"
      >
        <AiMarkIcon size={20} aria-hidden />
        <span className="min-w-0 flex-1 truncate text-[14px] leading-5 text-ink">
          <NoteText note={note} currency={data.currency} own={own} short />
        </span>
        {more > 0 && (
          <>
            <span aria-hidden className="tnum shrink-0 rounded-full bg-[color-mix(in_srgb,var(--paper)_72%,transparent)] px-2 text-[12px] leading-6 font-medium text-ink-2">
              {words.count(more)}
            </span>
            <span className="sr-only">{words.countLabel(more)}</span>
          </>
        )}
      </button>
      <IconButton size="sm" aria-label={words.hide} onClick={close}>
        <CloseIcon size={16} />
      </IconButton>
    </div>
  );
}
