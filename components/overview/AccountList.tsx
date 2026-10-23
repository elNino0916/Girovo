'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent, ReactNode, RefObject } from 'react';
import { canReportBalance, isCardAccount, isDepot, namesList } from '@/lib/balances';
import { translateType } from '@/lib/format';
import type { SerializedAccount } from '@/lib/fints-types';
import { useT } from '@/lib/i18n/react';
import { combinedTotal, groupByLogin } from '@/lib/linked-banks';
import { BankLogo } from '../BankLogo';
import { bankAllowed } from '@/lib/plus';
import { useFints, type BankEntry } from '../FintsProvider';
import { Money } from '../Money';
import { PlusButton } from '../android/PlusTeaser';
import { PencilIcon, PlusIcon, RefreshIcon, UndoIcon } from '../icons';
import { Alert, Button, DotList, EmptyState, IconButton, Input, Skeleton, TileHeader, cx } from '../ui';
import { AccountGlyph, MAX_ALIAS, ShortIban, accountIdent, aliasFromDraft, bankName, vaultNote } from './AccountIdentity';

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
 * A row says what its figure is waiting for: "Saldo abrufen", "Abruf
 * fehlgeschlagen" with the way to try again, or "Kein Saldo abrufbar" for an
 * account the bank reports no balance for over FinTS. That a read can need an
 * approval is said once for the tile: beside "Alle Salden abrufen" when that
 * is offered, else under the first row that offers a read. The selected
 * Depot leaves its read to the hero, which offers it, shows it under way and
 * reports how it went.
 *
 * With more than one bank in the view (lib/linked-banks.ts) the rows are
 * grouped under each bank's band — the primary login first — and the
 * Gesamtsaldo is over all of them. A linked bank logged out during the
 * session keeps its rows as they were last read, with "Erneut anmelden"; one
 * remembered from an earlier session but not logged in now offers "Auch bei
 * … anmelden", and keeps the Gesamtsaldo open until it is.
 */
export function AccountList() {
  const {
    accounts, activeAccount, balances, loadingAccount, balanceLoading, busy, wait, selectAccount, loadBalance,
    portfolios, portfolioLoading,
    loadAllBalances, loadingAllBalances, isLoadedForAppliedRange, txErrors, balanceErrors,
    accountLabel, renameAccount, vault, vaultStatus, toast,
    banks, links, bankOf, logoFiles, openAddBank,
  } = useFints();
  const t = useT();
  const words = t.insights.accounts;

  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [noteOpen, setNoteOpen] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const firstInput = useRef<HTMLInputElement>(null);
  const totalRef = useRef<HTMLDivElement>(null);
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
      // Typing the bank's own name back in is the same as having no alias.
      const next = aliasFromDraft(a, drafts[a.accountNumber] ?? '');
      if ((aliases[a.accountNumber] ?? null) === next) continue;
      renameAccount(a.accountNumber, next);
      changed++;
    }
    setEditing(false);
    if (changed) toast(words.namesSaved(changed), 'success');
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
  // the way to rename it. A list of one would only say it all again — unless
  // another bank is in the view.
  if (accounts.length === 1 && banks.length <= 1) return null;
  const grouped = banks.length > 1;

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
  // what is left out is named. Over every bank in the view: a linked bank not
  // logged in keeps it open too (lib/linked-banks.ts).
  const absent = banks.filter((b) => b.state === 'remembered').map((b) => b.bank.name);
  const total = combinedTotal(accounts, balances, absent);
  const names = (list: SerializedAccount[]) => namesList(list.map(accountLabel));
  // A logged-out bank's accounts are its own fact: nothing can fetch them now.
  const gone = (a: SerializedAccount) => bankOf(a)?.state === 'loggedOut';
  const loggedOut = total.missing.filter(gone);
  // An account being fetched right now is neither: its row shows the fetch.
  const failed = total.missing.filter((a) => !gone(a) && !loadingNow(a.accountNumber) && failureOf(a.accountNumber));
  const notYet = total.missing.filter((a) => !gone(a) && !loadingNow(a.accountNumber) && !failureOf(a.accountNumber));
  const excluded = namesList(total.excluded.map(({ account, reason, currency }) => (
    reason === 'currency' ? `${accountLabel(account)} (${currency})` : accountLabel(account)
  )));
  const totalFacts: ReactNode[] = [
    failed.length > 0 && `${t.common.fetchFailed}: ${names(failed)}`,
    notYet.length > 0 && words.notYet(names(notYet)),
    loggedOut.length > 0 && `${t.banks.state.loggedOut}: ${names(loggedOut)}`,
    absent.length > 0 && t.banks.notLoggedIn(namesList(absent)),
    excluded && (
      <span title={words.excludedHint}>
        {t.insights.without(excluded)}
      </span>
    ),
  ];
  // What "Alle Salden abrufen" can still fetch: not a logged-out bank's.
  const fetchable = total.missing.filter((a) => !gone(a));

  // One group per bank, the primary login first; a single bank is one group without a band.
  const groups: Array<{ entry: BankEntry | null; accounts: SerializedAccount[] }> = grouped
    ? groupByLogin(accounts, links).map((g) => ({
        entry: banks.find((b) => b.key === (g.id ?? 'primary')) ?? null,
        accounts: g.accounts,
      }))
    : [{ entry: null, accounts }];
  // The banks that are not logged in: one row each, with the way in — a bank
  // remembered from an earlier session, and (on a phone, where its accounts'
  // cards carry no button) one whose session ended during this one.
  const outside = banks.filter((b) => b.state === 'remembered' || b.state === 'loggedOut');

  // A phone shows the cards only when there is something to switch between:
  // with one account the hero below is that account, and only the banks
  // outside are left to say. The Gesamtsaldo heads the cards once it is a
  // figure; until then the cards and the rows say what it waits for.
  const strip = accounts.length >= 2;
  const phoneTotal = total.cents != null && total.counted.length >= 2;

  const busyTitle = busy
    ? wait.open ? words.busyApproval : words.busyFetch
    : undefined;

  // The approval note, once for the tile: beside "Alle Salden abrufen" when
  // the total row offers it, else under the first row that offers a read.
  const footerNote = total.counted.length + total.absent.length >= 2 && fetchable.length > 0;
  const offersRead = (a: SerializedAccount) => {
    const acct = a.accountNumber;
    if (isDepot(a)) {
      return activeAccount?.accountNumber !== acct && portfolios[acct]?.totalValue == null && portfolioLoading !== acct;
    }
    return !balances[acct] && !loadingNow(acct) && !gone(a) && canReportBalance(a);
  };
  const noteRow = footerNote ? null : groups.flatMap((g) => g.accounts).find(offersRead)?.accountNumber ?? null;

  // One account's card (a phone) or row (from sm up).
  const card = (a: SerializedAccount) => {
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
    const note = noteRow === acct;
    return (
      <li
        key={acct}
        data-card
        className="w-[min(80vw,300px)] shrink-0 snap-start sm:w-auto rows:w-auto"
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
            'sm:flex-row rows:flex-row sm:items-center rows:items-center sm:gap-4 rows:gap-4 sm:rounded-[16px] rows:rounded-[16px] sm:px-3 rows:px-3 sm:py-3 rows:py-3',
            busy ? 'cursor-progress' : 'cursor-pointer',
            active
              // Selected: the wash, edged in the action colour like a
              // segmented control's thumb; from sm up Material's
              // selected list item, filled and round.
              ? 'bg-accent-soft shadow-[inset_0_0_0_1.5px_var(--accent)] sm:shadow-none rows:shadow-none'
              // At rest: a well on a phone; a row whose state layer shows on hover from sm up.
              : 'bg-inset sm:bg-transparent rows:bg-transparent sm:hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)] rows:hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)]',
          )}
        >
          <span className="flex min-w-0 items-center gap-3 sm:flex-1 rows:flex-1 sm:gap-4 rows:gap-4">
            <AccountGlyph account={a} selected={active} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] leading-snug font-semibold text-ink">
                {label}
                {label !== kind && <span className="sr-only">, {kind}</span>}
              </span>
              <ShortIban account={a} />
            </span>
          </span>

          <span className="min-w-0 sm:shrink-0 rows:shrink-0 sm:text-right rows:text-right">
            {isDepot(a) ? (
              // A Depot: its value as the last read of its holdings states it.
              portfolios[acct]?.totalValue != null ? (
                <>
                  <Money
                    value={portfolios[acct].totalValue}
                    currency={portfolios[acct].currency}
                    tone="plain"
                    className="block text-[20px] leading-tight font-semibold sm:text-[15px] rows:text-[15px] sm:leading-snug rows:leading-snug"
                  />
                  <span className="block text-[13px] leading-snug text-ink-3">{t.depot.total}</span>
                </>
              ) : active ? (
                // The selected Depot's read is the hero's, like its Verfügbar is.
                null
              ) : portfolioLoading === acct ? (
                <span className="block py-1">
                  <Skeleton className="h-4 w-24 rounded-[4px] sm:ml-auto rows:ml-auto" />
                  <span className="sr-only">{t.depot.loading}</span>
                </span>
              ) : (
                <>
                  <RowAction busy={busy} className="text-[14px]">{t.depot.read}</RowAction>
                  {note && <span className="block text-[13px] leading-snug text-ink-3">{t.common.mayNeedApproval}</span>}
                </>
              )
            ) : bal ? (
              <>
                <Money
                  value={bal.balance}
                  currency={bal.currency}
                  // A card's balance is negative by nature — ink, not the red of an overdraft.
                  tone={isCardAccount(a) ? 'plain' : 'auto'}
                  className="block text-[20px] leading-tight font-semibold sm:text-[15px] rows:text-[15px] sm:leading-snug rows:leading-snug"
                />
                {showAvailable && (
                  <span className="block text-[13px] leading-snug text-ink-3">
                    {t.insights.available}{' '}
                    <Money value={bal.availableAmount} currency={bal.currency} tone="plain" />
                  </span>
                )}
              </>
            ) : loading ? (
              <span className="block py-1">
                <Skeleton className="h-4 w-24 rounded-[4px] sm:ml-auto rows:ml-auto" />
                <span className="sr-only">{words.fetching}</span>
              </span>
            ) : gone(a) ? (
              // Its bank's band says so, with the way back in.
              <span className="block text-[13px] leading-snug text-ink-3">{t.banks.state.loggedOut}</span>
            ) : !canReportBalance(a) ? (
              <span className="block text-[13px] leading-snug text-ink-3">{t.insights.hero.noBalance}</span>
            ) : failure ? (
              <>
                <span className="block text-[14px] leading-snug font-semibold text-red">{t.common.fetchFailed}</span>
                <RowAction busy={busy}>{t.common.retry}</RowAction>
                {note && <span className="sr-only">. {t.common.mayNeedApproval}</span>}
              </>
            ) : (
              <>
                <RowAction busy={busy} className="text-[14px]">{t.insights.loadBalance}</RowAction>
                {note && <span className="block text-[13px] leading-snug text-ink-3">{t.common.mayNeedApproval}</span>}
              </>
            )}
          </span>
        </button>
      </li>
    );
  };

  const loadAll = (
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
      {words.loadAll}
    </Button>
  );

  return (
    <section
      className={cx(
        'panel min-w-0 overflow-clip',
        // A phone with one account and every bank logged in has nothing here the hero does not say.
        !strip && outside.length === 0 && 'narrow:hidden',
      )}
      aria-labelledby={titleId}
    >
      <TileHeader
        title={words.title}
        titleId={titleId}
        // On a phone the title heads the cards: without them, the rows of the banks outside stand alone.
        className={cx('px-4 pt-4 pb-3 sm:px-5 rows:px-5 sm:pt-5 rows:pt-5', !strip && 'narrow:hidden')}
        actions={
          editing ? null : accounts.length > 0 ? (
            <>
              {/* A phone: the Gesamtsaldo, once it is a figure. */}
              {phoneTotal && (
                <span className="mt-1 mr-1 text-right sm:hidden rows:hidden">
                  <span className="block text-[12px] leading-4 text-ink-2">{words.total}</span>
                  <Money value={total.cents! / 100} tone="auto" className="block text-[15px] leading-snug font-semibold" />
                  {excluded && <span className="block text-[12px] leading-4 text-ink-2">{t.insights.without(excluded)}</span>}
                </span>
              )}
              {/* Renaming the accounts at once, from sm up; on a phone each is renamed on its balance. */}
              <Button
                ref={editButton}
                variant="tertiary"
                size="xs"
                iconLeft={<PencilIcon size={16} />}
                // The label's text, not the pill's padding, ends on the tile's
                // content edge — over the balances' right edge.
                className="-mr-2.5 narrow:hidden"
                onClick={startEditing}
                aria-describedby={noteOpen ? noteId : undefined}
                aria-label={words.renameAll}
              >
                {words.renameAll}
              </Button>
            </>
          ) : null
        }
      />

      {noteOpen && !editing && (
        <div className="px-4 pb-3 sm:px-5 rows:px-5">
          <Alert tone="info" role="status" className="mt-0" onDismiss={() => setNoteOpen(false)}>
            <span id={noteId}>{vaultNote(vaultStatus)}</span>
          </Alert>
        </div>
      )}

      {accounts.length === 0 ? (
        <EmptyState compact title={words.none}>
          {words.noneHint}
        </EmptyState>
      ) : editing ? (
        <form onSubmit={save} noValidate aria-label={words.renameAll}>
          <p className="px-4 pb-3 text-[13px] leading-snug text-ink-3 sm:px-5 rows:px-5">
            {words.renameHint}
          </p>
          <ul className="border-t border-line">
            {accounts.map((a, i) => {
              const draft = drafts[a.accountNumber] ?? '';
              const fieldId = `${titleId}-alias-${i}`;
              const custom = !!draft.trim();
              const ident = accountIdent(a).spoken;
              return (
                <li key={a.accountNumber} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0 sm:gap-4 rows:gap-4 sm:px-5 rows:px-5">
                  <AccountGlyph account={a} className="hidden sm:grid rows:grid" />
                  <div className="min-w-0 flex-1 sm:flex rows:flex sm:items-center rows:items-center sm:gap-6 rows:gap-6">
                    <label htmlFor={fieldId} className="sr-only">
                      {words.nameFor(bankName(a), ident)}
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
                      containerClassName="w-full sm:max-w-[400px] rows:max-w-[400px]"
                      onChange={(e) => setDrafts((d) => ({ ...d, [a.accountNumber]: e.target.value }))}
                      onKeyDown={onFieldKey}
                      // Always rendered (only hidden while there is nothing to
                      // reset): adding it on the first keystroke would wrap
                      // the input in a new element and drop the caret.
                      trailing={
                        <IconButton
                          aria-label={t.insights.resetTo(bankName(a))}
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
                    <span className="mt-1.5 block min-w-0 sm:mt-0 rows:mt-0">
                      <ShortIban account={a} />
                      {custom && (
                        <span className="block truncate text-[13px] leading-snug text-ink-3">{words.atBank(bankName(a))}</span>
                      )}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
          {/* After the fields, where Tab arrives — the primary action last. */}
          <div className="flex justify-end gap-2 border-t border-line px-4 py-3 sm:px-5 rows:px-5">
            <Button variant="tertiary" size="sm" onClick={cancel}>{t.common.cancel}</Button>
            <Button variant="primary" size="sm" type="submit">{t.common.save}</Button>
          </div>
        </form>
      ) : (
        <>
          {/* The accounts, bank by bank: from sm up a column of rows under each
              bank's band; on a phone one row of cards to swipe through, each
              bank's name over its own — and no card at all with one account,
              which the hero below is. */}
          <AccountStrip count={accounts.length} className={cx(!strip && 'narrow:hidden')}>
            {groups.map(({ entry, accounts: list }) => (
              <div key={entry?.key ?? 'all'} className="flex shrink-0 flex-col gap-2 sm:block rows:block">
                {entry && (
                  <>
                    <BankBand
                      entry={entry}
                      logoFile={logoFiles[entry.bank.brand]}
                      onLogin={() => openAddBank({ bank: entry.bank, userId: entry.ref?.userId })}
                      className="narrow:hidden"
                    />
                    <StripLabel entry={entry} logoFile={logoFiles[entry.bank.brand]} className="sm:hidden rows:hidden" />
                  </>
                )}
                <ul
                  aria-label={entry ? t.banks.accountsAt(entry.bank.name) : t.common.account.accounts}
                  className={cx('flex gap-3 sm:flex-col rows:flex-col sm:gap-0.5 rows:gap-0.5 sm:px-2 rows:px-2 sm:pb-1 rows:pb-1', grouped && 'sm:pt-1 rows:pt-1')}
                >
                  {list.map(card)}
                </ul>
              </div>
            ))}
          </AccountStrip>

          {/* A phone: what "Alle Salden abrufen" can still fetch, under the cards. */}
          {strip && footerNote && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-4 pb-2 sm:hidden rows:hidden">
              {loadAll}
              <span className="text-[13px] leading-snug text-ink-3">{t.common.mayNeedApproval}</span>
            </div>
          )}

          {/* The banks that are not logged in, each one row with the way in.
              From sm up a bank logged out during the session keeps that on
              its band, over its rows. */}
          {outside.map((entry) => (
            <LoginRow
              key={entry.key}
              entry={entry}
              logoFile={logoFiles[entry.bank.brand]}
              onLogin={() => openAddBank({ bank: entry.bank, userId: entry.ref?.userId })}
              className={entry.state === 'loggedOut' ? 'sm:hidden rows:hidden' : undefined}
            />
          ))}

          {/* A total of one account is that account again: the row is there
              once two or more accounts can be added up — or one beside a
              bank that is not logged in. A phone says it in the title row,
              and only as a figure. */}
          {total.counted.length + total.absent.length >= 2 && (
            <div ref={totalRef} tabIndex={-1} className="px-4 py-3.5 outline-none narrow:hidden sm:px-5 rows:px-5">
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-[14px] font-semibold text-ink-2">{words.total}</span>
                {total.cents != null ? (
                  <Money value={total.cents / 100} tone="auto" className="text-[17px] font-bold" />
                ) : (
                  <span className="text-[13px] text-ink-3">{words.incomplete}</span>
                )}
              </div>
              {totalFacts.some(Boolean) && (
                <p className="mt-0.5 text-[13px] leading-snug text-ink-3">
                  <DotList items={totalFacts} />
                </p>
              )}
              {footerNote && (
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                  {loadAll}
                  <span className="text-[13px] leading-snug text-ink-3">{t.common.mayNeedApproval}</span>
                </div>
              )}
            </div>
          )}

          {/* Once the view holds more than one bank, the way to one more is
              here too from sm up (otherwise, and on a phone, in the Sitzung
              panel). */}
          {grouped && (
            <div className="border-t border-line px-4 py-2 narrow:hidden sm:px-5 rows:px-5">
              <Button variant="tertiary" size="sm" className="-ml-4" iconLeft={<PlusIcon size={16} />} onClick={() => openAddBank()}>
                {t.banks.add}
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/**
 * The accounts' frame: from sm up the classic column of rows, bank under
 * bank; on a phone one swipeable, snapping row of cards across every bank,
 * the next one peeking in from the edge, with dots for where in the row you
 * are.
 */
function AccountStrip({ count, className, children }: { count: number; className?: string; children: ReactNode }) {
  const stripRef = useRef<HTMLDivElement>(null);
  const inView = useCardInView(stripRef, count);
  return (
    <div className={className}>
      <div
        ref={stripRef}
        className={cx(
          // Phones: a swipeable row of cards, snapping so a card is never
          // left half in view; a bank's cards stand a little apart from the next's.
          'flex snap-x snap-mandatory scroll-px-4 gap-5 overflow-x-auto overscroll-x-contain px-4 pb-3',
          '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          // The row of cards is as wide as all cards together; without
          // this, that width would leak up as the tile's minimum width
          // and push the whole page sideways inside a grid column.
          '[contain:inline-size]',
          'sm:block rows:block sm:overflow-visible rows:overflow-visible sm:p-0 rows:p-0',
        )}
      >
        {children}
      </div>

      {/* Where in the row of cards you are, so the third account is not
          a secret until swiped to. Phones only; the lists themselves tell
          a screen reader how many there are. */}
      {count > 1 && (
        <div aria-hidden className="flex justify-center gap-1.5 pb-3 sm:hidden rows:hidden">
          {Array.from({ length: count }, (_, i) => (
            <span
              key={i}
              className={cx('size-1.5 rounded-full transition-colors duration-150', i === inView ? 'bg-ink-2' : 'bg-line-strong')}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A bank's band over its rows from sm up, once more than one bank is in the
 * view: its mark and name the way the institute bar shows them, and — for
 * one whose session ended during this one — where it stands, with the way
 * back in.
 */
function BankBand({ entry, logoFile, onLogin, className }: {
  entry: BankEntry; logoFile?: string; onLogin: () => void; className?: string;
}) {
  const t = useT();
  return (
    <div className={cx('flex min-h-11 items-center gap-2.5 px-4 pt-3 pb-1 sm:px-5 rows:px-5', className)}>
      {/* One column for every bank's mark, so the names line up band under band. */}
      <span className="grid w-[52px] shrink-0 place-items-center [&>span]:max-w-full">
        <BankLogo brand={entry.bank.brand} size="sm" file={logoFile} />
      </span>
      <h3 className="min-w-0 flex-1 truncate text-[13.5px] leading-snug font-semibold text-ink-2" title={entry.bank.name}>
        {entry.bank.name}
      </h3>
      {entry.state === 'loggedOut' && (
        <>
          <span className="shrink-0 text-[13px] leading-snug text-ink-3">{t.banks.state.loggedOut}</span>
          <Button variant="tertiary" size="xs" className="-mr-2.5 shrink-0" onClick={onLogin}>{t.banks.loginAgain}</Button>
        </>
      )}
    </div>
  );
}

/**
 * A phone's name for a bank's cards, over the first of them in the row: so
 * the row can hold every bank's accounts without a band between them. It
 * takes no width of its own — the cards decide how wide the bank's part is.
 */
function StripLabel({ entry, logoFile, className }: { entry: BankEntry; logoFile?: string; className?: string }) {
  const t = useT();
  return (
    <h3 className={cx('flex w-0 min-w-full items-center gap-2 text-[13px] leading-snug font-semibold text-ink-2', className)}>
      <BankLogo brand={entry.bank.brand} size="sm" file={logoFile} />
      <span className="min-w-0 truncate">
        {entry.bank.name}
        {entry.state === 'loggedOut' && <span className="font-normal"> · {t.banks.state.loggedOut}</span>}
      </span>
    </h3>
  );
}

/**
 * A bank of the view that is not logged in: its mark, its name, where it
 * stands, and the one way in — to its login form, the login name filled in;
 * the PIN and the approval are still the user's. Said once, here.
 */
function LoginRow({ entry, logoFile, onLogin, className }: {
  entry: BankEntry; logoFile?: string; onLogin: () => void; className?: string;
}) {
  const t = useT();
  const { plus } = useFints();
  // Every bank beside the one the app opens with needs Girovo Plus in the Play build.
  const locked = !bankAllowed(plus.state, false);
  const again = entry.state === 'loggedOut';
  return (
    <div className={cx('flex min-h-14 items-center gap-2.5 px-4 py-2 sm:px-5 rows:px-5', className)}>
      <span className="grid w-[52px] shrink-0 place-items-center [&>span]:max-w-full">
        <BankLogo brand={entry.bank.brand} size="sm" file={logoFile} />
      </span>
      <span className="min-w-0 flex-1">
        <h3 className="truncate text-[14px] leading-snug font-semibold text-ink" title={entry.bank.name}>{entry.bank.name}</h3>
        <span className="block text-[13px] leading-snug text-ink-3">
          {locked ? t.plus.bankLocked : again ? t.banks.state.loggedOut : t.banks.state.remembered}
        </span>
      </span>
      {locked ? (
        <PlusButton size="xs" className="shrink-0" label={t.plus.bankUnlock} aria-label={`${t.plus.name}: ${entry.bank.name}`} onClick={onLogin} />
      ) : (
        <Button
          variant="secondary"
          size="xs"
          className="shrink-0"
          aria-label={again ? undefined : t.banks.alsoLogin(entry.bank.name)}
          onClick={onLogin}
        >
          {again ? t.banks.loginAgain : t.banks.login}
        </Button>
      )}
    </div>
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
function useCardInView(strip: RefObject<HTMLDivElement | null>, count: number): number {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    const measure = () => {
      const items = Array.from(el.querySelectorAll<HTMLElement>('[data-card]'));
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
  }, [strip, count]);
  return index;
}
