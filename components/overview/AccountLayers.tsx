'use client';

// The accounts in the frame's sidebar, as layers (components/overview/
// layers.ts): each a check box in its own colour, its name and its figure.
// The box puts the account's Umsätze and balance into the Übersicht or takes
// them out; the name shows that account alone, as its page. "+" logs in a
// further bank.

import { M3eCheckbox } from '@m3e/react/checkbox';
import type { CSSProperties } from 'react';
import { useT } from '@/lib/i18n/react';
import { useFints } from '../FintsProvider';
import { Icon } from '../icons';
import { Money } from '../Money';
import { IconButton, cx } from '../ui';
import { useAccountValue, useLayers } from './layers';

export function AccountLayers() {
  const { accountLabel, openAddBank, activeAccount, tab } = useFints();
  const t = useT();
  const words = t.shell.frame;
  const { layers, shown, setShown, only } = useLayers();
  const valueOf = useAccountValue();
  const alone = shown.length === 1 ? shown[0].accountNumber : null;

  return (
    <section aria-label={words.accounts} className="pt-4">
      <div className="flex items-center justify-between pr-3 pl-7">
        <h2 className="text-[14px] leading-5 font-medium text-ink-2">{words.accounts}</h2>
        <IconButton size="sm" aria-label={t.banks.add} title={t.banks.add} onClick={() => openAddBank()}>
          <Icon ms="add" size={20}>{null}</Icon>
        </IconButton>
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
    </section>
  );
}
