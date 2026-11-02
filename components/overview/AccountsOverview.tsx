'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import {
  GROUP_KINDS, groupAccounts, groupKindOf, groupSum, moveAccount, orderAccounts, overviewFigures,
  type AccountGroup, type AccountGroupKind, type AccountGrouping, type AccountValue,
} from '@/lib/account-overview';
import { canReportBalance, isCardAccount, isDepot, namesList } from '@/lib/balances';
import { COMPACT_LOGO } from '@/lib/brands';
import { dayKey, fmtIban, isoDate } from '@/lib/format';
import type { SerializedAccount, SerializedTransaction } from '@/lib/fints-types';
import { intlLocale, msgs } from '@/lib/i18n';
import { useT } from '@/lib/i18n/react';
import { bankAllowed } from '@/lib/plus';
import { BankChip, BankLogo } from '../BankLogo';
import { useFints, type BankEntry } from '../FintsProvider';
import { Money } from '../Money';
import { PlusButton } from '../android/PlusTeaser';
import { AccountTypeIcon, ChevronIcon, DragIcon, EyeIcon, EyeOffIcon, PlusIcon, RefreshIcon, SwapVertIcon } from '../icons';
import { fmtSince } from '../shell/session';
import { txText } from '../transactions/model';
import { Alert, Button, DotList, FilterChip, IconButton, Menu, MenuItemRadio, Overlay, Segmented, Sheet, Skeleton, cx } from '../ui';
import { accountIdent, vaultNote } from './AccountIdentity';

/**
 * The Übersicht's start once there is more than one account (issue #19):
 * every account of every bank in the view at a glance, the way a bank's
 * Kontenübersicht shows them — and, a press away, each account's own page
 * (AccountHero and its Umsätze, with the way back).
 *
 * Top to bottom, as the mock the owner answered the issue with
 * (.impeccable/mocks/issue-19): the Gesamtsaldo set flat like an account's
 * balance, with how many accounts at how many banks and how fresh it is;
 * Vermögen and Verbindlichkeiten once something is owed; the kinds as filter
 * chips; then the accounts under their groups (Girokonten, Sparen & Anlegen,
 * Karten & Kredite) with each group's sum, every row with its balance and
 * its last booking. "Konten anordnen" sets the order and the grouping
 * (ArrangeSheet below, kept in the vault). From 640px the rows are a table
 * — Konto · Letzter Umsatz · Kontostand — footed by the Gesamtsaldo.
 *
 * The figures follow the Gesamtsaldo's rules (lib/account-overview.ts): only
 * euros, only once every account they are about is known, and what is left
 * out is named. Nothing is read on its own: each read can cost an approval,
 * so a balance this session does not know says so, and "Alle Salden abrufen"
 * fetches the rest, Depots included. A row opens its account's page, where
 * a figure that failed says why.
 */
export function AccountsOverview() {
  const {
    accounts, balances, balanceAt, portfolios, portfolioLoading, portfolioErrors, txByAccount,
    banks, bankOf, logoFiles, accountLabel, privacy, togglePrivacy, busy, wait,
    loadAllBalances, loadingAllBalances, loadBalance, selectAccount, isLoadedForAppliedRange,
    txErrors, balanceErrors, loadingAccount, balanceLoading, vault, vaultStatus, openAddBank, arrangeAccounts,
  } = useFints();
  const t = useT();
  const words = t.insights.accounts;
  const titleId = useId();
  const noteId = useId();
  const figureRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState<AccountGroupKind | null>(null);
  const [arranging, setArranging] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);

  // The explanation answers a press on "Anordnen"; once the vault is readable it is moot.
  useEffect(() => {
    if (vaultStatus === 'ready') setNoteOpen(false);
  }, [vaultStatus]);

  // Back from an account's page: focus returns to its row, not to <body>.
  useEffect(() => {
    if (!lastOpened) return;
    document.querySelector<HTMLElement>(`[data-account-row="${CSS.escape(lastOpened)}"]`)?.focus({ preventScroll: false });
    lastOpened = null;
  }, []);

  const failureOf = (acct: string) => txErrors[acct] ?? balanceErrors[acct];
  const loadingNow = (a: SerializedAccount) => {
    const acct = a.accountNumber;
    return isDepot(a) ? portfolioLoading === acct : loadingAccount === acct || balanceLoading === acct;
  };
  // A logged-out bank's accounts are its own fact: nothing can fetch them now.
  const gone = (a: SerializedAccount) => bankOf(a)?.state === 'loggedOut';

  /** What the overview knows of an account's figure (lib/account-overview.ts AccountValue). */
  const valueOf = (a: SerializedAccount): AccountValue => {
    const acct = a.accountNumber;
    if (isDepot(a)) {
      const p = portfolios[acct];
      if (p?.totalValue != null) return { state: 'known', cents: Math.round(p.totalValue * 100), currency: p.currency || 'EUR' };
      // Read, but the bank stated no total: nothing to add, for good.
      return p ? { state: 'never' } : { state: 'unread' };
    }
    const b = balances[acct];
    if (b) return { state: 'known', cents: Math.round(b.balance * 100), currency: b.currency || a.currency || 'EUR' };
    return canReportBalance(a) ? { state: 'missing', currency: a.currency || 'EUR' } : { state: 'never' };
  };

  const absent = banks.filter((b) => b.state === 'remembered').map((b) => b.bank.name);
  const figures = overviewFigures(accounts, valueOf, absent.length);
  const grouping: AccountGrouping = vault?.accountGrouping ?? 'type';
  const ordered = orderAccounts(accounts, vault?.accountOrder);
  const kinds = GROUP_KINDS.filter((k) => accounts.some((a) => groupKindOf(a) === k));
  // A kind that left the view (a bank logged out and removed) is no filter any more.
  const shownFilter = filter && kinds.includes(filter) ? filter : null;
  const groups = groupAccounts(
    shownFilter ? ordered.filter((a) => groupKindOf(a) === shownFilter) : ordered,
    grouping,
    { kindOf: groupKindOf, bankOf: (a) => bankOf(a)?.key ?? 'primary', banks: banks.map((b) => b.key) },
  );
  // With accounts at more than one bank, each disc carries its bank's mark.
  const severalBanks = new Set(accounts.map((a) => bankOf(a)?.key ?? 'primary')).size > 1;

  // ---- what keeps the figures open, and what fetching can still do --------
  const names = (list: SerializedAccount[]) => namesList(list.map(accountLabel));
  const loggedOut = figures.missing.filter(gone);
  const failed = figures.missing.filter((a) => !gone(a) && !loadingNow(a) && failureOf(a.accountNumber));
  const notYet = figures.missing.filter((a) => !gone(a) && !loadingNow(a) && !failureOf(a.accountNumber));
  const unreadDepots = figures.excluded.filter((e) => e.reason === 'unread').map((e) => e.account);
  const excluded = namesList(figures.excluded.map(({ account, reason, currency }) => (
    reason === 'currency' ? `${accountLabel(account)} (${currency})` : accountLabel(account)
  )));
  const facts: ReactNode[] = [
    failed.length > 0 && `${t.common.fetchFailed}: ${names(failed)}`,
    notYet.length > 0 && words.notYet(names(notYet)),
    loggedOut.length > 0 && `${t.banks.state.loggedOut}: ${names(loggedOut)}`,
    absent.length > 0 && t.banks.notLoggedIn(namesList(absent)),
  ].filter(Boolean);
  // What "Alle Salden abrufen" can still fetch: not a logged-out bank's.
  const fetchable = [...figures.missing, ...unreadDepots].filter((a) => !gone(a));
  const busyTitle = busy ? (wait.open ? words.busyApproval : words.busyFetch) : undefined;
  const loadAll = () => {
    // The button gives way to the result: focus waits on the figure for it.
    figureRef.current?.focus({ preventScroll: true });
    loadAllBalances();
  };

  // "Stand": as fresh as the oldest figure the total is made of.
  const readTimes = figures.counted.map((a) => (isDepot(a)
    ? (portfolios[a.accountNumber] ? Date.parse(portfolios[a.accountNumber].readAt) : NaN)
    : balanceAt[a.accountNumber] ?? NaN)).filter(Number.isFinite);
  const stand = figures.total != null && readTimes.length ? t.transactions.pending.asOf(fmtSince(Math.min(...readTimes))) : null;
  const bankCount = new Set([...accounts.map((a) => bankOf(a)?.key ?? 'primary'), ...banks.filter((b) => b.state === 'remembered').map((b) => b.key)]).size;

  const openArrange = () => {
    if (vaultStatus !== 'ready') setNoteOpen(true);
    else setArranging(true);
  };

  /** Opens an account's page, and asks for whatever its figure still lacks. */
  const open = (a: SerializedAccount) => {
    if (busy) return;
    // Its Umsätze are loaded but brought no balance (a range that ends before
    // today): only the balance enquiry can still add it.
    const enquire = !balances[a.accountNumber] && a.canBalance && a.canStatements && isLoadedForAppliedRange(a.accountNumber);
    lastOpened = a.accountNumber;
    selectAccount(a);
    if (enquire) void loadBalance(a);
  };

  // The banks that are not logged in, one row each with the way in. Grouped
  // by bank, a bank logged out during the session says so on its band.
  const outside = banks.filter((b) => b.state === 'remembered' || (b.state === 'loggedOut' && grouping !== 'bank'));

  return (
    <section aria-labelledby={titleId} className="min-w-0">
      {/* Gesamtsaldo, with "Konten anordnen" and the eye at the row's end. */}
      <div className="-mr-2 flex min-h-12 items-center justify-between gap-2">
        <h2 id={titleId} className="text-[14px] leading-5 font-medium text-ink-2 sm:text-[16px] sm:leading-6">{words.total}</h2>
        <div className="flex shrink-0 items-center gap-1">
          <IconButton
            size="md"
            className="sm:hidden"
            aria-label={words.arrange}
            aria-haspopup="dialog"
            aria-describedby={noteOpen ? noteId : undefined}
            onClick={openArrange}
          >
            <SwapVertIcon size={24} />
          </IconButton>
          <Button
            variant="tertiary"
            size="sm"
            className="max-sm:hidden"
            iconLeft={<SwapVertIcon size={18} />}
            aria-haspopup="dialog"
            aria-describedby={noteOpen ? noteId : undefined}
            onClick={openArrange}
          >
            {words.arrangeShort}
          </Button>
          <IconButton
            size="md"
            aria-label={privacy ? t.common.showAmounts : t.common.hideAmounts}
            onClick={togglePrivacy}
            className={cx('rounded-full', privacy && 'bg-[color-mix(in_srgb,var(--ink)_12%,transparent)]')}
          >
            {privacy ? <EyeOffIcon /> : <EyeIcon />}
          </IconButton>
        </div>
      </div>

      {noteOpen && (
        <Alert tone="info" role="status" className="mt-1 mb-3" onDismiss={() => setNoteOpen(false)}>
          <span id={noteId}>{vaultNote(vaultStatus)}</span>
        </Alert>
      )}

      <div className="sm:flex sm:items-end sm:justify-between sm:gap-6">
        <div ref={figureRef} tabIndex={-1} aria-busy={loadingAllBalances || undefined} className="min-w-0 outline-none">
          {figures.total != null ? (
            <p data-balance className={cx('leading-none', (privacy || figures.total >= 0) && 'text-headline')}>
              <Money
                value={figures.total / 100}
                tone="auto"
                split
                className="text-[48px] leading-[56px] font-medium"
                centsClassName="text-[0.58em]"
              />
            </p>
          ) : loadingAllBalances ? (
            <>
              <Skeleton className="mt-1 h-12 w-56 max-w-full rounded-[6px]" />
              <p className="mt-2 text-[14px] leading-5 text-ink-2">{t.insights.hero.fetchingDots}</p>
            </>
          ) : (
            // No partial sum: what is missing, and the read that completes it.
            <div className="mt-1">
              <p className="text-[22px] leading-7 font-medium text-ink">{words.pending}</p>
              {facts.length > 0 && (
                <p className="mt-1 max-w-[60ch] text-[14px] leading-5 text-ink-2"><DotList items={facts} /></p>
              )}
              {fetchable.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <Button size="sm" variant="secondary" iconLeft={<RefreshIcon size={16} />} disabled={busy} title={busyTitle} onClick={loadAll}>
                    {words.loadAll}
                  </Button>
                  <span className="text-[14px] leading-5 text-ink-2">{t.common.mayNeedApproval}</span>
                </div>
              )}
            </div>
          )}
          <p className="tnum mt-1 text-[14px] leading-5 text-ink-2">
            {words.count(accounts.length, bankCount)}
            {stand && ` · ${stand}`}
          </p>
          {figures.total != null && excluded && (
            <p className="text-[14px] leading-5 text-ink-2" title={words.excludedHint}>{t.insights.without(excluded)}</p>
          )}
        </div>

        {/* Vermögen and Verbindlichkeiten — once something is owed; otherwise the first is the Gesamtsaldo again. */}
        {figures.total != null && figures.liabilities != null && figures.liabilities < 0 && (
          <dl className="mt-4 flex gap-10 sm:mt-0 sm:mb-1 sm:shrink-0 sm:gap-12">
            <div>
              <dt className="text-[14px] leading-5 text-ink-2">{words.assets}</dt>
              <dd><Money value={(figures.assets ?? 0) / 100} tone="plain" className="text-[16px] leading-6 font-medium text-ink" /></dd>
            </div>
            <div>
              <dt className="text-[14px] leading-5 text-ink-2">{words.liabilities}</dt>
              <dd><Money value={figures.liabilities / 100} tone="plain" className="text-[16px] leading-6 font-medium text-ink" /></dd>
            </div>
          </dl>
        )}
      </div>

      {/* The kinds as filters; from 640px the grouping and "Alle Salden abrufen" at the row's end. */}
      <div className="-mx-4 mt-5 flex items-center gap-2 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:mt-6 sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden">
        {kinds.length > 1 && (
          <div role="group" aria-label={words.filterLabel} className="flex shrink-0 gap-2 sm:flex-wrap">
            <FilterChip selected={!shownFilter} onClick={() => setFilter(null)}>{words.all}</FilterChip>
            {kinds.map((k) => (
              <FilterChip key={k} selected={shownFilter === k} onClick={() => setFilter(shownFilter === k ? null : k)}>
                {words.groups[k]}
              </FilterChip>
            ))}
          </div>
        )}
        <div className="flex-1 max-sm:hidden" />
        <Menu
          label={words.grouping}
          placement="bottom-end"
          minWidth={200}
          trigger={(p) => (
            <FilterChip {...p} menu className="max-sm:hidden">{words.groupings[grouping]}</FilterChip>
          )}
        >
          {GROUPING_ORDER.map((g) => (
            <MenuItemRadio
              key={g}
              checked={grouping === g}
              onSelect={() => {
                if (vaultStatus !== 'ready') setNoteOpen(true);
                else arrangeAccounts({ grouping: g });
              }}
            >
              {words.groupings[g]}
            </MenuItemRadio>
          ))}
        </Menu>
        {fetchable.length > 0 && (
          <IconButton
            size="md"
            className="-mr-2 max-sm:hidden"
            aria-label={words.loadAll}
            title={busyTitle ?? `${words.loadAll} – ${t.common.mayNeedApproval}`}
            disabled={busy}
            onClick={loadAll}
          >
            <RefreshIcon size={20} />
          </IconButton>
        )}
      </div>

      {/* The table's heads, from 640px; the rows say the same to a screen reader. */}
      <div aria-hidden className={cx(TABLE, 'px-5 pt-5 pb-1 text-[12px] leading-4 font-medium text-ink-2 max-sm:hidden sm:-mx-5')}>
        <span className="col-span-2">{words.columns.account}</span>
        <span>{words.columns.last}</span>
        <span className="text-right">{words.columns.balance}</span>
        <span />
      </div>

      <div className="-mx-4 sm:-mx-5">
        {groups.map((g) => (
          <AccountGroupList
            key={g.key}
            group={g}
            grouping={grouping}
            entry={grouping === 'bank' ? banks.find((b) => b.key === g.key) ?? null : null}
            sum={groupSum(g.accounts, valueOf)}
            render={(a) => (
              <AccountRow
                key={a.accountNumber}
                account={a}
                label={accountLabel(a)}
                entry={bankOf(a)}
                badge={severalBanks}
                value={valueOf(a)}
                last={lastBooking(txByAccount[a.accountNumber])}
                loading={loadingNow(a)}
                failed={!!(isDepot(a) ? portfolioErrors[a.accountNumber] : failureOf(a.accountNumber))}
                gone={gone(a)}
                busy={busy}
                busyTitle={busyTitle}
                onOpen={() => open(a)}
              />
            )}
          />
        ))}

        {outside.map((entry) => (
          <LoginRow
            key={entry.key}
            entry={entry}
            logoFile={logoFiles[entry.bank.brand]}
            onLogin={() => openAddBank({ bank: entry.bank, userId: entry.ref?.userId })}
          />
        ))}
      </div>

      {/* The footing, from 640px: the Gesamtsaldo under a rule, as a statement sums up. */}
      {figures.total != null && !shownFilter && (
        <div className={cx(TABLE_FOOT, 'mt-2 border-t border-line pt-3 max-sm:hidden')}>
          <span className="text-[16px] leading-[22px] font-medium text-ink">{words.total}</span>
          <Money value={figures.total / 100} tone="auto" className="text-right text-[16px] leading-[22px] font-medium" />
          <span />
        </div>
      )}

      {/* Once the view holds more than one bank, the way to one more is here too from 640px. */}
      {banks.length > 1 && (
        <div className="mt-2 max-sm:hidden">
          <Button variant="tertiary" size="sm" className="-ml-3" iconLeft={<PlusIcon size={16} />} onClick={() => openAddBank()}>
            {t.banks.add}
          </Button>
        </div>
      )}

      {arranging && <ArrangeSheet onClose={() => setArranging(false)} />}
    </section>
  );
}

/** The account whose page was opened last: its row takes focus when the overview comes back. */
let lastOpened: string | null = null;

const GROUPING_ORDER: readonly AccountGrouping[] = ['type', 'bank', 'none'];

// The desktop table's columns (the mock's): the disc, the account, the last
// booking, the figure, the chevron. Its foot shares the figure's column.
const TABLE = 'grid grid-cols-[40px_minmax(0,1fr)_minmax(0,300px)_180px_24px] items-center gap-x-4';
const TABLE_FOOT = 'grid grid-cols-[minmax(0,1fr)_180px_24px] items-baseline gap-x-4';

/** A group's head and its rows: a kind or a bank with its sum, or the rows alone. */
function AccountGroupList({ group, grouping, entry, sum, render }: {
  group: AccountGroup<SerializedAccount>;
  grouping: AccountGrouping;
  entry: BankEntry | null;
  sum: number | null;
  render: (a: SerializedAccount) => ReactNode;
}) {
  const t = useT();
  const { logoFiles, openAddBank } = useFints();
  const headId = useId();
  const title = group.kind ? t.insights.accounts.groups[group.kind] : entry?.bank.name ?? null;
  return (
    <section aria-labelledby={title ? headId : undefined} aria-label={title ? undefined : t.common.account.accounts}>
      {title && grouping !== 'none' && (
        <div className="flex items-baseline gap-x-4 px-4 pt-4 pb-1 sm:grid sm:grid-cols-[minmax(0,1fr)_180px_24px] sm:px-5 sm:pt-[18px]">
          <h3 id={headId} className="flex min-w-0 flex-1 items-center gap-2 text-[14px] leading-5 font-medium text-ink-2">
            {entry && <BankLogo brand={entry.bank.brand} size="sm" file={logoFiles[entry.bank.brand]} />}
            <span className="min-w-0 truncate">{title}</span>
            {entry?.state === 'loggedOut' && (
              <span className="shrink-0 font-normal">· {t.banks.state.loggedOut}</span>
            )}
          </h3>
          {entry?.state === 'loggedOut' ? (
            <Button
              variant="tertiary"
              size="xs"
              className="-mr-2.5 shrink-0 justify-self-end"
              onClick={() => openAddBank({ bank: entry.bank, userId: entry.ref?.userId })}
            >
              {t.banks.loginAgain}
            </Button>
          ) : sum != null ? (
            <Money value={sum / 100} tone="plain" className="shrink-0 text-right text-[14px] leading-5 font-medium text-ink-2" />
          ) : <span />}
        </div>
      )}
      <ul className={cx(grouping === 'none' && 'pt-2')}>{group.accounts.map(render)}</ul>
    </section>
  );
}

/**
 * One account: what kind (the disc, its bank's mark on it when there are
 * several banks), what you call it, its bank and the end of its number, its
 * figure, and its last booking. A phone stacks it as three lines, the
 * figures right-aligned in one column; from 640px it is a row of the table.
 * The whole row opens the account's page.
 */
function AccountRow({
  account: a, label, entry, badge, value, last, loading, failed, gone, busy, busyTitle, onOpen,
}: {
  account: SerializedAccount;
  label: string;
  entry: BankEntry | null;
  badge: boolean;
  value: AccountValue;
  last: SerializedTransaction | null;
  loading: boolean;
  failed: boolean;
  gone: boolean;
  busy: boolean;
  busyTitle?: string;
  onOpen: () => void;
}) {
  const t = useT();
  const words = t.insights.accounts;
  const { balances, portfolios, logoFiles } = useFints();
  const acct = a.accountNumber;
  const depot = isDepot(a);
  const kind = groupKindOf(a);
  const card = isCardAccount(a);
  const bal = balances[acct];
  const portfolio = portfolios[acct];
  const bank = entry?.bank.name ?? '';

  // The figure, or what it waits for. A credit's or loan's balance is
  // negative by nature: ink, not the red of an overdrawn Girokonto.
  const figure: ReactNode = value.state === 'known' ? (
    <Money value={value.cents / 100} currency={value.currency} tone={kind === 'credit' || depot ? 'plain' : 'auto'} />
  ) : loading ? (
    <span className="inline-block py-0.5 align-middle">
      <Skeleton className="h-4 w-20 rounded-[4px]" />
      <span className="sr-only">{words.fetching}</span>
    </span>
  ) : gone ? (
    <span className="font-normal text-ink-2">{t.banks.state.loggedOut}</span>
  ) : value.state === 'never' ? (
    <span className="font-normal text-ink-2">{t.insights.hero.noBalance}</span>
  ) : failed ? (
    <span className="text-red">{t.common.fetchFailed}</span>
  ) : (
    <span className="font-normal text-ink-2">{words.notFetched}</span>
  );

  // What kind of figure it is, under it in the table.
  const available = bal?.availableAmount != null && Math.round(bal.availableAmount * 100) !== Math.round(bal.balance * 100)
    ? bal.availableAmount : null;
  const figureKind: ReactNode = value.state !== 'known' ? null
    : depot ? t.depot.total
      : kind === 'credit' ? (card ? t.insights.hero.cardBalance : words.loanBalance)
        : available != null ? <>{t.insights.available} <Money value={available} currency={bal?.currency} tone="plain" /></> : null;

  // The bank, and what tells the account apart: the IBAN's end on a phone, all of it in the table.
  const ident = accountIdent(a);
  const short = depot && portfolio ? t.depot.holdings(portfolio.holdings.length)
    : ident.tail ? `${ident.kind === 'card' ? `${words.card} ` : ''}··· ${ident.tail}` : '';
  const long = depot && portfolio ? t.depot.holdings(portfolio.holdings.length)
    : a.iban ? fmtIban(a.iban) : short;
  const idClass = depot ? '' : 'iban text-[13px]';

  // The last booking: who and when, its amount beside it.
  const lastWhen = last ? when(last, 'short') : '';
  const lastName = last ? txText(last).name : '';
  const lastAmount = last ? <Money value={last.amount} currency={last.currency} signed tone="credit" /> : null;
  const depotNote = depot && portfolio ? t.depot.asOf(new Intl.DateTimeFormat(intlLocale(), { hour: '2-digit', minute: '2-digit' }).format(new Date(portfolio.readAt))) : null;

  return (
    <li>
      <button
        type="button"
        data-account-row={acct}
        onClick={onOpen}
        aria-disabled={busy || undefined}
        title={busyTitle}
        className={cx(
          'row-focus group w-full text-left transition-colors duration-150',
          'px-4 py-2.5 hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] sm:rounded-[16px] sm:px-5',
          busy ? 'cursor-progress' : 'cursor-pointer',
        )}
      >
        {/* A phone: name and figure, bank and number, the last booking and its amount. */}
        <span className="grid grid-cols-[40px_minmax(0,1fr)_auto] gap-x-4 sm:hidden">
          <AccountDisc account={a} entry={badge ? entry : null} logoFile={entry ? logoFiles[entry.bank.brand] : undefined} className="row-span-3 mt-0.5" />
          <span className="col-start-2 truncate text-[16px] leading-[22px] font-medium text-ink">{label}</span>
          <span className="col-start-3 text-right text-[16px] leading-[22px] font-medium text-ink">{figure}</span>
          <span className="col-span-2 col-start-2 flex min-w-0 items-baseline text-[14px] leading-5 text-ink-2">
            <span className="min-w-0 truncate">{bank}</span>
            {short && <span className="shrink-0 whitespace-pre"> · <span className={idClass}>{short}</span></span>}
          </span>
          {last ? (
            <>
              <span className="col-start-2 truncate text-[14px] leading-5 text-ink-2">
                <span className="sr-only">{words.columns.last}: </span>
                {lastName} · {lastWhen}
              </span>
              <span className="col-start-3 text-right text-[14px] leading-5 text-ink-2">{lastAmount}</span>
            </>
          ) : depotNote ? (
            <span className="col-span-2 col-start-2 truncate text-[14px] leading-5 text-ink-2">{depotNote}</span>
          ) : null}
        </span>

        {/* From 640px: a row of the table. */}
        <span className={cx(TABLE, 'max-sm:hidden')}>
          <AccountDisc account={a} entry={badge ? entry : null} logoFile={entry ? logoFiles[entry.bank.brand] : undefined} />
          <span className="min-w-0">
            <span className="block truncate text-[16px] leading-[22px] font-medium text-ink">{label}</span>
            {/* The whole IBAN, which never wraps: the bank is the disc's mark with several banks, its
                group's head by bank, and with one bank the same on every row — said to a screen reader only. */}
            <span className="block truncate text-[14px] leading-5 text-ink-2">
              <span className="sr-only">{bank}{long && ', '}</span>
              {long && <span className={idClass}>{long}</span>}
            </span>
          </span>
          <span className="min-w-0 text-[14px] leading-5">
            {last ? (
              <>
                <span className="sr-only">{words.columns.last}: </span>
                <span className="block truncate text-ink">{lastName}</span>
                <span className="block truncate text-ink-2">{when(last, 'long')} · {lastAmount}</span>
              </>
            ) : depotNote ? (
              <span className="block truncate text-ink-2">{depotNote}</span>
            ) : null}
          </span>
          <span className="text-right text-[16px] leading-[22px] font-medium text-ink">
            {figure}
            {figureKind && <span className="block text-[14px] leading-5 font-normal text-ink-2">{figureKind}</span>}
          </span>
          <ChevronIcon dir="right" size={24} className="text-ink-2 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100" />
        </span>
      </button>
    </li>
  );
}

/**
 * The account's kind on the booking rows' disc (Container High, the variant
 * ink) — and, with accounts at more than one bank, the bank's mark on its
 * edge: a compact logo on its white plate, else the brand's chip.
 */
function AccountDisc({ account, entry, logoFile, className }: {
  account: SerializedAccount; entry: BankEntry | null; logoFile?: string; className?: string;
}) {
  return (
    <span aria-hidden className={cx('relative grid size-10 shrink-0 place-items-center rounded-full bg-inset text-ink-2', className)}>
      <AccountTypeIcon type={account.accountType} product={account.product} size={20} />
      {entry && (
        <BankMark
          entry={entry}
          logoFile={logoFile}
          className="absolute -right-[3px] -bottom-[3px] size-[18px] rounded-full shadow-[0_0_0_2px_var(--paper)]"
        />
      )}
    </span>
  );
}

/**
 * A bank's mark at a few pixels: its logo on the white plate where the file
 * is a compact mark, else the brand's chip — a wordmark would be unreadable
 * this small (lib/brands.ts COMPACT_LOGO). `className` sets size and shape.
 */
export function BankMark({ entry, logoFile, className }: { entry: BankEntry; logoFile?: string; className: string }) {
  const brand = entry.bank.brand;
  const logo = logoFile && COMPACT_LOGO.has(brand) ? logoFile : null;
  return (
    <span aria-hidden title={entry.bank.name} className={cx('grid shrink-0 place-items-center overflow-hidden', logo && 'logo-img p-[3px]', className)}>
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/logos/${logo}`} alt="" draggable={false} className="size-full object-contain" />
      ) : (
        <BankChip brand={brand} className="size-full" />
      )}
    </span>
  );
}

/**
 * The newest booked item of an account's loaded (or kept) Umsätze, up to
 * today: a booking the bank dated ahead ("noch nicht gebucht") is the
 * account page's to show, unless there is nothing else.
 */
function lastBooking(txs: readonly SerializedTransaction[] | undefined): SerializedTransaction | null {
  if (!txs?.length) return null;
  const today = isoDate(new Date());
  let best: SerializedTransaction | null = null;
  let bestDay = '';
  let ahead: SerializedTransaction | null = null;
  for (const tx of txs) {
    const day = dayKey(tx.entryDate) || dayKey(tx.valueDate);
    if (day > today) {
      ahead ??= tx;
      continue;
    }
    if (day > bestDay) {
      best = tx;
      bestDay = day;
    }
  }
  return best ?? ahead;
}

/** "Heute", "Gestern", "23.10." on a phone; "Fr., 23. Oktober" in the table. */
function when(tx: SerializedTransaction, style: 'short' | 'long'): string {
  const day = dayKey(tx.entryDate) || dayKey(tx.valueDate);
  if (!day) return '';
  const today = isoDate(new Date());
  const words = msgs().format;
  if (day === today) return words.today;
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (day === isoDate(yesterday)) return words.yesterday;
  const date = new Date(`${day}T12:00:00`);
  return new Intl.DateTimeFormat(intlLocale(), style === 'short'
    ? { day: '2-digit', month: '2-digit' }
    : { weekday: 'short', day: 'numeric', month: 'long' }).format(date);
}

/**
 * A bank of the view that is not logged in: its mark, its name, where it
 * stands, and the one way in — to its login form, the login name filled in;
 * the PIN and the approval are still the user's. Said once, here.
 */
function LoginRow({ entry, logoFile, onLogin }: { entry: BankEntry; logoFile?: string; onLogin: () => void }) {
  const t = useT();
  const { plus } = useFints();
  // Every bank beside the one the app opens with needs Girovo Plus in the Play build.
  const locked = !bankAllowed(plus.state, false);
  const again = entry.state === 'loggedOut';
  return (
    <div className="flex min-h-16 items-center gap-4 px-4 py-2.5 sm:px-5">
      <span className="grid size-10 shrink-0 place-items-center [&>span]:max-w-full">
        <BankLogo brand={entry.bank.brand} size="sm" file={logoFile} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[16px] leading-[22px] font-medium text-ink" title={entry.bank.name}>{entry.bank.name}</span>
        <span className="block text-[14px] leading-5 text-ink-2">
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

// ---------------------------------------------------------------------------
// Konten anordnen

/** How far a finger or the mouse moves before a press on a row stops being a press. */
const SLOP = 8;
/** How long a finger rests on a row before the row lifts (the grip lifts at once). */
const HOLD_MS = 350;

type Drag = {
  key: string;
  group: string;
  members: string[];
  from: number;
  over: number;
  dy: number;
  /** The rows' tops and heights, measured when the drag began. */
  rects: Array<{ top: number; height: number }>;
};

/**
 * "Konten anordnen": the grouping (Nach Art, Nach Bank, Keine) and the order
 * within each group. A row is moved by its grip, or by resting a finger on
 * it, and with the keyboard by the grip's arrow keys; each change is kept in
 * the vault as it is made, so the sheet can be closed any way. A bottom sheet
 * on a phone, a dialog from 640px.
 */
function ArrangeSheet({ onClose }: { onClose: () => void }) {
  const { accounts, vault, arrangeAccounts, bankOf, banks, accountLabel, logoFiles } = useFints();
  const t = useT();
  const words = t.insights.accounts;
  const id = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const [said, setSaid] = useState('');
  const grouping: AccountGrouping = vault?.accountGrouping ?? 'type';
  const order = useMemo(() => orderAccounts(accounts, vault?.accountOrder).map((a) => a.accountNumber), [accounts, vault?.accountOrder]);
  const byKey = useMemo(() => new Map(accounts.map((a) => [a.accountNumber, a])), [accounts]);
  const severalBanks = new Set(accounts.map((a) => bankOf(a)?.key ?? 'primary')).size > 1;
  const groups = groupAccounts(
    order.map((n) => byKey.get(n)!).filter(Boolean),
    grouping,
    { kindOf: groupKindOf, bankOf: (a) => bankOf(a)?.key ?? 'primary', banks: banks.map((b) => b.key) },
  );

  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;
  const hold = useRef<{ timer: number; x: number; y: number } | null>(null);

  const move = (members: string[], from: number, to: number) => {
    const next = moveAccount(order, members, from, to);
    arrangeAccounts({ order: next });
    const name = accountLabel(byKey.get(members[from])!);
    setSaid(words.moved(name, to + 1, members.length));
  };

  /** Lifts a row: measures its group's rows, so the others can make room as it moves. */
  const lift = (key: string, group: AccountGroup<SerializedAccount>, startY: number) => {
    const members = group.accounts.map((a) => a.accountNumber);
    const rows = members.map((n) => listRef.current?.querySelector<HTMLElement>(`[data-order-row="${CSS.escape(n)}"]`));
    const rects = rows.map((r) => {
      const box = r?.getBoundingClientRect();
      return { top: box?.top ?? 0, height: box?.height ?? 0 };
    });
    const from = members.indexOf(key);
    startYRef.current = startY;
    setDrag({ key, group: group.key, members, from, over: from, dy: 0, rects });
    navigator.vibrate?.(10);
  };
  const startYRef = useRef(0);

  const follow = (y: number) => {
    const d = dragRef.current;
    if (!d) return;
    const dy = y - startYRef.current;
    const me = d.rects[d.from];
    const centre = me.top + me.height / 2 + dy;
    let over = d.from;
    // The place whose row the lifted one's middle has passed.
    for (let i = 0; i < d.rects.length; i++) {
      const r = d.rects[i];
      if (i < d.from && centre < r.top + r.height / 2) { over = i; break; }
      if (i > d.from && centre > r.top + r.height / 2) over = i;
    }
    setDrag({ ...d, dy, over });
  };

  const drop = () => {
    const d = dragRef.current;
    setDrag(null);
    if (d && d.over !== d.from) move(d.members, d.from, d.over);
  };

  // While a row is lifted the page under the finger must not scroll.
  useEffect(() => {
    if (!drag) return;
    const stop = (e: TouchEvent) => e.preventDefault();
    document.addEventListener('touchmove', stop, { passive: false });
    return () => document.removeEventListener('touchmove', stop);
  }, [drag]);

  const onGripDown = (e: ReactPointerEvent<HTMLElement>, key: string, group: AccountGroup<SerializedAccount>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    lift(key, group, e.clientY);
  };

  const onRowDown = (e: ReactPointerEvent<HTMLElement>, key: string, group: AccountGroup<SerializedAccount>) => {
    if (e.pointerType !== 'touch' || (e.target as HTMLElement).closest('[data-grip]')) return;
    const target = e.currentTarget;
    const pointer = e.pointerId;
    const y = e.clientY;
    hold.current = {
      x: e.clientX,
      y,
      timer: window.setTimeout(() => {
        hold.current = null;
        try { target.setPointerCapture(pointer); } catch { /* the finger has left */ }
        lift(key, group, y);
      }, HOLD_MS),
    };
  };

  const onRowMove = (e: ReactPointerEvent<HTMLElement>) => {
    const h = hold.current;
    if (h && Math.hypot(e.clientX - h.x, e.clientY - h.y) > SLOP) {
      // A scroll, not a hold.
      clearTimeout(h.timer);
      hold.current = null;
    }
    if (dragRef.current) follow(e.clientY);
  };

  const onRowUp = () => {
    if (hold.current) {
      clearTimeout(hold.current.timer);
      hold.current = null;
    }
    if (dragRef.current) drop();
  };

  const onGripKey = (e: KeyboardEvent<HTMLButtonElement>, key: string, members: string[]) => {
    const from = members.indexOf(key);
    const to = e.key === 'ArrowUp' ? from - 1 : e.key === 'ArrowDown' ? from + 1 : -1;
    if (to < 0 || to >= members.length) return;
    e.preventDefault();
    move(members, from, to);
  };

  return (
    <Overlay open onClose={onClose} labelledBy={`${id}-title`} describedBy={`${id}-hint`}>
      <Sheet
        onClose={onClose}
        className="select-none"
        footer={<Button variant="primary" className="w-full" onClick={onClose}>{words.done}</Button>}
      >
        <div data-arrange>
          <h2 id={`${id}-title`} className="text-[22px] leading-7 font-medium text-ink">{words.arrange}</h2>
          <p id={`${id}-hint`} className="mt-1 text-[14px] leading-5 text-ink-2">
            {words.arrangeHint}
            <span className="sr-only"> {words.arrangeKeys}</span>
          </p>

          <p className="mt-4 mb-2 text-[14px] leading-5 font-medium text-ink-2">{words.grouping}</p>
          <Segmented
            block
            aria-label={words.grouping}
            value={grouping}
            onChange={(g) => arrangeAccounts({ grouping: g })}
            options={GROUPING_ORDER.map((g) => ({ value: g, label: words.groupings[g] }))}
          />

          <div ref={listRef} className="-mx-4 mt-2 sm:-mx-6">
            {groups.map((g) => {
              const members = g.accounts.map((a) => a.accountNumber);
              const entry = grouping === 'bank' ? banks.find((b) => b.key === g.key) ?? null : null;
              const title = g.kind ? words.groups[g.kind] : entry?.bank.name ?? null;
              const lifted = drag?.group === g.key ? drag : null;
              return (
                <section key={g.key} aria-label={title ?? t.common.account.accounts}>
                  {title && grouping !== 'none' && (
                    <h3 className="px-4 pt-3.5 pb-1 text-[14px] leading-5 font-medium text-ink-2 sm:px-6">{title}</h3>
                  )}
                  <ul>
                    {g.accounts.map((a, i) => {
                      const key = a.accountNumber;
                      const isLifted = lifted?.key === key;
                      // The others make room: each row between the lifted one's place and where it is over moves a row's height.
                      let shift = 0;
                      if (lifted && !isLifted) {
                        const h = lifted.rects[lifted.from].height;
                        if (lifted.from < lifted.over && i > lifted.from && i <= lifted.over) shift = -h;
                        if (lifted.from > lifted.over && i < lifted.from && i >= lifted.over) shift = h;
                      }
                      const entryOf = bankOf(a);
                      const ident = accountIdent(a);
                      return (
                        <li
                          key={key}
                          data-order-row={key}
                          onPointerDown={(e) => onRowDown(e, key, g)}
                          onPointerMove={onRowMove}
                          onPointerUp={onRowUp}
                          onPointerCancel={onRowUp}
                          // A held finger brings up no menu of its own.
                          onContextMenu={(e) => e.preventDefault()}
                          style={{
                            transform: isLifted ? `translateY(${lifted!.dy}px) rotate(-0.6deg)` : shift ? `translateY(${shift}px)` : undefined,
                            // Only while a row is lifted: once it is dropped, the new order puts every row where it already stands.
                            transition: lifted && !isLifted ? 'transform var(--m3e-spatial-fast-ms) var(--m3e-spatial-fast)' : undefined,
                          }}
                          className={cx(
                            'relative grid min-h-16 grid-cols-[24px_40px_minmax(0,1fr)_auto] items-center gap-x-3 py-2 pr-4 pl-3 sm:pr-6 sm:pl-5',
                            isLifted && 'z-10 mx-2 rounded-[16px] bg-paper pr-2 pl-1 shadow-[var(--shadow-pop)] sm:pr-4 sm:pl-3',
                          )}
                        >
                          <button
                            type="button"
                            data-grip
                            aria-label={words.move(accountLabel(a))}
                            aria-describedby={`${id}-hint`}
                            onPointerDown={(e) => onGripDown(e, key, g)}
                            onKeyDown={(e) => onGripKey(e, key, members)}
                            className="-m-3 grid size-12 cursor-grab touch-none place-items-center rounded-full text-ink-2 outline-offset-[-4px] active:cursor-grabbing"
                          >
                            <DragIcon size={24} />
                          </button>
                          <AccountDisc account={a} entry={severalBanks ? entryOf : null} logoFile={entryOf ? logoFiles[entryOf.bank.brand] : undefined} />
                          <span className="min-w-0">
                            <span className="block truncate text-[16px] leading-[22px] font-medium text-ink">{accountLabel(a)}</span>
                            {/* The end of its number tells it apart; the disc's mark already names its bank. */}
                            <span className="block truncate text-[14px] leading-5 text-ink-2">
                              {ident.tail && !isDepot(a) ? (
                                <span className="iban text-[13px]">{ident.kind === 'card' ? `${words.card} ` : ''}··· {ident.tail}</span>
                              ) : entryOf?.bank.name}
                            </span>
                          </span>
                          <ArrangeFigure account={a} />
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
          <p role="status" className="sr-only">{said}</p>
        </div>
      </Sheet>
    </Overlay>
  );
}

/** A row's figure in the sheet, as far as this session knows it. */
function ArrangeFigure({ account }: { account: SerializedAccount }) {
  const { balances, portfolios } = useFints();
  const acct = account.accountNumber;
  const value = isDepot(account) ? portfolios[acct]?.totalValue : balances[acct]?.balance;
  const currency = isDepot(account) ? portfolios[acct]?.currency : balances[acct]?.currency;
  if (value == null) return <span />;
  return <Money value={value} currency={currency} tone="plain" className="text-right text-[14px] leading-5 font-medium text-ink" />;
}
