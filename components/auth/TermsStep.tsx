'use client';

// The step before the bank: the terms of use, agreed to once (lib/terms.ts).
// On the login's own frame, in place of the bank search, so nothing of the
// app is reached without it — the demo and a remembered login included.
//
// One button. The terms are agreed to; the privacy policy is only pointed at
// (it informs, it is not something to consent to), and both open in the
// browser, in the app's language. There is no "no": not agreeing is closing
// the app.

import { useT, useLocale } from '@/lib/i18n/react';
import { privacyUrl, termsUrl } from '@/lib/links';
import { acceptTerms } from '@/lib/terms';
import { ExternalIcon, FileIcon, ShieldIcon } from '../icons';
import { Button } from '../ui';

export function TermsStep() {
  const t = useT();
  const { locale } = useLocale();
  const words = t.auth.terms;
  const links = [
    { href: termsUrl(locale), label: t.settings.terms, icon: <FileIcon size={20} /> },
    { href: privacyUrl(locale), label: t.settings.privacyPolicy, icon: <ShieldIcon size={20} /> },
  ];
  return (
    <div data-terms-step>
      <h1 className="text-[28px] leading-tight font-medium text-headline sm:text-[32px]">{words.title}</h1>
      <p className="mt-3 text-[16px] leading-6 text-ink-2">{words.text}</p>
      <ul className="mt-6 flex flex-col gap-0.5 overflow-hidden rounded-[var(--radius-card)]">
        {links.map((l) => (
          <li key={l.href}>
            <a
              href={l.href}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-14 items-center gap-4 bg-surface px-4 text-[16px] leading-6 text-ink transition-colors hover:bg-inset"
            >
              <span aria-hidden className="shrink-0 text-ink-2">{l.icon}</span>
              <span className="min-w-0 flex-1">{l.label}<span className="sr-only">{` ${t.shell.opensExternally}`}</span></span>
              <ExternalIcon size={16} className="shrink-0 text-ink-2" />
            </a>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-[14px] leading-5 text-ink-2">{words.privacy}</p>
      <div className="mt-6 flex">
        <Button variant="primary" data-autofocus onClick={acceptTerms}>{words.agree}</Button>
      </div>
    </div>
  );
}
