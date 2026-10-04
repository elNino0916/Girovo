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

import { useId, useMemo } from 'react';
import { fmtBytes, fmtDate } from '@/lib/format';
import { parseReleaseNotes } from '@/lib/release-notes';
import { useFints, waitHoldsSession } from '../FintsProvider';
import { CheckCircleIcon, DownloadIcon, ExternalIcon, InfoIcon, RefreshIcon } from '../icons';
import { Alert, Button, Dialog, Spinner, Switch } from '../ui';
import { fmtSince } from '../shell/session';
import { ReleaseNotes } from './ReleaseNotes';
import { hasNewer, updates, useUpdates, type UpdateState } from './store';

export function UpdateDialog() {
  const { state, dialog } = useUpdates();
  if (!state) return null;
  return <UpdateDialogView state={state} open={dialog} />;
}

function UpdateDialogView({ state, open }: { state: UpdateState; open: boolean }) {
  const { view, busy, wait } = useFints();
  const release = hasNewer(state) ? state.release : null;
  const installed = release ? null : state.installed;
  const signedIn = view === 'dashboard';
  // An approval being waited for, or a bank call on the wire: quitting now
  // would abandon it half-way.
  const holding = busy || (wait.open && waitHoldsSession(wait));
  const portable = state.kind === 'portable';

  const title = release
    ? state.phase === 'ready' || state.phase === 'installing'
      ? `Version ${release.version} ist bereit`
      : `Version ${release.version} ist verfügbar`
    : installed
      ? `Neu in Version ${installed.version}`
      : 'Updates';

  const description = release ? (
    <>
      Du nutzt Version <span className="tnum">{state.current}</span>
      {release.publishedAt && <> · erschienen am <span className="tnum">{fmtDate(release.publishedAt)}</span></>}
    </>
  ) : installed ? (
    installed.from ? <>Aktualisiert von Version <span className="tnum">{installed.from}</span>.</> : 'Gerade aktualisiert.'
  ) : (
    <>Installiert ist Version <span className="tnum">{state.current}</span>.</>
  );

  const icon = release ? <DownloadIcon size={20} /> : installed ? <CheckCircleIcon size={20} /> : <RefreshIcon size={20} />;
  const close = updates.closeDialog;

  let actions;
  if (release && !release.canInstall) {
    actions = (
      <>
        <Button variant="secondary" onClick={close}>Schließen</Button>
        <Button variant="primary" iconLeft={<ExternalIcon size={16} />} onClick={() => void updates.openRelease()}>
          Download-Seite öffnen
        </Button>
      </>
    );
  } else if (release && state.phase === 'downloading') {
    actions = (
      <>
        <Button variant="secondary" onClick={() => void updates.cancel()}>Abbrechen</Button>
        <Button variant="primary" onClick={close}>Im Hintergrund laden</Button>
      </>
    );
  } else if (release && (state.phase === 'ready' || state.phase === 'installing')) {
    actions = (
      <>
        <Button variant="secondary" onClick={close} disabled={state.phase === 'installing'}>Später</Button>
        <Button
          variant="primary"
          busy={state.phase === 'installing'}
          disabled={holding}
          onClick={() => void updates.install()}
        >
          {portable ? 'Neue Version starten' : 'Jetzt neu starten'}
        </Button>
      </>
    );
  } else if (release) {
    actions = (
      <>
        <Button variant="secondary" onClick={close}>Später</Button>
        <Button
          variant="primary"
          iconLeft={<DownloadIcon size={16} />}
          disabled={state.phase !== 'available'}
          onClick={() => void updates.download()}
        >
          Herunterladen{release.size ? <span className="font-normal opacity-85">({fmtBytes(release.size)})</span> : null}
        </Button>
      </>
    );
  } else {
    actions = (
      <>
        <Button variant="secondary" onClick={close}>Schließen</Button>
        <Button
          variant="primary"
          iconLeft={<RefreshIcon size={16} />}
          busy={state.phase === 'checking'}
          onClick={() => void updates.check()}
        >
          Nach Updates suchen
        </Button>
      </>
    );
  }

  return (
    <Dialog open={open} onClose={close} size="md" title={title} description={description} icon={icon} actions={actions}>
      <div className="flex flex-col gap-4">
        {!release && <Status state={state} />}

        {release && <Notes notes={release.notes} name={release.name} />}
        {installed?.notes && <Notes notes={installed.notes} name={installed.version} />}

        {release && state.phase === 'downloading' && <Progress received={state.received} total={state.total} />}

        {release && !release.canInstall && (
          <Alert tone="info" className="mt-0">
            {state.kind === 'dev' || state.kind === 'manual'
              ? 'Diese Ausgabe der App kann sich nicht selbst aktualisieren. Lade die neue Version auf GitHub herunter.'
              : 'Für diese Version gibt es keine Datei, die die App prüfen könnte. Lade sie auf GitHub herunter.'}
          </Alert>
        )}

        {release?.canInstall && (state.phase === 'ready' || state.phase === 'installing') && (
          <Alert tone="info" className="mt-0" role="status">
            {portable ? (
              <>
                Die neue Version liegt in <span className="font-semibold [overflow-wrap:anywhere]">{state.location}</span> und
                startet statt dieser.
              </>
            ) : (
              <>Sooskasse-FinTS wird beendet, installiert die neue Version und startet von selbst neu – meist in weniger als einer Minute.</>
            )}
            {signedIn && <> Du wirst dabei abgemeldet.</>}
          </Alert>
        )}

        {release?.canInstall && state.phase === 'ready' && holding && (
          <p className="flex items-start gap-2.5 text-[14px] leading-snug text-ink-2">
            <InfoIcon size={16} className="mt-px shrink-0 text-info" />
            <span>Gerade läuft eine Freigabe. Neu starten kannst du, sobald sie abgeschlossen ist.</span>
          </p>
        )}

        {installed?.previousFile && (
          <p className="flex items-start gap-2.5 text-[14px] leading-snug text-ink-2">
            <InfoIcon size={16} className="mt-px shrink-0 text-info" />
            <span>
              Die vorige Version liegt noch unter{' '}
              <span className="font-semibold [overflow-wrap:anywhere]">{installed.previousFile}</span>. Du kannst sie
              löschen.
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
  if (state.phase === 'checking') {
    return (
      <p role="status" className="flex items-center gap-2.5 text-[15px] text-ink">
        <Spinner />
        Suche nach Updates …
      </p>
    );
  }
  if (state.phase === 'current') {
    return (
      <p role="status" className="flex items-start gap-2.5 text-[15px] leading-snug text-ink">
        <CheckCircleIcon size={20} className="shrink-0 text-green" />
        <span>
          Du nutzt die neueste Version.
          {state.checkedAt != null && (
            <span className="mt-0.5 block text-[13.5px] text-ink-3">
              Zuletzt geprüft: <span className="tnum">{fmtSince(state.checkedAt)}</span>
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
      {state.auto && state.kind !== 'dev'
        ? 'Die App sucht kurz nach dem Start von selbst nach Updates – oder jetzt, wenn du möchtest.'
        : 'Die App sucht nicht von selbst nach Updates.'}
    </p>
  );
}

function Notes({ notes, name }: { notes: string; name: string }) {
  const id = useId();
  const blocks = useMemo(() => parseReleaseNotes(notes, name), [notes, name]);
  if (!blocks.length) return null;
  return (
    <section aria-labelledby={id}>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 id={id} className="text-[15px] font-bold text-headline">Was ist neu</h3>
        <button
          type="button"
          onClick={() => void updates.openRelease()}
          className="inline-flex min-h-8 items-center gap-1 rounded-sm text-[13.5px] font-semibold text-accent underline-offset-4 hover:underline"
        >
          Auf GitHub
          <ExternalIcon size={13} />
          <span className="sr-only">(öffnet extern)</span>
        </button>
      </div>
      {/* A scrolling region, so it takes focus to be scrolled by keyboard. */}
      <div
        role="region"
        aria-labelledby={id}
        tabIndex={0}
        className="max-h-[min(32vh,300px)] overflow-y-auto overscroll-contain rounded-[10px] bg-inset px-4 py-3.5 text-[14px] leading-relaxed text-ink-2"
      >
        <ReleaseNotes blocks={blocks} />
      </div>
    </section>
  );
}

function Progress({ received, total }: { received: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.floor((received / total) * 100)) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-[14px]">
        <span className="font-semibold text-ink">Wird heruntergeladen …</span>
        <span className="tnum text-ink-2">
          {fmtBytes(received, { unitOf: total, bare: true })} von {fmtBytes(total)}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label="Download des Updates"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={`${pct} Prozent`}
        className="mt-2 h-2 overflow-hidden rounded-full bg-inset"
      >
        <div className="h-full rounded-full bg-accent transition-[width] duration-200 ease-out" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 text-[13px] leading-snug text-ink-3">
        Die Datei wird vor der Installation mit der Prüfsumme von GitHub abgeglichen.
      </p>
    </div>
  );
}

function AutoCheck({ state }: { state: UpdateState }) {
  // An unpackaged build never checks on its own; a switch would only mislead.
  if (state.kind === 'dev') return null;
  return (
    <div className="border-t border-line pt-4">
      <Switch
        checked={state.auto}
        onChange={(on) => void updates.setAuto(on)}
        label="Automatisch nach Updates suchen"
        description="Beim Start und alle sechs Stunden. Die Anfrage an GitHub enthält nur die Versionsnummer der App. Wie bei jedem Abruf sieht GitHub dabei deine IP-Adresse – nichts über deine Konten."
      />
    </div>
  );
}
