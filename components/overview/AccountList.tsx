'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent, ReactNode, RefObject } from 'react';
import { canReportBalance, isCardAccount, namesList, totalBalance } from '@/lib/balances';
import { translateType } from '@/lib/format';
import type { SerializedAccount } from '@/lib/fints-types';
import { useFints } from '../FintsProvider';
import { Money } from '../Money';
import { PencilIcon, RefreshIcon, UndoIcon } from '../icons';
import { Alert, Button, DotList, EmptyState, IconButton, Input, Skeleton, TileHeader, cx } from '../ui';
import { AccountGlyph, MAX_ALIAS, ShortIban, accountIdent, aliasFromDraft, bankName, vaultNote } from './AccountIdentity';

/** The same words every other fetch control carries. */
const MAY_NEED_TAN = 'Kann eine Freigabe erfordern';

/**
 * Konten und Karten — the account switcher, and the place the whole relationship
 * with the bank is summed up.
 *
 * A row per account in the shape every German Kontenübersicht uses: what kind
 * of account (as a pictogram), what you call it, the end of its IBAN, and the
 * balance right-aligned so a column of balances can be compared at a glance.
 * On a phone the column becomes a row of cards you swipe through, with the
 * next one peeking in from the edge so it is obvious there is more — a column
 * of four full-width rows would push the statement itself below the fold.
 *
 * The hero right below shows the selected account in detail. So the list
 * keeps every balance (the column has to add up to the Gesamtsaldo), but the
 * selected row leaves its Verfügbar to the hero, where it stands beside the
 * Dispositionsrahmen and Vorgemerkt. With a single account there is nothing
 * to switch or add up: the hero is that account, and this tile stays away.
 *
 * A row says what its figure is waiting for: "Saldo abrufen" (which, like
 * every read, can need an approval), "Abruf fehlgeschlagen" with the way to
 * try again, or "Kein Abruf möglich" for an account the bank reports no
 * balance for over FinTS.
 */
export function AccountList() {
  const {
    accounts, activeAccount, balances, loadingAccount, balanceLoading, busy, wait, selectAccount, loadBalance,
    loadAllBalances, loadingAllBalances, isLoadedForAppliedRange, txErrors, balanceErrors,
    accountLabel, renameAccount, vault, vaultStatus, toast,
  } = useFints();

  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [noteOpen, setNoteOpen] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const firstInput = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const totalRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const noteId = useId();
  const inView = useCardInView(listRef, accounts.length, !editing);

  // Focus follows the mode: into the first name when editing starts, back to
  // the button that started it when editing ends — never lost to <body>.
  const wasEditing = useRef(false);
  useEffect(() => {
    if (editing) firstInput.current?.focus();
    else if (wasEditing.current) editButton.current?.focus();
    wasEditing.current = editing;
  }, [editing]);

  // The explanation answers a click; once the vault is readable it is moot.
  useEffect(() => {
    if (vaultStatus === 'ready') setNoteOpen(false);
  }, [vaultStatus]);

  const startEditing = () => {
    if (vaultStatus !== 'ready') {
      setNoteOpen(true);
      return;
    }
    const aliases = vault?.aliases ?? {};
    setDrafts(Object.fromEntries(accounts.map((a) => [a.accountNumber, aliases[a.accountNumber] ?? ''])));
    setEditing(true);
  };

  const cancel = () => setEditing(false);

  const save = (e?: FormEvent) => {
    e?.preventDefault();
    const aliases = vault?.aliases ?? {};
    let changed = 0;
    for (const a of accounts) {
      // Typing the bank's own name back in is the same as having no alias.
      const next = aliasFromDraft(a, drafts[a.accountNumber] ?? '');
      if ((aliases[a.accountNumber] ?? null) === next) continue;
      renameAccount(a.accountNumber, next);
      changed++;
    }
    setEditing(false);
    if (changed) toast(changed === 1 ? 'Kontoname gespeichert.' : 'Kontonamen gespeichert.', 'success');
  };

  const onFieldKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      // Escape belongs to this field, not to whatever layer sits above the page.
      e.preventDefault();
      e.stopPropagation();
      cancel();
    }
  };

  // One account: the hero is that account, with its name, IBAN, balance and
  // the way to rename it. A list of one would only say it all again.
  if (accounts.length === 1) return null;

  const failureOf = (acct: string) => txErrors[acct] ?? balanceErrors[acct];
  const loadingNow = (acct: string) => loadingAccount === acct || balanceLoading === acct;

  /** Opens an account, and asks for whatever its figure still lacks. */
  const open = (a: SerializedAccount) => {
    if (busy) return;
    // Its Umsätze are loaded but brought no balance (a range that ends before
    // today): only the balance enquiry can still add it.
    const enquire = !balances[a.accountNumber] && a.canBalance && a.canStatements && isLoadedForAppliedRange(a.accountNumber);
    selectAccount(a);
    if (enquire) void loadBalance(a);
  };

  // ---- Gesamtsaldo ---------------------------------------------------------
  // A figure only once every account it is about is known: "Gesamtsaldo" is
  // the bank's word for all of them, and a sum of some is another number.
  // Euros only, never an account that cannot report (lib/balances.ts) — and
  // what is left out is named.
  const total = totalBalance(accounts, balances);
  const names = (list: SerializedAccount[]) => namesList(list.map(accountLabel));
  // An account being fetched right now is neither: its row shows the fetch.
  const failed = total.missing.filter((a) => !loadingNow(a.accountNumber) && failureOf(a.accountNumber));
  const notYet = total.missing.filter((a) => !loadingNow(a.accountNumber) && !failureOf(a.accountNumber));
  const excluded = namesList(total.excluded.map(({ account, reason, currency }) => (
    reason === 'currency' ? `${accountLabel(account)} (${currency})` : accountLabel(account)
  )));
  const totalFacts: ReactNode[] = [
    failed.length > 0 && `Abruf fehlgeschlagen: ${names(failed)}`,
    notYet.length > 0 && `Noch nicht abgerufen: ${names(notYet)}`,
    excluded && (
      <span title="Konten, für die deine Bank keinen Saldo meldet, und Konten in anderer Währung zählen nicht mit.">
        ohne {excluded}
      </span>
    ),
  ];

  const busyTitle = busy
    ? wait.open ? 'Bitte warten – eine Freigabe läuft' : 'Bitte warten – ein Abruf läuft'
    : undefined;

  return (
    <section className="panel min-w-0 overflow-clip" aria-labelledby={titleId}>
      <TileHeader
        title="Konten und Karten"
        titleId={titleId}
        actions={
          editing ? null : accounts.length > 0 ? (
            <Button
              ref={editButton}
              variant="tertiary"
              size="xs"
              iconLeft={<PencilIcon size={16} />}
              // The label's text, not the pill's padding, ends on the tile's
              // content edge — over the balances' right edge.
              className="-mr-2.5"
              onClick={startEditing}
              aria-describedby={noteOpen ? noteId : undefined}
              aria-label="Konten umbenennen"
            >
              {/* Renaming is all it does, and only on this machine — "anpassen"
                  sounded like a change at the bank. The short form keeps the
                  tile's title on one line on a phone. */}
              <span className="sm:hidden">Umbenennen</span>
              <span className="hidden sm:inline">Konten umbenennen</span>
            </Button>
          ) : null
        }
      />

      {noteOpen && !editing && (
        <div className="px-4 pb-3 sm:px-5">
          <Alert tone="info" role="status" className="mt-0" onDismiss={() => setNoteOpen(false)}>
            <span id={noteId}>{vaultNote(vaultStatus)}</span>
          </Alert>
        </div>
      )}

      {accounts.length === 0 ? (
        <EmptyState compact title="Keine Konten">
          Deine Bank hat für diesen Zugang keine Konten gemeldet.
        </EmptyState>
      ) : editing ? (
        <form onSubmit={save} noValidate aria-label="Konten umbenennen">
          <p className="px-4 pb-3 text-[13px] leading-snug text-ink-3 sm:px-5">
            Gib deinen Konten eigene Namen. Sie werden verschlüsselt auf diesem Rechner gespeichert, deine Bank
            erfährt davon nichts. Ein leeres Feld zeigt wieder den Namen deiner Bank.
          </p>
          <ul className="border-t border-line">
            {accounts.map((a, i) => {
              const draft = drafts[a.accountNumber] ?? '';
              const fieldId = `${titleId}-alias-${i}`;
              const custom = !!draft.trim();
              const ident = accountIdent(a).spoken;
              return (
                <li key={a.accountNumber} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0 sm:gap-4 sm:px-5">
                  <AccountGlyph account={a} className="hidden sm:grid" />
                  <div className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-6">
                    <label htmlFor={fieldId} className="sr-only">
                      Name für {bankName(a)}, {ident}
                    </label>
                    {/* A name is a short thing: the field is sized like one,
                        with the way back to the bank's name inside it. */}
                    <Input
                      ref={i === 0 ? firstInput : undefined}
                      id={fieldId}
                      value={draft}
                      maxLength={MAX_ALIAS}
                      placeholder={bankName(a)}
                      autoComplete="off"
                      spellCheck={false}
                      enterKeyHint="done"
                      containerClassName="w-full sm:max-w-[400px]"
                      onChange={(e) => setDrafts((d) => ({ ...d, [a.accountNumber]: e.target.value }))}
                      onKeyDown={onFieldKey}
                      // Always rendered (only hidden while there is nothing to
                      // reset): adding it on the first keystroke would wrap
                      // the input in a new element and drop the caret.
                      trailing={
                        <IconButton
                          aria-label={`Auf „${bankName(a)}“ zurücksetzen`}
                          disabled={!custom}
                          className={custom ? undefined : 'invisible'}
                          onClick={() => {
                            setDrafts((d) => ({ ...d, [a.accountNumber]: '' }));
                            document.getElementById(fieldId)?.focus();
                          }}
                        >
                          <UndoIcon size={17} />
                        </IconButton>
                      }
                    />
                    <span className="mt-1.5 block min-w-0 sm:mt-0">
                      <ShortIban account={a} />
                      {custom && (
                        <span className="block truncate text-[13px] leading-snug text-ink-3">Bei der Bank: {bankName(a)}</span>
                      )}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
          {/* After the fields, where Tab arrives — the primary action last. */}
          <div className="flex justify-end gap-2 border-t border-line px-4 py-3 sm:px-5">
            <Button variant="tertiary" size="sm" onClick={cancel}>Abbrechen</Button>
            <Button variant="primary" size="sm" type="submit">Speichern</Button>
          </div>
        </form>
      ) : (
        <>
          <ul
            ref={listRef}
            aria-label="Konten"
            className={cx(
              // Phones: a swipeable row of cards, snapping so a card is never
              // left half in view. From sm up: the classic column of rows.
              'flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto overscroll-x-contain px-4 pb-3',
              '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
              // The row of cards is as wide as all cards together; without
              // this, that width would leak up as the tile's minimum width
              // and push the whole page sideways inside a grid column.
              '[contain:inline-size]',
              'sm:block sm:overflow-visible sm:border-t sm:border-line sm:px-0 sm:pb-0',
            )}
          >
            {accounts.map((a) => {
              const acct = a.accountNumber;
              const bal = balances[acct];
              const active = activeAccount?.accountNumber === acct;
              const loading = loadingNow(acct);
              const failure = !bal && !loading && canReportBalance(a) ? failureOf(acct) : undefined;
              const label = accountLabel(a);
              const kind = translateType(a.accountType);
              // The selected account's Verfügbar is the hero's to say.
              const showAvailable = !active
                && bal?.availableAmount != null && Math.round(bal.availableAmount * 100) !== Math.round(bal.balance * 100);
              return (
                <li
                  key={acct}
                  className="w-[80%] max-w-[300px] shrink-0 snap-start sm:w-auto sm:max-w-none sm:border-b sm:border-line sm:last:border-b-0"
                >
                  <button
                    type="button"
                    onClick={() => open(a)}
                    aria-current={active ? 'true' : undefined}
                    aria-disabled={busy || undefined}
                    // The bank's reason, for a pointer resting on a failed row;
                    // the hero states it once the row is opened.
                    title={busyTitle ?? failure?.message}
                    className={cx(
                      // On a phone each card is a well in the tile, never a
                      // framed card inside it (Lifted, Never Framed).
                      'row-focus group relative flex h-full w-full flex-col gap-3 rounded-[8px] p-3.5 text-left',
                      'transition-colors duration-150',
                      'sm:flex-row sm:items-center sm:gap-4 sm:rounded-none sm:px-5 sm:py-3.5',
                      busy ? 'cursor-progress' : 'cursor-pointer',
                      active
                        ? cx(
                          // Selected: the wash, edged in the action colour like
                          // a segmented control's thumb.
                          'bg-accent-soft shadow-[inset_0_0_0_1.5px_var(--accent)]',
                          'sm:bg-[color-mix(in_srgb,var(--accent)_6%,var(--surface))] sm:shadow-none',
                          // The selected row is named by a rail in the action
                          // colour — the same mark as the active tab above it.
                          'sm:before:absolute sm:before:inset-y-0 sm:before:left-0 sm:before:w-[3px] sm:before:bg-accent',
                        )
                        : 'bg-inset sm:bg-transparent sm:hover:bg-inset',
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-3 sm:flex-1 sm:gap-4">
                      <AccountGlyph account={a} selected={active} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] leading-snug font-semibold text-ink">
                          {label}
                          {label !== kind && <span className="sr-only">, {kind}</span>}
                        </span>
                        <ShortIban account={a} />
                      </span>
                    </span>

                    <span className="min-w-0 sm:shrink-0 sm:text-right">
                      {bal ? (
                        <>
                          <Money
                            value={bal.balance}
                            currency={bal.currency}
                            // A card's balance is negative by nature — ink, not the red of an overdraft.
                            tone={isCardAccount(a) ? 'plain' : 'auto'}
                            className="block text-[19px] leading-tight font-semibold sm:text-[15.5px] sm:leading-snug"
                          />
                          {showAvailable && (
                            <span className="block text-[13px] leading-snug text-ink-3">
                              Verfügbar{' '}
                              <Money value={bal.availableAmount} currency={bal.currency} tone="plain" />
                            </span>
                          )}
                        </>
                      ) : loading ? (
                        <span className="block py-1">
                          <Skeleton className="h-4 w-24 rounded-[4px] sm:ml-auto" />
                          <span className="sr-only">Saldo wird abgerufen</span>
                        </span>
                      ) : !canReportBalance(a) ? (
                        <span className="block text-[13px] leading-snug text-ink-3">Kein Abruf möglich</span>
                      ) : failure ? (
                        <>
                          <span className="block text-[14px] leading-snug font-semibold text-red">Abruf fehlgeschlagen</span>
                          <RowAction busy={busy}>Erneut versuchen</RowAction>
                          <span className="sr-only">. {MAY_NEED_TAN}.</span>
                        </>
                      ) : (
                        <>
                          <RowAction busy={busy} className="text-[14px]">Saldo abrufen</RowAction>
                          <span className="block text-[13px] leading-snug text-ink-3">{MAY_NEED_TAN}</span>
                        </>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {/* Where in the row of cards you are, so the third account is not
              a secret until swiped to. Phones only; the list itself tells a
              screen reader how many there are. */}
          <div aria-hidden className="flex justify-center gap-1.5 pb-3 sm:hidden">
            {accounts.map((a, i) => (
              <span
                key={a.accountNumber}
                className={cx('size-1.5 rounded-full transition-colors duration-150', i === inView ? 'bg-ink-2' : 'bg-line-strong')}
              />
            ))}
          </div>

          {/* A total of one account is that account again: the row is there
              once two or more accounts can be added up. */}
          {total.counted.length >= 2 && (
            <div ref={totalRef} tabIndex={-1} className="border-t border-line bg-inset px-4 py-3.5 outline-none sm:px-5">
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-[14px] font-semibold text-ink-2">Gesamtsaldo</span>
                {total.cents != null ? (
                  <Money value={total.cents / 100} tone="auto" className="text-[17px] font-bold" />
                ) : (
                  <span className="text-[13px] text-ink-3">unvollständig</span>
                )}
              </div>
              {totalFacts.some(Boolean) && (
                <p className="mt-0.5 text-[13px] leading-snug text-ink-3">
                  <DotList items={totalFacts} />
                </p>
              )}
              {total.cents == null && (
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                  <Button
                    variant="tertiary"
                    size="sm"
                    // The label, not the pill's padding, starts on the text edge above.
                    className="-ml-4"
                    iconLeft={<RefreshIcon size={16} />}
                    busy={loadingAllBalances}
                    disabled={busy}
                    title={busyTitle}
                    onClick={() => {
                      // The button gives way to the result: focus waits on the
                      // Gesamtsaldo for it, not on <body>.
                      totalRef.current?.focus({ preventScroll: true });
                      loadAllBalances();
                    }}
                  >
                    Alle Salden abrufen
                  </Button>
                  <span className="text-[13px] leading-snug text-ink-3">{MAY_NEED_TAN}.</span>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

/**
 * What pressing a row will do, in the action colour — or in quiet ink while
 * another read runs, when the row cannot be pressed (and so is not blue).
 */
function RowAction({ busy, className, children }: { busy: boolean; className?: string; children: ReactNode }) {
  return (
    <span
      className={cx(
        'block leading-snug font-semibold',
        className ?? 'text-[13px]',
        busy ? 'text-ink-3' : 'text-accent group-hover:underline',
      )}
    >
      {children}
    </span>
  );
}

/**
 * Which card of the phone's row is in view: the one whose start is nearest
 * the scroll position (the row snaps to card starts), or the last once the row
 * is scrolled to its end. Only the phone row scrolls; from sm up it stays 0.
 */
function useCardInView(list: RefObject<HTMLUListElement | null>, count: number, mounted: boolean): number {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const el = list.current;
    if (!el || !mounted) return;
    const measure = () => {
      const items = Array.from(el.children) as HTMLElement[];
      if (!items.length) return;
      const start = el.getBoundingClientRect().left;
      const pad = parseFloat(getComputedStyle(el).scrollPaddingLeft) || 0;
      let best = 0;
      let distance = Infinity;
      items.forEach((item, i) => {
        const d = Math.abs(item.getBoundingClientRect().left - start - pad);
        if (d < distance) { distance = d; best = i; }
      });
      if (el.scrollLeft > 0 && el.scrollLeft >= el.scrollWidth - el.clientWidth - 2) best = items.length - 1;
      setIndex(best);
    };
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(el);
    return () => {
      el.removeEventListener('scroll', measure);
      ro?.disconnect();
    };
  }, [list, count, mounted]);
  return index;
}
