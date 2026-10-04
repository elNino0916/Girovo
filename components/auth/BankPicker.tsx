'use client';

// Step one: find the bank. Search comes first — most people know their bank's
// name or city, or have its IBAN on a card or statement, and there are
// thousands of institutes behind it — with the big names as one-click picks
// underneath.
//
// The search box is an ARIA 1.2 combobox with a list popup: focus never leaves
// the field, the arrows move a highlight (aria-activedescendant), Enter takes
// it, Escape closes the list and a second Escape clears the query. A polite
// status line says how many banks matched — and which, when it is one — so a
// screen reader hears the result of typing without having to go looking.
//
// An IBAN is read here (lib/bank-query.ts): only its BLZ goes to the search,
// never the IBAN itself.

import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { get } from '@/lib/client-api';
import type { PopularBank } from '@/lib/banks';
import { bankSearchTerm, parseBankQuery, type BankQuery } from '@/lib/bank-query';
import { BankLogo } from '../BankLogo';
import type { BankSearchHit, ChosenBank } from '../FintsProvider';
import { CloseIcon, SearchIcon } from '../icons';
import { Alert, IconButton, Input, Skeleton, Spinner, cx } from '../ui';
import { PrivacyNote } from './AuthShell';
import { LoginHelp } from './LoginHelp';
import { fmtBlz } from './format';

/** What the search route returns at most (lib/banks.ts searchBanks). */
const SEARCH_LIMIT = 25;
const QUICK_PICKS = 8;

/**
 * Tile names that read better than the preset's own: the group tile covers
 * both halves of the cooperative banks, and says so.
 */
const TILE_LABEL: Record<string, string> = {
  vrbank: 'Volksbank / Raiffeisenbank',
};

// A tile is ~90px of text at four across, narrower than 'Raiffeisenbank' or
// 'Commerzbank' set whole. Soft hyphens give the compound a place to break
// that does not depend on a hyphenation dictionary (Electron ships none), and
// they stay invisible whenever the word fits.
const softBreaks = (label: string) =>
  label.replace(/(Raiffeisen|Commerz|Deutsche|Spar)(bank|kasse)/g, '$1\u00AD$2');

/**
 * Banks people look for that offer no FinTS access, so no search can find
 * them. Named only when the query is one of them — every other miss gets the
 * general sentence, which makes no claim about any bank.
 */
const WITHOUT_FINTS = ['N26', 'Revolut', 'Trade Republic', 'bunq', 'C24', 'Tomorrow', 'Vivid'];

function bankWithoutFinTS(query: string): string | null {
  const squash = (s: string) => s.toLowerCase().replace(/[\s-]+/g, '');
  const q = squash(query);
  if (q.length < 3) return null;
  return WITHOUT_FINTS.find((name) => squash(name).startsWith(q) || q.startsWith(squash(name))) ?? null;
}

type SearchState =
  | { kind: 'idle' }
  | { kind: 'searching'; previous: BankSearchHit[] | null }
  | { kind: 'done'; hits: BankSearchHit[] }
  | { kind: 'failed' };

/** Why there is nothing to search yet, for a query that is an IBAN on its way. */
function ibanNote(q: BankQuery): string | null {
  if (q.kind !== 'iban') return null;
  if (q.country !== 'DE') return 'Hier gibt es nur deutsche Banken – eine deutsche IBAN beginnt mit DE.';
  if (q.valid === false) return 'Diese IBAN stimmt nicht. Prüfe sie bitte noch einmal.';
  if (!q.blz) return 'Tippe weiter – die BLZ steckt in Stelle 5 bis 12 deiner IBAN.';
  return null;
}

/** Nothing found, said for what was searched. */
function emptyNote(q: BankQuery): string {
  if (q.kind === 'iban') return 'Zu dieser IBAN gibt es keine Bank mit FinTS-Zugang. Nicht jede Bank bietet FinTS an.';
  if (q.kind === 'blz') {
    return 'Keine Bank mit dieser BLZ. Eine BLZ hat 8 Ziffern – du findest sie in deiner IBAN an Stelle 5 bis 12.';
  }
  const known = q.kind === 'text' ? bankWithoutFinTS(q.text) : null;
  if (known) return `${known} bietet kein FinTS an. Mit Sooskasse-FinTS lässt sich das Konto dort deshalb nicht nutzen.`;
  return 'Keine Bank mit diesem Namen oder Ort. Nicht jede Bank bietet FinTS an.';
}

/** The one hit is the bank the IBAN names (not a list still left from before). */
const isIbanBank = (q: BankQuery, hits: BankSearchHit[]) =>
  q.kind === 'iban' && hits.length === 1 && hits[0].blz === q.blz;

/** Guidance above a list that is long, or whose rows share one name. */
function listNote(q: BankQuery, hits: BankSearchHit[]): string | null {
  if (!hits.length) return null;
  if (q.kind === 'iban') return isIbanBank(q, hits) ? 'Die Bank zu deiner IBAN:' : null;
  if (hits.length >= SEARCH_LIMIT) return `Die ersten ${SEARCH_LIMIT} Treffer – ergänze den Ort oder gib deine IBAN ein.`;
  if (new Set(hits.map((h) => h.name)).size < hits.length) return 'Gib deine IBAN ein, dann findest du genau deine Bank.';
  return null;
}

export function BankPicker({
  banks, logoFiles, bankCount, staleBank, onPick,
}: {
  banks: PopularBank[];
  logoFiles: Record<string, string>;
  bankCount?: number;
  /** The bank chosen last time, when the list no longer has it. */
  staleBank?: ChosenBank | null;
  onPick: (b: ChosenBank) => void;
}) {
  const uid = useId();
  const inputId = `banksearch${uid}`;
  const listId = `${inputId}-list`;
  const optId = (i: number) => `${inputId}-opt-${i}`;

  const [query, setQuery] = useState('');
  const [search, setSearch] = useState<SearchState>({ kind: 'idle' });
  const [active, setActive] = useState(-1);
  const [focused, setFocused] = useState(false);
  // Escape closes the list without throwing the query away; typing reopens it.
  const [dismissed, setDismissed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const reqRef = useRef(0);

  // autoFocus lands before any effect runs, but a window that is not in the
  // foreground (a desktop app opening behind another) delivers no focus
  // event for it — so ask where focus actually is once, on mount.
  useEffect(() => {
    if (document.activeElement === inputRef.current) setFocused(true);
  }, []);

  const parsed = parseBankQuery(query);
  // What goes to the server: a name, a BLZ — for an IBAN only its BLZ.
  const term = bankSearchTerm(parsed);
  const waitNote = ibanNote(parsed);

  useEffect(() => {
    if (term === null) {
      reqRef.current++;
      setSearch({ kind: 'idle' });
      return;
    }
    setSearch((s) => ({ kind: 'searching', previous: s.kind === 'done' ? s.hits : s.kind === 'searching' ? s.previous : null }));
    const t = setTimeout(() => {
      // Answers can overtake each other; only the latest query's may land.
      const req = ++reqRef.current;
      get<BankSearchHit[]>(`/api/bank-search?q=${encodeURIComponent(term)}`)
        .then((hits) => { if (req === reqRef.current) setSearch({ kind: 'done', hits }); })
        .catch(() => { if (req === reqRef.current) setSearch({ kind: 'failed' }); });
    }, 180);
    return () => clearTimeout(t);
  }, [term]);

  const hits = term === null ? null : search.kind === 'done' ? search.hits : search.kind === 'searching' ? search.previous : null;
  const open = focused && !dismissed && (term !== null || waitNote !== null);
  const options = open && hits ? hits : [];

  // A new result set starts without a highlight: arrows step into it.
  useEffect(() => { setActive(-1); }, [hits]);

  useEffect(() => {
    if (active < 0) return;
    document.getElementById(optId(active))?.scrollIntoView({ block: 'nearest' });
    // optId is derived from the stable useId value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const pickHit = (b: BankSearchHit) => {
    // The query may be an IBAN: it leaves the field with the pick.
    setQuery('');
    setDismissed(true);
    onPick({ blz: b.blz, name: b.name, location: b.location, brand: b.brand, bic: b.bic });
  };

  const pickPopular = (b: PopularBank) => {
    // Only presets whose BLZ is in the list arrive with one (lib/banks.ts).
    if (b.blz) {
      onPick({ blz: b.blz, name: b.fullName || b.name, brand: b.brand, bic: b.bic });
      return;
    }
    // A regional group (Sparkasse, VR, …) has no single BLZ — hand over to the
    // search, with the caret after a space so the city can simply follow.
    const next = `${b.search || b.name} `;
    setQuery(next);
    setDismissed(false);
    const el = inputRef.current;
    if (el) {
      el.focus();
      requestAnimationFrame(() => el.setSelectionRange(next.length, next.length));
    }
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!hits?.length || term === null) return;
      e.preventDefault();
      if (dismissed) {
        setDismissed(false);
        setActive(e.key === 'ArrowDown' ? 0 : hits.length - 1);
        return;
      }
      const n = hits.length;
      setActive((a) => (e.key === 'ArrowDown' ? (a + 1) % n : a <= 0 ? n - 1 : a - 1));
      return;
    }
    if (e.key === 'Enter') {
      if (!open || !options.length) return;
      e.preventDefault();
      // Without a highlight, Enter only commits when there is nothing to
      // choose between — a BLZ typed in full, say. The status line has named
      // that one bank already.
      if (active >= 0) pickHit(options[active]);
      else if (options.length === 1) pickHit(options[0]);
      return;
    }
    if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        setDismissed(true);
        setActive(-1);
      } else if (query) {
        e.preventDefault();
        setQuery('');
      }
    }
  };

  // The popup's words: one note above the list (guidance), or one in its
  // place (why there is no list). The status line says the same for a
  // screen reader, which does not see the popup's text.
  const settled = search.kind === 'done' ? search.hits : null;
  const topNote = open && hits ? listNote(parsed, hits) : null;
  const placeNote = !open
    ? null
    : waitNote
      ?? (search.kind === 'failed'
        ? 'Die Suche ist gerade nicht erreichbar. Bitte versuche es gleich noch einmal.'
        : search.kind === 'searching' && !hits
          ? 'Suche …'
          : settled && settled.length === 0
            ? emptyNote(parsed)
            : null);

  const status = !open
    ? ''
    : placeNote
      ?? (hits
        ? hits.length === 1
          ? `${isIbanBank(parsed, hits) ? 'Die Bank zu deiner IBAN' : '1 Bank gefunden'}: ${hits[0].name}, BLZ ${fmtBlz(hits[0].blz)}`
          : `${hits.length >= SEARCH_LIMIT ? `Mindestens ${SEARCH_LIMIT}` : hits.length} Banken gefunden.${topNote ? ` ${topNote}` : ''}`
        : '');

  const searching = search.kind === 'searching';
  const popupShown = open && (options.length > 0 || !!placeNote);

  // The quick picks arrive from /api/banks a moment after the page. If they
  // have not come after a few seconds they are not coming (the request
  // failed), and a row of skeletons would then promise something forever — so
  // the section goes away and the search stands alone.
  const [quickPicksGone, setQuickPicksGone] = useState(false);
  useEffect(() => {
    if (banks.length) { setQuickPicksGone(false); return; }
    const t = setTimeout(() => setQuickPicksGone(true), 5000);
    return () => clearTimeout(t);
  }, [banks.length]);

  return (
    <>
      <h1 className="text-[28px] leading-tight font-bold text-headline sm:text-[32px]">Bank wählen</h1>
      <p className="mt-1.5 text-[15px] leading-snug text-ink-2">Bei welcher Bank führst du dein Konto?</p>

      {staleBank && (
        <Alert tone="info" className="mt-5" title="Deine Bank vom letzten Mal steht nicht mehr in der Liste">
          {staleBank.name} (BLZ <span className="num">{fmtBlz(staleBank.blz)}</span>) – vielleicht hat sie fusioniert.
          Such deine Bank bitte neu, am genauesten mit deiner IBAN.
        </Alert>
      )}

      <div className="mt-6">
        <label htmlFor={inputId} className="text-[13px] leading-snug font-semibold text-ink-2">
          Bank suchen
        </label>
        <div
          className="relative mt-1.5"
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
          }}
        >
          <Input
            ref={inputRef}
            id={inputId}
            type="text"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={popupShown}
            aria-controls={listId}
            aria-activedescendant={open && active >= 0 ? optId(active) : undefined}
            aria-describedby={`${inputId}-hint`}
            // The first thing on the screen; nothing else competes for it.
            autoFocus
            value={query}
            onChange={(e) => { setQuery(e.target.value); setDismissed(false); }}
            onFocus={() => setFocused(true)}
            onKeyDown={onKeyDown}
            placeholder="Name, Ort, BLZ oder IBAN"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="search"
            leading={<SearchIcon size={18} />}
            trailing={
              searching ? (
                <span className="grid size-8 place-items-center text-ink-3"><Spinner size={16} /></span>
              ) : query ? (
                <IconButton
                  aria-label="Suche leeren"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { setQuery(''); inputRef.current?.focus(); }}
                >
                  <CloseIcon size={16} />
                </IconButton>
              ) : undefined
            }
          />

          {/* The popup. Pressing inside it must not blur the field — the
              highlight and the typed query both live there. */}
          <div
            hidden={!popupShown}
            onMouseDown={(e) => e.preventDefault()}
            className="anim-pop absolute inset-x-0 top-[calc(100%+6px)] z-30 overflow-hidden rounded-[12px] bg-raised shadow-[var(--shadow-pop)]"
          >
            {topNote && options.length > 0 && (
              <p aria-hidden className="border-b border-line px-4 py-2.5 text-[13px] leading-snug text-ink-2">
                {topNote}
              </p>
            )}
            <ul
              id={listId}
              role="listbox"
              aria-label="Gefundene Banken"
              className={cx('max-h-[min(340px,50vh)] overflow-y-auto overscroll-contain', options.length > 0 && 'p-1.5')}
            >
              {options.map((b, i) => (
                <li
                  key={b.blz}
                  id={optId(i)}
                  role="option"
                  aria-selected={i === active}
                  onMouseMove={() => { if (i !== active) setActive(i); }}
                  onClick={() => pickHit(b)}
                  className={cx(
                    'flex min-h-14 cursor-pointer items-center gap-3 rounded-[8px] px-3 py-2',
                    // The tint alone is ~1.1:1 on --raised; the ring is what a
                    // keyboard user sees (focus stays in the field). Forced
                    // colours drop box-shadows, so there it is an outline.
                    i === active
                      ? 'bg-accent-soft shadow-[inset_0_0_0_2px_var(--accent)] forced-colors:outline-2 forced-colors:-outline-offset-2 forced-colors:outline-solid'
                      : undefined,
                  )}
                >
                  <span className="grid w-[52px] shrink-0 place-items-center">
                    <BankLogo brand={b.brand} size="sm" file={logoFiles[b.brand]} />
                  </span>
                  <span className="min-w-0 flex-1">
                    {/* Two lines rather than an ellipsis: institute names in
                        one region often differ only in their last words. */}
                    <span className="line-clamp-2 block text-[15px] leading-snug font-semibold text-ink">{b.name}</span>{' '}
                    <span className="mt-0.5 block text-[13px] leading-snug text-ink-3">
                      {/* The town gets its own line on a phone, so a wrap
                          never strands a separator at a line's end. */}
                      {b.location && (
                        <span className="block sm:inline">
                          {b.location}
                          <span className="hidden sm:inline"> · </span>
                        </span>
                      )}
                      <span className="whitespace-nowrap">BLZ <span className="num">{fmtBlz(b.blz)}</span></span>
                      {b.bic && <span className="whitespace-nowrap"> · <span className="num">{b.bic}</span></span>}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            {placeNote && (
              <p aria-hidden className="px-4 py-3 text-[13.5px] leading-snug text-ink-3">
                {placeNote}
              </p>
            )}
          </div>
        </div>
        {/* Faded, not hidden, under an open list: still the field's
            description, just not peeking out beside the popup's corners. */}
        <p
          id={`${inputId}-hint`}
          className={cx('mt-1.5 min-h-[18px] text-[13px] leading-snug text-ink-3 transition-opacity duration-150', popupShown && 'opacity-0')}
        >
          {bankCount ? (
            // Entries of the bank list are Bankleitzahlen, not banks: one
            // bank can have several.
            <>
              <span className="tnum">{new Intl.NumberFormat('de-DE').format(bankCount)}</span> Bankleitzahlen mit
              FinTS-Zugang
            </>
          ) : (
            <Skeleton className="mt-0.5 h-3.5 w-64 max-w-full" />
          )}
        </p>
        <p role="status" className="sr-only">{status}</p>
      </div>

      {!quickPicksGone && (
        <section aria-labelledby={`${inputId}-popular`} className="mt-7">
          {/* Not "Häufig gewählt": the app counts nothing, so it cannot know. */}
          <h2 id={`${inputId}-popular`} className="text-[13px] leading-snug font-semibold text-ink-2">
            Schnellauswahl
          </h2>
          <QuickPicks banks={banks} logoFiles={logoFiles} onPick={pickPopular} />
        </section>
      )}

      <LoginHelp step="bank" />

      <PrivacyNote />
    </>
  );
}

function QuickPicks({
  banks, logoFiles, onPick,
}: {
  banks: PopularBank[];
  logoFiles: Record<string, string>;
  onPick: (b: PopularBank) => void;
}) {
  // Unframed picks on the card itself — a frame per tile inside the card
  // would be a box in a box — tinting on hover like a menu row. Logos on one
  // line across the row: each pick stacks from the top, and the label sits
  // centred in a box two lines tall, so a name that wraps ("Volksbank /
  // Raiffeisenbank") does not lift its logo above its neighbours'.
  const tileBase =
    'flex flex-col items-center justify-start gap-2 rounded-[var(--radius-chip)] px-1 pt-3 pb-2.5 text-center sm:gap-2.5 sm:pt-3.5 sm:pb-3';
  const labelBox = 'flex min-h-[2lh] w-full items-center justify-center text-[12.5px] leading-tight';

  if (!banks.length) {
    return (
      <ul aria-hidden className="mt-1.5 -mx-1 grid grid-cols-2 gap-1 sm:grid-cols-4">
        {Array.from({ length: QUICK_PICKS }, (_, i) => (
          <li key={i} className={tileBase}>
            <span className="grid h-8 w-full grid-cols-[minmax(0,1fr)] place-items-center sm:h-10">
              <Skeleton className="h-6 w-16 sm:h-7" />
            </span>
            <span className={labelBox}>
              <Skeleton className="h-3.5 w-16" />
            </span>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <ul className="mt-1.5 -mx-1 grid grid-cols-2 gap-1 sm:grid-cols-4">
      {banks.slice(0, QUICK_PICKS).map((b) => {
        const label = TILE_LABEL[b.key] ?? b.name;
        // A group (Sparkasse, VR, …) has no one BLZ: its pick starts a
        // search instead of choosing — the glyph and the name say so.
        const searches = !b.blz;
        return (
          <li key={b.key} className="flex">
            <button
              type="button"
              onClick={() => onPick(b)}
              aria-label={searches ? `${label} suchen` : label}
              className={cx(
                tileBase,
                'w-full transition-colors duration-150 hover:bg-inset active:bg-[color-mix(in_srgb,var(--inset)_70%,var(--line))]',
              )}
            >
              <span className="grid h-8 w-full grid-cols-[minmax(0,1fr)] place-items-center sm:h-10">
                <BankLogo brand={b.brand} size="tile" file={logoFiles[b.brand]} />
              </span>
              <span className={labelBox}>
                <span className="min-w-0 font-semibold text-balance text-ink-2">
                  {searches && <SearchIcon size={12} strokeWidth={2.2} className="mr-1 inline-block align-[-1px] text-ink-3" />}
                  {softBreaks(label)}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
