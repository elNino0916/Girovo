'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { get, store } from '@/lib/client-api';
import { BankLogo } from './BankLogo';
import { useFints, type BankSearchHit, type ChosenBank } from './FintsProvider';
import { ThemeToggle } from './ThemeToggle';
import { Alert, Button, Field, Input, SearchIcon, ShieldIcon } from './ui';

export function Login() {
  const { bank, setBank, popularBanks, logoFiles, meta, connect } = useFints();
  return bank ? <Credentials bank={bank} onChange={() => setBank(null)} onSubmit={connect} meta={meta} />
    : <BankPicker banks={popularBanks} logoFiles={logoFiles} bankCount={meta?.bankCount} onPick={setBank} />;
}

// ---------------------------------------------------------------------------
// Step A: pick the bank
// ---------------------------------------------------------------------------
function BankPicker({
  banks, logoFiles, bankCount, onPick,
}: {
  banks: ReturnType<typeof useFints>['popularBanks'];
  logoFiles: Record<string, string>;
  bankCount?: number;
  onPick: (b: ChosenBank) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<BankSearchHit[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults(null); return; }
    const t = setTimeout(() => {
      get<BankSearchHit[]>(`/api/bank-search?q=${encodeURIComponent(q)}`)
        .then(setResults)
        .catch(() => setResults([]));
    }, 180);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setResults(null);
    };
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, []);

  return (
    <AuthCard>
      <Brand />
      <p className="eyebrow mb-2.5">Bank wählen</p>

      <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
        {banks.slice(0, 8).map((b) => (
          <button
            key={b.key}
            type="button"
            onClick={() => {
              if (b.blz && b.url) {
                onPick({ blz: b.blz, name: b.fullName || b.name, brand: b.brand, bic: b.bic, hint: b.hint });
              } else {
                // regional group (Sparkasse, VR, …) — hand over to the search
                const term = b.search || b.name;
                setQuery(term);
                inputRef.current?.focus();
              }
            }}
            className="flex flex-col items-center gap-2 rounded-[10px] border border-line bg-surface px-1 pt-3 pb-2.5
                       transition-[border-color,background-color,transform] duration-150
                       hover:border-line-strong hover:bg-inset active:scale-[0.97]"
          >
            <BankLogo brand={b.brand} size="tile" file={logoFiles[b.brand]} />
            <span className="text-center text-[11.5px] leading-tight font-medium text-ink-2">{b.name}</span>
          </button>
        ))}
      </div>

      <div ref={boxRef} className="relative">
        <SearchAdornment />
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') setResults(null); }}
          placeholder="Bank, Ort, BLZ oder BIC suchen …"
          autoComplete="off"
          aria-label="Bank suchen"
          className="pl-10"
        />

        {results && (
          <div className="absolute inset-x-0 top-[calc(100%+6px)] z-30 max-h-[300px] overflow-y-auto rounded-[10px]
                          border border-line-strong bg-surface shadow-[var(--shadow-pop)]">
            {results.length === 0 ? (
              <p className="p-3.5 text-[13.5px] text-ink-3">Keine Bank gefunden. BLZ prüfen oder anders suchen.</p>
            ) : results.map((b) => (
              <button
                key={b.blz}
                type="button"
                onClick={() => {
                  setResults(null);
                  setQuery('');
                  onPick({ blz: b.blz, name: b.name, location: b.location, brand: b.brand, bic: b.bic });
                }}
                className="flex w-full items-center gap-3 border-b border-line px-3 py-2.5 text-left last:border-b-0 hover:bg-inset"
              >
                <BankLogo brand={b.brand} size="sm" file={logoFiles[b.brand]} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{b.name}</span>
                  <span className="num block truncate text-[11.5px] text-ink-3">
                    {[b.blz, b.bic, b.location].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <p className="mt-2 text-[12.5px] text-ink-3">
        <span className="num">{bankCount ? new Intl.NumberFormat('de-DE').format(bankCount) : '…'}</span>
        {' '}deutsche Banken mit FinTS-Zugang in der Datenbank.
      </p>

      <PrivacyNote />
    </AuthCard>
  );
}

// ---------------------------------------------------------------------------
// Step B: credentials
// ---------------------------------------------------------------------------
function Credentials({
  bank, onChange, onSubmit, meta,
}: {
  bank: ChosenBank;
  onChange: () => void;
  onSubmit: (bank: ChosenBank, userId: string, pin: string) => Promise<void>;
  meta: ReturnType<typeof useFints>['meta'];
}) {
  const { logoFiles } = useFints();
  const [login, setLogin] = useState(() => store.get(`fints.userId.${bank.blz}`) || '');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [remembered, setRemembered] = useState(false);
  const pinRef = useRef<HTMLInputElement>(null);
  const loginRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (login ? pinRef : loginRef).current?.focus();
    // Focus once, on mount, for whichever field still needs filling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Show a hint when this (bank, login name) has a remembered device, so the
  // user knows the PIN they type will unlock it (fewer TAN prompts).
  useEffect(() => {
    const name = login.trim();
    if (!bank.blz || !name) { setRemembered(false); return; }
    const t = setTimeout(() => {
      get<{ remembered: boolean }>(`/api/device-status?blz=${encodeURIComponent(bank.blz)}&userId=${encodeURIComponent(name)}`)
        .then((r) => setRemembered(r.remembered))
        .catch(() => setRemembered(false));
    }, 250);
    return () => clearTimeout(t);
  }, [bank.blz, login]);

  const submit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit(bank, login.trim(), pin);
      setPin('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }, [bank, login, pin, onSubmit]);

  return (
    <AuthCard>
      <Brand />

      <form onSubmit={submit} noValidate>
        <div className="mb-4 flex items-center gap-3 rounded-[10px] border border-line bg-inset p-3">
          <BankLogo brand={bank.brand} size="lg" file={logoFiles[bank.brand]} />
          <div className="min-w-0 flex-1">
            <span className="block truncate text-[14.5px] font-semibold">{bank.name}</span>
            <span className="num block truncate text-[11.5px] text-ink-3">
              BLZ {bank.blz}{bank.location ? ` · ${bank.location}` : ''}
            </span>
          </div>
          <Button type="button" size="sm" onClick={onChange}>Ändern</Button>
        </div>

        <Field label="Anmeldename · VR-NetKey · Legitimations-ID" htmlFor="userId">
          <Input
            id="userId" ref={loginRef} value={login} onChange={(e) => setLogin(e.target.value)}
            autoComplete="username" required
          />
        </Field>

        <Field label="PIN" htmlFor="pin">
          <Input
            id="pin" ref={pinRef} type="password" value={pin} onChange={(e) => setPin(e.target.value)}
            autoComplete="current-password" required
          />
        </Field>

        {bank.hint && <p className="-mt-1 mb-3 text-[12.5px] text-ink-3">{bank.hint}</p>}

        {remembered && (
          <p className="mb-3 flex items-center gap-2 rounded-[9px] bg-accent-soft px-3 py-2.5 text-[12.5px] font-medium text-accent">
            <ShieldIcon check />
            Gerät gemerkt — deine PIN schaltet die gespeicherten Zugangsdaten frei.
          </p>
        )}

        <Button type="submit" variant="primary" block busy={submitting}>
          {submitting ? 'Verbinde mit der Bank …' : 'Anmelden'}
        </Button>

        {error && <Alert>{error}</Alert>}
      </form>

      {meta && !meta.productRegistered && (
        <Alert tone="warn">
          Es ist keine registrierte FinTS-Produkt-ID hinterlegt — Banken lehnen die Anmeldung
          damit meist ab (Code 9078). ID in <span className="num">config.json</span> eintragen.
        </Alert>
      )}

      <PrivacyNote />
    </AuthCard>
  );
}

// ---------------------------------------------------------------------------
// Shared chrome
// ---------------------------------------------------------------------------
export function AuthCard({ children }: { children: React.ReactNode }) {
  // No session yet to put a bar over, but the window still needs one: with
  // no native frame (electron/main.cjs) this is also the only place on the
  // login screen the user can grab to drag it.
  return (
    <div className="flex h-dvh flex-col">
      {/* Not a scroll container, same reason as Dashboard.tsx's header: kept
          clear of the row so the OS-drawn scrollbar never crosses it.
          bar-caption-safe keeps content clear of the OS caption buttons —
          see the same note in Dashboard.tsx. */}
      <div
        className="on-bar bar-caption-safe flex shrink-0 items-center gap-3 bg-bar pl-4 text-bar-ink sm:pl-6"
        style={{
          height: 'var(--barbar-h)',
          WebkitAppRegion: 'drag',
        } as React.CSSProperties}
      >
        <span className="font-display text-[17px] leading-none font-semibold tracking-tight">
          Sooskasse<span className="text-bar-ink-2">-FinTS</span>
        </span>

        <div className="flex-1" />

        <div style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <ThemeToggle tone="bar" />
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center overflow-y-auto px-4 py-8">
        <div className="panel w-full max-w-[470px] p-6 sm:p-8">
          {children}
        </div>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <div className="mb-6 flex items-center gap-3">
      <span className="num grid size-10 shrink-0 place-items-center rounded-[11px] bg-accent text-[22px] font-semibold text-accent-ink">
        €
      </span>
      <div>
        <span className="block font-display text-[19px] leading-tight font-semibold tracking-tight">Sooskasse-FinTS</span>
        <span className="block text-[12.5px] text-ink-3">Direktzugang über FinTS 3.0</span>
      </div>
    </div>
  );
}

function SearchAdornment() {
  return (
    <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-3">
      <SearchIcon />
    </span>
  );
}

function PrivacyNote() {
  return (
    <p className="mt-5 flex items-start gap-2 border-t border-line pt-4 text-[12.5px] text-ink-3">
      <span className="mt-0.5"><ShieldIcon /></span>
      Deine PIN bleibt nur im Arbeitsspeicher und wird nie gespeichert. Die Verbindung
      läuft direkt von diesem Rechner zu deiner Bank.
    </p>
  );
}
