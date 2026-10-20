'use client';

// The Android app's own settings, on the Einstellungen page's "Auf diesem
// Telefon" (components/settings/Settings.tsx): fingerprint login, the category guess
// with Gemini Nano, Play's updates, and what the phone's integrity check found. The colours and light or dark are the
// phone's (mobile/bridges/appearance.ts) — not a setting here. Each talks to the phone runtime
// (window.girovoMobile, mobile/runtime.ts); none of them exists on the
// desktop or the website, where this renders nothing.

import { useEffect, useState } from 'react';
import { fmtBytes } from '@/lib/format';
import { useIntegrity } from './IntegrityNotice';
import { useT } from '@/lib/i18n/react';
import { IS_ANDROID } from '@/lib/platform';
import { useFints } from '../FintsProvider';
import { Button, Progress, Switch, Tag, cx } from '../ui';

export function AndroidSettings() {
  if (!IS_ANDROID) return null;
  return (
    <>
      <FingerprintSwitch />
      <NanoRow />
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

/**
 * Whether this phone sorts with Gemini Nano (mobile/bridges/categories.ts).
 * Nothing to switch: where Android has it, it works; where Android is still
 * fetching it, that is said; where the phone has none, "Nicht unterstütztes
 * Telefon" and the rules sort alone.
 */
function NanoRow() {
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
      <div className="mt-4">
        <p className="text-[15px] leading-snug text-ink">{m.title}</p>
        <Tag className="mt-1.5">{m.unsupported}</Tag>
        <p className="mt-1.5 text-[13px] leading-snug text-ink-3">
          {status.reason === 'update' ? m.update : status.reason === 'aicore' ? m.aicore : m.unsupportedHint}
        </p>
      </div>
    );
  }

  const total = status.total ?? 0;
  return (
    <div className="mt-4">
      <p className="text-[15px] leading-snug text-ink">{m.title}</p>
      <p className="mt-0.5 text-[13px] leading-snug text-ink-3">{m.hint}</p>
      {status.state === 'downloading' && (
        <div className="mt-2.5">
          <p className="flex items-baseline justify-between gap-3 text-[13px] leading-snug text-ink-2">
            <span className="min-w-0">{m.downloading}</span>
            {total > 0 && (
              <span className="tnum shrink-0">{m.downloadProgress(fmtBytes(status.received ?? 0, { unitOf: total, bare: true }), fmtBytes(total))}</span>
            )}
          </p>
          {total > 0 && <Progress value={((status.received ?? 0) / total) * 100} label={m.downloading} className="mt-1.5" />}
        </div>
      )}
      {status.state === 'downloadable' && (
        <>
          <p className="mt-1.5 text-[13px] leading-snug text-ink-2">{m.downloadable}</p>
          <Button variant="secondary" size="sm" className="mt-2" onClick={() => void download()}>{m.downloadNow}</Button>
        </>
      )}
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
