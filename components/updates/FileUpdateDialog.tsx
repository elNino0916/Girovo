'use client';

// "Update aus Datei installieren" (docs/updater-v2.md, step 5): the dialog
// for a Setup.exe or .girovoupdate picked in Einstellungen → Über Girovo,
// dropped on the window or double-clicked. The shell checks it against
// Girovo's signed releases (src-tauri/src/updater/engine.rs check_file; a
// .girovoupdate with no connection needed) while this says so; a file that
// checks out is offered for install — an older version with the warning the
// owner asked for — and anything else is refused with the reason. Installing
// quits the app like any update (girovo-update.exe runs the installer), so a
// bank call on the wire holds it, as in the update dialog.

import { useT } from '@/lib/i18n/react';
import { useFints, waitHoldsSession } from '../FintsProvider';
import { Alert, Button, Dialog, Spinner } from '../ui';
import { updates, useUpdates } from './store';

export function FileUpdateDialog() {
  const { state } = useUpdates();
  const { view, busy, wait } = useFints();
  const t = useT();
  const f = t.shell.updates.file;
  const file = state?.file;
  if (!state || !file) return null;
  const holding = busy || (wait.open && waitHoldsSession(wait));
  const close = () => void updates.dismissFile();

  if (file.phase === 'checking') {
    return (
      <Dialog open onClose={close} title={f.checking} description={f.checkingHint}>
        <div className="flex items-center gap-3 text-[14px] text-ink-2">
          <Spinner />
          <span className="min-w-0 truncate">{file.name}</span>
        </div>
      </Dialog>
    );
  }

  if (file.phase === 'refused' || !file.version) {
    return (
      <Dialog
        open
        onClose={close}
        title={f.refusedTitle}
        description={file.message ?? undefined}
        actions={<Button variant="primary" onClick={close}>{t.common.close}</Button>}
      >
        <p className="truncate text-[14px] text-ink-2">{file.name}</p>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onClose={close}
      title={f.readyTitle(file.version)}
      description={f.ready}
      actions={(
        <>
          <Button variant="secondary" onClick={close}>{t.common.cancel}</Button>
          <Button variant="primary" disabled={holding} onClick={() => void updates.installFile()}>{f.install}</Button>
        </>
      )}
    >
      <div className="flex flex-col gap-3">
        {file.older && <Alert tone="warn" className="mt-0">{f.older(file.version, state.current)}</Alert>}
        {file.same && <Alert tone="info" className="mt-0">{f.same(file.version)}</Alert>}
        {view === 'dashboard' && <p className="text-[14px] leading-relaxed text-ink-2">{t.shell.updates.logsOut}</p>}
        {holding && <p className="text-[14px] leading-relaxed text-ink-2">{f.holding}</p>}
      </div>
    </Dialog>
  );
}
