'use client';

// The Android app's own settings, on the Einstellungen page's "Auf diesem
// Telefon" (components/settings/Settings.tsx): fingerprint login, the category model
// as a download, Play's updates, and what the phone's integrity check found. The colours and light or dark are the
// phone's (mobile/bridges/appearance.ts) — not a setting here. Each talks to the phone runtime
// (window.girovoMobile, mobile/runtime.ts); none of them exists on the
// desktop or the website, where this renders nothing.

import { useEffect, useState } from 'react';
import { fmtBytes } from '@/lib/format';
import { useIntegrity } from './IntegrityNotice';
import { useT } from '@/lib/i18n/react';
import { IS_ANDROID } from '@/lib/platform';
import { useFints } from '../FintsProvider';
import { Button, Progress, Switch, cx } from '../ui';

export function AndroidSettings() {
  if (!IS_ANDROID) return null;
  return (
    <>
      <FingerprintSwitch />
      <ModelRow />
      <PlayUpdateRow />
      <IntegrityRow />
    </>
  );
}

/**
 * On for the login this session belongs to: turning it on seals that login's
 * PIN behind a fingerprint, turning it off deletes it. Only the first bank's
 * login — the one the app opens with.
 */
function FingerprintSwitch() {
  const t = useT();
  const b = t.android.biometric;
  const { bank, sessionId, userId, toast } = useFints();
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

  if (!available || !bank || !userId || !sessionId) return null;

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
    <Switch
      checked={on}
      onChange={(next) => void change(next)}
      disabled={!available.available || working}
      label={b.label}
      description={available.available ? b.hint : b.unavailable[available.reason ?? 'unavailable']}
      className="mt-3"
    />
  );
}

function ModelRow() {
  const t = useT();
  const m = t.android.model;
  const { toast } = useFints();
  const [status, setStatus] = useState<GirovoModelStatus | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const mobile = window.girovoMobile;
    if (!mobile) return;
    void mobile.model.status().then(setStatus);
    return mobile.model.onProgress(setStatus);
  }, []);

  const mobile = typeof window === 'undefined' ? undefined : window.girovoMobile;
  if (!mobile || !status) return null;
  const total = status.total || mobile.model.bytes;

  const download = async () => {
    setFailed(false);
    setStatus((s) => (s ? { ...s, downloading: true, received: 0, total } : s));
    try {
      setStatus(await mobile.model.download());
      toast(m.ready, 'success');
    } catch (err) {
      setStatus(await mobile.model.status());
      // Cancelled is the user's own doing, not a failure.
      if ((err as { code?: string } | null)?.code !== 'CANCELLED') setFailed(true);
    }
  };

  const remove = async () => {
    await mobile.model.remove();
    setStatus(await mobile.model.status());
    toast(m.removed, 'info');
  };

  return (
    <div className="mt-4">
      <p className="text-[15px] leading-snug text-ink">{m.title}</p>
      <p className="mt-0.5 text-[13px] leading-snug text-ink-3">{m.hint}</p>
      {status.downloading ? (
        <div className="mt-2.5">
          <div className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="tnum text-ink-2">{m.progress(fmtBytes(status.received, { unitOf: total, bare: true }), fmtBytes(total))}</span>
            <Button variant="tertiary" size="xs" className="-mr-3" onClick={() => void mobile.model.cancel()}>{m.cancel}</Button>
          </div>
          <Progress value={Math.floor((status.received / total) * 100)} label={m.title} className="mt-1.5" />
        </div>
      ) : status.installed ? (
        <div className="mt-1.5 flex items-center justify-between gap-3">
          <span className="text-[13px] text-ink-2">{m.installed}</span>
          <Button variant="tertiary" size="xs" className="-mr-3" onClick={() => void remove()}>{m.remove}</Button>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <Button variant="secondary" size="sm" onClick={() => void download()}>{m.download}</Button>
          <span className="text-[13px] text-ink-3">{m.size}</span>
        </div>
      )}
      {failed && <p role="alert" className="mt-1.5 text-[13px] leading-snug text-red">{m.failed}</p>}
    </div>
  );
}

/**
 * What the phone's integrity check found (lib/device-integrity.ts), said
 * always — the login warns only about a modified phone or a foreign copy.
 */
function IntegrityRow() {
  const t = useT();
  const m = t.android.integrity;
  const integrity = useIntegrity();
  if (integrity === undefined) return null;
  const device = integrity?.device ?? 'unknown';
  return (
    <div className="mt-4">
      <p className="text-[15px] leading-snug text-ink">{m.title}</p>
      <p className={cx('mt-0.5 text-[13px] leading-snug', device === 'modified' ? 'text-red' : 'text-ink-3')}>{m[device]}</p>
      {integrity?.copy === 'foreign' && <p className="mt-1 text-[13px] leading-snug text-red">{m.foreign}</p>}
      {integrity?.copy === 'development' && <p className="mt-1 text-[13px] leading-snug text-ink-3">{m.development}</p>}
    </div>
  );
}

/**
 * The Google Play build: when Play has a newer version, its own in-app
 * update, right here. Play may not be bypassed — the GitHub build's updater
 * (components/updates) is not in this build at all.
 */
function PlayUpdateRow() {
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
  return (
    <div className="mt-4 flex flex-col items-start gap-2">
      <p className="text-[13px] leading-snug text-ink-2">{u.playAvailable}</p>
      <Button variant="primary" size="sm" onClick={() => void play.start()}>{u.playUpdate}</Button>
    </div>
  );
}
