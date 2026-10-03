'use client';

import { useEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import type { SerializedTanMethod } from '@/lib/fints-types';
import { AuthCard } from './auth/AuthShell';
import { useFints } from './FintsProvider';
import { ArrowRightIcon, BackIcon, PhoneIcon } from './icons';
import { Alert, Button, Spinner, cx } from './ui';

/**
 * Sicherheitsverfahren — which SCA method approves this session, and on which
 * device. A bank offering exactly one method skips straight through.
 *
 * Only decoupled methods (approval in the bank's app) are offered: the app has
 * no TAN entry field. Every row on this screen is therefore a "Direktfreigabe",
 * which is said once in the intro instead of on every row.
 */
export function TanMethodPicker() {
  const {
    tanMethods, mediaChoice, selectedMethod, tanMethodError, chooseTanMethod, clearMediaChoice, setView,
  } = useFints();
  const autoPicked = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // The row whose request is out. Everything else waits for it: a second
  // click would open a second approval for the same login.
  const [pending, setPending] = useState<string | null>(null);

  const single = tanMethods.length === 1;

  useEffect(() => {
    if (autoPicked.current || mediaChoice) return;
    if (single) {
      autoPicked.current = true;
      setPending(`m:${tanMethods[0].id}`);
      void chooseTanMethod(tanMethods[0]).finally(() => setPending(null));
    }
  }, [single, tanMethods, mediaChoice, chooseTanMethod]);

  const decoupled = tanMethods.filter((m) => m.isDecoupled);
  const hiddenCount = tanMethods.length - decoupled.length;
  // The device list is the provider's: it lives until a pick answers it or
  // "Anderes Verfahren" clears it, and comes back if the bank asks again.
  const pickingMedia = !!mediaChoice && !!selectedMethod;
  // Auto-picking the bank's only method: there is no choice to show, only
  // the connection being made (or, if that failed, the way to try again).
  const connectingOnly = single && !pickingMedia;

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

  return (
    <AuthCard step="approval" aside={<ApprovalAside />}>
      {pickingMedia ? (
        <>
          <Heading refEl={headingRef} title="Gerät wählen">
            Auf welchem Gerät möchtest du freigeben?
            <span className="mt-1 block text-ink-3">Verfahren: {selectedMethod!.name}</span>
          </Heading>
          <ul className="mt-6 flex flex-col gap-2">
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
          {decoupled.length > 1 && (
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
            Deine Bank bietet für diesen Zugang ein Verfahren an.
          </Heading>
          {busy || !tanMethodError ? (
            <p role="status" className="mt-6 flex items-center gap-3 rounded-[10px] bg-inset px-4 py-4 text-[15px] text-ink">
              <Spinner size={18} className="text-accent" />
              <span>Verbinde über <span className="font-semibold">{tanMethods[0].name}</span> …</span>
            </p>
          ) : (
            <Button
              variant="primary"
              className="mt-6"
              onClick={() => run(`m:${tanMethods[0].id}`, tanMethods[0])}
            >
              Erneut versuchen
            </Button>
          )}
        </>
      ) : (
        <>
          <Heading refEl={headingRef} title="Sicherheitsverfahren">
            {decoupled.length || !tanMethods.length
              ? 'Wähle, wie du Anmeldung und Aufträge freigibst. Die Freigabe erfolgt direkt in deiner Banking-App.'
              : 'Für diesen Zugang gibt es kein Verfahren, das hier funktioniert.'}
          </Heading>
          {decoupled.length ? (
            <ul className="mt-6 flex flex-col gap-2">
              {decoupled.map((m) => (
                <li key={m.id}>
                  <OptionRow
                    title={m.name}
                    // The device names, when the bank lists them — the one
                    // thing that tells two "pushTAN" entries apart.
                    subtitle={m.activeTanMedia?.length ? m.activeTanMedia.join(', ') : undefined}
                    pending={pending === `m:${m.id}`}
                    disabled={busy}
                    onClick={() => run(`m:${m.id}`, m)}
                  />
                </li>
              ))}
            </ul>
          ) : tanMethods.length > 0 && (
            <Alert className="mt-6">
              Diese Bank bietet für deinen Zugang nur Verfahren mit TAN-Eingabe an. Sooskasse-FinTS unterstützt
              derzeit nur die Direktfreigabe in einer Banking-App.
            </Alert>
          )}
          {decoupled.length > 0 && hiddenCount > 0 && (
            <p className="mt-3 text-[13px] leading-snug text-ink-3">
              {hiddenCount === 1
                ? 'Ein weiteres Verfahren mit TAN-Eingabe wird nicht unterstützt.'
                : `${hiddenCount} weitere Verfahren mit TAN-Eingabe werden nicht unterstützt.`}
            </p>
          )}
        </>
      )}

      {tanMethodError && <Alert className="mt-4">{tanMethodError}</Alert>}

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
 * 1024px it is left out — the dialog that follows says the same in context.
 */
function ApprovalAside() {
  const steps = [
    { title: 'Verfahren wählen', text: 'Das, mit dem du auch im Online-Banking deiner Bank freigibst.' },
    { title: 'Banking-App öffnen', text: 'Deine Bank schickt die Anfrage an das Gerät, das du dort hinterlegt hast.' },
    { title: 'Anfrage bestätigen', text: 'Danach geht es hier von selbst weiter.' },
  ];
  return (
    <aside aria-labelledby="tan-aside-title" className="panel px-6 pt-6 pb-6">
      <h2 id="tan-aside-title" className="section-head">So läuft die Freigabe</h2>
      <ol className="mt-5 flex flex-col gap-5">
        {steps.map((st, i) => (
          <li key={st.title} className="flex items-start gap-3.5">
            <span aria-hidden className="tnum grid size-9 shrink-0 place-items-center rounded-full bg-inset text-[14px] font-bold text-headline">
              {i + 1}
            </span>
            <span className="min-w-0 pt-px">
              <span className="block text-[14.5px] leading-snug font-semibold text-ink">{st.title}</span>
              <span className="mt-0.5 block text-[13.5px] leading-snug text-ink-2">{st.text}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-6 border-t border-line pt-4 text-[13px] leading-snug text-ink-3">
        Nach der ersten bestätigten Anmeldung kann sich die App dieses Gerät merken. Künftige Anmeldungen brauchen
        dann seltener eine Freigabe.
      </p>
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
        'group flex min-h-16 w-full items-center gap-3.5 rounded-[10px] px-4 py-3 text-left',
        'transition-[box-shadow,background-color] duration-150',
        // Exclusive sets: cx does not merge, so a state never relies on one
        // utility beating another.
        pending
          ? 'bg-accent-soft shadow-[inset_0_0_0_1.5px_var(--accent)]'
          : 'bg-surface shadow-[inset_0_0_0_1px_var(--line-strong)] enabled:hover:bg-accent-soft enabled:hover:shadow-[inset_0_0_0_1.5px_var(--accent)]',
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
