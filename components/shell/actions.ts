'use client';

// The shell's launchers, decided once: the stage's Schnellzugriffe, the
// command palette and the keyboard shortcuts all call these, so "Kontoauszug"
// means the same period and "Export" the same file wherever it is started.
//
// None of them talks to the bank. Überweisen and Geld anfordern open their
// sheets (the transfer still goes through its review, Namensabgleich and
// TAN); Kontoauszug and Export work on what is already loaded.

import { useCallback, useMemo } from 'react';
import { transactionsToCsv, csvFileName } from '@/lib/csv';
import { downloadText } from '@/lib/download';
import { dayKey, fmtRange } from '@/lib/format';
import type { SerializedTransaction } from '@/lib/fints-types';
import { useFints } from '../FintsProvider';

/** The Umsätze search field's id (components/transactions/TxFilterBar.tsx). */
const TX_SEARCH_ID = 'umsatz-suche';

/** Newest day first; bookings of one day keep the order the bank sent them in. */
function newestFirst(txs: readonly SerializedTransaction[]): SerializedTransaction[] {
  return txs
    .map((tx, i) => ({ tx, i, day: dayKey(tx.entryDate) }))
    .sort((a, b) => (a.day === b.day ? a.i - b.i : a.day < b.day ? 1 : -1))
    .map((r) => r.tx);
}

export type ShellActions = ReturnType<typeof useShellActions>;

export function useShellActions() {
  const {
    accounts, activeAccount, transactions, pendingCache, statementInfo, loadingAccount, bank,
    accountLabel, categoryOf, toast, openTransfer, openShare, printStatement, setTab,
  } = useFints();

  const acct = activeAccount?.accountNumber ?? null;
  const info = acct ? statementInfo[acct] : undefined;
  // What the documents describe is what was fetched — never a control's range.
  const loaded = !!activeAccount && !!transactions && !!info && loadingAccount !== acct;
  const rangeLabel = info ? fmtRange(info.from, info.to) : '';
  const rowCount = loaded ? (transactions?.length ?? 0) + (pendingCache[acct!]?.length ?? 0) : 0;

  const canTransfer = useMemo(() => accounts.some((a) => a.canTransfer), [accounts]);
  const canShare = useMemo(() => accounts.some((a) => !!a.iban), [accounts]);

  const transfer = useCallback(() => openTransfer(), [openTransfer]);
  const share = useCallback(() => openShare(), [openShare]);

  const statement = useCallback(() => {
    if (!loaded || !info) return;
    printStatement(info.from, info.to);
  }, [loaded, info, printStatement]);

  const exportCsv = useCallback(() => {
    if (!loaded || !activeAccount || !transactions || !info) return;
    // Vorgemerkte that were loaded for this account go first, flagged as such
    // in the Status column — they are on screen, so they belong in the file.
    // The provider has already dropped those the statement shows as booked,
    // so nothing is in the file twice.
    const pending = pendingCache[activeAccount.accountNumber] ?? [];
    const rows = [...newestFirst(pending), ...newestFirst(transactions)];
    if (!rows.length) {
      toast(`Keine Umsätze im Zeitraum ${rangeLabel} – es gibt nichts zu exportieren.`, 'info');
      return;
    }
    const csv = transactionsToCsv(rows, {
      account: activeAccount,
      bankName: bank?.name ?? '',
      accountLabel: accountLabel(activeAccount),
      categoryOf,
      pendingRows: new Set(pending),
    });
    downloadText(csvFileName(activeAccount, { from: info.from, to: info.to }), csv, 'text/csv;charset=utf-8');
    toast(`${rows.length} ${rows.length === 1 ? 'Umsatz' : 'Umsätze'} als CSV-Datei exportiert.`, 'success');
  }, [loaded, activeAccount, transactions, info, pendingCache, bank, accountLabel, categoryOf, toast, rangeLabel]);

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
    /** A file with nothing but a header row helps nobody. */
    canExport: rowCount > 0, exportCsv,
    /** Whether the active account's statement is loaded (a statement may be empty). */
    loaded,
    focusSearch,
    /** "05.07.–03.10.2026" — the loaded period of the active account, or ''. */
    rangeLabel,
  };
}
