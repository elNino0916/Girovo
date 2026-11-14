'use client';

// Sicherheit → Signatur → MT-Media-Zertifikat, the Windows desktop app only
// (docs/mt-media-code-signing.md): whether Windows trusts the MT-Media
// code-signing certificate Girovo is signed with, its details, and the way to
// install or remove it. Optional: Girovo works the same without it.
//
// The shell reads the machine's trust stores and changes them through
// girovo-cert.exe, which Windows starts as administrator after its own UAC
// prompt (src-tauri/src/publisher_cert.rs). This page asks first, says what
// installing means, and believes only the state read back afterwards.
//
// The logo heads the dialog (owner's pick C, 2026-11-14,
// .impeccable/mocks/decision/mt-media): the mark in a disc that gets a green
// check once Windows trusts it, the wordmark under it. Its letters are
// near-black, so the dark theme takes the *-dark.png versions, letters in
// Girovo's light ink and the blues brightened.

import { useCallback, useEffect, useId, useState } from 'react';
import { useLocale, useT } from '@/lib/i18n/react';
import type { PublisherCertAnswer, PublisherCertStatus } from '@/types/electron-window';
import { useFints } from '../FintsProvider';
import { ShieldIcon } from '../icons';
import { Button, cx, Dialog, DialogActions, DialogHeader, Overlay, Sheet } from '../ui';
import { ActionItem, SettingsGroup } from './rows';

const bridge = () => (typeof window !== 'undefined' ? window.electronPublisherCert : undefined);

/** "0799 5B74 08F1 …": the hex in groups of four, so a line breaks between groups only. */
function grouped(hex: string): string {
  return hex.match(/.{1,4}/g)?.join(' ') ?? hex;
}

/** One of the two logo files, in the version for the theme on screen. */
function Logo({ part, className, alt = '' }: { part: 'mark' | 'wordmark'; className: string; alt?: string }) {
  const size = part === 'mark' ? { width: 254, height: 120 } : { width: 498, height: 60 };
  return (
    <>
      <img src={`/brand/mt-media-${part}.png`} alt={alt} {...size} className={cx(className, 'dark:hidden')} draggable={false} />
      <img src={`/brand/mt-media-${part}-dark.png`} alt={alt} {...size} className={cx(className, 'hidden dark:block')} draggable={false} />
    </>
  );
}

/** A small green check at the disc's lower right, ringed in the colour behind it. */
function TrustBadge({ size, ring }: { size: 'sm' | 'lg'; ring: string }) {
  return (
    <span
      aria-hidden
      className={cx(
        'absolute grid place-items-center rounded-full bg-green text-white',
        size === 'lg' ? '-right-0.5 -bottom-0.5 size-[26px] border-[3px]' : '-right-[3px] -bottom-[3px] size-[18px] border-2',
      )}
      style={{ borderColor: ring }}
    >
      <svg viewBox="0 0 24 24" width={size === 'lg' ? 14 : 10} height={size === 'lg' ? 14 : 10} fill="none" stroke="currentColor" strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </svg>
    </span>
  );
}

/** One step off the surface it sits on: the disc behind the mark, the state's line. */
const TONAL = 'bg-[var(--md-surface-container-low,var(--raised))] dark:bg-[var(--md-surface-container-highest,var(--inset))]';

export function PublisherCertGroup() {
  const t = useT();
  const { locale } = useLocale();
  const { toast } = useFints();
  const titleId = useId();
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

  const trusted = status?.state === 'trusted';
  const installed = !!status && (status.inRoot || status.inTrustedPublisher);
  const canInstall = !!status && !installed && status.state !== 'expired';
  const summary = status ? words.state[status.state] : words.state.checking;
  const warn = !!status && (status.state === 'invalid' || status.state === 'expired' || status.state === 'mismatch');
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
  ];

  return (
    <SettingsGroup title={words.group}>
      <ActionItem
        setting="publisher"
        icon={
          <span className="relative grid size-10 shrink-0 place-items-center rounded-full bg-[var(--md-surface-container-highest,var(--inset))]">
            <Logo part="mark" className="h-auto w-[26px]" />
            {trusted && <TrustBadge size="sm" ring="var(--md-surface-container,var(--surface))" />}
          </span>
        }
        title={words.row}
        summary={summary}
        action={words.details}
        onClick={() => {
          void refresh();
          setOpen(true);
        }}
      />

      {/* The details: the logo heads it, so the dialog is built from its parts rather than Dialog's icon slot. */}
      <Overlay open={open && !confirm} onClose={() => setOpen(false)} labelledBy={titleId}>
        <Sheet
          basic
          size="sm"
          footer={
            <DialogActions align="end" className="">
              <Button variant="secondary" data-autofocus onClick={() => setOpen(false)}>{t.common.close}</Button>
              {installed ? (
                <Button variant="secondary" onClick={() => setConfirm('remove')}>{words.remove}</Button>
              ) : (
                <Button variant="primary" disabled={!canInstall} onClick={() => setConfirm('install')}>{words.install}</Button>
              )}
            </DialogActions>
          }
        >
          <div className="mb-3 flex flex-col items-center gap-3">
            <span className={cx('relative grid size-[76px] place-items-center rounded-full', TONAL)}>
              <Logo part="mark" className="h-auto w-[52px]" />
              {trusted && <TrustBadge size="lg" ring="var(--dialog-bg,var(--surface))" />}
            </span>
            <Logo part="wordmark" className="h-[15px] w-auto" alt="MT-Media" />
          </div>
          <DialogHeader title={words.row} titleId={titleId} description={words.description} className="mb-4 text-center" />
          <div
            className={cx(
              'mb-4 flex items-center gap-2.5 rounded-[12px] px-3.5 py-2.5 text-[14px] leading-5 font-medium',
              trusted ? 'bg-green-soft text-green' : warn ? 'bg-amber-soft text-amber' : cx(TONAL, 'text-ink-2'),
            )}
          >
            <ShieldIcon size={20} check={trusted} />
            <span>{trusted ? words.trustedLine : status?.state === 'notInstalled' ? words.notInstalledLine : summary}</span>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
            {rows.map(([label, value, mono]) => (
              <div key={label} className="contents">
                <dt className="text-ink-3">{label}</dt>
                <dd className={mono ? 'font-mono text-[12px] leading-[18px] text-ink' : 'text-ink'}>{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-[13px] text-ink-3">{words.optional}</p>
        </Sheet>
      </Overlay>

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
