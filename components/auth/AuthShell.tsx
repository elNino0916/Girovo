'use client';

// The frame every screen before the dashboard shares: the navy masthead, a
// short navy stage band carrying the three-step progress, and the white tile
// (or two) that overlaps the stage — the shape of a German bank's login page,
// on the same tokens as the dashboard behind it.

import type { CSSProperties, ReactNode } from 'react';
import { useT } from '@/lib/i18n/react';
import { useFints } from '../FintsProvider';
import { ThemeToggle } from '../ThemeToggle';
import { LanguageSwitch } from '../LanguageToggle';
import { CheckIcon, EyeOffIcon, LandmarkIcon, LockIcon, ShieldIcon } from '../icons';
import { cx } from '../ui';
import { BrandMark } from '../shell/BrandMark';
import { MASTHEAD_EDGES } from '../shell/edges';
import { useUpdates } from '../updates/store';
import { UpdateBarButton } from '../updates/UpdateNotices';
import { useUsageConsent } from '../telemetry/usage';

export type AuthStep = 'bank' | 'credentials' | 'approval';

const STEPS: AuthStep[] = ['bank', 'credentials', 'approval'];

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || '';

const DRAG = { WebkitAppRegion: 'drag' } as CSSProperties;
const NO_DRAG = { WebkitAppRegion: 'no-drag' } as CSSProperties;

/**
 * The auth screens' page. `step` draws the progress on the stage; `aside` is a
 * second tile beside the main one on a wide window (≥1024px) and is simply
 * left out below that — whatever it says must not be the only place it is said.
 */
export function AuthCard({
  children, step, aside,
}: {
  children: ReactNode;
  step?: AuthStep;
  aside?: ReactNode;
}) {
  return (
    <div className="flex h-dvh flex-col bg-paper">
      <AuthMasthead />

      {/* The page scrolls here, not the window (the window sits fixed under
          the desktop caption bar). Marked as the scroll root so an open
          dialog — the TAN wait over the method picker — can lock it. */}
      <div data-scroll-root className="relative min-h-0 flex-1 overflow-y-auto">
        {/* A little lower on a short window (the desktop shell's 900×600
            minimum), so the form starts above the fold. */}
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 h-[132px] bg-stage sm:[@media(min-height:721px)]:h-[164px] sm:[@media(max-height:720px)]:h-[136px]"
        />

        <main
          className={cx(
            'relative mx-auto w-full px-4 pt-5 pb-12 sm:px-6 sm:pb-16 sm:[@media(min-height:721px)]:pt-8 sm:[@media(max-height:720px)]:pt-5',
            aside ? 'max-w-[528px] lg:max-w-[900px]' : 'max-w-[528px]',
          )}
        >
          {step && <StepIndicator current={step} />}

          <div className={cx('mt-5 sm:[@media(min-height:721px)]:mt-7', !!aside && 'lg:grid lg:grid-cols-[minmax(0,1fr)_316px] lg:items-start lg:gap-6')}>
            <div className="panel px-5 pt-6 pb-6 sm:px-8 sm:pt-8 sm:pb-8">{children}</div>
            {aside && <div className="hidden lg:block">{aside}</div>}
          </div>
        </main>
      </div>
    </div>
  );
}

/**
 * No session yet to put a bar over, but the window still needs one: with no
 * native frame (electron/main.cjs) this is also the only place on the login
 * screen the user can grab to drag it.
 */
function AuthMasthead() {
  return (
    // Not a scroll container, same reason as the dashboard's masthead: kept
    // clear of the row so the OS-drawn scrollbar never crosses it. Its edges
    // are the dashboard masthead's (1280px column, toggle clear of the OS
    // caption buttons), so the "€" mark is where the dashboard will put it.
    <header
      // A faint hairline: in light mode bar and stage are the same navy, and
      // the line is what says where the window's drag handle ends.
      className={cx(
        'on-bar flex shrink-0 items-center gap-3 bg-bar text-bar-ink shadow-[inset_0_-1px_0_color-mix(in_srgb,var(--bar-ink)_10%,transparent)]',
        MASTHEAD_EDGES,
      )}
      style={{ height: 'var(--barbar-h)', ...DRAG }}
    >
      <BrandMark version={APP_VERSION} versionClassName="hidden sm:inline" />

      <div className="flex-1" />

      <div className="flex items-center gap-1" style={NO_DRAG}>
        {/* Desktop app, and only while a newer version is known. */}
        <UpdateBarButton />
        {/* Before anything is typed: the bank search, the login and the approval read in it. */}
        <LanguageSwitch />
        <ThemeToggle tone="bar" />
      </div>
    </header>
  );
}

/** Bank · Anmeldung · Freigabe — where the user is, set on the navy stage. */
function StepIndicator({ current }: { current: AuthStep }) {
  const t = useT();
  const labels: Record<AuthStep, string> = {
    bank: t.auth.steps.bank,
    credentials: t.auth.steps.credentials,
    approval: t.common.approval,
  };
  const at = STEPS.indexOf(current);
  return (
    <ol aria-label={t.auth.steps.label} className="on-stage flex items-center gap-2 sm:gap-3">
      {STEPS.map((id, i) => {
        const done = i < at;
        const active = i === at;
        return (
          <li key={id} aria-current={active ? 'step' : undefined} className="flex min-w-0 items-center gap-2 sm:gap-3">
            <span className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden
                className={cx(
                  'tnum grid size-6 shrink-0 place-items-center rounded-full text-[12.5px] leading-none font-bold',
                  active && 'bg-stage-ink text-stage',
                  done && 'bg-[color-mix(in_srgb,var(--stage-ink)_18%,transparent)] text-stage-ink',
                  !active && !done && 'shadow-[inset_0_0_0_1.5px_var(--stage-line)] text-stage-ink-2',
                )}
              >
                {done ? <CheckIcon size={14} strokeWidth={2.6} /> : i + 1}
              </span>
              {/* Three labels don't fit a phone without being cut to "Ba…":
                  there only the current step is named, the others stay as
                  numbered marks (and remain readable to screen readers). */}
              <span
                className={cx(
                  'text-[13.5px] leading-none whitespace-nowrap sm:text-[14px]',
                  !active && 'max-sm:sr-only',
                  active ? 'font-bold text-stage-ink' : done ? 'font-semibold text-stage-ink' : 'font-semibold text-stage-ink-2',
                )}
              >
                {labels[id]}
                {done && <span className="sr-only"> {t.auth.steps.done}</span>}
              </span>
            </span>
            {i < STEPS.length - 1 && (
              <span aria-hidden className={cx('h-px w-4 shrink-0 sm:w-10', done ? 'bg-stage-ink-2' : 'bg-stage-line')} />
            )}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The company-logo sentence, the same at every width: the only lookup besides
 * the bank that would carry anything from the user's bookings, so it names
 * the service and says what goes there. Null in a build that does not offer it.
 */
function useLogoLine(offered?: boolean): string | null {
  const { meta, logoConsent } = useFints();
  const t = useT();
  if (!(offered ?? meta?.merchantLogos)) return null;
  if (logoConsent === 'on') return t.auth.privacy.logosOn;
  if (logoConsent === 'off') return t.auth.privacy.logosOff;
  return t.auth.privacy.logosUnasked;
}

/**
 * The desktop app's reports to the developer: errors always, usage only with
 * the yes. Null outside the desktop app, which sends neither. `mentionUsage`
 * false where the text around it already says usage needs the yes.
 */
function useTelemetryLine(mentionUsage = true): string | null {
  const usage = useUsageConsent();
  const t = useT();
  if (!usage) return null;
  if (usage === 'on') return t.auth.privacy.telemetryOn;
  const errors = t.auth.privacy.errorReports;
  return mentionUsage ? `${errors} ${t.auth.privacy.usageNeedsYes}` : errors;
}

/**
 * What happens to the credentials, said once in the wide layout's side tile.
 * Honest about what is kept on this machine and about every outside lookup
 * the app can make: company names to Brandfetch only with the user's yes,
 * with the desktop app's update check on, its version number to GitHub, and
 * in the desktop app error reports — plus usage data with the yes — to the
 * developer (components/telemetry).
 */
export function PrivacyAside({ merchantLogos }: { merchantLogos?: boolean }) {
  const { logoConsent } = useFints();
  const { state: update } = useUpdates();
  const usage = useUsageConsent();
  const words = useT().auth.privacy;
  const updateChecks = !!update?.auto && update.kind !== 'dev';
  const logoLine = useLogoLine(merchantLogos);
  const outside = [
    updateChecks ? words.updates : '',
    logoLine ?? '',
    // "Keine Nutzungsstatistik ohne deine Zustimmung" leads the point already.
    useTelemetryLine(false) ?? '',
  ].filter(Boolean).join(' ');
  // Nothing leaves the machine but bank traffic — now, and without a yes.
  const nothingOut = !updateChecks && !usage && (!logoLine || logoConsent === 'off');
  const points: { icon: ReactNode; title: string; text: string }[] = [
    { icon: <LockIcon size={18} />, ...words.pin },
    { icon: <LandmarkIcon size={18} />, ...words.direct },
    // Said before the fact: the app does not ask, it announces.
    { icon: <ShieldIcon size={18} check />, ...words.device },
    nothingOut
      ? {
          icon: <EyeOffIcon size={18} />,
          title: words.nothingOut.title,
          text: [words.nothingOut.text, outside].filter(Boolean).join(' '),
        }
      : usage === 'on'
        ? {
            icon: <EyeOffIcon size={18} />,
            title: words.usageOn.title,
            text: `${words.usageOn.text} ${outside}`,
          }
        : {
            icon: <EyeOffIcon size={18} />,
            title: words.usageOff.title,
            text: `${words.usageOff.text} ${outside}`,
          },
  ];

  return (
    <aside aria-labelledby="auth-privacy-title" className="panel px-6 pt-6 pb-6">
      <h2 id="auth-privacy-title" className="section-head">{words.title}</h2>
      <ul className="mt-5 flex flex-col gap-5">
        {points.map((p) => (
          <li key={p.title} className="flex items-start gap-3.5">
            <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-inset text-headline">
              {p.icon}
            </span>
            <span className="min-w-0 pt-px">
              <span className="block text-[14.5px] leading-snug font-semibold text-ink">{p.title}</span>
              <span className="mt-0.5 block text-[13.5px] leading-snug text-ink-2">{p.text}</span>
            </span>
          </li>
        ))}
      </ul>
    </aside>
  );
}

/**
 * The narrow layout's version of the side tile, under the form. Short, but
 * it keeps what matters most: the device the app remembers, and the one
 * lookup that would carry anything from the bookings.
 */
export function PrivacyNote() {
  const t = useT();
  const logoLine = useLogoLine();
  const telemetryLine = useTelemetryLine();
  return (
    <p className="mt-6 flex items-start gap-2.5 border-t border-line pt-5 text-[13px] leading-snug text-ink-3 lg:hidden">
      <ShieldIcon size={16} className="mt-px shrink-0" />
      <span>
        {t.auth.privacy.note}{logoLine && ` ${logoLine}`}{telemetryLine && ` ${telemetryLine}`}
      </span>
    </p>
  );
}
