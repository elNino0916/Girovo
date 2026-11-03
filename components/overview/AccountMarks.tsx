'use client';

// The small marks the account rows share: the account's kind on its disc,
// and the bank's mark at a few pixels (also on an account's head).

import { COMPACT_LOGO } from '@/lib/brands';
import type { SerializedAccount } from '@/lib/fints-types';
import { BankChip } from '../BankLogo';
import type { BankEntry } from '../FintsProvider';
import { AccountTypeIcon } from '../icons';
import { cx } from '../ui';

/**
 * The account's kind on the booking rows' disc (Container High, the variant
 * ink) — and, with accounts at more than one bank, the bank's mark on its
 * edge: a compact logo on its white plate, else the brand's chip.
 */
export function AccountDisc({ account, entry, logoFile, selected = false, className }: {
  account: SerializedAccount; entry: BankEntry | null; logoFile?: string; selected?: boolean; className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cx(
        'relative grid size-10 shrink-0 place-items-center rounded-full',
        // On the selected row's container the disc is a tint of its ink, as Material's selected list item draws it.
        selected
          ? 'bg-[color-mix(in_srgb,var(--md-on-secondary-container)_12%,transparent)] text-[var(--md-on-secondary-container)]'
          : 'bg-inset text-ink-2',
        className,
      )}
    >
      <AccountTypeIcon type={account.accountType} product={account.product} size={20} />
      {entry && (
        <BankMark
          entry={entry}
          logoFile={logoFile}
          className="absolute -right-[3px] -bottom-[3px] size-[18px] rounded-full shadow-[0_0_0_2px_var(--disc-ring,var(--paper))]"
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
