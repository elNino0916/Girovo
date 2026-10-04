'use client';

// The Übersicht's pointer to unread bank messages — only while there are
// any. It shows the first unread subject so the tile is worth reading on its own,
// and opens the Mitteilungen drawer for the rest.
//
// At login the bank's messages are announced here and by the masthead's
// bell, and nowhere else: no toast on top. A toast is gone after a few
// seconds, at the busiest moment of the session; this tile stays until the
// messages are read. It counts the bank's messages only, as the bell's number
// does; a waiting app update is marked on the bell by its dot alone.

import { useFints } from '../FintsProvider';
import { ChevronIcon, MailIcon } from '../icons';
import { Dot, Tile } from '../ui';

export function MessagesTeaser() {
  const { messages, setInboxOpen } = useFints();
  const unread = messages.filter((m) => !m.read);
  if (!unread.length) return null;
  const first = unread[0];
  const count = unread.length;

  return (
    <Tile
      title="Mitteilungen"
      // The count in words, not in a filled badge: blue is for what can be pressed.
      subtitle={`${count} ungelesen · von deiner Bank, bei dieser Anmeldung`}
      className="min-w-0 overflow-clip"
    >
      <div className="px-4 pb-4 sm:px-5 sm:pb-5">
        <div className="flex items-start gap-3 rounded-[var(--radius-chip)] bg-inset px-3.5 py-3">
          <span className="relative mt-0.5 shrink-0 text-ink-2">
            <MailIcon />
            <Dot className="absolute -top-0.5 -right-0.5 ring-2 ring-[var(--inset)]" />
          </span>
          <div className="min-w-0">
            <p className="line-clamp-2 text-[14px] leading-snug font-semibold text-ink">{first.subject}</p>
            {first.text && first.text !== first.subject && (
              // A preview reads as one run of text; the bank's line breaks are
              // kept in the drawer, where the whole message is shown.
              <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-ink-2">{first.text.replace(/\s+/g, ' ')}</p>
            )}
          </div>
        </div>
      </div>
      {/* The way on, as a full-width row at the foot of the tile — the shape
          the Monatsbilanz beside it uses, its label on the tile's text edge. */}
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => setInboxOpen(true)}
        className="row-focus flex w-full items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-left text-[13.5px] font-semibold text-accent hover:bg-accent-soft sm:px-5"
      >
        {count === 1 ? 'Mitteilung lesen' : count === 2 ? 'Beide lesen' : `Alle ${count} lesen`}
        <ChevronIcon dir="right" size={15} />
      </button>
    </Tile>
  );
}
