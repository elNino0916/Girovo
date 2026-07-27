'use client';

// TEMPORARY design-verification harness. Delete after review.

import { FintsContext, type FintsApi } from '@/components/FintsProvider';
import { Dashboard } from '@/components/Dashboard';
import type { SerializedAccount, SerializedTransaction } from '@/lib/fints-types';

const acct = (n: string, iban: string, product: string, type: string): SerializedAccount => ({
  accountNumber: n, iban, bic: 'MALADE51KOB', currency: 'EUR', accountType: type,
  holder: 'NINO BORNEMANN', product, limit: null,
  canStatements: true, canBalance: true, canTransfer: true, canInstant: true, canPending: true,
});

const accounts = [
  acct('0105593271', 'DE78570501200105593271', 'GiroKomfort17', '10'),
  acct('0105593272', 'DE78570501200105593272', 'S-Sparkonto', '20'),
  acct('0105593273', 'DE78570501200105593273', 'Tagesgeld Plus', '20'),
];

const tx = (
  d: string, amount: number, remoteName: string, purpose: string, bookingText: string,
): SerializedTransaction => ({
  valueDate: d, entryDate: d, amount, currency: 'EUR', purpose, bookingText,
  remoteName, remoteIban: 'DE02120300000000202051', remoteBic: 'BYLADEM1001',
  e2eReference: '1051808585130', mandateReference: '5RRJ2259NXZLLC',
  customerReference: 'NONREF', bankReference: 'B' + d + amount, transactionCode: '166',
  primeNotesNr: '9021', textKeyExtension: '', additionalInformation: '', statementNumber: '014',
});

const today = new Date().toISOString().slice(0, 10);
const yest = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const older = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10);

const transactions = [
  tx(today, -12.99, 'NETFLIX INTERNATIONAL B.V.', 'EREF+1051808585130MREF+5RRJ2259NXZLLCRED+LU96ZZZ0000000000000000058SVWZ+Netflix Abo Juli 2026', 'LASTSCHRIFT'),
  tx(today, 2480.5, 'ARBEITGEBER GMBH', 'SVWZ+Gehalt Juli 2026 Personalnummer 44821', 'GUTSCHRIFT'),
  tx(yest, -64.2, 'REWE SAGT DANKE 123456', 'SVWZ+Einkauf', 'KARTENZAHLUNG'),
  tx(yest, -1250, 'STADTWERKE KOBLENZ', 'EREF+SW-2026-0714-8891MREF+SWK889120CRED+DE98ZZZ09999999999SVWZ+Abschlag Strom und Gas 07/2026', 'LASTSCHRIFT'),
  tx(older, -9.99, 'G2A.COM Limited', 'EREF+1051808585130MREF+5RRJ2259NXZLLCRED+LU96ZZZ0000000000000000058SVWZ+G2A.COM Limited', 'PAYPAL'),
  tx(older, 150, 'MAX MUSTERMANN', 'Rueckzahlung Urlaubskasse', 'UEBERWEISUNG'),
];

const mock = {
  bank: { name: 'Sparkasse Koblenz', blz: '57050120', brand: 'sparkasse' },
  logoFiles: {},
  accounts,
  activeAccount: accounts[0],
  balances: {
    '0105593271': { balance: 1196.22, currency: 'EUR', date: today, availableAmount: 2196.22 },
    '0105593272': { balance: 8420.0, currency: 'EUR', date: today, availableAmount: 8420.0 },
    '0105593273': { balance: -184.35, currency: 'EUR', date: today, availableAmount: 0 },
  },
  transactions,
  loadingAccount: null,
  txError: null,
  pendingCache: { '0105593271': [tx(today, -49.9, 'AMAZON EU S.A R.L.', 'SVWZ+Bestellung 302-8841923', 'KARTENZAHLUNG')] },
  pendingLoading: null,
  merchants: {},
  busy: false,
  deviceRemembered: true,
  toasts: [],
  printJob: null,
  selectAccount: () => {},
  refreshAccount: () => {},
  loadPending: () => {},
  forgetDevice: () => {},
  logout: () => {},
  printStatement: () => {},
  printTransaction: () => {},
  toast: () => {},
} as unknown as FintsApi;

export default function DesignPreview() {
  return (
    <FintsContext.Provider value={mock}>
      <Dashboard />
    </FintsContext.Provider>
  );
}
