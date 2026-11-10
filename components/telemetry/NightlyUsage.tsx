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

import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n/react';
import { ChartIcon } from '../icons';
import { PrivacyPolicyLink } from '../PrivacyPolicyLink';
import { Button, Dialog } from '../ui';
import { updates, useUpdates } from '../updates/store';
import { setUsageConsent, usageCameWithChannel, useUsageConsent, type UsageConsent } from './usage';

/** Whether this copy shares usage data as part of its channel. */
export function usageComesWithChannel(channel: UpdateChannel | undefined, usage: UsageConsent | null): boolean {
  return channel === 'preview' && usage !== null;
}

export function NightlyUsageDialog() {
  const t = useT();
  const { state } = useUpdates();
  const usage = useUsageConsent();
  const [busy, setBusy] = useState<'agree' | 'stable' | null>(null);
  const words = t.settings.channel.usageAsk;
  const open = usageComesWithChannel(state?.channel, usage) && usage !== 'on';
  // Off Nightly by another way than the channel's dialog (the updater can move
  // a copy back to "Stabil"): a yes that came with the channel ends here too.
  const channel = state?.channel;
  useEffect(() => {
    if (channel === 'stable' && usage === 'on' && usageCameWithChannel()) void setUsageConsent(false);
  }, [channel, usage]);
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
      title={words.title}
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
