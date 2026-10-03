// Booking fixtures in the two shapes the wire actually carries.
//
// Both go through lib-fints and lib/serialize.ts, and they differ in ways the
// analysis has to survive:
//
//   MT940 (HKKAZ)  dates are local midnight → "2026-10-02T22:00:00.000Z" for
//                  3 October in Berlin; transactionCode is the three-digit
//                  GVC; bookingText is the bank's caps label
//                  ("BASISLASTSCHRIFT"); when the :86: tags are space-separated
//                  the parser keeps only the SVWZ text as `purpose` and files
//                  CRED+ under remoteIdentifier — which serialize.ts maps onto
//                  remoteBic. When the bank runs the tags together, `purpose`
//                  keeps the whole raw "EREF+…MREF+…CRED+…SVWZ+…" string.
//   CAMT (HKCAZ)   date-only values become local noon; transactionCode is the
//                  ISO sub-family ("ESDD", "SALA", "POSD"); bookingText is the
//                  AddtlNtryInf in mixed case; the creditor ID has no field of
//                  its own and only survives if the bank wrote it into Ustrd.
//
// Import './tz.ts' (or this module) before building any date.

import './tz.ts';
import type { SerializedTransaction, StatementBlock } from '../fints-types';

const parts = (day: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) throw new Error(`fixture day must be yyyy-mm-dd: ${day}`);
  return [+m[1], +m[2] - 1, +m[3]] as const;
};

/** JSON of the Date lib-fints' MT940 parser builds: local midnight. */
export const mt940Date = (day: string) => {
  const [y, m, d] = parts(day);
  return new Date(y, m, d).toISOString();
};

/** JSON of the Date lib-fints' CAMT parser builds for a date-only value: local noon. */
export const camtDate = (day: string) => {
  const [y, m, d] = parts(day);
  return new Date(y, m, d, 12).toISOString();
};

type Common = {
  /** Buchungstag, yyyy-mm-dd. */
  day: string;
  /** Wertstellung; defaults to the Buchungstag. */
  valueDay?: string;
  amount: number;
  name?: string;
  iban?: string;
  currency?: string;
  mref?: string;
  eref?: string;
  statement?: string;
};

export type Mt940Input = Common & {
  /** Geschäftsvorfallcode, e.g. '105'. */
  gvc?: string;
  /** ?00 Buchungstext, e.g. 'BASISLASTSCHRIFT'. */
  text?: string;
  /** The SVWZ text as lib-fints leaves it, or a raw tag run (see `rawTags`). */
  purpose?: string;
  /** Creditor ID — lands in remoteBic, as serialize.ts maps remoteIdentifier. */
  cred?: string;
  bic?: string;
  /**
   * The bank ran the tags together without spaces: lib-fints cannot split
   * them, so purpose carries EREF/MREF/CRED/SVWZ raw and the fields stay empty.
   */
  rawTags?: boolean;
};

export function mt940(p: Mt940Input): SerializedTransaction {
  const svwz = p.purpose ?? '';
  const raw = p.rawTags
    ? `${p.eref ? `EREF+${p.eref}` : ''}${p.mref ? `MREF+${p.mref}` : ''}${p.cred ? `CRED+${p.cred}` : ''}SVWZ+${svwz}`
    : svwz;
  return {
    valueDate: mt940Date(p.valueDay ?? p.day),
    entryDate: mt940Date(p.day),
    amount: p.amount,
    currency: p.currency ?? 'EUR',
    purpose: raw,
    bookingText: p.text ?? '',
    remoteName: p.name ?? '',
    remoteIban: p.iban ?? '',
    remoteBic: p.rawTags ? (p.bic ?? '') : (p.cred ?? p.bic ?? ''),
    // With run-together tags lib-fints puts everything after EREF+ here.
    e2eReference: p.rawTags ? (p.eref ? raw.slice(5) : '') : (p.eref ?? ''),
    mandateReference: p.rawTags ? '' : (p.mref ?? ''),
    customerReference: 'NONREF',
    bankReference: '',
    transactionCode: p.gvc ?? '',
    primeNotesNr: '9248',
    textKeyExtension: '',
    additionalInformation: '',
    statementNumber: p.statement ?? '00001/001',
  };
}

export type CamtInput = Common & {
  /** ISO sub-family code, e.g. 'ESDD'. */
  code?: string;
  /** AddtlNtryInf, e.g. 'SEPA-Basislastschrift'. */
  text?: string;
  /** RmtInf/Ustrd. */
  purpose?: string;
  bic?: string;
  ref?: string;
};

export function camt(p: CamtInput): SerializedTransaction {
  return {
    valueDate: camtDate(p.valueDay ?? p.day),
    entryDate: camtDate(p.day),
    amount: p.amount,
    currency: p.currency ?? 'EUR',
    purpose: p.purpose ?? '',
    bookingText: p.text ?? '',
    remoteName: p.name ?? '',
    remoteIban: p.iban ?? '',
    remoteBic: p.bic ?? '',
    e2eReference: p.eref ?? 'NOTPROVIDED',
    mandateReference: p.mref ?? '',
    customerReference: p.eref ?? 'NOTPROVIDED',
    bankReference: p.ref ?? '',
    transactionCode: p.code ?? '',
    primeNotesNr: '',
    textKeyExtension: '',
    additionalInformation: p.text ?? '',
    statementNumber: p.statement ?? '1',
  };
}

/** A statement block as statementBlocks() serialises it. */
export function block(p: {
  open: number | null;
  openDay: string | null;
  close: number | null;
  closeDay: string | null;
  count: number;
  currency?: string;
  /** CAMT balances are date-only → local noon; MT940 → local midnight. */
  camt?: boolean;
}): StatementBlock {
  const at = p.camt ? camtDate : mt940Date;
  return {
    openingBalance: p.open,
    openingDate: p.openDay ? at(p.openDay) : null,
    closingBalance: p.close,
    closingDate: p.closeDay ? at(p.closeDay) : null,
    currency: p.currency ?? 'EUR',
    count: p.count,
  };
}

/** Newest first, the way serializeTransactions hands them to the browser. */
export const newestFirst = (txs: readonly SerializedTransaction[]) =>
  [...txs].sort((a, b) => new Date(b.entryDate).getTime() - new Date(a.entryDate).getTime());

// ---------------------------------------------------------------------------
// Counterparties that recur across the suites
// ---------------------------------------------------------------------------

export const OWN_GIRO = 'DE02120300000000202051';
export const OWN_SAVINGS = 'DE12500105170648489890';
export const OWN_IBANS = [OWN_GIRO, OWN_SAVINGS];

export const IBAN = {
  employer: 'DE89370400440532013000',
  landlord: 'DE75512108001245126199',
  netflix: 'NL91ABNA0417164300',
  paypal: 'LU89751000135104200E',
  stadtwerke: 'DE44500105175407324931',
  insurer: 'DE27100777770209299700',
  person: 'DE91100000000123456789',
  rewe: 'DE37500700100953901000',
  kfz: 'DE68210501700012345678',
} as const;

export const CRED = {
  netflix: 'NL57ZZZ342486780000',
  paypal: 'LU96ZZZ0000000000000000058',
  stadtwerke: 'DE98ZZZ09999999999',
  insurer: 'DE51ZZZ00000012345',
  kfz: 'DE21ZZZ00000098765',
  gym: 'DE33ZZZ00000055555',
} as const;
