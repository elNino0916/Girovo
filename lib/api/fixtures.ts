// Fake data for the Girovo API's tests (lib/api/*.test.ts): three accounts,
// a few bookings, a contract, budgets and a goal.

import type { SerializedAccount, SerializedTransaction } from '../fints-types';
import type { CategoryId, CategoryResult } from '../categories';
import type { RecurringSeries } from '../recurring';
import type { ApiData } from './methods.ts';

// i18n-data-start: bank data as a bank would send it, not interface text.
export const account = (accountNumber: string, extra: Partial<SerializedAccount> = {}): SerializedAccount => ({
  accountNumber, iban: `DE0012345678000000${accountNumber.slice(-4)}`, bic: null, currency: 'EUR', accountType: 'Girokonto',
  holder: 'Nino', product: null, limit: null, canStatements: true, canBalance: true, canTransfer: true, canInstant: false,
  canPending: false, ...extra,
});

export const tx = (day: string, amount: number, name: string, extra: Partial<SerializedTransaction> = {}): SerializedTransaction => ({
  valueDate: day, entryDate: day, bankDay: day, amount, currency: 'EUR', purpose: `Zahlung ${name}`, bookingText: 'Lastschrift',
  remoteName: name, remoteIban: 'DE02120300000000202051', remoteBic: '', e2eReference: '', mandateReference: '',
  customerReference: '', bankReference: '', transactionCode: '', primeNotesNr: '', textKeyExtension: '',
  additionalInformation: '', statementNumber: '', ...extra,
});

const CATS: Record<string, CategoryId> = { Rewe: 'groceries', Miete: 'housing', Arbeitgeber: 'income', Netflix: 'media', Umbuchung: 'transfer' };

export function fakeData(): ApiData {
  const giro = [
    tx('2026-11-03', -54.2, 'Rewe'),
    tx('2026-11-01', -900, 'Miete'),
    tx('2026-10-30', 2500, 'Arbeitgeber'),
    tx('2026-10-15', -12.99, 'Netflix'),
    tx('2026-10-12', -40.1, 'Rewe'),
    tx('2026-10-05', -200, 'Umbuchung'),
  ];
  const savings = [tx('2026-10-05', 200, 'Umbuchung')];
  const categoryOf = (t: SerializedTransaction): CategoryResult => {
    if (t.remoteName === 'Rewe' && t.amount === -54.2) return { id: 'groceries', source: 'manual', parts: [{ id: 'groceries', amount: -44.2 }, { id: 'shopping', amount: -10 }] };
    return { id: CATS[t.remoteName] ?? 'other', source: 'auto' };
  };
  const series = {
    id: 'ser1', key: 'out|x', kind: 'expense', name: 'NETFLIX INT', customName: 'Netflix', iban: null, creditorId: null, mandateReference: null,
    directDebit: true, category: 'media', cadence: 'monthly', cadenceLabel: 'monatlich', intervalDays: 30, amount: -12.99, lastAmount: -12.99,
    previousAmount: -12.99, changed: false, change: null, priceChange: null, variable: false, monthlyAmount: -12.99, yearlyAmount: -155.88,
    currency: 'EUR', count: 6, firstDate: '2026-05-15', lastDate: '2026-10-15', nextDate: '2026-11-17', overdue: false, ended: false, transactions: [],
  } as RecurringSeries;
  const all = [...giro];
  return {
    accounts: [
      { key: '1001', account: account('1001'), label: 'Girokonto', bank: 'Testbank', balance: { balance: 1234.56, currency: 'EUR', date: '2026-11-14', availableAmount: 2234.56 } },
      { key: '2002@12345678', account: account('2002', { accountType: 'Tagesgeld' }), label: 'Urlaub', bank: 'Andere Bank', balance: { balance: 800, currency: 'EUR', date: '2026-11-14', availableAmount: null } },
      { key: '3003', account: account('3003', { iban: null, accountType: 'Depot' }), label: 'Depot', bank: 'Testbank', balance: null },
    ],
    txByAccount: { 1001: giro, '2002@12345678': savings },
    categoryOf,
    categoryName: (id) => ({ groceries: 'Lebensmittel', shopping: 'Shopping', housing: 'Wohnen', income: 'Einkommen', media: 'Medien', transfer: 'Umbuchung' }[id as string] ?? 'Sonstiges'),
    noteOf: (t) => (t.remoteName === 'Miete' ? 'Nebenkosten' : null),
    scope: { txs: all, from: '2026-08-16', to: '2026-11-14', currency: 'EUR' },
    contracts: [series],
    budgets: { groceries: 30000, housing: 80000 },
    goals: [{ accountNumber: '2002@12345678', name: 'Urlaub', target: 200000, by: '2027-06' }],
    today: '2026-11-14',
  };
}
// i18n-data-end
