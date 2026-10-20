'use client';

// Einstellungen → Auf diesem Rechner → Sicherung: a backup of what Girovo
// keeps here (lib/backup.ts) — made into one file under a password the user
// picks, and restored from one. Both dialogs keep their buttons pinned below
// the form and say afterwards, bank by bank, what the file held or what came
// back; the password is never kept, shown again or sent anywhere but the
// app's own server, which seals or opens the file with it.

import { useRef, useState } from 'react';
import type { BackupSummary, RestoreReport } from '@/lib/backup';
import { useT } from '@/lib/i18n/react';
import { useFints } from '../FintsProvider';
import { ArchiveIcon, UndoIcon, UploadIcon } from '../icons';
import { Alert, Button, Dialog, Field, Input } from '../ui';
import { ActionItem } from './rows';

/** The shortest password the server takes (lib/backup.ts BACKUP_MIN_PASSWORD) — said before it refuses. */
const MIN_PASSWORD = 10;

/** Two rows of the grouped list: making a backup (with what it holds), and restoring one. */
export function BackupRows() {
  const t = useT();
  const [open, setOpen] = useState<'make' | 'restore' | null>(null);
  return (
    <>
      <ActionItem
        setting="backup"
        icon={<ArchiveIcon />}
        title={t.backup.make.title}
        summary={t.backup.row.hint}
        onClick={() => setOpen('make')}
      />
      <ActionItem icon={<UndoIcon />} title={t.backup.restore.title} onClick={() => setOpen('restore')} />
      {open === 'make' && <MakeBackupDialog onClose={() => setOpen(null)} />}
      {open === 'restore' && <RestoreBackupDialog onClose={() => setOpen(null)} />}
    </>
  );
}

function MakeBackupDialog({ onClose }: { onClose: () => void }) {
  const { makeBackup, toast } = useFints();
  const t = useT();
  const words = t.backup.make;
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [problem, setProblem] = useState<'short' | 'mismatch' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<BackupSummary[] | null>(null);
  const first = useRef<HTMLInputElement | null>(null);

  const run = async () => {
    if (Array.from(password).length < MIN_PASSWORD) {
      setProblem('short');
      first.current?.focus();
      return;
    }
    if (password !== confirm) {
      setProblem('mismatch');
      return;
    }
    setBusy(true);
    setError(null);
    const r = await makeBackup(password);
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    if (!r.saved) return; // the save dialog was dismissed: the form stays as it was
    toast(words.saved, 'success');
    setPassword('');
    setConfirm('');
    setDone(r.summary);
  };

  if (done) {
    return (
      <Dialog
        open
        onClose={onClose}
        title={words.saved}
        actions={<Button variant="primary" data-autofocus onClick={onClose}>{t.common.done}</Button>}
      >
        <ul className="space-y-1.5 text-[14px] leading-snug text-ink">
          {done.map((s, i) => (
            <li key={i}>{words.summary(s.bank, s.accounts, s.bookings, s.docs)}</li>
          ))}
        </ul>
        {done.filter((s) => s.missing.length).map((s, i) => (
          <Alert key={i} tone="warn" className="mt-3">{words.missing(s.bank)}</Alert>
        ))}
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onClose={busy ? undefined : onClose}
      onBackdrop={() => {}}
      title={words.title}
      description={words.intro}
      initialFocus={first}
      actions={(
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>{t.common.cancel}</Button>
          <Button variant="primary" busy={busy} onClick={() => void run()}>{words.save}</Button>
        </>
      )}
    >
      <Field label={words.password} hint={words.hint(MIN_PASSWORD)} error={problem === 'short' ? words.tooShort(MIN_PASSWORD) : undefined}>
        <Input
          ref={first}
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (problem) setProblem(null);
          }}
        />
      </Field>
      <Field label={words.confirm} error={problem === 'mismatch' ? words.mismatch : undefined} className="mb-1">
        <Input
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => {
            setConfirm(e.target.value);
            if (problem === 'mismatch') setProblem(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void run();
            }
          }}
        />
      </Field>
      {error && <Alert tone="error" className="mt-3">{error}</Alert>}
    </Dialog>
  );
}

function RestoreBackupDialog({ onClose }: { onClose: () => void }) {
  const { restoreBackup, toast } = useFints();
  const t = useT();
  const words = t.backup.restore;
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<RestoreReport[] | null>(null);
  const picker = useRef<HTMLInputElement | null>(null);
  const chooseRef = useRef<HTMLElement | null>(null);

  const run = async () => {
    if (!file) {
      picker.current?.click();
      return;
    }
    setBusy(true);
    setError(null);
    let text: string;
    try {
      text = await file.text();
    } catch {
      setBusy(false);
      setError(t.backup.server.format);
      return;
    }
    const r = await restoreBackup(text, password);
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setPassword('');
    toast(words.done, 'success');
    setDone(r.report);
  };

  if (done) {
    return (
      <Dialog
        open
        onClose={onClose}
        title={words.done}
        actions={<Button variant="primary" data-autofocus onClick={onClose}>{t.common.done}</Button>}
      >
        <ul className="space-y-1.5 text-[14px] leading-snug text-ink">
          {done.map((r, i) => (
            <li key={i}>{r.skipped ? words.skipped(r.bank) : words.result(r.bank, r.days, r.docs, r.vault)}</li>
          ))}
        </ul>
        {done.filter((r) => r.historyOff).map((r, i) => (
          <Alert key={`h${i}`} tone="warn" className="mt-3">{words.historyOff(r.bank)}</Alert>
        ))}
        {done.filter((r) => r.docsFull).map((r, i) => (
          <Alert key={`f${i}`} tone="warn" className="mt-3">{words.full(r.bank, r.docsFull)}</Alert>
        ))}
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onClose={busy ? undefined : onClose}
      onBackdrop={() => {}}
      title={words.title}
      description={words.intro}
      initialFocus={chooseRef}
      actions={(
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>{t.common.cancel}</Button>
          <Button variant="primary" busy={busy} disabled={!file || !password} onClick={() => void run()}>{words.run}</Button>
        </>
      )}
    >
      <p className="mb-1.5 text-[13px] leading-snug font-semibold text-ink-2">{words.file}</p>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Button ref={chooseRef} variant="secondary" size="sm" iconLeft={<UploadIcon size={16} />} onClick={() => picker.current?.click()}>
          {words.choose}
        </Button>
        <span className="min-w-0 truncate text-[14px] text-ink-2">{file ? file.name : words.none}</span>
        <input
          ref={picker}
          type="file"
          accept=".girovo,application/octet-stream,application/json"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setError(null);
          }}
        />
      </div>
      <Field label={words.password} className="mb-1">
        <Input
          type="password"
          autoComplete="off"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing && file && password) {
              e.preventDefault();
              void run();
            }
          }}
        />
      </Field>
      {error && <Alert tone="error" className="mt-3">{error}</Alert>}
    </Dialog>
  );
}
