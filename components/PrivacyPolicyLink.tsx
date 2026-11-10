'use client';

// The privacy policy on girovo.de, as a link in a line of text: on the login,
// where the app is first met (the update check and an error report can go
// out before anyone has opened Einstellungen → Über Girovo), and wherever a
// yes is asked in one short line and the rest is the policy's to say.

import { useLocale, useT } from '@/lib/i18n/react';
import { privacyUrl } from '@/lib/links';
import { ExternalIcon } from './icons';
import { cx } from './ui';

export function PrivacyPolicyLink({ className }: { className?: string }) {
  const t = useT();
  const { locale } = useLocale();
  return (
    <a
      href={privacyUrl(locale)}
      target="_blank"
      rel="noopener noreferrer"
      data-privacy-policy
      className={cx('font-semibold text-accent underline-offset-4 hover:underline', className)}
    >
      {t.settings.privacyPolicy}
      <ExternalIcon size={12} className="ml-1 inline-block align-[-1px]" />
      <span className="sr-only">{` ${t.shell.opensExternally}`}</span>
    </a>
  );
}
