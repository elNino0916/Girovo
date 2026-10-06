'use client';

// The stage: the navy band a bank's start page opens with. It says who is
// looking and where they are before it shows a single figure, and it carries
// the Schnellzugriffe — the few things people come to do: Überweisen, Geld
// anfordern, Kontoauszug. The CSV export is not one of them; it sits on the
// Umsätze list it exports, where a bank's Umsatzliste has it.
//
// Compact on purpose (~140px on a desktop, and the first row of tiles laps
// 48px over its lower edge): at the desktop shell's 900×600 minimum the
// account tiles must still be on screen without scrolling. In a zoomed or
// very short window it gets more compact still — no greeting, a smaller
// title — so the first account row stays in view there too.

import { useId } from 'react';
import type { ReactNode } from 'react';
import { useT } from '@/lib/i18n/react';
import { useFints } from '../FintsProvider';
import { FileIcon, QrIcon, TransferIcon } from '../icons';
import { Button, cx } from '../ui';
import type { ShellActions } from './actions';
import { firstName, greeting, sessionHolder, useNow } from './session';

export const PAGE_TITLE_ID = 'page-title';

export function Stage({ actions }: { actions: ShellActions }) {
  const { tab, accounts } = useFints();
  const t = useT();
  // Re-read every few minutes, so a session left open over dinner does not
  // keep saying "Guten Tag".
  const now = useNow(5 * 60_000);
  // The session's holder, as on the profile chip — not the active account's.
  const name = firstName(sessionHolder(accounts));

  return (
    <section aria-labelledby={PAGE_TITLE_ID} className="on-stage bg-stage">
      <div className="mx-auto w-full max-w-[1280px] px-4 pt-4 pb-[64px] sm:px-6 sm:pt-5 shorter:pt-3">
        <div className="flex flex-col gap-x-8 gap-y-3.5 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between shorter:items-center">
          <div className="min-w-0">
            <p className="min-h-[1.4em] text-[15px] leading-snug text-stage-ink-2 shorter:hidden">
              {now != null && `${greeting(now)}${name ? `, ${name}` : ''}`}
            </p>
            <h1
              id={PAGE_TITLE_ID}
              tabIndex={-1}
              className="mt-0.5 text-[28px] leading-[1.15] font-bold text-stage-ink outline-none sm:text-[32px] desk:text-[36px] shorter:mt-0 shorter:text-[24px]"
            >
              {t.shell.stage.titles[tab]}
            </h1>
          </div>
          <QuickActions actions={actions} />
        </div>
      </div>
    </section>
  );
}

// Below the desk breakpoint the pills drop to 36px and (above phone width)
// lose their glyphs, so all three fit on one line beside the title at the
// desktop shell's 900px minimum — a second row would push the first tiles
// below the fold there. On a phone they become one row of equal, thumb-sized
// pills (44px) with their glyphs; Überweisen leaves the row there, because
// the bottom bar's round button in the middle is that same action.
const PILL =
  'max-sm:h-11 max-sm:min-w-0 max-sm:flex-1 max-sm:px-3 max-sm:text-[14px] desk:h-11 desk:px-5 desk:text-[14px]';
const glyph = (icon: ReactNode) => <span className="contents sm:max-desk:hidden">{icon}</span>;

/**
 * Not available yet, and still a stop for Tab: a disabled button would leave
 * the reason in a tooltip that keyboard and touch never see. It looks
 * unavailable, says why to a screen reader, and a press says it in a toast.
 */
const UNAVAILABLE =
  'aria-disabled:cursor-not-allowed aria-disabled:opacity-45 aria-disabled:hover:border-stage-line aria-disabled:hover:bg-transparent';

function QuickActions({ actions: a }: { actions: ShellActions }) {
  const { singleKeyShortcuts: singleKeys } = useFints();
  const t = useT();
  const hintId = useId();
  return (
    <div role="group" aria-label={t.shell.stage.quickActions} className="flex gap-2 sm:flex-wrap">
      {a.canTransfer && (
        <Button
          variant="stage-primary"
          size="sm"
          className={cx(PILL, 'max-sm:hidden')}
          iconLeft={glyph(<TransferIcon size={17} />)}
          aria-keyshortcuts={singleKeys ? 'N' : undefined}
          onClick={a.transfer}
        >
          {t.shell.transfer}
        </Button>
      )}
      <Button variant="stage" size="sm" className={PILL} iconLeft={glyph(<QrIcon size={17} />)} disabled={!a.canShare} onClick={a.share}>
        {t.shell.requestMoney}
      </Button>
      <Button
        variant="stage"
        size="sm"
        className={cx(PILL, UNAVAILABLE)}
        iconLeft={glyph(<FileIcon size={17} />)}
        aria-disabled={!a.canStatement || undefined}
        aria-describedby={a.statementHint ? hintId : undefined}
        // Whose statement and which period: the pill acts on the account
        // selected in the Übersicht, whatever tab is open.
        title={a.canStatement ? t.shell.stage.statementTitle(a.statementSubject) : a.statementHint}
        onClick={a.statement}
      >
        {t.shell.stage.statement}
      </Button>
      {a.statementHint && <span id={hintId} className="sr-only">{a.statementHint}</span>}
    </div>
  );
}
