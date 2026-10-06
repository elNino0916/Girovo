'use client';

// "Was brauche ich?" — what the app needs, said before the PIN is typed:
// the online-banking credentials, the bank's FinTS access, approval in the
// bank's app (the one hard requirement), and where the BLZ is. A quiet
// disclosure, closed by default: it is there for whoever wonders, and stays
// out of the way of everyone else. In the user's language (lib/i18n) — the
// README is for developers.

import type { Messages } from '@/lib/i18n';
import { useT } from '@/lib/i18n/react';
import { ChevronIcon, HelpIcon } from '../icons';
import { cx } from '../ui';

type Point = { title: string; text: string };

/**
 * Per step, what is still open: once the bank is chosen, finding it is done,
 * the form itself already says which PIN it wants — and a forgotten one is
 * the question now.
 */
function pointsFor(step: 'bank' | 'credentials', help: Messages['auth']['help']): Point[] {
  if (step === 'bank') return [help.credentials, help.fints, help.approval, help.findBank];
  return [{ ...help.credentials, text: help.credentialsShort }, help.fints, help.approval, help.forgotPin];
}

export function LoginHelp({ step, className }: { step: 'bank' | 'credentials'; className?: string }) {
  const help = useT().auth.help;
  return (
    <details className={cx('group', className ?? 'mt-5')}>
      {/* A tertiary button in look; the native summary keeps it a
          disclosure for keyboards and screen readers. */}
      <summary
        className="-ml-2 inline-flex min-h-9 cursor-pointer list-none items-center gap-1.5 rounded-full px-2 text-[13.5px]
                   font-semibold text-accent transition-colors duration-150 select-none hover:bg-accent-soft
                   [&::-webkit-details-marker]:hidden"
      >
        <HelpIcon size={16} />
        {help.toggle}
        <ChevronIcon size={14} className="transition-transform duration-150 group-open:rotate-180" />
      </summary>
      <dl className="mt-2 flex flex-col gap-3 text-[13.5px] leading-snug">
        {pointsFor(step, help).map((p) => (
          <div key={p.title}>
            <dt className="font-semibold text-ink">{p.title}</dt>
            <dd className="mt-0.5 text-ink-2">{p.text}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
