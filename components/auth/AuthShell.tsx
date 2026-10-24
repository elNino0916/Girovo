'use client';

// The frame every screen before the dashboard shares, "Markenfläche mit
// Blatt" (owner, 2026-10-23, the phone's; the desktop's since 2026-10-24):
// the brand's colour holds the G€ plate, the name and one line of what
// Girovo is, and the steps stand on a paper sheet that rises over it — from
// below on a phone, from the right on a wide window. On the sheet the
// three-step progress and the form stand straight on the page, no card
// around them; where the sheet is wide enough a side tile beside the form
// says what happens to the data. The Android app has no Darstellung here:
// it follows the phone's light and dark.
//
// The sheet's width is a container (`auth`): the side tile, and the form's
// rows that make room for it, switch on what the sheet holds, not on the
// window — the brand field beside it takes its share.

import type { CSSProperties, ReactNode } from 'react';
import { useT } from '@/lib/i18n/react';
import { IS_ANDROID } from '@/lib/platform';
import { useFints } from '../FintsProvider';
import { ThemeToggle } from '../ThemeToggle';
import { LanguageSwitch } from '../LanguageToggle';
import { CheckIcon, EyeOffIcon, LandmarkIcon, LockIcon, ShieldIcon } from '../icons';
import { cx } from '../ui';
import { BrandPlate } from '../shell/BrandMark';
import { usePhone } from '../shell/usePhone';
import { useUpdates } from '../updates/store';
import { UpdateBarButton } from '../updates/UpdateNotices';
import { useUsageConsent } from '../telemetry/usage';

export type AuthStep = 'bank' | 'credentials' | 'approval';

const STEPS: AuthStep[] = ['bank', 'credentials', 'approval'];

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || '';

const DRAG = { WebkitAppRegion: 'drag' } as CSSProperties;
const NO_DRAG = { WebkitAppRegion: 'no-drag' } as CSSProperties;

/**
 * The auth screens' page. `step` draws the progress above the form; `aside` is
 * a second tile beside the main one on a wide sheet (the `auth` container
 * from 59rem) and is simply left out below that — whatever it says must not
 * be the only place it is said.
 */
export function AuthCard({
  children, step, aside,
}: {
  children: ReactNode;
  step?: AuthStep;
  aside?: ReactNode;
}) {
  const t = useT();
  const phone = usePhone();
  if (phone) return <PhoneAuth step={step}>{children}</PhoneAuth>;
  return (
    <div className="flex h-dvh bg-stage text-stage-ink">
      {/* The brand field: the window's left edge, top to bottom. Nothing in
          it is pressed, so all of it drags the window, like the bar beside it. */}
      <div className="on-stage flex w-[clamp(240px,28vw,400px)] shrink-0 flex-col pr-7 pl-8 xl:pl-12" style={DRAG}>
        <div className="flex flex-1 flex-col justify-center pb-[18vh]">
          {/* By night the field is a deep blue too: a hairline of its ink keeps the navy plate's edge. */}
          <BrandPlate size={48} className="dark:shadow-[0_0_0_1.5px_color-mix(in_srgb,var(--stage-ink)_45%,transparent)]" />
          <p className="mt-5 text-[28px] leading-9 font-medium">Girovo</p>
          <p className="mt-3 max-w-[24ch] text-lg leading-[26px]">{t.auth.brandLine}</p>
        </div>
        {/* For support questions, development builds included ("3.1.3-dev.123"). */}
        {APP_VERSION && (
          <p title={`Version ${APP_VERSION}`} className="tnum truncate pb-6 text-[12px] leading-4 text-stage-ink-2">
            {APP_VERSION}
          </p>
        )}
      </div>

      {/* The sheet, risen 28px over the field from the right. */}
      <div className="relative -ml-7 flex min-w-0 flex-1 flex-col rounded-l-[28px] bg-paper text-ink shadow-[-2px_0_12px_rgb(0_0_0/0.08)]">
        <AuthBar />

        {/* The page scrolls here, not the window (the window sits fixed under
            the desktop caption bar). Marked as the scroll root so an open
            dialog — the TAN wait over the method picker — can lock it. */}
        <div data-scroll-root className="@container/auth relative min-h-0 flex-1 overflow-y-auto">
          <main
            className={cx(
              'relative mx-auto w-full px-6 pb-16 [@media(min-height:721px)]:pt-6 [@media(max-height:720px)]:pt-2',
              aside ? 'max-w-[528px] @min-[59rem]/auth:max-w-[900px]' : 'max-w-[528px]',
            )}
          >
            {step && <StepIndicator current={step} />}

            <div className={cx('mt-5 [@media(min-height:721px)]:mt-7', !!aside && '@min-[59rem]/auth:grid @min-[59rem]/auth:grid-cols-[minmax(0,1fr)_316px] @min-[59rem]/auth:items-start @min-[59rem]/auth:gap-6')}>
              <div className="pb-2">{children}</div>
              {aside && <div className="hidden @min-[59rem]/auth:block">{aside}</div>}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

/**
 * A phone (owner, 2026-10-23): the brand's colour fills the top — the G€
 * plate, the name and, on the first step, one line of what Girovo is — and
 * the step rises over it as Material's bottom sheet. After the first step
 * the field shrinks to the plate and the name, so the form keeps the room.
 * The whole page scrolls as one; the sheet's paper runs to the bottom of
 * the screen. A narrow browser window (the website) gets the same, with its
 * Darstellung beside the language.
 */
function PhoneAuth({ step, children }: { step?: AuthStep; children: ReactNode }) {
  const t = useT();
  const first = !step || step === 'bank';
  return (
    <div className="flex h-dvh flex-col bg-stage text-stage-ink">
      <div data-scroll-root className="relative flex min-h-0 flex-1 flex-col overflow-y-auto">
        <header
          data-topbar
          className={cx('on-stage shrink-0 px-6', first ? 'pb-14' : 'pb-11')}
        >
          <div className="-mr-3 flex h-16 items-center justify-end [--md-sys-color-on-surface-variant:var(--stage-ink)]">
            <LanguageSwitch />
            {!IS_ANDROID && <ThemeToggle tone="stage" />}
          </div>
          <div className="flex items-center gap-3.5">
            {/* By night the field is a deep blue too: a hairline of its ink keeps the navy plate's edge. */}
            <BrandPlate size={first ? 48 : 36} className="dark:shadow-[0_0_0_1.5px_color-mix(in_srgb,var(--stage-ink)_45%,transparent)]" />
            <span className={cx('font-medium', first ? 'text-[28px] leading-9' : 'text-[22px] leading-7')}>Girovo</span>
          </div>
          {first && <p className="mt-3 max-w-[30ch] text-lg leading-[26px]">{t.auth.brandLine}</p>}
        </header>
        <main className="@container/auth relative -mt-7 flex-1 rounded-t-[28px] bg-paper px-4 pt-3 pb-12 text-ink shadow-[0_-2px_12px_rgb(0_0_0/0.08)]">
          {/* Material's bottom sheet carries a handle; this one is a page, so it only looks like one. */}
          <span aria-hidden className="mx-auto mb-4 block h-1 w-8 rounded-full bg-[color-mix(in_srgb,var(--ink-2)_40%,transparent)]" />
          {step && <StepIndicator current={step} />}
          <div className={step ? 'mt-5' : undefined}>{children}</div>
        </main>
      </div>
    </div>
  );
}

/**
 * No session yet to put a bar over, but the window still needs one: with no
 * native frame (electron/main.cjs) this strip along the sheet's top is,
 * with the brand field beside it, where the user grabs the window to drag
 * it. On the sheet's paper, so the OS-drawn caption buttons at its right
 * end are the colour they are everywhere else.
 */
function AuthBar() {
  return (
    // Not a scroll container, same reason as the dashboard's masthead: kept
    // clear of the row so the OS-drawn scrollbar never crosses it.
    <header
      data-topbar
      className="on-bar bar-caption-safe flex shrink-0 items-center justify-end gap-1 pl-6"
      style={{ height: 'var(--barbar-h)', ...DRAG }}
    >
      <div className="flex items-center gap-1" style={NO_DRAG}>
        {/* Desktop app, and only while a newer version is known. */}
        <UpdateBarButton />
        {/* Before anything is typed: the bank search, the login and the approval read in it. */}
        <LanguageSwitch />
        {!IS_ANDROID && <ThemeToggle tone="bar" />}
      </div>
    </header>
  );
}

/** Bank · Anmeldung · Freigabe — where the user is, above the form. */
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
 * What happens to the credentials, said once in the wide sheet's side tile.
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
 * The narrow sheet's version of the side tile, under the form. Short, but
 * it keeps what matters most: the device the app remembers, and the one
 * lookup that would carry anything from the bookings.
 */
export function PrivacyNote() {
  const t = useT();
  const logoLine = useLogoLine();
  const telemetryLine = useTelemetryLine();
  return (
    <p className="mt-6 flex items-start gap-2.5 border-t border-line pt-5 text-[13px] leading-snug text-ink-3 @min-[59rem]/auth:hidden">
      <ShieldIcon size={16} className="mt-px shrink-0" />
      <span>
        {t.auth.privacy.note}{logoLine && ` ${logoLine}`}{telemetryLine && ` ${telemetryLine}`}
      </span>
    </p>
  );
}
