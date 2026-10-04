'use client';

import type { StatementInfo } from '@/lib/app-types';
import { csvFileName, transactionsToCsv } from '@/lib/csv';
import { downloadText } from '@/lib/download';
import type { SerializedTransaction } from '@/lib/fints-types';
import { daysLabel } from '@/lib/analytics';
import { fmtRange } from '@/lib/format';
import { useFints } from '../FintsProvider';
import { ChevronIcon, DownloadIcon, FileIcon, FilterIcon } from '../icons';
import { Button, Menu, MenuItem, MenuSeparator, cx } from '../ui';

const umsaetze = (n: number) => `${n.toLocaleString('de-DE')} ${n === 1 ? 'Umsatz' : 'Umsätze'}`;

/**
 * Taking the loaded statement elsewhere: the printable Kontoauszug, or the
 * bookings as a German-Excel CSV — all of them, or just what the filter
 * shows. Everything is built from what is already on screen; nothing here
 * asks the bank for anything. A filtered file narrowed to a month says so,
 * in the menu and in its name.
 */
export function ExportMenu({
  loaded, all, filtered, filterActive, days = null,
}: {
  loaded: StatementInfo | undefined;
  /** Every loaded booking, newest first — as the list shows them. */
  all: readonly SerializedTransaction[];
  /** The bookings the current filter leaves, newest first. */
  filtered: readonly SerializedTransaction[];
  filterActive: boolean;
  /** The days the filter narrows the list to (TxFilter from/to, open ends filled from the loaded range). */
  days?: { from: string; to: string } | null;
}) {
  const { activeAccount, bank, accountLabel, categoryOf, printStatement, toast } = useFints();
  if (!activeAccount) return null;

  const range = loaded ? { from: loaded.from, to: loaded.to } : null;
  const nothing = !range || all.length === 0;

  // Booked rows only, so every Status says "Gebucht" — never matched against
  // the Vorgemerkt list, whose items share a key with the bookings they became.
  const saveCsv = (rows: readonly SerializedTransaction[], span = range) => {
    if (!span || !rows.length) return;
    try {
      const csv = transactionsToCsv(rows, {
        account: activeAccount,
        bankName: bank?.name ?? '',
        accountLabel: accountLabel(activeAccount),
        categoryOf,
      });
      downloadText(csvFileName(activeAccount, span), csv, 'text/csv;charset=utf-8');
    } catch {
      toast('Die CSV-Datei konnte nicht erstellt werden.', 'error');
    }
  };

  return (
    <Menu
      label="Export"
      placement="bottom-end"
      minWidth={288}
      trigger={(p, { open }) => (
        <Button
          {...p}
          size="sm"
          variant="tertiary"
          aria-label="Export"
          iconLeft={<DownloadIcon size={16} />}
          iconRight={<ChevronIcon size={14} strokeWidth={2} className={cx('-mr-1 hidden transition-transform duration-150 sm:block', open && 'rotate-180')} />}
          className="max-sm:px-2.5"
        >
          <span className="hidden sm:inline">Export</span>
        </Button>
      )}
    >
      <MenuItem
        icon={<FileIcon />}
        disabled={!range}
        description={range ? `Zeitraum ${fmtRange(range.from, range.to)}` : 'Noch keine Umsätze geladen'}
        onSelect={() => range && printStatement(range.from, range.to)}
      >
        Kontoauszug als PDF
      </MenuItem>
      <MenuSeparator />
      <MenuItem
        icon={<DownloadIcon />}
        disabled={nothing}
        description={nothing ? 'Keine Umsätze im Zeitraum' : `${umsaetze(all.length)} · für Excel`}
        onSelect={() => saveCsv(all)}
      >
        Umsätze als CSV (Excel)
      </MenuItem>
      <MenuItem
        icon={<FilterIcon />}
        disabled={nothing || !filterActive || filtered.length === 0}
        description={
          !filterActive
            ? 'Kein Filter aktiv'
            : filtered.length === 0
              ? 'Der Filter zeigt keine Umsätze'
              : days ? `${umsaetze(filtered.length)} · ${daysLabel(days.from, days.to)}` : umsaetze(filtered.length)
        }
        onSelect={() => saveCsv(filtered, days ?? range)}
      >
        Gefilterte Umsätze als CSV
      </MenuItem>
    </Menu>
  );
}
