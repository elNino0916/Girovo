'use client';

// Einstellungen → Auf diesem Rechner → Ältere Umsätze importieren: an export
// of the online banking (lib/bank-import.ts) read, said back — what it is,
// how many, which days, which account — and only then added, to the days the
// kept Umsätze do not cover yet. Offered while "Umsätze behalten" is on: the
// kept history is where they go.

import { useRef, useState } from 'react';
import { fmtDate } from '@/lib/format';
import { useT } from '@/lib/i18n/react';
import { useFints, type ImportInfo } from '../FintsProvider';
import { FileIcon, UploadIcon } from '../icons';
import { Alert, Button, Dialog, Select, Spinner } from '../ui';
import { ActionItem } from './rows';

/** A file's text whatever the bank wrote it in: UTF-8 if it is that, else Windows-1252, which German banks' CSVs mostly are. */
async function fileText(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

export function ImportRow() {
  const t = useT();
  const words = t.history.import;
  const [open, setOpen] = useState(false);
  return (
    <>
      <ActionItem icon={<FileIcon />} title={words.row} summary={words.rowHint} onClick={() => setOpen(true)} />
      {open && <ImportDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function ImportDialog({ onClose }: { onClose: () => void }) {
  const { accounts, accountLabel, inspectBankFile, importBankFile, toast, keepBookings } = useFints();
  const t = useT();
  const words = t.history.import;
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [info, setInfo] = useState<ImportInfo | null>(null);
  const [account, setAccount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'read' | 'import' | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement | null>(null);
  const chooseRef = useRef<HTMLElement | null>(null);
  // A Depot has no Umsätze to fill.
  const choices = accounts.filter((a) => a.accountType !== 'SecuritiesAccount');

  const read = async (f: File) => {
    setFile(f);
    setInfo(null);
    setError(null);
    setDone(null);
    setBusy('read');
    try {
      const content = await fileText(f);
      setText(content);
      const r = await inspectBankFile(content);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setInfo(r.info);
      setAccount(r.info.account ?? choices[0]?.accountNumber ?? '');
    } catch {
      setError(words.server.notReadable);
    } finally {
      setBusy(null);
    }
  };

  const run = async () => {
    if (!text || !account) return;
    setBusy('import');
    setError(null);
    const r = await importBankFile(text, account);
    setBusy(null);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    const said = words.done(r.days, t.transactions.count(r.bookings));
    toast(said, r.days ? 'success' : 'info');
    setDone(said);
  };

  return (
    <Dialog
      open
      onClose={busy ? undefined : onClose}
      onBackdrop={() => {}}
      title={words.title}
      description={words.intro}
      initialFocus={chooseRef}
      actions={done ? (
        <Button variant="primary" data-autofocus onClick={onClose}>{t.common.done}</Button>
      ) : (
        <>
          <Button variant="secondary" disabled={!!busy} onClick={onClose}>{t.common.cancel}</Button>
          <Button variant="primary" busy={busy === 'import'} disabled={!info || !account || !keepBookings} onClick={() => void run()}>
            {words.run}
          </Button>
        </>
      )}
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Button
          ref={chooseRef}
          variant="secondary"
          size="sm"
          disabled={!!busy || !!done}
          iconLeft={<UploadIcon size={16} />}
          onClick={() => picker.current?.click()}
        >
          {words.choose}
        </Button>
        <span className="min-w-0 truncate text-[14px] text-ink-2">{file ? file.name : words.none}</span>
        <input
          ref={picker}
          type="file"
          accept=".csv,.txt,.sta,.mta,.940,.xml,.camt,text/csv,application/xml,text/xml,text/plain"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void read(f);
            e.target.value = '';
          }}
        />
      </div>

      {busy === 'read' && (
        <p role="status" className="flex items-center gap-2 text-[14px] text-ink-2"><Spinner size={14} /> {words.reading}</p>
      )}

      {info && (
        <div className="rounded-[8px] bg-inset px-4 py-3">
          <p className="tnum text-[14px] leading-snug text-ink">
            {words.found(
              words.format[info.format],
              t.transactions.count(info.bookings),
              info.from ? fmtDate(info.from) : '—',
              info.to ? fmtDate(info.to) : '—',
            )}
          </p>
          {info.skipped > 0 && <p className="mt-1 text-[13px] leading-snug text-ink-3">{words.skipped(info.skipped)}</p>}
        </div>
      )}

      {info && !done && (
        <div className="mt-4">
          <label htmlFor="import-account" className="mb-1.5 block text-[13px] leading-snug font-semibold text-ink-2">{words.account}</label>
          <Select id="import-account" value={account} onChange={(e) => setAccount(e.target.value)}>
            {choices.map((a) => <option key={a.accountNumber} value={a.accountNumber}>{accountLabel(a)}</option>)}
          </Select>
          {info.foreign && <Alert tone="warn" className="mt-3">{words.foreign}</Alert>}
        </div>
      )}

      {!keepBookings && <Alert tone="info" className="mt-3">{words.keepOff}</Alert>}
      {error && <Alert tone="error" className="mt-3">{error}</Alert>}
      {done && <Alert tone="success" className="mt-3">{done}</Alert>}
    </Dialog>
  );
}
