'use client';

// The places that point to the update dialog. Each says only what it must —
// a newer version exists, or this start is the result of an update — and
// opens the dialog for everything else. None renders outside the desktop app.
//
//   UpdateLayer       the dialog itself, and the toast after an update
//   UpdateInboxCard   Mitteilungen (the bell counts it until it was seen)
//   UpdateSessionRow  the Sitzung panel, always there: the way to look
//   UpdateBarButton   the login screens' bar, which has room to spare

import { useEffect } from 'react';
import { useFints } from '../FintsProvider';
import { CheckCircleIcon, DownloadIcon, RefreshIcon } from '../icons';
import { Button, Dot, Tag, cx } from '../ui';
import { UpdateDialog } from './UpdateDialog';
import { hasNewer, updates, useUpdates, type UpdateState } from './store';

export function UpdateLayer() {
  const { state, greeted } = useUpdates();
  const { toast } = useFints();
  const installed = state?.installed?.version;
  const failed = state?.failedInstall;

  // Said once per page, at the first start after an install: that it worked —
  // or, when this is still the old version, that it did not.
  useEffect(() => {
    if (greeted || (!installed && !failed)) return;
    updates.markGreeted();
    if (installed) {
      toast(`Sooskasse-FinTS wurde auf Version ${installed} aktualisiert.`, 'success', 10_000, {
        label: 'Was ist neu?',
        run: updates.openDialog,
      });
    } else {
      toast(`Das Update auf Version ${failed} wurde nicht abgeschlossen.`, 'error', 12_000, {
        label: 'Details',
        run: updates.openDialog,
      });
    }
  }, [installed, failed, greeted, toast]);

  return <UpdateDialog />;
}

export type UpdateNotice =
  | { kind: 'newer'; version: string; ready: boolean; current: string }
  | { kind: 'installed'; version: string };

/** What Mitteilungen should say about the app itself, if anything. */
export function useUpdateNotice(): UpdateNotice | null {
  const { state } = useUpdates();
  return noticeOf(state);
}

function noticeOf(state: UpdateState | null): UpdateNotice | null {
  if (hasNewer(state)) {
    return {
      kind: 'newer',
      version: state.release.version,
      ready: state.phase === 'ready' || state.phase === 'installing',
      current: state.current,
    };
  }
  if (state?.installed) return { kind: 'installed', version: state.installed.version };
  return null;
}

export function UpdateInboxCard({ notice, onOpen }: { notice: UpdateNotice; onOpen: () => void }) {
  const newer = notice.kind === 'newer';
  return (
    <div className="flex items-start gap-3 rounded-[10px] bg-inset px-4 py-3.5">
      <span
        aria-hidden
        className={cx(
          'grid size-9 shrink-0 place-items-center rounded-full',
          newer ? 'bg-accent-soft text-accent' : 'bg-green-soft text-green',
        )}
      >
        {newer ? <DownloadIcon size={17} /> : <CheckCircleIcon size={17} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] leading-snug font-semibold text-ink">
          {newer
            ? notice.ready
              ? `Version ${notice.version} ist bereit zur Installation`
              : `Version ${notice.version} ist verfügbar`
            : `Aktualisiert auf Version ${notice.version}`}
        </p>
        <p className="mt-0.5 text-[13.5px] leading-snug text-ink-2">
          {!newer
            ? 'Sieh dir an, was sich geändert hat.'
            : notice.ready
              ? <>Du nutzt noch Version <span className="tnum">{notice.current}</span>. Installiert wird erst, wenn du es sagst.</>
              : <>Du nutzt Version <span className="tnum">{notice.current}</span>. Heruntergeladen wird erst, wenn du es sagst.</>}
        </p>
        <Button variant="tertiary" size="xs" className="mt-1.5 -ml-3" aria-haspopup="dialog" onClick={onOpen}>
          {newer ? (notice.ready ? 'Jetzt installieren …' : 'Details und Download …') : 'Was ist neu? …'}
        </Button>
      </div>
    </div>
  );
}

/**
 * The Sitzung panel's line about the app: its version, and a mark when a
 * newer one is known. Always there in the desktop app, so a check is always
 * one press away.
 */
export function UpdateSessionRow({ onOpen }: { onOpen: () => void }) {
  const { state } = useUpdates();
  if (!state) return null;
  const newer = hasNewer(state) ? state.release : null;
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      onClick={onOpen}
      className="-mx-1.5 flex min-h-10 items-center gap-3 rounded-[8px] px-3 text-left text-[14px] text-ink hover:bg-inset"
    >
      <RefreshIcon size={18} className="text-ink-2" />
      <span className="flex-1">Updates</span>
      {newer ? (
        <Tag tone="emphasis" size="sm">
          {state.phase === 'ready' ? 'Bereit zur Installation' : `Version ${newer.version}`}
        </Tag>
      ) : (
        <span className="tnum text-[13px] text-ink-3">Version {state.current}</span>
      )}
    </button>
  );
}

/**
 * The login screens' bar: before anyone signs in is the best moment to
 * update, and that bar has the room. The dashboard's masthead does not — it
 * has the bell for this.
 */
export function UpdateBarButton({ className }: { className?: string }) {
  const { state } = useUpdates();
  if (!hasNewer(state)) return null;
  const label = state.phase === 'ready' ? 'Update bereit' : 'Update verfügbar';
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      title={`${label}: Version ${state.release.version}`}
      onClick={updates.openDialog}
      className={cx('navlink inline-flex', className)}
    >
      <span className="relative">
        <DownloadIcon size={18} />
        <Dot className="absolute -top-0.5 -right-0.5 ring-2 ring-bar" />
      </span>
      <span>{label}</span>
    </button>
  );
}
