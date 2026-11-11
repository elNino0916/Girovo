'use client';

// The Nightly channel shares usage data (owner, 2026-11-10): whoever runs
// what is not finished also tells how it went. Never switched on behind
// anyone's back. Choosing the channel is the yes — the channel's dialog says
// so and sets it (components/settings/UpdateChannel.tsx) — and a copy that is
// on the channel without it is asked here, with the way out as the other
// answer: back to "Stabil". No usage event goes out before the yes; the
// shell still sends them with the consent alone (src-tauri/src/telemetry.rs).
//
// Mounted in Dashboard, at every width, like LinkedUnlockDialog. Only builds
// with an updater of their own have a channel, and only those that can share
// usage data have the question: everywhere else this draws nothing.

import { useEffect, useRef, useState } from 'react';
import { useLocale, useT } from '@/lib/i18n/react';
import { ChartIcon } from '../icons';
import { PrivacyPolicyLink } from '../PrivacyPolicyLink';
import { Button, Dialog } from '../ui';
import { channelInfo, channelName, needsUsage } from '../updates/channels';
import { updateStateNow, updates, useUpdates } from '../updates/store';
import { setUsageConsent, usageCameWithChannel, useUsageConsent, type UsageConsent } from './usage';

/** Whether this copy shares usage data as part of its channel (Nightly, or a listed channel that says so). */
export function usageComesWithChannel(channel: UpdateChannel | undefined, usage: UsageConsent | null): boolean {
  return channel != null && needsUsage(updateStateNow(), channel) && usage !== null;
}

/**
 * Off Nightly by another way than the channel's dialog (the updater can move a
 * copy back to "Stabil" at start): a yes that came with the channel ends then
 * too. Mounted at the app's root (app/page.tsx), so it ends before the login,
 * not after it.
 *
 * Only when the channel is first known or has just left Nightly — never on
 * the consent changing: choosing Nightly sets the yes a moment before the
 * channel follows, and that moment must not take it back.
 */
export function ChannelConsentGuard() {
  const { state } = useUpdates();
  const channel = state?.channel;
  const withUsage = channel == null ? undefined : needsUsage(state, channel);
  const seen = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    if (withUsage === undefined) return;
    const before = seen.current;
    seen.current = withUsage;
    if (!withUsage && before !== false && usageCameWithChannel()) void setUsageConsent(false);
  }, [withUsage]);
  return null;
}

export function NightlyUsageDialog() {
  const t = useT();
  const { locale } = useLocale();
  const { state } = useUpdates();
  const usage = useUsageConsent();
  const [busy, setBusy] = useState<'agree' | 'stable' | null>(null);
  const words = t.settings.channel.usageAsk;
  const open = usageComesWithChannel(state?.channel, usage) && usage !== 'on';
  // Either answer ends the question by what it changes: the consent, or the channel.
  const answer = async (which: 'agree' | 'stable') => {
    setBusy(which);
    try {
      if (which === 'agree') await setUsageConsent(true, true);
      else await updates.setChannel('stable');
    } finally {
      setBusy(null);
    }
  };
  return (
    <Dialog
      open={open}
      title={words.title(state ? channelName(channelInfo(state, state.channel), state.channel, t.settings.channel, locale) : t.settings.channel.preview)}
      icon={<ChartIcon size={20} />}
      // Two short lines; what is shared in full is the policy's to say.
      description={<>{words.text} <PrivacyPolicyLink /></>}
      actions={
        <>
          <Button variant="secondary" data-autofocus busy={busy === 'stable'} disabled={busy === 'agree'} onClick={() => void answer('stable')}>
            {words.toStable}
          </Button>
          <Button variant="primary" busy={busy === 'agree'} disabled={busy === 'stable'} onClick={() => void answer('agree')}>
            {words.agree}
          </Button>
        </>
      }
    />
  );
}
