'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { translateType } from '@/lib/format';
import type { SerializedAccount } from '@/lib/fints-types';
import type { VaultStatus } from '@/lib/app-types';
import { useFints } from '../FintsProvider';
import { Money } from '../Money';
import { PencilIcon, UndoIcon } from '../icons';
import { Alert, Button, EmptyState, IconButton, Input, Skeleton, TileHeader, cx } from '../ui';
import { AccountGlyph, ShortIban, accountIdent } from './AccountIdentity';

/** The provider clips an alias to this too (MAX_ALIAS); the field says so up front. */
const MAX_ALIAS = 60;

/** What the bank itself calls the account — the name an empty alias falls back to. */
const bankName = (a: SerializedAccount) => a.product?.trim() || translateType(a.accountType);

/**
 * Why renaming is not possible right now. Aliases live in the encrypted vault,
 * so a name typed while it is unreadable would quietly vanish at the next
 * login — better to say so than to accept the edit.
 */
function vaultNote(status: VaultStatus): string {
  switch (status) {
    case 'idle':
    case 'loading':
      return 'Deine persönlichen Einstellungen werden noch geladen. Gleich kannst du deine Konten umbenennen.';
    case 'error':
      return 'Deine gespeicherten persönlichen Einstellungen ließen sich nicht entschlüsseln – meist, weil sich deine PIN geändert hat. Bis sie zurückgesetzt sind, kann ein neuer Kontoname nicht gespeichert werden.';
    default:
      return 'Kontonamen werden verschlüsselt auf diesem Rechner gespeichert. Das ist in dieser Sitzung nicht möglich.';
  }
}

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
 */
export function AccountList() {
  const {
    accounts, activeAccount, balances, loadingAccount, busy, wait, selectAccount,
    accountLabel, renameAccount, vault, vaultStatus, toast,
  } = useFints();

  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [noteOpen, setNoteOpen] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const firstInput = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const noteId = useId();

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
      const clean = (drafts[a.accountNumber] ?? '').replace(/\s+/g, ' ').trim();
      // Typing the bank's own name back in is the same as having no alias.
      const next = clean && clean !== bankName(a) ? clean : null;
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

  // ---- Gesamtsaldo ---------------------------------------------------------
  // Only what is known and only in euros: a balance that was never fetched is
  // not zero, and currencies are never added together. Summed in cents so
  // four balances cannot drift by one.
  let totalCents = 0;
  let counted = 0;
  for (const a of accounts) {
    const b = balances[a.accountNumber];
    if (!b || (b.currency || 'EUR') !== 'EUR') continue;
    totalCents += Math.round(b.balance * 100);
    counted++;
  }
  const partial = counted < accounts.length;

  const busyTitle = busy
    ? wait.open ? 'Bitte warten – eine Freigabe läuft' : 'Bitte warten – ein Abruf läuft'
    : undefined;

  const single = accounts.length === 1;

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
              aria-label="Konten anpassen"
            >
              {/* The short form keeps the tile's title on one line on a phone. */}
              <span className="sm:hidden">Anpassen</span>
              <span className="hidden sm:inline">Konten anpassen</span>
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
        <form onSubmit={save} noValidate aria-label="Kontonamen anpassen">
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
            aria-label="Konten"
            className={cx(
              // Phones: a swipeable row of cards, snapping so a card is never
              // left half in view. From sm up: the classic column of rows.
              'flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto overscroll-x-contain px-4 pb-4',
              '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
              // The row of cards is as wide as all cards together; without
              // this, that width would leak up as the tile's minimum width
              // and push the whole page sideways inside a grid column.
              '[contain:inline-size]',
              'sm:block sm:overflow-visible sm:border-t sm:border-line sm:px-0 sm:pb-0',
            )}
          >
            {accounts.map((a) => {
              const bal = balances[a.accountNumber];
              const active = activeAccount?.accountNumber === a.accountNumber;
              const loading = loadingAccount === a.accountNumber;
              const label = accountLabel(a);
              const kind = translateType(a.accountType);
              const showAvailable =
                bal?.availableAmount != null && Math.round(bal.availableAmount * 100) !== Math.round(bal.balance * 100);
              return (
                <li
                  key={a.accountNumber}
                  className={cx(
                    'shrink-0 snap-start sm:w-auto sm:border-b sm:border-line sm:last:border-b-0',
                    single ? 'w-full' : 'w-[80%] max-w-[300px] sm:max-w-none',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => { if (!busy) selectAccount(a); }}
                    aria-current={active ? 'true' : undefined}
                    aria-disabled={busy || undefined}
                    title={busyTitle}
                    className={cx(
                      'row-focus group relative flex h-full w-full flex-col gap-3 rounded-[10px] border p-3.5 text-left',
                      'transition-colors duration-150',
                      'sm:flex-row sm:items-center sm:gap-4 sm:rounded-none sm:border-0 sm:px-5 sm:py-3.5',
                      busy ? 'cursor-progress' : 'cursor-pointer',
                      active
                        ? cx(
                          'border-accent bg-[color-mix(in_srgb,var(--accent)_6%,var(--surface))]',
                          // The selected row is named by a rail in the action
                          // colour — the same mark as the active tab above it.
                          'sm:before:absolute sm:before:inset-y-0 sm:before:left-0 sm:before:w-[3px] sm:before:bg-accent',
                        )
                        : 'border-line hover:bg-inset',
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
                            tone="auto"
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
                      ) : a.canStatements || a.canBalance ? (
                        <span
                          className={cx(
                            'block text-[14px] leading-snug font-semibold',
                            // Not pressable while another fetch runs, so not blue either.
                            busy ? 'text-ink-3' : 'text-accent group-hover:underline',
                          )}
                        >
                          Saldo abrufen
                        </span>
                      ) : (
                        <span className="block text-[13px] leading-snug text-ink-3">Kein Abruf möglich</span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {/* A total of one account is that account again, and a total of
              nothing known yet is not a figure — the row appears once there
              is something to add up. */}
          {accounts.length > 1 && counted > 0 && (
            <div className="flex items-baseline justify-between gap-4 border-t border-line bg-inset px-4 py-3.5 sm:px-5">
              <span className="min-w-0">
                <span className="text-[14px] font-semibold text-ink-2">Gesamtsaldo</span>
                {partial && (
                  <span
                    className="tnum block text-[13px] whitespace-nowrap text-ink-3 sm:ml-2 sm:inline"
                    title="Enthalten sind die Konten in Euro, deren Saldo in dieser Sitzung abgerufen wurde."
                  >
                    {counted} von {accounts.length} Konten
                  </span>
                )}
              </span>
              <Money value={totalCents / 100} tone="auto" className="text-[17px] font-bold" />
            </div>
          )}
        </>
      )}
    </section>
  );
}
