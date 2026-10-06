'use client';

// The one place an update is looked at and acted on: what the new version
// brings, the download, the restart into it — and whether the app looks for
// updates on its own. Every other surface (Mitteilungen, the Sitzung panel,
// the login bar, the palette) only points here.
//
// Nothing happens without a press: the download starts on "Herunterladen",
// the install on "Jetzt neu starten". The restart ends the bank session like
// any quit would, so it waits while an approval is open (the same rule as
// the automatic logout), and says so when the user is signed in.
//
// Focus opens on the step the dialog is about when that step is harmless
// (Herunterladen, Im Hintergrund laden, Nach Updates suchen) and on the way
// out when it is not (Später before a restart, Schließen before a page that
// leaves the app) — never on the switch or the GitHub link.
//
// A restart over a transfer whose status is unclear is the logout decision
// again, and gets the same safe answer: "Umsätze prüfen" (or, for several,
// "In Mitteilungen ansehen") is the filled primary, the restart the outline.

import { useId, useMemo } from 'react';
import { fmtBytes, fmtDate } from '@/lib/format';
import { rich, useT } from '@/lib/i18n/react';
import { parseReleaseNotes } from '@/lib/release-notes';
import { useFints, waitHoldsSession } from '../FintsProvider';
import { CheckCircleIcon, DownloadIcon, ExternalIcon, InfoIcon, RefreshIcon } from '../icons';
import { Alert, Button, Dialog, Spinner, Switch } from '../ui';
import { fmtSince } from '../shell/session';
import { useLookAtUnclear } from '../shell/actions';
import { ReleaseNotes } from './ReleaseNotes';
import { hasNewer, updates, useUpdates, type UpdateState } from './store';

export function UpdateDialog() {
  const { state, dialog } = useUpdates();
  if (!state) return null;
  return <UpdateDialogView state={state} open={dialog} />;
}

function UpdateDialogView({ state, open }: { state: UpdateState; open: boolean }) {
  const { view, busy, wait } = useFints();
  const t = useT();
  const u = t.shell.updates;
  const { unclear: unclearList, look, lookLabel } = useLookAtUnclear();
  const release = hasNewer(state) ? state.release : null;
  const installed = release ? null : state.installed;
  const signedIn = view === 'dashboard';
  // An approval being waited for, or a bank call on the wire: quitting now
  // would abandon it half-way.
  const holding = busy || (wait.open && waitHoldsSession(wait));
  const portable = state.kind === 'portable';
  // The restart is a logout too: what it would take with it is said, as on
  // every other way out of the session.
  const unclear = signedIn ? unclearList.length : 0;

  const title = release
    ? state.phase === 'ready' || state.phase === 'installing'
      ? u.ready(release.version)
      : u.available(release.version)
    : installed
      ? u.newIn(installed.version)
      : u.title;

  // The date belongs to the new version, so it is said with it.
  const current = <span className="tnum">{state.current}</span>;
  const description = release ? (
    release.publishedAt ? (
      rich(u.releaseOf(
        <span className="tnum">{release.version}</span>,
        <span className="tnum">{fmtDate(release.publishedAt)}</span>,
        current,
      ))
    ) : (
      rich(u.youUse(current))
    )
  ) : installed ? (
    installed.from ? rich(u.updatedFrom(<span className="tnum">{installed.from}</span>)) : u.justUpdated
  ) : (
    rich(u.installedIs(current))
  );

  const icon = release ? <DownloadIcon size={20} /> : installed ? <CheckCircleIcon size={20} /> : <RefreshIcon size={20} />;
  const close = updates.closeDialog;

  let actions;
  if (release && !release.canInstall) {
    actions = (
      <>
        <Button variant="secondary" data-autofocus onClick={close}>{t.common.close}</Button>
        <Button variant="primary" iconLeft={<ExternalIcon size={16} />} onClick={() => void updates.openRelease()}>
          {u.openDownloadPage}
        </Button>
      </>
    );
  } else if (release && state.phase === 'downloading') {
    actions = (
      <>
        <Button variant="secondary" onClick={() => void updates.cancel()}>{t.common.cancel}</Button>
        <Button variant="primary" data-autofocus onClick={close}>{u.inBackground}</Button>
      </>
    );
  } else if (release && (state.phase === 'ready' || state.phase === 'installing')) {
    const restart = (
      <Button
        variant={unclear > 0 ? 'secondary' : 'primary'}
        busy={state.phase === 'installing'}
        disabled={holding}
        onClick={() => void updates.install()}
      >
        {portable ? u.startNew : u.restartNow}
      </Button>
    );
    actions = unclear > 0 ? (
      // Look first: the restart takes the only record of those transfers with it.
      <>
        <Button variant="quiet" className="sm:mr-auto sm:-ml-3" onClick={close} disabled={state.phase === 'installing'}>{u.later}</Button>
        {restart}
        <Button
          variant="primary"
          data-autofocus
          disabled={state.phase === 'installing'}
          onClick={() => {
            close();
            look();
          }}
        >
          {lookLabel}
        </Button>
      </>
    ) : (
      <>
        <Button variant="secondary" data-autofocus onClick={close} disabled={state.phase === 'installing'}>{u.later}</Button>
        {restart}
      </>
    );
  } else if (release) {
    actions = (
      <>
        <Button variant="secondary" onClick={close}>{u.later}</Button>
        <Button
          variant="primary"
          data-autofocus
          iconLeft={<DownloadIcon size={16} />}
          disabled={state.phase !== 'available'}
          onClick={() => void updates.download()}
        >
          {u.download}{release.size ? <span className="font-normal opacity-85">({fmtBytes(release.size)})</span> : null}
        </Button>
      </>
    );
  } else {
    actions = (
      <>
        <Button variant="secondary" onClick={close}>{t.common.close}</Button>
        <Button
          variant="primary"
          data-autofocus
          iconLeft={<RefreshIcon size={16} />}
          busy={state.phase === 'checking'}
          onClick={() => void updates.check()}
        >
          {t.shell.checkForUpdates}
        </Button>
      </>
    );
  }

  return (
    <Dialog open={open} onClose={close} size="md" title={title} description={description} icon={icon} actions={actions}>
      <div className="flex flex-col gap-4">
        {/* First, above the notes: it is why "Umsätze prüfen" is the filled
            button, so it must be in view in a short window too. A caution,
            not information — the warning's inset with the orange edge, as
            everywhere Status unklar is said. */}
        {release?.canInstall && (state.phase === 'ready' || state.phase === 'installing') && unclear > 0 && (
          <Alert tone="warn" className="mt-0">
            {u.unclearRestart(unclear)}
          </Alert>
        )}

        {!release && <Status state={state} />}

        {release && <Notes notes={release.notes} name={release.name} />}
        {installed?.notes && <Notes notes={installed.notes} name={installed.version} />}

        {release && state.phase === 'downloading' && <Progress received={state.received} total={state.total} />}

        {release && !release.canInstall && (
          <Alert tone="info" className="mt-0">
            {state.kind === 'dev' || state.kind === 'manual' ? u.cannotUpdate : u.noFile}
          </Alert>
        )}

        {release?.canInstall && (state.phase === 'ready' || state.phase === 'installing') && (
          <Alert tone="info" className="mt-0" role="status">
            {portable
              ? rich(u.portable(<span className="font-semibold [overflow-wrap:anywhere]">{state.location}</span>))
              : u.restarts}
            {signedIn && <> {u.logsOut}</>}
          </Alert>
        )}


        {release?.canInstall && state.phase === 'ready' && holding && (
          <p className="flex items-start gap-2.5 text-[14px] leading-snug text-ink-2">
            <InfoIcon size={16} className="mt-px shrink-0 text-info" />
            <span>{u.approvalRunning}</span>
          </p>
        )}

        {installed?.previousFile && (
          <p className="flex items-start gap-2.5 text-[14px] leading-snug text-ink-2">
            <InfoIcon size={16} className="mt-px shrink-0 text-info" />
            <span>
              {rich(u.previous(<span className="font-semibold [overflow-wrap:anywhere]">{installed.previousFile}</span>))}
            </span>
          </p>
        )}

        {state.error && (
          <Alert tone="error" className="mt-0">
            {state.error.message}
          </Alert>
        )}

        <AutoCheck state={state} />
      </div>
    </Dialog>
  );
}

/** Where the search stands, while no newer version is known. */
function Status({ state }: { state: UpdateState }) {
  const t = useT();
  const u = t.shell.updates;
  if (state.phase === 'checking') {
    return (
      <p role="status" className="flex items-center gap-2.5 text-[15px] text-ink">
        <Spinner />
        {u.checking}
      </p>
    );
  }
  if (state.phase === 'current') {
    return (
      <p role="status" className="flex items-start gap-2.5 text-[15px] leading-snug text-ink">
        <CheckCircleIcon size={20} className="shrink-0 text-green" />
        <span>
          {u.latest}
          {state.checkedAt != null && (
            <span className="mt-0.5 block text-[13.5px] text-ink-3">
              {rich(u.lastChecked(<span className="tnum">{fmtSince(state.checkedAt)}</span>))}
            </span>
          )}
        </span>
      </p>
    );
  }
  // Not yet asked in this session (the first automatic check runs shortly
  // after the start), or the automatic check is off.
  if (state.installed) return null;
  return (
    <p className="text-[15px] leading-snug text-ink-2">
      {state.auto && state.kind !== 'dev' ? u.autoOn : u.autoOff}
    </p>
  );
}

function Notes({ notes, name }: { notes: string; name: string }) {
  const t = useT();
  const id = useId();
  const blocks = useMemo(() => parseReleaseNotes(notes, name), [notes, name]);
  if (!blocks.length) return null;
  return (
    <section aria-labelledby={id}>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 id={id} className="section-head">{t.shell.updates.whatsNew}</h3>
        <button
          type="button"
          onClick={() => void updates.openRelease()}
          className="inline-flex min-h-8 items-center gap-1 rounded-sm text-[13.5px] font-semibold text-accent underline-offset-4 hover:underline"
        >
          {t.shell.updates.onGitHub}
          <ExternalIcon size={13} />
          <span className="sr-only">{t.shell.opensExternally}</span>
        </button>
      </div>
      {/* A scrolling region, so it takes focus to be scrolled by keyboard.
          Lower on a short window, where the dialog itself already scrolls. */}
      <div
        role="region"
        aria-labelledby={id}
        tabIndex={0}
        className="max-h-[min(32vh,300px)] overflow-y-auto overscroll-contain rounded-[8px] bg-inset px-4 py-3.5 text-[14px] leading-relaxed text-ink-2 short:max-h-[min(24vh,300px)]"
      >
        <ReleaseNotes blocks={blocks} />
      </div>
    </section>
  );
}

function Progress({ received, total }: { received: number; total: number }) {
  const t = useT();
  const u = t.shell.updates;
  const pct = total > 0 ? Math.min(100, Math.floor((received / total) * 100)) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-[14px]">
        <span className="font-semibold text-ink">{u.downloading}</span>
        <span className="tnum text-ink-2">
          {t.format.partOf(fmtBytes(received, { unitOf: total, bare: true }), fmtBytes(total))}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={u.progress}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={u.percent(pct)}
        className="mt-2 h-2 overflow-hidden rounded-full bg-inset"
      >
        {/* Navy, not Signal Blue: a progress fill cannot be pressed. It slides
            in behind the track's clip (a transform, no layout per chunk). */}
        <div
          className="h-full rounded-full bg-headline transition-transform duration-200 ease-[var(--ease-out-soft)] motion-reduce:transition-none"
          style={{ transform: `translateX(${pct - 100}%)` }}
        />
      </div>
      <p className="mt-2 text-[13px] leading-snug text-ink-3">
        {u.checksum}
      </p>
    </div>
  );
}

function AutoCheck({ state }: { state: UpdateState }) {
  const u = useT().shell.updates;
  // An unpackaged build never checks on its own; a switch would only mislead.
  if (state.kind === 'dev') return null;
  return (
    <div className="border-t border-line pt-4">
      <Switch
        checked={state.auto}
        onChange={(on) => void updates.setAuto(on)}
        label={u.auto}
        description={u.autoHint}
      />
    </div>
  );
}
