'use client';

// The Android app's own rows of the Einstellungen page (components/settings/
// Settings.tsx), each placed in its section there: what the phone's integrity
// check found and fingerprint login under Sicherheit, the category guess with
// Gemini Nano under Kategorien, Play's updates under Über Girovo. The colours
// and light or dark are the phone's (mobile/bridges/appearance.ts) — not a
// setting here. Each talks to the phone runtime (window.girovoMobile,
// mobile/runtime.ts); none of them exists on the desktop or the website,
// where each renders nothing.

import { useEffect, useState } from 'react';
import { keepsNothing } from '@/lib/device-integrity';
import { fmtBytes } from '@/lib/format';
import { useIntegrity } from './IntegrityNotice';
import { useT } from '@/lib/i18n/react';
import { IS_ANDROID } from '@/lib/platform';
import { useFints } from '../FintsProvider';
import { AlertCircleIcon, CheckCircleIcon, DownloadIcon, FingerprintIcon, GeminiSparkIcon, XCircleIcon } from '../icons';
import { ActionItem, SettingItem, SwitchItem } from '../settings/rows';
import { Button, Dialog, Progress, Tag, cx } from '../ui';

/**
 * On for the login this session belongs to: turning it on seals that login's
 * PIN behind a fingerprint, turning it off deletes it. Only the first bank's
 * login — the one the app opens with.
 */
export function FingerprintSwitch() {
  const t = useT();
  const b = t.android.biometric;
  const { bank, sessionId, userId, toast } = useFints();
  const integrity = useIntegrity();
  const [available, setAvailable] = useState<GirovoBiometricState | null>(null);
  const [on, setOn] = useState(false);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    const mobile = window.girovoMobile;
    if (!mobile || !bank || !userId) return;
    let live = true;
    void mobile.biometric.state().then((s) => live && setAvailable(s));
    void mobile.biometric.enrolled(bank.blz, userId).then((e) => live && setOn(e));
    return () => {
      live = false;
    };
  }, [bank, userId]);

  if (!available || !bank || !userId || !sessionId || integrity === undefined) return null;
  // Turning it on stores the PIN on the phone: not where Girovo keeps nothing.
  // Off stays possible — it deletes what an earlier start sealed.
  const refused = keepsNothing(integrity) && !on;

  const change = async (next: boolean) => {
    const mobile = window.girovoMobile;
    if (!mobile || working) return;
    setWorking(true);
    try {
      if (next) {
        const result = await mobile.biometric.enroll(sessionId, {
          title: b.enrollTitle,
          subtitle: b.enrollSubtitle(bank.name),
          cancel: b.cancel,
        });
        if (result === 'enrolled') {
          setOn(true);
          toast(b.nowOn, 'success');
        } else if (result === 'failed') {
          toast(b.enrollFailed, 'error');
        }
      } else {
        await mobile.biometric.forget(bank.blz, userId);
        setOn(false);
        toast(b.nowOff, 'info');
      }
    } finally {
      setWorking(false);
    }
  };

  return (
    <SwitchItem
      icon={<FingerprintIcon />}
      checked={on}
      onChange={(next) => void change(next)}
      disabled={!available.available || working || refused}
      title={b.label}
      summary={refused ? t.android.integrity.noFingerprint : available.available ? b.hint : b.unavailable[available.reason ?? 'unavailable']}
    />
  );
}

/**
 * Whether this phone sorts with Gemini Nano (mobile/bridges/categories.ts).
 * Nothing to switch: where Android has it, it works; where Android is still
 * fetching it, that is said; where the phone has none, "Nicht unterstütztes
 * Telefon" and the rules sort alone.
 */
export function NanoRow() {
  const t = useT();
  const m = t.android.categories;
  const [status, setStatus] = useState<GirovoNanoStatus | null>(null);

  useEffect(() => {
    const categories = window.girovoMobile?.categories;
    if (!categories) return;
    let live = true;
    void categories.status().then((s) => live && setStatus(s));
    const off = categories.onStatus((s) => live && setStatus(s));
    return () => {
      live = false;
      off();
    };
  }, []);

  const categories = typeof window === 'undefined' ? undefined : window.girovoMobile?.categories;
  if (!categories || !status) return null;

  const download = async () => {
    setStatus({ state: 'downloading' });
    setStatus(await categories.download());
  };

  if (status.state === 'unsupported') {
    return (
      <SettingItem
        tone="ai"
        icon={<GeminiSparkIcon />}
        title={m.title}
        summary={status.reason === 'update' ? m.update : status.reason === 'aicore' ? m.aicore : m.unsupportedHint}
        below={<Tag className="mt-2">{m.unsupported}</Tag>}
      />
    );
  }

  const total = status.total ?? 0;
  return (
    <SettingItem
      tone="ai"
      icon={<GeminiSparkIcon />}
      title={m.title}
      summary={m.hint}
      // Android has it, and it sorts: a small confirmation, in Credit Green.
      trailing={status.state === 'available' && (
        <span className="grid size-6 place-items-center text-green">
          <CheckCircleIcon size={22} strokeWidth={2} />
          <span className="sr-only">{m.running}</span>
        </span>
      )}
      below={status.state === 'downloading' ? (
        <span className="mt-2.5 block">
          <span className="flex items-baseline justify-between gap-3 text-[13px] leading-snug text-ink-2">
            <span className="min-w-0">{m.downloading}</span>
            {total > 0 && (
              <span className="tnum shrink-0">{m.downloadProgress(fmtBytes(status.received ?? 0, { unitOf: total, bare: true }), fmtBytes(total))}</span>
            )}
          </span>
          {total > 0 && <Progress value={((status.received ?? 0) / total) * 100} label={m.downloading} className="mt-1.5" />}
        </span>
      ) : status.state === 'downloadable' ? (
        <span className="mt-1.5 block">
          <span className="block text-[13px] leading-snug text-ink-2">{m.downloadable}</span>
          <Button variant="secondary" size="sm" className="mt-2" onClick={() => void download()}>{m.downloadNow}</Button>
        </span>
      ) : undefined}
    />
  );
}

/**
 * What the phone's integrity check found (lib/device-integrity.ts), said
 * always — the login warns only about a modified phone or a foreign copy.
 * The row gives the verdict as its mark and in a few words; pressed, it says
 * it in full, with what follows from it.
 */
export function IntegrityRow() {
  const t = useT();
  const m = t.android.integrity;
  const integrity = useIntegrity();
  const [open, setOpen] = useState(false);
  if (!IS_ANDROID || integrity === undefined) return null;
  const device = integrity?.device ?? 'unknown';
  const foreign = integrity?.copy === 'foreign';
  const bad = foreign || device === 'modified';
  const nothing = keepsNothing(integrity);
  // The verdict as the row's mark: a check in Credit Green for a phone its
  // hardware vouches for, a cross in Soll Red for a modified phone or a
  // foreign copy, and the warning's orange mark for one that cannot prove
  // anything (amber is Vorgemerkt's alone).
  const mark = bad
    ? <XCircleIcon className="text-red" strokeWidth={2} />
    : device === 'unknown'
      ? <AlertCircleIcon className="text-emphasis" strokeWidth={2} />
      : <CheckCircleIcon className="text-green" strokeWidth={2} />;
  return (
    <>
      <ActionItem
        icon={mark}
        title={m.title}
        summary={(
          <span className={cx(bad && 'text-red')}>
            {foreign ? m.foreignShort : m.short[device]}
            {nothing && ` · ${m.keepsNothingShort}`}
          </span>
        )}
        onClick={() => setOpen(true)}
      />
      {open && (
        <Dialog
          open
          onClose={() => setOpen(false)}
          title={m.title}
          actions={<Button variant="primary" data-autofocus onClick={() => setOpen(false)}>{t.common.close}</Button>}
        >
          <div className="flex flex-col gap-3 text-[15px] leading-normal text-ink-2">
            {/* A modified phone is said in Soll Red, as the login's warning says it. */}
            <p className={cx(device === 'modified' && 'text-red')}>{m[device]}</p>
            {foreign && <p className="text-red">{m.foreign}</p>}
            {integrity?.copy === 'development' && <p>{m.development}</p>}
            {nothing && <p className="text-ink">{m.keepsNothing}</p>}
          </div>
        </Dialog>
      )}
    </>
  );
}

/**
 * The Google Play build: when Play has a newer version, its own in-app
 * update, right here. Play may not be bypassed — the GitHub build's updater
 * (components/updates) is not in this build at all.
 */
export function PlayUpdateRow() {
  const t = useT();
  const u = t.android.updates;
  const [play, setPlay] = useState<Awaited<ReturnType<GirovoMobile['playUpdate']>> | null>(null);
  useEffect(() => {
    let live = true;
    void window.girovoMobile?.playUpdate().then((p) => live && setPlay(p));
    return () => {
      live = false;
    };
  }, []);
  if (!play?.available) return null;
  // Play's own flow takes over from here: no dialog of Girovo's.
  return (
    <ActionItem
      icon={<DownloadIcon />}
      title={u.playUpdate}
      summary={u.playAvailable}
      haspopup={false}
      onClick={() => void play.start()}
    />
  );
}
