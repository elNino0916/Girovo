'use client';

// Sicherheit → Herausgeber, the Windows desktop app only
// (docs/mt-media-code-signing.md): whether Windows trusts the MT-Media
// code-signing certificate Girovo is signed with, its details, and the way to
// install or remove it. Optional: Girovo works the same without it.
//
// The shell reads the machine's trust stores and changes them through
// girovo-cert.exe, which Windows starts as administrator after its own UAC
// prompt (src-tauri/src/publisher_cert.rs). This page asks first, says what
// installing means, and believes only the state read back afterwards.

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useT } from '@/lib/i18n/react';
import type { PublisherCertAnswer, PublisherCertStatus } from '@/types/electron-window';
import { useFints } from '../FintsProvider';
import { ShieldIcon } from '../icons';
import { Button, Dialog } from '../ui';
import { ActionItem, SettingsGroup } from './rows';

const bridge = () => (typeof window !== 'undefined' ? window.electronPublisherCert : undefined);

/** "0799 5B74 08F1 …": the hex in groups of four, so a line breaks between groups only. */
function grouped(hex: string): string {
  return hex.match(/.{1,4}/g)?.join(' ') ?? hex;
}

/** The MT-Media mark on a white plate: the logo's letters are dark, so the plate keeps them readable in the dark theme too. */
function MtMediaMark({ size = 28 }: { size?: number }) {
  return (
    <span className="inline-flex shrink-0 items-center justify-center rounded-[6px] bg-white ring-1 ring-black/5" style={{ width: size, height: size }} aria-hidden>
      <img src="/brand/mt-media-mark.png" alt="" width={254} height={120} className="h-auto w-[82%]" draggable={false} />
    </span>
  );
}

/** Mark and wordmark together, at the head of the dialog. */
function MtMediaLogo() {
  return (
    <span className="flex items-center gap-3 rounded-[10px] bg-white px-4 py-3 ring-1 ring-black/5">
      <img src="/brand/mt-media-mark.png" alt="" width={254} height={120} className="h-9 w-auto" draggable={false} />
      <img src="/brand/mt-media-wordmark.png" alt="MT-Media" width={498} height={60} className="h-4 w-auto" draggable={false} />
    </span>
  );
}

export function PublisherCertGroup() {
  const t = useT();
  const { locale } = useLocale();
  const { toast } = useFints();
  const [status, setStatus] = useState<PublisherCertStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<'install' | 'remove' | null>(null);
  const [busy, setBusy] = useState(false);
  const words = t.settings.publisherCert;

  const refresh = useCallback(async () => {
    const b = bridge();
    if (!b) return;
    try {
      setStatus(await b.status());
    } catch {
      /* the row stays at "checking" and offers nothing */
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!bridge() || (status && !status.available)) return null;

  const installed = !!status && (status.inRoot || status.inTrustedPublisher);
  const canInstall = !!status && !installed && status.state !== 'expired';
  const summary = status ? words.state[status.state] : words.state.checking;
  const date = status?.validUntil
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${status.validUntil}T00:00:00Z`))
    : '';

  const run = async (what: 'install' | 'remove') => {
    const b = bridge();
    if (!b) return;
    setBusy(true);
    let answer: PublisherCertAnswer | null = null;
    try {
      answer = what === 'install' ? await b.install() : await b.remove();
    } catch {
      answer = null;
    }
    setBusy(false);
    setConfirm(null);
    if (answer) setStatus(answer.status);
    else void refresh();
    const result = answer?.result ?? 'failed';
    if (result === 'done') toast(what === 'install' ? words.installed : words.removed, 'success');
    else if (result === 'canceled') toast(words.canceled, 'info');
    else if (result === 'refused') toast(words.refused, 'error');
    else toast(words.failed, 'error');
  };

  const rows: [string, string, boolean?][] = [
    [words.publisher, status?.publisher ?? 'MT-Media'],
    [words.kind, words.kindValue],
    [words.algorithm, 'SHA-256, RSA 3072'],
    [words.validUntil, date],
    [words.sha256, grouped(status?.sha256 ?? ''), true],
    [words.thumbprint, grouped(status?.thumbprint ?? ''), true],
    [words.status, summary],
  ];

  return (
    <SettingsGroup title={words.group}>
      <ActionItem
        setting="publisher"
        icon={<MtMediaMark />}
        title={words.row}
        summary={summary}
        action={words.details}
        onClick={() => {
          void refresh();
          setOpen(true);
        }}
      />

      <Dialog
        open={open && !confirm}
        onClose={() => setOpen(false)}
        title={words.row}
        icon={<ShieldIcon size={20} check={status?.state === 'trusted'} />}
        description={words.description}
        actions={
          <>
            <Button variant="secondary" data-autofocus onClick={() => setOpen(false)}>{t.common.close}</Button>
            {installed ? (
              <Button variant="secondary" onClick={() => setConfirm('remove')}>{words.remove}</Button>
            ) : (
              <Button variant="primary" disabled={!canInstall} onClick={() => setConfirm('install')}>{words.install}</Button>
            )}
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <MtMediaLogo />
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
            {rows.map(([label, value, mono]) => (
              <div key={label} className="contents">
                <dt className="text-ink-3">{label}</dt>
                <dd className={mono ? 'font-mono text-[12px] leading-[18px] text-ink' : 'text-ink'}>{value}</dd>
              </div>
            ))}
          </dl>
          <p className="text-[13px] text-ink-3">{words.optional}</p>
        </div>
      </Dialog>

      <Dialog
        open={confirm === 'install'}
        onClose={busy ? undefined : () => setConfirm(null)}
        title={words.installTitle}
        icon={<ShieldIcon size={20} />}
        actions={
          <>
            <Button variant="secondary" data-autofocus onClick={() => setConfirm(null)} disabled={busy}>{t.common.cancel}</Button>
            <Button variant="primary" busy={busy} onClick={() => void run('install')}>{words.installConfirm}</Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-[14px] leading-relaxed text-ink-2">
          <ul className="flex list-disc flex-col gap-1.5 pl-4">
            {words.installPoints.map((point) => <li key={point}>{point}</li>)}
          </ul>
          <div>
            <div className="text-[13px] text-ink-3">{words.sha256}</div>
            <div className="font-mono text-[12px] leading-[18px] text-ink">{grouped(status?.sha256 ?? '')}</div>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={confirm === 'remove'}
        onClose={busy ? undefined : () => setConfirm(null)}
        title={words.removeTitle}
        icon={<ShieldIcon size={20} />}
        description={words.removeBody}
        actions={
          <>
            <Button variant="secondary" data-autofocus onClick={() => setConfirm(null)} disabled={busy}>{t.common.cancel}</Button>
            <Button variant="danger" busy={busy} onClick={() => void run('remove')}>{words.removeConfirm}</Button>
          </>
        }
      />
    </SettingsGroup>
  );
}
