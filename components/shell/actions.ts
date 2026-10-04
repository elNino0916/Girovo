'use client';

// The shell's launchers, decided once: the stage's Schnellzugriffe, the
// command palette and the keyboard shortcuts all call these, so "Kontoauszug"
// means the same period and the CSV export the same file wherever it is
// started.
//
// None of them talks to the bank. Überweisen and Geld anfordern open their
// sheets (the transfer still goes through its review, Namensabgleich and
// TAN); Kontoauszug and the export work on what is already loaded.

import { useCallback, useMemo } from 'react';
import { csvFileName, transactionsToCsv } from '@/lib/csv';
import { saveFile, textBlob } from '@/lib/download';
import { fmtRange } from '@/lib/format';
import type { SerializedTransaction } from '@/lib/fints-types';
import { useFints } from '../FintsProvider';
import { newestFirst } from '../transactions/model';

/** The Umsätze search field's id (components/transactions/TxFilterBar.tsx). */
const TX_SEARCH_ID = 'umsatz-suche';

const umsaetze = (n: number) => `${n.toLocaleString('de-DE')} ${n === 1 ? 'Umsatz' : 'Umsätze'}`;

/**
 * The one CSV export, for every place that offers it (the Umsätze tile's
 * Export menu, the palette).
 *
 * What goes in the file is what the Umsätze list shows: the active account's
 * booked Umsätze of the loaded period — or just those the list's filter
 * leaves — in the list's own order. Vorgemerkte are not in it: they are not
 * bookings yet, can still change or vanish, and once booked would turn up in
 * two exports. The count in the toast is the count beside the button. The
 * file name says the days it covers, and "_gefiltert" when a search, a
 * category or a direction narrowed it.
 *
 * "Gespeichert" is said only for a file that was written: the desktop app's
 * Save-As answers first, and a dismissed dialog says nothing. A browser
 * download is confirmed by the browser itself.
 */
export function useCsvExport() {
  const { activeAccount, bank, accountLabel, categoryOf, toast } = useFints();

  return useCallback(async (
    rows: readonly SerializedTransaction[],
    span: { from: string; to: string },
    opts: { filtered?: boolean } = {},
  ) => {
    if (!activeAccount || !rows.length) return;
    let csv: string;
    try {
      csv = transactionsToCsv(rows, {
        account: activeAccount,
        bankName: bank?.name ?? '',
        accountLabel: accountLabel(activeAccount),
        categoryOf,
      });
    } catch {
      toast('Die CSV-Datei konnte nicht erstellt werden.', 'error');
      return;
    }
    try {
      const outcome = await saveFile(csvFileName(activeAccount, span, opts), textBlob(csv, 'text/csv;charset=utf-8'));
      if (outcome === 'saved') toast(`${umsaetze(rows.length)} als CSV-Datei gespeichert.`, 'success');
    } catch (e) {
      toast((e as Error).message || 'Die CSV-Datei konnte nicht gespeichert werden.', 'error');
    }
  }, [activeAccount, bank, accountLabel, categoryOf, toast]);
}

export type ShellActions = ReturnType<typeof useShellActions>;

export function useShellActions() {
  const {
    accounts, activeAccount, transactions, statementInfo, loadingAccount,
    accountLabel, toast, openTransfer, openShare, printStatement, setTab,
  } = useFints();
  const saveCsv = useCsvExport();

  const acct = activeAccount?.accountNumber ?? null;
  const info = acct ? statementInfo[acct] : undefined;
  // What the documents describe is what was fetched — never a control's range.
  const loaded = !!activeAccount && !!transactions && !!info && loadingAccount !== acct;
  const rangeLabel = info ? fmtRange(info.from, info.to) : '';
  const booked = loaded ? (transactions?.length ?? 0) : 0;

  const canTransfer = useMemo(() => accounts.some((a) => a.canTransfer), [accounts]);
  const canShare = useMemo(() => accounts.some((a) => !!a.iban), [accounts]);

  const transfer = useCallback(() => openTransfer(), [openTransfer]);
  const share = useCallback(() => openShare(), [openShare]);

  // Why there is no Kontoauszug yet, in words a press can show — a disabled
  // button would only say it in a tooltip, which keyboard and touch never see.
  const statementHint = !activeAccount || loaded ? ''
    : !activeAccount.canStatements
      ? 'Für dieses Konto bietet deine Bank keine Umsätze an – daher auch keinen Kontoauszug.'
      : loadingAccount === acct
        ? 'Die Umsätze werden gerade geladen. Danach gibt es den Kontoauszug.'
        : 'Den Kontoauszug gibt es, sobald die Umsätze dieses Kontos geladen sind.';

  const statement = useCallback(() => {
    if (!loaded || !info) {
      if (statementHint) toast(statementHint, 'info');
      return;
    }
    printStatement(info.from, info.to);
  }, [loaded, info, printStatement, statementHint, toast]);

  /** Every booked Umsatz of the loaded period — "Alle Umsätze als CSV". */
  const exportCsv = useCallback(() => {
    if (!loaded || !transactions || !info) return;
    void saveCsv(newestFirst(transactions), { from: info.from, to: info.to });
  }, [loaded, transactions, info, saveCsv]);

  /**
   * Puts the cursor into the Umsätze search. The list may not be on screen
   * (another tab), so the Übersicht is brought back first and the field
   * looked up once it has rendered. Deliberately not showTransactions(): that
   * hands focus to the list's heading, which would take it from the field.
   */
  const focusSearch = useCallback(() => {
    setTab('overview');
    let tries = 0;
    const find = () => {
      const el = document.getElementById(TX_SEARCH_ID) as HTMLInputElement | null
        ?? document.querySelector<HTMLInputElement>('[data-scroll-root] [role="search"] input, [data-scroll-root] input[type="search"]');
      if (el) {
        el.scrollIntoView({ block: 'center' });
        el.focus({ preventScroll: true });
        el.select();
      } else if (++tries < 40) {
        setTimeout(find, 25);
      }
    };
    setTimeout(find, 0);
  }, [setTab]);

  return {
    canTransfer, transfer,
    canShare, share,
    canStatement: loaded, statement,
    /** Why the Kontoauszug is not there yet ('' once it is). */
    statementHint,
    /** "GiroKomfort, 05.07.–03.10.2026" — whose statement, and which period. */
    statementSubject: activeAccount && rangeLabel ? `${accountLabel(activeAccount)}, ${rangeLabel}` : '',
    /** A file with nothing but a header row helps nobody. */
    canExport: booked > 0, exportCsv,
    /** Whether the active account's statement is loaded (a statement may be empty). */
    loaded,
    focusSearch,
    /** "05.07.–03.10.2026" — the loaded period of the active account, or ''. */
    rangeLabel,
  };
}
