'use client';

// The places that point to the update dialog. Each says only what it must —
// a newer version exists, or this start is the result of an update — and
// opens the dialog for everything else. None renders outside the desktop app.
//
//   UpdateLayer       the dialog itself, the toast when a download that was
//                     sent to the background is ready, the toast after an update
//   UpdateInboxCard   Mitteilungen, at the foot, after the bank's own words
//                     (the bell marks it until it was seen)
//   UpdateSessionRow  the Sitzung panel, always there: the way to look
//   UpdateBarButton   the login screens' bar, which has room to spare

import { useEffect, useRef } from 'react';
import { msgs } from '@/lib/i18n';
import { rich, useT } from '@/lib/i18n/react';
import { useFints } from '../FintsProvider';
import { CheckCircleIcon, DownloadIcon, RefreshIcon } from '../icons';
import { Button, Dot, Tag, cx } from '../ui';
import { UpdateDialog } from './UpdateDialog';
import { hasNewer, isReady, updates, useUpdates, type UpdateState } from './store';

// Up to 4.3 the app was called Sooskasse-FinTS. The first start after the
// update from such a version says so — the name in the bar has just changed.
// `from` is the version the update replaced ("4.3.0", "4.1.0-dev.12", or ''
// when the marker did not say).
function renamedSince(from: string | undefined): boolean {
  const [major, minor] = (from ?? '').split('.').map(Number);
  return major < 4 || (major === 4 && minor <= 3);
}

export function UpdateLayer() {
  const { state, greeted, dialog } = useUpdates();
  const { toast } = useFints();
  const installed = state?.installed?.version;
  const installedFrom = state?.installed?.from;
  const failed = state?.failedInstall;

  // "Im Hintergrund laden" closes the dialog on a running download; when it
  // is through, that is said here — once, and only when the dialog is not
  // open to say it itself. Nothing is installed until the restart.
  const phase = state?.phase;
  const prevPhase = useRef(phase);
  useEffect(() => {
    const was = prevPhase.current;
    prevPhase.current = phase;
    if (was !== 'downloading' || phase !== 'ready' || dialog || !state?.release) return;
    const u = msgs().shell.updates;
    toast(u.downloaded(state.release.version), 'success', 12_000, { label: u.details, run: updates.openDialog });
  }, [phase, dialog, state, toast]);

  // Said once per page, at the first start after an install: that it worked —
  // or, when this is still the old version, that it did not.
  useEffect(() => {
    if (greeted || (!installed && !failed)) return;
    updates.markGreeted();
    const u = msgs().shell.updates;
    if (installed) {
      const text = renamedSince(installedFrom) ? u.renamed(installed) : u.updated(installed);
      toast(text, 'success', 10_000, {
        label: u.whatsNewAsk,
        run: updates.openDialog,
      });
    } else {
      toast(u.notCompleted(failed ?? ''), 'error', 12_000, {
        label: u.details,
        run: updates.openDialog,
      });
    }
  }, [installed, installedFrom, failed, greeted, toast]);

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
      ready: isReady(state),
      current: state.current,
    };
  }
  if (state?.installed) return { kind: 'installed', version: state.installed.version };
  return null;
}

/**
 * The app's own news in Mitteilungen: one quiet row under the bank's
 * messages and this session's transfers — housekeeping, not content, so no
 * tinted card and nothing in Signal Blue that cannot be pressed.
 */
export function UpdateInboxCard({ notice, onOpen }: { notice: UpdateNotice; onOpen: () => void }) {
  const u = useT().shell.updates;
  const newer = notice.kind === 'newer';
  return (
    <div className="flex items-start gap-3">
      <span
        aria-hidden
        className={cx(
          'mt-0.5 grid size-8 shrink-0 place-items-center rounded-full',
          newer ? 'bg-inset text-ink-2' : 'bg-green-soft text-green',
        )}
      >
        {newer ? <DownloadIcon size={16} /> : <CheckCircleIcon size={16} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14.5px] leading-snug font-semibold text-ink">
          {newer
            ? notice.ready
              ? u.readyToInstall(notice.version)
              : u.available(notice.version)
            : u.updatedTo(notice.version)}
        </p>
        <p className="mt-0.5 text-[13px] leading-snug text-ink-3">
          {!newer
            ? u.seeChanges
            : notice.ready
              ? rich(u.stillOn(<span className="tnum">{notice.current}</span>))
              : rich(u.notYetDownloaded(<span className="tnum">{notice.current}</span>))}
        </p>
        <Button variant="tertiary" size="xs" className="mt-1 -ml-3.5" aria-haspopup="dialog" onClick={onOpen}>
          {newer ? (notice.ready ? u.installNow : u.detailsAndDownload) : u.whatsNewOpen}
        </Button>
      </div>
    </div>
  );
}

/**
 * The Sitzung panel's line about the app: its version, a mark when a newer
 * one is known, and how far a download sent to the background has come.
 * Always there in the desktop app, so a check is always one press away.
 * `className`: the panel's row style, shared with the rows beside it.
 */
export function UpdateSessionRow({ onOpen, className }: { onOpen: () => void; className?: string }) {
  const { state } = useUpdates();
  const t = useT();
  if (!state) return null;
  const newer = hasNewer(state) ? state.release : null;
  const pct = state.total > 0 ? Math.min(100, Math.floor((state.received / state.total) * 100)) : 0;
  return (
    <button type="button" aria-haspopup="dialog" onClick={onOpen} className={className}>
      <RefreshIcon size={18} className="text-ink-2" />
      <span className="flex-1">{t.shell.updates.title}</span>
      {newer && state.phase === 'downloading' ? (
        <span className="tnum text-[13px] text-ink-3">{t.shell.updates.loadingPct(pct)}</span>
      ) : newer ? (
        <Tag tone="emphasis" size="sm">
          {isReady(state) ? t.shell.updates.readyTag : t.shell.version(newer.version)}
        </Tag>
      ) : (
        <span className="tnum text-[13px] text-ink-3">{t.shell.version(state.current)}</span>
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
  const u = useT().shell.updates;
  if (!hasNewer(state)) return null;
  const label = isReady(state) ? u.barReady : u.barAvailable;
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      title={u.barTitle(label, state.release.version)}
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
