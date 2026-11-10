'use client';

// Sync between devices (6.0, lib/sync.ts): the row in Einstellungen → Geräte
// and the dialog behind it — setting a device up as the group's first (where
// the devices meet, then the code for the next one), joining with a code
// (scanned on the phone, pasted on the desktop), and how it stands. The code
// is the group's key: shown on this screen, never sent anywhere.

import { useEffect, useMemo, useState } from 'react';
import { intlLocale } from '@/lib/i18n';
import { useT } from '@/lib/i18n/react';
import { IS_ANDROID } from '@/lib/platform';
import { qrMatrix, qrSvgPath } from '@/lib/qr';
import { useFints, type SyncPlaceChoice } from '../FintsProvider';
import { MonitorIcon, PhoneIcon, RefreshIcon, ScanIcon } from '../icons';
import { Alert, Button, CopyButton, Dialog, Field, Input } from '../ui';
import { ActionItem } from './rows';

const when = (ts: number | null | undefined, never: string) =>
  ts ? new Date(ts).toLocaleString(intlLocale(), { dateStyle: 'short', timeStyle: 'short' }) : never;

/** The row, once the first login's vault is loaded (sync is null before). */
export function SyncRow() {
  const t = useT();
  const { sync, openSync } = useFints();
  if (!sync) return null;
  const words = t.sync;
  const others = (sync.devices ?? []).filter((d) => d.id !== sync.deviceId).length;
  const summary = !sync.on ? words.hintOff : others ? words.hintOn(others, when(sync.lastSync, words.never)) : words.hintAlone;
  return <ActionItem icon={<RefreshIcon />} title={words.title} summary={summary} onClick={openSync} />;
}

/** Where a code says the group meets, read on this side only to ask for a folder where it is one. */
function codePlace(code: string): string | null {
  const m = /^girovo-sync:1:([A-Za-z0-9_-]+)$/.exec(code.trim());
  if (!m) return null;
  try {
    const json = JSON.parse(atob(m[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof json?.p?.kind === 'string' ? json.p.kind : null;
  } catch {
    return null;
  }
}

type Step = 'menu' | 'place' | 'code' | 'join' | 'status' | 'leave';

export function SyncDialog() {
  const t = useT();
  const { sync, syncOpen, closeSync, syncNow, createSync, syncCode, joinSync, leaveSync } = useFints();
  const words = t.sync;
  const [step, setStep] = useState<Step>('menu');
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const [kind, setKind] = useState<SyncPlaceChoice['kind']>(IS_ANDROID ? 'webdav' : 'lan');
  const [dav, setDav] = useState({ url: '', user: '', password: '' });
  const [folder, setFolder] = useState('');
  const [pasted, setPasted] = useState('');

  // Each opening starts where the device stands.
  useEffect(() => {
    if (!syncOpen) return;
    setStep(sync?.on ? 'status' : 'menu');
    setCode('');
    setPasted('');
    setBusy(false);
    // Only on opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncOpen]);

  const qr = useMemo(() => (code ? qrSvgPath(qrMatrix(code, 'L')) : null), [code]);
  if (!sync) return null;

  const work = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  const pickFolder = async () => {
    const picked = await window.electronSync?.pickFolder().catch(() => null);
    if (picked) setFolder(picked);
  };
  const create = () => work(async () => {
    const place: SyncPlaceChoice = kind === 'webdav' ? { kind: 'webdav', ...dav }
      : kind === 'folder' ? { kind: 'folder', path: folder }
        : { kind: 'lan', addresses: [], port: 0 };
    const made = await createSync(place);
    if (made) {
      setCode(made);
      setStep('code');
    }
  });
  const another = () => work(async () => {
    const made = await syncCode();
    if (made) {
      setCode(made);
      setStep('code');
    }
  });
  const join = (value: string) => work(async () => {
    if (await joinSync(value.trim(), codePlace(value) === 'folder' ? folder : undefined)) closeSync();
  });
  const scan = () => work(async () => {
    const r = await window.girovoMobile?.scanner.scan();
    if (r && 'value' in r && r.value) {
      setPasted(r.value);
      if (await joinSync(r.value.trim())) closeSync();
    }
  });

  const placeReady = kind === 'lan' || (kind === 'folder' ? !!folder : /^https:\/\//i.test(dav.url.trim()) && !!dav.user);
  const needsFolder = codePlace(pasted) === 'folder' && !IS_ANDROID;
  const others = (sync.devices ?? []);

  let body: React.ReactNode;
  let actions: React.ReactNode;
  if (step === 'menu') {
    body = <p className="text-[14px] leading-relaxed text-ink-2">{words.intro}</p>;
    actions = (
      <>
        <Button variant="secondary" onClick={() => setStep('join')}>{words.join}</Button>
        <Button variant="primary" onClick={() => setStep('place')}>{words.start}</Button>
      </>
    );
  } else if (step === 'place') {
    const choices: Array<{ id: SyncPlaceChoice['kind']; title: string; hint: string }> = [
      ...(IS_ANDROID ? [] : [{ id: 'lan' as const, title: words.lan, hint: words.lanHint }]),
      { id: 'webdav', title: words.webdav, hint: words.webdavHint },
      ...(IS_ANDROID ? [] : [{ id: 'folder' as const, title: words.folder, hint: words.folderHint }]),
    ];
    body = (
      <div className="flex flex-col gap-3">
        <p className="text-[13px] font-semibold text-ink-2">{words.placeTitle}</p>
        <div role="radiogroup" aria-label={words.placeTitle} className="flex flex-col gap-2">
          {choices.map((c) => (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={kind === c.id}
              onClick={() => setKind(c.id)}
              className={`rounded-[12px] border px-4 py-3 text-left transition-colors ${kind === c.id ? 'border-accent bg-accent-soft' : 'border-line hover:bg-inset'}`}
            >
              <span className="block text-[14.5px] font-semibold text-ink">{c.title}</span>
              <span className="mt-0.5 block text-[13px] leading-snug text-ink-2">{c.hint}</span>
            </button>
          ))}
        </div>
        {kind === 'webdav' && (
          <div className="flex flex-col gap-2">
            <Field label={words.webdavUrl}>
              <Input type="url" inputMode="url" autoComplete="url" placeholder="https://" value={dav.url} onChange={(e) => setDav({ ...dav, url: e.target.value })} />
            </Field>
            <Field label={words.webdavUser}>
              <Input autoComplete="username" value={dav.user} onChange={(e) => setDav({ ...dav, user: e.target.value })} />
            </Field>
            <Field label={words.webdavPassword}>
              <Input type="password" autoComplete="current-password" value={dav.password} onChange={(e) => setDav({ ...dav, password: e.target.value })} />
            </Field>
          </div>
        )}
        {kind === 'folder' && (
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" size="sm" onClick={() => void pickFolder()}>{words.folderPick}</Button>
            <span className="min-w-0 break-all text-[13px] text-ink-2">{folder || words.folderNone}</span>
          </div>
        )}
      </div>
    );
    actions = (
      <>
        <Button variant="secondary" onClick={() => setStep('menu')} disabled={busy}>{t.common.back}</Button>
        <Button variant="primary" busy={busy} disabled={!placeReady} onClick={() => void create()}>{words.create}</Button>
      </>
    );
  } else if (step === 'code') {
    body = (
      <div className="flex flex-col items-center gap-3 text-center">
        <p className="text-[14px] font-semibold text-ink">{words.codeTitle}</p>
        <p className="text-[13.5px] leading-snug text-ink-2">{words.codeScan}</p>
        {qr && (
          <svg viewBox={`0 0 ${qr.size} ${qr.size}`} className="h-56 w-56 rounded-[12px] bg-white p-1" role="img" aria-label={words.codeTitle}>
            <path d={qr.d} fill="#000" />
          </svg>
        )}
        <p className="text-[13px] text-ink-2">{words.codeCopy}</p>
        <div className="flex w-full items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-[6px] bg-inset px-2 py-1.5 text-left text-[12px] text-ink-2">{code}</code>
          <CopyButton text={code} />
        </div>
        <Alert tone="warn" className="w-full text-left">{words.codeSecret}</Alert>
      </div>
    );
    actions = <Button variant="primary" onClick={closeSync}>{words.done}</Button>;
  } else if (step === 'join') {
    body = (
      <div className="flex flex-col gap-3">
        {IS_ANDROID && (
          <Button variant="primary" iconLeft={<ScanIcon size={18} />} busy={busy} onClick={() => void scan()}>{words.scan}</Button>
        )}
        <Field label={words.paste}>
          <Input value={pasted} placeholder={words.pastePlaceholder} autoComplete="off" spellCheck={false} onChange={(e) => setPasted(e.target.value)} />
        </Field>
        {needsFolder && (
          <div className="flex flex-col gap-1">
            <p className="text-[13px] text-ink-2">{words.folderHint}</p>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="secondary" size="sm" onClick={() => void pickFolder()}>{words.folderPick}</Button>
              <span className="min-w-0 break-all text-[13px] text-ink-2">{folder || words.folderNone}</span>
            </div>
          </div>
        )}
      </div>
    );
    actions = (
      <>
        <Button variant="secondary" onClick={() => setStep('menu')} disabled={busy}>{t.common.back}</Button>
        <Button variant={IS_ANDROID ? 'secondary' : 'primary'} busy={busy} disabled={!pasted.trim() || (needsFolder && !folder)} onClick={() => void join(pasted)}>
          {words.connect}
        </Button>
      </>
    );
  } else if (step === 'leave') {
    body = <p className="text-[14px] leading-relaxed text-ink-2">{words.leaveText}</p>;
    actions = (
      <>
        <Button variant="secondary" data-autofocus onClick={() => setStep('status')} disabled={busy}>{t.common.cancel}</Button>
        <Button variant="danger" busy={busy} onClick={() => void work(async () => { await leaveSync(); closeSync(); })}>{words.leave}</Button>
      </>
    );
  } else {
    body = (
      <div className="flex flex-col gap-3">
        <p className="text-[14px] text-ink-2">{words.status(when(sync.lastSync, words.never))}</p>
        <div>
          <p className="mb-1 text-[13px] font-semibold text-ink-2">{words.devices}</p>
          <ul className="flex flex-col divide-y divide-line rounded-[12px] border border-line">
            {others.map((d) => {
              // Said by the device itself since 6.1; a list from 6.0 only has the name, and every phone was "Android" then.
              const phone = d.kind ? d.kind === 'phone' : /android|telefon|phone/i.test(d.name);
              const seen = words.seen(when(d.at, words.never));
              return (
                // Two lines: the name keeps the row's width (a phone's "Nino's S26 Ultra" was cut to "N" beside the date).
                <li key={d.id} className="flex items-center gap-3 px-3 py-2.5">
                  <span className="shrink-0 text-ink-2" aria-hidden>{phone ? <PhoneIcon size={18} /> : <MonitorIcon size={18} />}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] leading-5 text-ink">{d.name}</span>
                    <span className="block truncate text-[12.5px] leading-[18px] text-ink-3">
                      {d.id === sync.deviceId ? words.thisDeviceSeen(seen) : seen}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" iconLeft={<RefreshIcon size={16} />} busy={busy} onClick={() => void work(() => syncNow(false))}>{words.syncNow}</Button>
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => void another()}>{words.addDevice}</Button>
          <Button variant="tertiary" size="sm" disabled={busy} onClick={() => setStep('leave')}>{words.leave}</Button>
        </div>
      </div>
    );
    actions = <Button variant="primary" onClick={closeSync}>{words.done}</Button>;
  }

  return (
    <Dialog open={syncOpen} onClose={busy ? undefined : closeSync} title={words.sheetTitle} icon={<RefreshIcon size={20} />} actions={actions}>
      {body}
    </Dialog>
  );
}
