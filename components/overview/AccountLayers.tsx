'use client';

// The accounts in the frame's sidebar, as layers (components/overview/
// layers.ts): each a check box in its own colour, its name and its figure.
// The box puts the account's Umsätze and balance into the Übersicht or takes
// them out; the name shows that account alone, as its page. "+" logs in a
// further bank, the arrows beside it open "Konten anordnen". Under the
// accounts, each further bank that is not logged in, with the way to log in
// (5.x had it under its account list; a user's report, 2026-11-10).

import { M3eCheckbox } from '@m3e/react/checkbox';
import type { CSSProperties } from 'react';
import { useT } from '@/lib/i18n/react';
import { BankLogo } from '../BankLogo';
import { useFints } from '../FintsProvider';
import { Icon } from '../icons';
import { Money } from '../Money';
import { Button, IconButton, cx } from '../ui';
import { vaultNote } from './AccountIdentity';
import { useAccountValue, useLayers } from './layers';

export function AccountLayers({ onArrange }: { onArrange: () => void }) {
  const { accountLabel, openAddBank, activeAccount, tab, banks, logoFiles, vaultStatus, toast } = useFints();
  const t = useT();
  const words = t.shell.frame;
  const { layers, shown, setShown, only } = useLayers();
  const valueOf = useAccountValue();
  const alone = shown.length === 1 ? shown[0].accountNumber : null;
  // Remembered from an earlier session, or its session ended during this one.
  const absent = banks.filter((b) => b.state === 'remembered' || b.state === 'loggedOut');
  // The order is kept in the saved data: without it there is nothing to keep it in.
  const arrange = () => {
    if (vaultStatus === 'ready') onArrange();
    else toast(vaultNote(vaultStatus), 'info');
  };

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
      <ul className="mt-1 flex flex-col">
        {layers.map(({ account: a, color, shown: on }) => {
          const name = accountLabel(a);
          const v = valueOf(a);
          const current = tab === 'overview' && alone === a.accountNumber && activeAccount?.accountNumber === a.accountNumber;
          return (
            <li
              key={a.accountNumber}
              data-layer={a.accountNumber}
              className={cx('mx-3 flex h-9 items-center gap-2 rounded-full pr-3 pl-2', current && 'bg-[var(--md-surface-container)]')}
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
                className={cx('row-focus flex h-full min-w-0 flex-1 items-center gap-2 rounded-full text-left', !on && 'text-ink-2')}
              >
                <span className="min-w-0 flex-1 truncate text-[14px] leading-5">{name}</span>
                <span className={cx('shrink-0 text-[14px] leading-5 font-medium', on ? 'text-ink' : 'text-ink-2', v.state === 'known' && v.kept && 'text-ink-2')}>
                  {v.state === 'known'
                    ? <Money value={v.cents / 100} currency={v.currency} tone="plain" />
                    : <span aria-label={t.insights.accounts.notFetched}>–</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
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
