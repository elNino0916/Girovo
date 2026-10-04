'use client';

// "Was brauche ich?" — what the app needs, said before the PIN is typed:
// the online-banking credentials, the bank's FinTS access, approval in the
// bank's app (the one hard requirement), and where the BLZ is. A quiet
// disclosure, closed by default: it is there for whoever wonders, and stays
// out of the way of everyone else. In German, for the user — the README is
// for developers.

import { ChevronIcon, HelpIcon } from '../icons';
import { cx } from '../ui';

type Point = { title: string; text: string };

const CREDENTIALS: Point = {
  title: 'Die Zugangsdaten deines Online-Bankings',
  text: 'Anmeldename und PIN, so wie auf der Website deiner Bank. Nicht die PIN deiner Bankkarte.',
};
const FINTS: Point = {
  title: 'FinTS-Zugang',
  text: 'Darüber spricht die App mit deiner Bank. Ist er für deinen Zugang nicht freigeschaltet, hilft dir deine Bank.',
};
const APPROVAL: Point = {
  title: 'Freigabe per App',
  text:
    'Anmeldung und Aufträge gibst du in der Banking-App deiner Bank frei, z.\u00a0B. mit S-pushTAN, SecureGo plus '
    + 'oder BestSign. chipTAN, smsTAN und TAN-Generator gehen hier nicht.',
};
const FIND_BANK: Point = {
  title: 'Deine Bank finden',
  text: 'Am genauesten mit deiner IBAN: Die Stellen 5 bis 12 sind die Bankleitzahl (BLZ).',
};
const FORGOT_PIN: Point = {
  title: 'PIN vergessen?',
  text: 'Eine neue PIN bekommst du nur von deiner Bank – Sooskasse-FinTS speichert deine PIN nie.',
};

/**
 * Per step, what is still open: once the bank is chosen, finding it is done,
 * the form itself already says which PIN it wants — and a forgotten one is
 * the question now.
 */
const POINTS: Record<'bank' | 'credentials', Point[]> = {
  bank: [CREDENTIALS, FINTS, APPROVAL, FIND_BANK],
  credentials: [
    { ...CREDENTIALS, text: 'Anmeldename und PIN, so wie auf der Website deiner Bank.' },
    FINTS,
    APPROVAL,
    FORGOT_PIN,
  ],
};

export function LoginHelp({ step, className }: { step: 'bank' | 'credentials'; className?: string }) {
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
        Was brauche ich?
        <ChevronIcon size={14} className="transition-transform duration-150 group-open:rotate-180" />
      </summary>
      <dl className="mt-2 flex flex-col gap-3 text-[13.5px] leading-snug">
        {POINTS[step].map((p) => (
          <div key={p.title}>
            <dt className="font-semibold text-ink">{p.title}</dt>
            <dd className="mt-0.5 text-ink-2">{p.text}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
