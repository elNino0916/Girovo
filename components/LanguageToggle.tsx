'use client';

// Sprache: Deutsch or English.
//
// Each language is named in itself and marked with its own `lang`, so someone
// stuck in a language they cannot read still finds theirs — and a screen
// reader pronounces "English" as English. A change applies at once: the page
// renders again in the other language, nothing reloads (lib/i18n/react.tsx).

import { LOCALES, LOCALE_NAMES, type Locale } from '@/lib/i18n/locale';
import { useLocale } from '@/lib/i18n/react';
import { GlobeIcon } from './icons';
import { Button, Segmented } from './ui';

/**
 * The login bar's switch: one button naming the other language, in that
 * language. With two languages, one press is the whole choice.
 */
export function LanguageSwitch({ className }: { className?: string }) {
  const { locale, setLocale } = useLocale();
  const other: Locale = locale === 'de' ? 'en' : 'de';
  return (
    <Button variant="quiet" size="sm" lang={other} iconLeft={<GlobeIcon size={18} />} onClick={() => setLocale(other)} className={className}>
      {LOCALE_NAMES[other]}
    </Button>
  );
}

/** The Sitzung panel's row: both languages, the current one selected. */
export function LanguageSegmented({ label, className }: { label: string; className?: string }) {
  const { locale, setLocale } = useLocale();
  return (
    <Segmented
      aria-label={label}
      size="sm"
      className={className}
      value={locale}
      onChange={(v) => setLocale(v as Locale)}
      options={LOCALES.map((l) => ({ value: l, label: <span lang={l}>{LOCALE_NAMES[l]}</span> }))}
    />
  );
}
