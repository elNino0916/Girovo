'use client';

// "Notiz" in the Umsatzdetails: a line the user writes about this booking,
// kept in the encrypted vault under its txKey (lib/notes.ts).
//
// Shown here in a well, with the amounts in it masked like the bank's own
// text while "Beträge ausblenden" is on (it is the user's text, but a screen
// share should not read a figure off it any more than off a
// Verwendungszweck). The field itself shows what is typed: writing is an
// explicit act, like the amount field of a transfer. Never printed — the
// Buchungsbeleg is for a third party.

import { useId, useRef, useState, type KeyboardEvent } from 'react';
import type { SerializedTransaction } from '@/lib/fints-types';
import { useT } from '@/lib/i18n/react';
import { NOTE_MAX_CHARS, cleanNote } from '@/lib/notes';
import { BankText } from '../BankText';
import { useFints } from '../FintsProvider';
import { NoteIcon, PencilIcon, TrashIcon } from '../icons';
import { Button, Field, Textarea } from '../ui';

export function NoteSection({ tx }: { tx: SerializedTransaction }) {
  const { noteOf, setNote, vaultStatus } = useFints();
  const tr = useT();
  const words = tr.budgets.notes;
  const note = noteOf(tx);
  const titleId = useId();
  const fieldId = useId();
  const [draft, setDraft] = useState<string | null>(null);
  /** What just happened, said to a screen reader (and kept for the "session only" hint). */
  const [said, setSaid] = useState<'saved' | 'removed' | null>(null);
  // The control that stays when the one holding focus goes: the section's
  // own action once the editor closes.
  const actionRef = useRef<HTMLButtonElement | null>(null);
  const refocus = () => setTimeout(() => actionRef.current?.focus(), 0);

  const editing = draft !== null;
  const start = () => {
    setDraft(note ?? '');
    setSaid(null);
  };
  const cancel = () => {
    setDraft(null);
    refocus();
  };
  const save = () => {
    const text = cleanNote(draft ?? '');
    setNote(tx, text || null);
    setDraft(null);
    setSaid(text ? 'saved' : note ? 'removed' : null);
    refocus();
  };
  const remove = () => {
    setNote(tx, null);
    setSaid('removed');
    refocus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // One line: Enter keeps the note, Escape leaves the editor — not the drawer.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      save();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    }
  };

  return (
    <section aria-labelledby={titleId} className="mt-6 border-t border-line pt-5">
      <h3 id={titleId} className="text-[15px] font-bold text-headline">{words.title}</h3>

      {editing ? (
        <div className="mt-3">
          <Field
            label={words.field}
            htmlFor={fieldId}
            labelHidden
            hint={words.hint}
            className="mb-0"
          >
            <Textarea
              id={fieldId}
              // The editor opened on request: the field is where the user is going.
              autoFocus
              rows={3}
              value={draft}
              maxLength={NOTE_MAX_CHARS}
              showCount
              placeholder={words.placeholder}
              autoComplete="off"
              spellCheck
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              className="min-h-[76px]"
            />
          </Field>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="primary" onClick={save}>{tr.common.save}</Button>
            <Button size="sm" variant="quiet" onClick={cancel}>{tr.common.cancel}</Button>
          </div>
        </div>
      ) : note ? (
        <>
          {/* The user's own words, one line as kept; amounts masked like bank text. */}
          <p className="mt-3 rounded-[8px] bg-inset px-4 py-3 text-[15px] leading-snug break-words text-ink">
            <BankText text={note} />
          </p>
          <div className="mt-2 -ml-3 flex flex-wrap items-center gap-1">
            <Button
              ref={actionRef}
              size="xs"
              variant="tertiary"
              iconLeft={<PencilIcon size={15} />}
              aria-label={words.editLabel}
              onClick={start}
            >
              {words.edit}
            </Button>
            <Button size="xs" variant="tertiary" iconLeft={<TrashIcon size={15} />} aria-label={words.removeLabel} onClick={remove}>
              {words.remove}
            </Button>
          </div>
        </>
      ) : (
        <>
          <Button ref={actionRef} size="sm" variant="secondary" iconLeft={<NoteIcon size={16} />} className="mt-3" onClick={start}>
            {words.add}
          </Button>
          <p className="mt-2 text-[13px] leading-snug text-ink-3">{words.hint}</p>
        </>
      )}

      <p className="sr-only" aria-live="polite">{said === 'saved' ? words.saved : said === 'removed' ? words.removed : ''}</p>
      {said && vaultStatus !== 'ready' && (
        <p className="mt-2 text-[13px] text-ink-3">{tr.transactions.categorize.sessionOnly}</p>
      )}
    </section>
  );
}
