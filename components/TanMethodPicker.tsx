'use client';

import { useEffect, useRef } from 'react';
import { AuthCard } from './Login';
import { useFints } from './FintsProvider';
import { Alert, ArrowRightIcon, Button } from './ui';

/**
 * Sicherheitsverfahren — which SCA method approves this session, and on which
 * device. A bank offering exactly one method skips straight through.
 */
export function TanMethodPicker() {
  const { tanMethods, mediaChoice, selectedMethod, tanMethodError, chooseTanMethod, setView } = useFints();
  const autoPicked = useRef(false);

  useEffect(() => {
    if (autoPicked.current || mediaChoice) return;
    if (tanMethods.length === 1) {
      autoPicked.current = true;
      void chooseTanMethod(tanMethods[0]);
    }
  }, [tanMethods, mediaChoice, chooseTanMethod]);

  const pickingMedia = !!mediaChoice && !!selectedMethod;

  return (
    <AuthCard>
      <h2 className="font-display text-[22px] font-semibold tracking-tight">
        {pickingMedia ? 'Gerät wählen' : 'Sicherheitsverfahren'}
      </h2>
      <p className="mt-1 mb-5 text-sm text-ink-2">
        {pickingMedia
          ? 'Auf welchem Gerät möchtest du freigeben?'
          : 'Wähle, wie du den Zugriff freigibst.'}
      </p>

      <div className="flex flex-col gap-2">
        {pickingMedia
          ? mediaChoice!.map((name) => (
              <OptionRow key={name} onClick={() => void chooseTanMethod(selectedMethod!, name)} title={name} />
            ))
          : (tanMethods.filter((m) => m.isDecoupled).length ? (
              tanMethods
                .filter((m) => m.isDecoupled)
                .map((m) => (
                  <OptionRow
                    key={m.id}
                    onClick={() => void chooseTanMethod(m)}
                    title={m.name}
                    subtitle={
                      'Direktfreigabe in der App'
                      + (m.activeTanMedia?.length ? ` · ${m.activeTanMedia.join(', ')}` : '')
                    }
                    badge="Direktfreigabe"
                  />
                ))
            ) : (
              <Alert>Diese Bank bietet nur TAN-Eingabe-Verfahren. Sooskasse-FinTS unterstützt aktuell nur Direktfreigabe-Verfahren (decoupled).</Alert>
            ))}
      </div>

      {tanMethodError && <Alert>{tanMethodError}</Alert>}

      <div className="mt-4">
        <Button size="sm" variant="quiet" onClick={() => setView('login')}>Zurück zur Anmeldung</Button>
      </div>
    </AuthCard>
  );
}

function OptionRow({
  title, subtitle, badge, onClick,
}: {
  title: string;
  subtitle?: string;
  badge?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-[10px] border border-line bg-surface px-3.5 py-3
                 text-left transition-colors duration-150 hover:border-green"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14.5px] font-semibold">{title}</span>
        {subtitle && <span className="mt-0.5 block truncate text-[12.5px] text-ink-3">{subtitle}</span>}
      </span>
      {badge ? (
        <span className="shrink-0 rounded-full bg-green-soft px-2 py-1 text-[10.5px] font-semibold tracking-wider text-green uppercase">
          {badge}
        </span>
      ) : (
        <span className="shrink-0 text-ink-3"><ArrowRightIcon /></span>
      )}
    </button>
  );
}
