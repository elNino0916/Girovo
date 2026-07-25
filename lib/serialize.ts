// Serialisers — map lib-fints objects to plain JSON for the frontend.

import type { AccountBalance, ClientResponse, Statement } from 'lib-fints';
import type { TanMethod } from './fints-types';
import { lookupBlz } from './banks';
import { INSTANT_SEG, TRANSFER_SEG } from './fints-sepa';
import { PENDING_SEG } from './fints-pending';
import type {
  SerializedAccount, SerializedBalance, SerializedTanMethod, SerializedTransaction, TanRequired,
} from './fints-types';
import type { Session } from './session';

export function serializeTanMethod(m: TanMethod): SerializedTanMethod {
  return {
    id: m.id,
    name: m.name,
    version: m.version,
    isDecoupled: m.isDecoupled,
    activeTanMedia: m.activeTanMedia || [],
    tanMediaRequirement: m.tanMediaRequirement,
    decoupled: m.decoupled
      ? {
          waitBeforeFirst: m.decoupled.waitingSecondsBeforeFirstStatusRequest,
          waitBetween: m.decoupled.waitingSecondsBetweenStatusRequests,
          maxStatusRequests: m.decoupled.maxStatusRequests,
        }
      : null,
  };
}

export function accountsFor(s: Session): SerializedAccount[] {
  const cfg = s.client.config;
  const accts = cfg.bankingInformation?.upd?.bankAccounts || [];
  const bankSupports = (segId: string) => cfg.isTransactionSupported(segId);
  const acctSupports = (a: (typeof accts)[number], segId: string) =>
    !!a.allowedTransactions?.find((t) => t.transId === segId);
  return accts.map((a) => ({
    accountNumber: a.accountNumber,
    iban: a.iban || null,
    bic: lookupBlz(a.bank?.bankId)?.bic || null,
    currency: a.currency || 'EUR',
    accountType: a.accountType,
    holder: [a.holder1, a.holder2].filter(Boolean).join(', '),
    product: a.product || null,
    // HIUPD nests the figure one level down (limit.limitAmount.value); the
    // Express version read limit.value, which never existed and always sent null.
    limit: a.limit?.limitAmount?.value ?? null,
    canStatements: acctSupports(a, 'HKKAZ') || acctSupports(a, 'HKCAZ'),
    canBalance: acctSupports(a, 'HKSAL'),
    canTransfer: bankSupports(TRANSFER_SEG) && acctSupports(a, TRANSFER_SEG) && !!a.iban,
    canInstant: bankSupports(INSTANT_SEG) && acctSupports(a, INSTANT_SEG) && !!a.iban,
    canPending: bankSupports(PENDING_SEG) && acctSupports(a, PENDING_SEG),
  }));
}

export function serializeBalance(b: AccountBalance | undefined | null): SerializedBalance | null {
  if (!b) return null;
  return {
    balance: b.balance,
    currency: b.currency,
    date: b.date,
    availableAmount: b.availableAmount ?? null,
    creditLimit: b.creditLimit ?? null,
    notedBalance: b.notedBalance ?? null,
  };
}

// The account statement already carries the current balance (closingBalance),
// so one statement query yields both Umsätze and Kontostand — avoiding a
// second SCA approval for a separate balance request.
//
// The "Stand" (as-of) date is the MT940 :62F: closing-balance date, i.e. the
// day the balance was last booked. We must pick the *newest* closing balance:
// some banks return statement blocks newest-first, so taking the positionally
// last block would yield the oldest balance (and a long-stale date).
export function balanceFromStatements(statements: Statement[] | undefined): SerializedBalance | null {
  const withBalance = (statements || []).filter((s) => s.closingBalance?.date);
  if (!withBalance.length) return null;

  const cbTime = (s: Statement) => {
    const t = new Date(s.closingBalance.date).getTime();
    return Number.isNaN(t) ? -Infinity : t;
  };
  const last = withBalance.reduce((a, b) => (cbTime(b) >= cbTime(a) ? b : a));
  const cb = last.closingBalance;
  const av = last.availableBalance;

  return {
    balance: cb.value,
    currency: cb.currency,
    date: cb.date, // MT940 :62F: — the day the balance was last booked
    availableAmount: av ? av.value : null,
  };
}

// Date-only diagnostics for the "Stand" issue — no amounts, names or IBANs are
// logged. Shows how the bank ordered its statement blocks and where the newest
// closing balance sits, so a stale "Stand" date can be traced to real data.
export function logStatementDates(accountNumber: string, statements: Statement[] | undefined): void {
  const iso = (d: Date | string) => {
    const t = new Date(d);
    return Number.isNaN(t.getTime()) ? '??' : t.toISOString().slice(0, 10);
  };
  const blocks = (statements || []).map((s, i) => {
    const txDates = (s.transactions || []).map((t) => t.entryDate || t.valueDate).filter(Boolean);
    const newestTx = txDates.length
      ? iso(txDates.reduce((a, b) => (new Date(b) > new Date(a) ? b : a)))
      : '-';
    return `#${i} close=${s.closingBalance ? iso(s.closingBalance.date) : '-'} txs=${(s.transactions || []).length} newestTx=${newestTx}`;
  });
  console.log(`[stmt-dates] acct=${accountNumber} blocks=${statements?.length ?? 0} | ${blocks.join(' | ')}`);
}

export function serializeTransactions(statements: Statement[] | undefined): SerializedTransaction[] {
  const txs: SerializedTransaction[] = [];
  for (const st of statements || []) {
    for (const t of st.transactions || []) {
      txs.push({
        valueDate: t.valueDate,
        entryDate: t.entryDate,
        amount: t.amount, // already signed: debit negative, credit positive
        currency: st.closingBalance?.currency || 'EUR',
        purpose: t.purpose || '',
        bookingText: t.bookingText || '',
        remoteName: t.remoteName || '',
        remoteIban: t.remoteAccountNumber || '',
        remoteBic: t.remoteIdentifier || t.remoteBankId || '',
        e2eReference: t.e2eReference || '',
        mandateReference: t.mandateReference || '',
        customerReference: t.customerReference || '',
        bankReference: t.bankReference || '',
        transactionCode: t.transactionCode || '',
        primeNotesNr: t.primeNotesNr || '',
        textKeyExtension: t.textKeyExtension || '',
        additionalInformation: t.additionalInformation || '',
        statementNumber: st.number || '',
      });
    }
  }
  // newest first
  txs.sort((a, b) => new Date(b.entryDate || b.valueDate || 0).getTime() - new Date(a.entryDate || a.valueDate || 0).getTime());
  return txs;
}

export function tanPayload(resp: ClientResponse): TanRequired {
  return {
    needsTan: true,
    decoupled: true,
    tanChallenge: resp.tanChallenge || null,
    tanMediaName: resp.tanMediaName || null,
  };
}

export function bankAnswerText(resp: ClientResponse): string {
  return (resp.bankAnswers || []).map((a) => `${a.code}: ${a.text}`).join(' | ');
}

// Log the bank's return codes for a response — this is what we need to see the
// exact decoupled-TAN handshake a bank uses.
export function logResp(label: string, s: Pick<Session, 'client'> | null, resp: ClientResponse): void {
  const codes = (resp.bankAnswers || []).map((a) => `${a.code}:${a.text}`).join(' | ');
  const ended = s?.client?.currentDialog?.hasEnded;
  console.log(`[${label}] requiresTan=${resp.requiresTan} success=${resp.success} hasEnded=${ended} tanRef=${resp.tanReference || '-'}`);
  console.log(`         codes: ${codes || '(none)'}`);
}
