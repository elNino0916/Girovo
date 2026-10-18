'use client';

import type { StatementInfo } from '@/lib/app-types';
import { csvScope } from '@/lib/csv';
import type { SerializedTransaction } from '@/lib/fints-types';
import { daysLabel } from '@/lib/analytics';
import { useT } from '@/lib/i18n/react';
import { useFints } from '../FintsProvider';
import { useCsvExport } from '../shell/actions';
import { ChevronIcon, DownloadIcon, FileIcon, FilterIcon } from '../icons';
import { Button, Menu, MenuItem, MenuSeparator, cx } from '../ui';

/**
 * The Umsätze as a German-Excel CSV — all of them, or just what the filter
 * shows. It sits on the list it exports, the way an online-banking
 * Umsatzliste offers its export; the Kontoauszug is a Schnellzugriff on the
 * stage. Both entries, and the palette's, go through the one export
 * (useCsvExport): the file holds the rows the list shows, booked Umsätze
 * only, and its name says which days — and that it was filtered.
 *
 * Where the bank provides its own Kontoauszüge over FinTS, the menu leads to
 * them as well (components/BankStatements.tsx).
 */
export function ExportMenu({
  loaded, all, filtered, onBankStatements,
}: {
  loaded: StatementInfo | undefined;
  /** Every loaded booking, newest first — as the list shows them. */
  all: readonly SerializedTransaction[];
  /** The bookings the current filter leaves, newest first. */
  filtered: readonly SerializedTransaction[];
  /**
   * Opens the bank's Kontoauszüge — a drawer the tile renders beside its
   * panel, never inside it: an overlay inside the panel would be clipped by it.
   */
  onBankStatements: () => void;
}) {
  const { activeAccount, txFilter } = useFints();
  const saveCsv = useCsvExport();
  const t = useT();
  if (!activeAccount) return null;

  const words = t.transactions.exportMenu;
  const count = t.transactions.count;
  const range = loaded ? { from: loaded.from, to: loaded.to } : null;
  const nothing = !range || all.length === 0;
  const scope = range ? csvScope(txFilter, range) : null;
  const narrowed = !!scope && (scope.filtered || !!txFilter.from || !!txFilter.to);
  const days = txFilter.from || txFilter.to ? scope?.span : null;

  return (
    <Menu
      label={words.label}
      placement="bottom-end"
      minWidth={288}
      trigger={(p, { open }) => (
        <Button
          {...p}
          size="sm"
          variant="tertiary"
          aria-label={words.button}
          iconLeft={<DownloadIcon size={16} />}
          iconRight={<ChevronIcon size={14} strokeWidth={2} className={cx('-mr-1 hidden transition-transform duration-150 sm:block', open && 'rotate-180')} />}
          className="max-sm:px-2.5"
        >
          <span className="hidden sm:inline">{words.button}</span>
        </Button>
      )}
    >
      <MenuItem
        icon={<DownloadIcon />}
        disabled={nothing}
        description={nothing ? words.nothing : words.forExcel(count(all.length))}
        onSelect={() => range && void saveCsv(all, range)}
      >
        {words.all}
      </MenuItem>
      <MenuItem
        icon={<FilterIcon />}
        disabled={nothing || !narrowed || filtered.length === 0}
        description={
          !narrowed
            ? words.noFilter
            : filtered.length === 0
              ? words.filterEmpty
              : days ? `${count(filtered.length)} · ${daysLabel(days.from, days.to)}` : count(filtered.length)
        }
        onSelect={() => scope && void saveCsv(filtered, scope.span, { filtered: scope.filtered })}
      >
        {words.filtered}
      </MenuItem>
      {activeAccount.canBankStatements && (
        <>
          <MenuSeparator />
          {/* It only opens the drawer: the approval note is beside the drawer's own fetch. */}
          <MenuItem icon={<FileIcon />} onSelect={onBankStatements}>
            {t.docs.statements.menu}
          </MenuItem>
        </>
      )}
    </Menu>
  );
}
