'use client';

// The Übersicht's pointer to unread bank messages — only while there are
// any. It shows the first unread subject so the tile is worth reading on its own,
// and opens the Mitteilungen drawer for the rest.

import { useFints } from '../FintsProvider';
import { ChevronIcon, MailIcon } from '../icons';
import { CountBadge, Dot, Tile } from '../ui';

export function MessagesTeaser() {
  const { messages, unreadCount, setInboxOpen } = useFints();
  const unread = messages.filter((m) => !m.read);
  if (!unread.length) return null;
  const first = unread[0];

  return (
    <Tile
      title={
        <span className="inline-flex items-center gap-2">
          Mitteilungen
          <CountBadge count={unreadCount} tone="accent" />
          <span className="sr-only">ungelesen</span>
        </span>
      }
      subtitle="Von deiner Bank, bei dieser Anmeldung"
      className="min-w-0 overflow-clip"
    >
      <div className="px-4 pb-4 sm:px-5 sm:pb-5">
        <div className="flex items-start gap-3 rounded-[10px] bg-inset px-3.5 py-3">
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
        {unread.length === 1 ? 'Mitteilung lesen' : `Alle ${unread.length} lesen`}
        <ChevronIcon dir="right" size={15} />
      </button>
    </Tile>
  );
}
