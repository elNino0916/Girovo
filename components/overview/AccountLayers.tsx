'use client';

// The accounts in the frame's sidebar, as layers (components/overview/
// layers.ts): each a check box in its own colour, its name and its figure.
// The box puts the account's Umsätze and balance into the Übersicht or takes
// them out; the name shows that account alone, as its page. "+" logs in a
// further bank, the arrows beside it open "Konten anordnen". Under the
// accounts, each further bank that is not logged in, with the way to log in
// (5.x had it under its account list; a user's report, 2026-11-10).
//
// Girovo Next: with "Eigene" (lib/account-groups.ts, own-groups.ts) the
// accounts stand under the user's groups, "Weitere Konten" last. A group's
// head folds and unfolds it (kept in the vault) and carries its sum by the
// Gesamtsaldo's rules: the ticked accounts only, euros only, nothing while a
// figure is missing, and what it leaves out named under it.

import { M3eCheckbox } from '@m3e/react/checkbox';
import { useId, type CSSProperties, type ReactNode } from 'react';
import { ownGroupFigure } from '@/lib/account-groups';
import { keptStandIns, type StandIn } from '@/lib/account-overview';
import { namesList } from '@/lib/balances';
import type { SerializedAccount } from '@/lib/fints-types';
import { useT } from '@/lib/i18n/react';
import { BankLogo } from '../BankLogo';
import { useFints } from '../FintsProvider';
import { ChevronIcon, Icon } from '../icons';
import { Money } from '../Money';
import { Button, IconButton, cx } from '../ui';
import { vaultNote } from './AccountIdentity';
import { useAccountValue, useLayers, type Layer } from './layers';
import { useOwnGroups } from './own-groups';

export function AccountLayers({ onArrange }: { onArrange: () => void }) {
  const { accountLabel, openAddBank, activeAccount, tab, banks, logoFiles, vaultStatus, toast, accounts, vault, accountsHidden } = useFints();
  const t = useT();
  const words = t.shell.frame;
  const { layers, shown, setShown, only } = useLayers();
  const own = useOwnGroups();
  const valueOf = useAccountValue();
  const alone = shown.length === 1 ? shown[0].accountNumber : null;
  // Remembered from an earlier session, or its session ended during this one.
  const absent = banks.filter((b) => b.state === 'remembered' || b.state === 'loggedOut');
  // A bank not logged in counts in its groups' sums with the balances kept
  // from its last session, as in the Gesamtsaldo (Ledger), unticked ones left out.
  const kept = vault?.keepBalances === false ? undefined : vault?.keptBalances;
  const { standIns } = keptStandIns(
    banks.filter((b) => b.state === 'remembered').map((b) => ({ name: b.bank.name, blz: b.ref?.blz ?? b.bank.blz, accounts: b.ref?.accounts })),
    kept,
    new Set(accounts.map((a) => a.accountNumber)),
    new Set(accountsHidden),
  );
  const standInsOf = (id: string): StandIn[] => {
    const members = new Set(own.groups.find((g) => g.id === id)?.accounts ?? []);
    return standIns.filter((s) => members.has(s.key));
  };
  // The order is kept in the saved data: without it there is nothing to keep it in.
  const arrange = () => {
    if (vaultStatus === 'ready') onArrange();
    else toast(vaultNote(vaultStatus), 'info');
  };

  const row = ({ account: a, color, shown: on }: Layer) => {
    const name = accountLabel(a);
    const v = valueOf(a);
    const current = tab === 'overview' && alone === a.accountNumber && activeAccount?.accountNumber === a.accountNumber;
    return (
      <li
        key={a.accountNumber}
        data-layer={a.accountNumber}
        // min-h, not h: a name too long beside its balance takes a second line
        // ("ONLINE-KREDIT" beside "−14.395,13 €" was cut to "ONLINE-…").
        className={cx('mx-3 flex min-h-9 items-center gap-2 rounded-[18px] pr-3 pl-2', current && 'bg-[var(--md-surface-container)]')}
      >
        <M3eCheckbox
          checked={on}
          aria-label={words.tick(name)}
          className="shrink-0"
          style={{
            '--m3e-checkbox-selected-container-color': color,
            '--m3e-checkbox-unselected-outline-color': color,
            '--m3e-checkbox-selected-hover-container-color': color,
            '--m3e-checkbox-selected-focus-container-color': color,
            '--m3e-checkbox-selected-pressed-container-color': color,
          } as CSSProperties}
          onChange={(e: Event) => setShown(a.accountNumber, !!(e.currentTarget as unknown as { checked: boolean }).checked)}
        />
        <button
          type="button"
          title={words.showOnly(name)}
          onClick={() => only(a)}
          className={cx('row-focus flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-[18px] py-1 text-left', !on && 'text-ink-2')}
        >
          <span className="line-clamp-2 min-w-0 flex-1 text-[14px] leading-5 break-words">{name}</span>
          <span className={cx('shrink-0 text-[14px] leading-5 font-medium', on ? 'text-ink' : 'text-ink-2', v.state === 'known' && v.kept && 'text-ink-2')}>
            {v.state === 'known'
              ? <Money value={v.cents / 100} currency={v.currency} tone="plain" />
              : <span aria-label={t.insights.accounts.notFetched}>–</span>}
          </span>
        </button>
      </li>
    );
  };

  const layerOf = new Map(layers.map((l) => [l.account.accountNumber, l]));

  return (
    <section aria-label={words.accounts} className="pt-4">
      <div className="flex items-center justify-between pr-3 pl-7">
        <h2 className="text-[14px] leading-5 font-medium text-ink-2">{words.accounts}</h2>
        <div className="flex items-center">
          {layers.length > 1 && (
            <IconButton size="sm" aria-label={t.insights.accounts.arrange} title={t.insights.accounts.arrange} aria-haspopup="dialog" onClick={arrange}>
              <Icon ms="swap_vert" size={20}>{null}</Icon>
            </IconButton>
          )}
          <IconButton size="sm" aria-label={t.banks.add} title={t.banks.add} onClick={() => openAddBank()}>
            <Icon ms="add" size={20}>{null}</Icon>
          </IconButton>
        </div>
      </div>
      {own.on ? (
        <div className="mt-1 flex flex-col">
          {own.shown.map((g) => (
            <LayerGroup
              key={g.id}
              id={g.id}
              name={own.nameOf(g)}
              accounts={g.accounts}
              folded={own.folded.has(g.id)}
              onToggle={() => own.toggle(g.id)}
              hidden={(a) => !layerOf.get(a.accountNumber)?.shown}
              standIns={standInsOf(g.id)}
            >
              {g.accounts.map((a) => layerOf.get(a.accountNumber)).filter((l): l is Layer => !!l).map(row)}
            </LayerGroup>
          ))}
        </div>
      ) : (
        <ul className="mt-1 flex flex-col">{layers.map(row)}</ul>
      )}
      {absent.length > 0 && (
        <ul className="mt-1 flex flex-col">
          {absent.map((b) => (
            <li key={b.key} data-absent-bank={b.key} className="mx-3 flex h-9 items-center gap-2 pr-1 pl-2">
              <span className="grid w-10 shrink-0 place-items-center [&>span]:max-w-full">
                <BankLogo brand={b.bank.brand} size="sm" file={logoFiles[b.bank.brand]} />
              </span>
              <span className="min-w-0 flex-1 truncate text-[14px] leading-5 text-ink-2" title={b.bank.name}>{b.bank.name}</span>
              <Button
                variant="tertiary"
                size="xs"
                className="shrink-0"
                aria-label={t.banks.alsoLogin(b.bank.name)}
                onClick={() => openAddBank({ bank: b.bank, userId: b.ref?.userId })}
              >
                {/* "Anmelden" in both cases: "Erneut anmelden" left the bank's name 38px of the sidebar (the screen sweep, 2026-11-10). */}
                {t.banks.login}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * One of the user's groups in the sidebar: its head, a button that folds and
 * unfolds it, with the name and the sum; what the sum leaves out on a line
 * under it; then its accounts, unless folded.
 */
function LayerGroup({ id, name, accounts, folded, onToggle, hidden, standIns, children }: {
  id: string;
  /** The group's accounts at a bank not logged in, by their kept balances. */
  standIns: StandIn[];
  name: string;
  accounts: SerializedAccount[];
  folded: boolean;
  onToggle: () => void;
  hidden: (a: SerializedAccount) => boolean;
  children: ReactNode;
}) {
  const t = useT();
  const { accountLabel } = useFints();
  const valueOf = useAccountValue();
  const listId = useId();
  const figure = ownGroupFigure(accounts, valueOf, hidden, standIns);
  const without = namesList(figure.excluded.map(({ account, reason, currency }) => (
    reason === 'currency' ? `${accountLabel(account)} (${currency})` : accountLabel(account)
  )));
  return (
    <div data-own-group={id} className="mt-1 first:mt-0">
      <button
        type="button"
        aria-expanded={!folded}
        aria-controls={listId}
        onClick={onToggle}
        className="row-focus mx-3 flex h-9 w-[calc(100%-24px)] items-center gap-1 rounded-full pr-3 pl-1 text-left text-ink-2 transition-colors duration-150 hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)]"
      >
        <ChevronIcon dir={folded ? 'right' : 'down'} size={20} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate text-[14px] leading-5 font-medium">{name}</span>
        {(accounts.length > 0 || standIns.length > 0) && (
          <span className="shrink-0 text-[14px] leading-5 font-medium">
            {figure.sum != null
              ? <Money value={figure.sum / 100} tone="plain" />
              : figure.open ? <span aria-label={t.insights.accounts.notFetched}>–</span> : null}
          </span>
        )}
      </button>
      {without && (
        <p className="mx-3 -mt-1 truncate pr-3 pl-7 text-[12px] leading-4 text-ink-2" title={`${t.insights.without(without)}. ${t.insights.accounts.excludedHint}`}>
          {t.insights.without(without)}
        </p>
      )}
      <ul id={listId} hidden={folded} className="flex flex-col">{children}</ul>
    </div>
  );
}
