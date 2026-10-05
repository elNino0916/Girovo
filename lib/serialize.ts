// Serialisers — map lib-fints objects to plain JSON for the frontend.

import type { AccountBalance, Balance, ClientResponse, Statement } from 'lib-fints';
import type { TanMethod } from './fints-types';
import { lookupBlz } from './banks';
import { nearestEntryYear } from './entry-date';
import { repairBankText } from './format';
import { parsePurpose } from './sepa-purpose';
import { INSTANT_SEG, TRANSFER_SEG } from './fints-sepa';
import { PENDING_SEG } from './fints-pending';
import type {
  SerializedAccount, SerializedBalance, SerializedTanMethod, SerializedTransaction,
  SerializedVop, StatementBlock, TanRequired,
} from './fints-types';
import type { VopResult } from './fints-vop';
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

  // Diagnostics for "the pending panel doesn't show" reports: unlike HKCCS/
  // HKIPZ (sending money — genuinely gated bank-wide by product agreement),
  // HKVMK is a read-only per-account query like HKKAZ/HKSAL, and some banks
  // don't bother (re-)advertising it in the bank-wide BPD list even though the
  // account-level UPD grants it. Log both sides so a report of "no pending
  // panel" can be traced to whichever list is actually missing HKVMK.
  const bpdIds = (cfg.bankingInformation?.bpd?.allowedTransactions || []).map((t) => t.transId);
  console.log(`[accounts] BPD transactions: ${bpdIds.join(', ') || '(none)'}`);
  for (const a of accts) {
    const acctIds = (a.allowedTransactions || []).map((t) => t.transId);
    console.log(`[accounts] acct ...${String(a.accountNumber).slice(-4)} UPD transactions: ${acctIds.join(', ') || '(none)'}`);
  }

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
    // Read-only query (like statements/balance above) — gate on the account's
    // own UPD grant only, not also on the bank-wide BPD list (see note above).
    canPending: acctSupports(a, PENDING_SEG),
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

/** A balance as the bank sent it, or null — never a stand-in. */
function blockBalance(b: Balance | undefined | null): { value: number; date: string } | null {
  if (!b || typeof b.value !== 'number' || !Number.isFinite(b.value)) return null;
  const t = new Date(b.date).getTime();
  if (Number.isNaN(t)) return null;
  // JSON's own rendering of a Date, so the client parses these exactly like
  // the bookings' entryDate/valueDate (and buckets them by *local* day).
  return { value: b.value, date: new Date(t).toISOString() };
}

/**
 * Each statement block's own opening and closing balance, for the client to
 * verify a Kontoverlauf against (lib/balance-history.ts). Blocks keep the
 * bank's order — some send newest first, see balanceFromStatements.
 *
 * lib-fints' CAMT parser fills gaps with balances the bank never sent, and a
 * made-up figure must not pass verification. Both stand-ins are recognisable
 * by identity, because the parser builds every real balance from its own XML
 * node, with its own Date:
 *   - a missing opening becomes { value: 0, date: closing.date } — a zero
 *     that shares the closing balance's very Date object;
 *   - a missing closing becomes the opening balance object itself.
 * MT940 leaves a missing :60F:/:62F: undefined, which maps to null anyway.
 */
export function statementBlocks(statements: Statement[] | undefined): StatementBlock[] {
  return (statements || []).map((st) => {
    const ob = st.openingBalance as Balance | undefined;
    const cb = st.closingBalance as Balance | undefined;
    const openingInvented = !!ob && !!cb && ob !== cb && ob.value === 0 && ob.date === cb.date;
    const closingCopied = !!ob && ob === cb;
    const opening = openingInvented ? null : blockBalance(ob);
    const closing = closingCopied ? null : blockBalance(cb);
    return {
      openingBalance: opening?.value ?? null,
      openingDate: opening?.date ?? null,
      closingBalance: closing?.value ?? null,
      closingDate: closing?.date ?? null,
      currency: cb?.currency || ob?.currency || 'EUR',
      count: (st.transactions || []).length,
    };
  });
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
    const txDates = (s.transactions || [])
      .map((t) => (t.entryDate ? nearestEntryYear(t.entryDate, t.valueDate) : t.valueDate))
      .filter(Boolean);
    const newestTx = txDates.length
      ? iso(txDates.reduce((a, b) => (new Date(b) > new Date(a) ? b : a)))
      : '-';
    return `#${i} close=${s.closingBalance ? iso(s.closingBalance.date) : '-'} txs=${(s.transactions || []).length} newestTx=${newestTx}`;
  });
  console.log(`[stmt-dates] acct=${accountNumber} blocks=${statements?.length ?? 0} | ${blocks.join(' | ')}`);
}

/**
 * The "abweichender Empfänger" of a payment or the "abweichender Auftraggeber"
 * of money coming in — the shop behind a card processor, the employer behind
 * a payroll service. lib-fints reads it from ABWE+/ABWA+ (MT940) and
 * UltmtCdtr/UltmtDbtr (CAMT) through this app's patch; a bank that runs the
 * SEPA tags together without spaces leaves them in the purpose, so that is the
 * fallback. Only the side facing the other party counts: on a payment the
 * ultimate *debtor* is the customer, not the shop.
 */
function ultimateParty(t: Statement['transactions'][number]): string {
  const credit = Number(t.amount) > 0;
  const own = (credit ? t.ultimateDebtor : t.ultimateCreditor) || '';
  const tagged = own ? '' : parsePurpose(t.purpose).fields.find((f) => f.tag === (credit ? 'ABWA' : 'ABWE'))?.value || '';
  return repairBankText(own || tagged).replace(/\s+/g, ' ').trim();
}

/**
 * `currency` stands in where a statement names none: MT942 and a camt report
 * of Vormerkposten carry no balance to read it from. Pass the account's.
 */
export function serializeTransactions(statements: Statement[] | undefined, currency = 'EUR'): SerializedTransaction[] {
  const txs: SerializedTransaction[] = [];
  for (const st of statements || []) {
    for (const t of st.transactions || []) {
      txs.push({
        valueDate: t.valueDate,
        // MT940 names the Buchungstag without a year, and lib-fints guesses
        // it wrong across the turn of the year (lib/entry-date.ts).
        entryDate: nearestEntryYear(t.entryDate, t.valueDate),
        amount: t.amount, // already signed: debit negative, credit positive
        currency: st.closingBalance?.currency || currency,
        // Repaired here, once, so the list, the CSV, the categories and the
        // logo lookup all see 'Thüringen' rather than the bank's 'ThA.ringen'.
        purpose: repairBankText(t.purpose || ''),
        bookingText: t.bookingText || '',
        remoteName: repairBankText(t.remoteName || ''),
        remoteIban: t.remoteAccountNumber || '',
        // lib-fints files MT940's CRED+/DEBT+ under remoteIdentifier. That is
        // the creditor's SEPA identifier, not a bank code — it used to be
        // preferred here, which put a Gläubiger-ID where the BIC belongs (on
        // screen and on the printed Buchungsbeleg).
        remoteBic: t.remoteBankId || '',
        creditorId: t.remoteIdentifier || '',
        ultimateName: ultimateParty(t),
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

/** The account's currency as the UPD names it — 'EUR' when it names none. */
export function accountCurrency(s: Pick<Session, 'client'>, accountNumber: string): string {
  try {
    return s.client.config.getBankAccount(accountNumber)?.currency || 'EUR';
  } catch {
    return 'EUR'; // not in the UPD, or not unique there
  }
}

/**
 * The Vorgemerkte a statement answer carried: undefined when it carried none,
 * null when they could not be read. Kept apart from the bookings: never part
 * of balanceFromStatements, statementBlocks or logStatementDates.
 */
export function serializeNoted(
  s: Pick<Session, 'client'>,
  accountNumber: string,
  statements: Statement[] | null | undefined,
): SerializedTransaction[] | null | undefined {
  if (!statements) return statements;
  return serializeTransactions(statements, accountCurrency(s, accountNumber));
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
  return (resp.bankAnswers || [])
    .map((a) => `${a.code}: ${repairBankText(a.text || '')}`)
    .join(' | ');
}

/** The bank's return codes as a set — the VoP flow is steered by these. */
export function bankAnswerCodes(resp: ClientResponse): Set<number> {
  return new Set((resp.bankAnswers || []).map((a) => a.code));
}

export function serializeVop(vop: VopResult, submittedName: string): SerializedVop {
  return {
    verdict: vop.verdict,
    suggestedName: vop.suggestedName,
    reason: vop.reason,
    infoText: vop.infoText,
    submittedName,
    iban: vop.iban,
    validTo: vop.validTo,
  };
}

// Log the bank's return codes for a response — this is what we need to see the
// exact decoupled-TAN handshake a bank uses.
export function logResp(label: string, s: Pick<Session, 'client'> | null, resp: ClientResponse): void {
  const codes = (resp.bankAnswers || []).map((a) => `${a.code}:${a.text}`).join(' | ');
  const ended = s?.client?.currentDialog?.hasEnded;
  console.log(`[${label}] requiresTan=${resp.requiresTan} success=${resp.success} hasEnded=${ended} tanRef=${resp.tanReference || '-'}`);
  console.log(`         codes: ${codes || '(none)'}`);
}
