'use client';

import { useEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { TRY_AGAIN_LATER, isBankOutage } from '@/lib/bank-answer';
import { APPROVAL_APP } from '@/lib/brands';
import type { SerializedTanMethod } from '@/lib/fints-types';
import { BankAnswerAlert } from './BankAnswer';
import { AuthCard } from './auth/AuthShell';
import { useFints } from './FintsProvider';
import { ArrowRightIcon, BackIcon, CheckCircleIcon, PhoneIcon, ShieldIcon } from './icons';
import { Alert, Button, Spinner, cx } from './ui';

/**
 * Sicherheitsverfahren — which SCA method approves this session, and on which
 * device. A bank offering exactly one method, and that one an app approval,
 * skips straight through.
 *
 * Only decoupled methods (approval in the bank's app) are offered: the app has
 * no TAN entry field. Every row on this screen is therefore a "Direktfreigabe",
 * which is said once in the intro instead of on every row. The methods that
 * need a typed TAN are named, so a chipTAN customer knows theirs was seen.
 */

/** One choice on the list: a method, or a method on one of its devices. */
type Row = { key: string; method: SerializedTanMethod; media?: string; title: string; subtitle?: string };

/**
 * The bank's app-approval methods as rows. A method the bank lists with
 * several devices, and that needs one named, gets a row per device — the
 * device is then chosen here, not on a second screen.
 */
function rowsFor(methods: SerializedTanMethod[]): Row[] {
  return methods.filter((m) => m.isDecoupled).flatMap((m): Row[] => {
    const devices = m.activeTanMedia ?? [];
    if (m.tanMediaRequirement >= 2 && devices.length > 1) {
      return devices.map((d) => ({ key: `m:${m.id}:${d}`, method: m, media: d, title: m.name, subtitle: d }));
    }
    // The device names, when the bank lists them — the one thing that tells
    // two "pushTAN" entries apart.
    return [{ key: `m:${m.id}`, method: m, title: m.name, subtitle: devices.length ? devices.join(', ') : undefined }];
  });
}

const listOf = (names: string[]) => new Intl.ListFormat('de', { style: 'long', type: 'conjunction' }).format(names);

/** Said before the fact, here and in the wide layout's side tile. */
const DEVICE_MEMORY = 'Nach der ersten Freigabe merkt sich die App dieses Gerät – rückgängig unter Sitzung → Gerät vergessen.';

export function TanMethodPicker() {
  const {
    bank, tanMethods, mediaChoice, selectedMethod, tanMethodError, chooseTanMethod, clearMediaChoice, setView,
  } = useFints();
  const autoPicked = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // The row whose request is out. Everything else waits for it: a second
  // click would open a second approval for the same login.
  const [pending, setPending] = useState<string | null>(null);

  const rows = rowsFor(tanMethods);
  const typed = tanMethods.filter((m) => !m.isDecoupled);
  // Picked without asking only when there is nothing to choose — and only an
  // app approval: a lone typed-TAN method would start a wait that cannot
  // succeed. It lands on the explanation below instead.
  const single = tanMethods.length === 1 && rows.length === 1;
  const only = single ? rows[0] : null;

  useEffect(() => {
    if (autoPicked.current || mediaChoice || !only) return;
    autoPicked.current = true;
    setPending(only.key);
    void chooseTanMethod(only.method, only.media).finally(() => setPending(null));
  }, [only, mediaChoice, chooseTanMethod]);

  // The device list is the provider's: it lives until a pick answers it or
  // "Anderes Verfahren" clears it, and comes back if the bank asks again.
  const pickingMedia = !!mediaChoice && !!selectedMethod;
  // Auto-picking the bank's only method: there is no choice to show, only
  // the connection being made (or, if that failed, the way to try again).
  const connectingOnly = !!only && !pickingMedia;

  // A new stage of the screen gets the screen reader's attention at its title.
  const stage = pickingMedia ? 'media' : connectingOnly ? 'single' : 'methods';
  const firstStage = useRef(true);
  useEffect(() => {
    if (firstStage.current) { firstStage.current = false; return; }
    headingRef.current?.focus();
  }, [stage]);

  const run = (key: string, method: SerializedTanMethod, media?: string) => {
    if (pending) return;
    setPending(key);
    void chooseTanMethod(method, media).finally(() => setPending(null));
  };

  const busy = pending !== null;
  const app = bank ? APPROVAL_APP[bank.brand] : undefined;

  return (
    <AuthCard step="approval" aside={<ApprovalAside />}>
      {pickingMedia ? (
        <>
          <Heading refEl={headingRef} title="Gerät wählen">
            Auf welchem Gerät möchtest du freigeben?
            <span className="mt-1 block text-ink-3">Verfahren: {selectedMethod!.name}</span>
          </Heading>
          <ul className="mt-6 flex flex-col gap-1">
            {mediaChoice!.map((name) => (
              <li key={name}>
                <OptionRow
                  title={name}
                  pending={pending === `d:${name}`}
                  disabled={busy}
                  onClick={() => run(`d:${name}`, selectedMethod!, name)}
                />
              </li>
            ))}
          </ul>
          {rows.length > 1 && (
            <Button
              variant="tertiary"
              size="sm"
              iconLeft={<BackIcon size={16} />}
              className="mt-4 -ml-3"
              disabled={busy}
              onClick={clearMediaChoice}
            >
              Anderes Verfahren
            </Button>
          )}
        </>
      ) : connectingOnly ? (
        <>
          <Heading refEl={headingRef} title="Sicherheitsverfahren">
            Deine Bank bietet für diesen Zugang nur ein Verfahren an.
          </Heading>
          {busy || !tanMethodError ? (
            <p role="status" className="mt-6 flex items-center gap-3 rounded-[var(--radius-chip)] bg-inset px-4 py-4 text-[15px] text-ink">
              <Spinner size={18} className="text-accent" />
              <span>Verbinde über <span className="font-semibold">{only!.title}</span> …</span>
            </p>
          ) : (
            <Button
              variant="primary"
              className="mt-6"
              onClick={() => run(only!.key, only!.method, only!.media)}
            >
              Erneut versuchen
            </Button>
          )}
          <p className="mt-5 text-[13px] leading-snug text-ink-3 lg:hidden">{DEVICE_MEMORY}</p>
        </>
      ) : rows.length ? (
        <>
          <Heading refEl={headingRef} title="Sicherheitsverfahren">
            Wähle, wie du Anmeldung und Aufträge freigibst. Die Freigabe erfolgt direkt in deiner Banking-App.
          </Heading>
          <ul className="mt-6 flex flex-col gap-1">
            {rows.map((r) => (
              <li key={r.key}>
                <OptionRow
                  title={r.title}
                  subtitle={r.subtitle}
                  pending={pending === r.key}
                  disabled={busy}
                  onClick={() => run(r.key, r.method, r.media)}
                />
              </li>
            ))}
          </ul>
          {typed.length > 0 && (
            <p className="mt-3 text-[13px] leading-snug text-ink-3">
              {listOf(typed.map((m) => m.name))} {typed.length === 1 ? 'braucht' : 'brauchen'} eine TAN-Eingabe
              und {typed.length === 1 ? 'geht' : 'gehen'} hier nicht.
            </p>
          )}
          <p className="mt-5 text-[13px] leading-snug text-ink-3 lg:hidden">{DEVICE_MEMORY}</p>
        </>
      ) : (
        <>
          <Heading refEl={headingRef} title="Sicherheitsverfahren">
            Für diesen Zugang gibt es kein Verfahren, das hier funktioniert.
          </Heading>
          {typed.length > 0 && (
            <Alert tone="warn" className="mt-6" title="Nur Verfahren mit TAN-Eingabe">
              <p>
                Für deinen Zugang meldet deine Bank: {listOf(typed.map((m) => m.name))}. Hier geht aber nur die
                Freigabe in einer Banking-App.
              </p>
              <p className="mt-1.5">
                Frag deine Bank nach der Freigabe per App{app ? ` (z.\u00a0B. ${app})` : ''} oder stell sie in deinem
                Online-Banking um. Danach kannst du dich hier anmelden.
              </p>
            </Alert>
          )}
        </>
      )}

      {tanMethodError && (
        <BankAnswerAlert message={tanMethodError} className="mt-4">
          {isBankOutage(tanMethodError) && <p>{TRY_AGAIN_LATER}</p>}
        </BankAnswerAlert>
      )}

      {/* Rows announce nothing themselves (a button's content is its name);
          this says what the click set going. */}
      <p role="status" className="sr-only">{busy ? 'Verbinde mit der Bank …' : ''}</p>

      <div className="mt-6 border-t border-line pt-4">
        <Button
          variant="quiet"
          size="sm"
          iconLeft={<BackIcon size={16} />}
          className="-ml-3"
          // Stays available while a method is being set up: a bank that never
          // answers must not trap the user on this screen.
          onClick={() => setView('login')}
        >
          Zurück zur Anmeldung
        </Button>
      </div>
    </AuthCard>
  );
}

/**
 * The wide layout's side tile for this step: what is about to happen, so the
 * phone buzzing a moment later is expected rather than a surprise. Below
 * 1024px it is left out — the dialog that follows says the same in context,
 * and the card says what the app will remember. Glyphs, not numbers: the
 * stage above already counts the steps of the login.
 */
function ApprovalAside() {
  const steps: { icon: ReactNode; title: string; text: string }[] = [
    { icon: <ShieldIcon size={18} check />, title: 'Verfahren wählen', text: 'Das, mit dem du auch im Online-Banking deiner Bank freigibst.' },
    { icon: <PhoneIcon size={18} />, title: 'Banking-App öffnen', text: 'Deine Bank schickt die Anfrage an das Gerät, das du dort hinterlegt hast.' },
    { icon: <CheckCircleIcon size={18} />, title: 'Anfrage bestätigen', text: 'Danach geht es hier von selbst weiter.' },
  ];
  return (
    <aside aria-labelledby="tan-aside-title" className="panel px-6 pt-6 pb-6">
      <h2 id="tan-aside-title" className="section-head">So läuft die Freigabe</h2>
      <ol className="mt-5 flex flex-col gap-5">
        {steps.map((st) => (
          <li key={st.title} className="flex items-start gap-3.5">
            <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-inset text-headline">
              {st.icon}
            </span>
            <span className="min-w-0 pt-px">
              <span className="block text-[14.5px] leading-snug font-semibold text-ink">{st.title}</span>
              <span className="mt-0.5 block text-[13.5px] leading-snug text-ink-2">{st.text}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-6 border-t border-line pt-4 text-[13px] leading-snug text-ink-3">{DEVICE_MEMORY}</p>
    </aside>
  );
}

function Heading({
  title, children, refEl,
}: {
  title: string;
  children: ReactNode;
  refEl: RefObject<HTMLHeadingElement | null>;
}) {
  return (
    <>
      <h1 ref={refEl} tabIndex={-1} className="text-[28px] leading-tight font-bold text-headline outline-none sm:text-[32px]">
        {title}
      </h1>
      <p className="mt-1.5 text-[15px] leading-snug text-ink-2">{children}</p>
    </>
  );
}

/**
 * A choice on the card itself, unframed — a frame per row inside the card
 * would be a box in a box. It tints on hover like a menu row and takes the
 * Signal Wash while its request is out.
 */
function OptionRow({
  title, subtitle, pending, disabled, onClick,
}: {
  title: string;
  subtitle?: string;
  pending: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-busy={pending || undefined}
      className={cx(
        // Pulled into the card's padding by its own, so the glyph lines up
        // with the heading while the tint gets room around it.
        'group -mx-3 flex min-h-16 w-[calc(100%+1.5rem)] items-center gap-3.5 rounded-[var(--radius-chip)] px-3 py-3 text-left',
        'transition-colors duration-150',
        // Exclusive sets: cx does not merge, so a state never relies on one
        // utility beating another.
        pending ? 'bg-accent-soft' : 'enabled:hover:bg-inset',
        disabled && !pending && 'cursor-not-allowed opacity-50',
      )}
    >
      <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
        <PhoneIcon size={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] leading-snug font-semibold text-ink">{title}</span>
        {subtitle && <span className="mt-0.5 block truncate text-[13px] leading-snug text-ink-3">{subtitle}</span>}
      </span>
      <span className="grid size-6 shrink-0 place-items-center text-accent">
        {pending ? <Spinner size={17} /> : <ArrowRightIcon size={18} className="text-ink-3 group-hover:text-accent" />}
      </span>
    </button>
  );
}
