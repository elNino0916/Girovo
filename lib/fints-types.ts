// Shared types for the FinTS layer.
//
// Two things live here:
//   1. Extensions of lib-fints' response/client surface for the custom segments
//      (HKCCS/HKIPZ/HKVMK) that this app registers itself.
//   2. The JSON contract between the route handlers and the browser. Both sides
//      import from here, so a change to a payload shape is a type error rather
//      than a runtime surprise.

import type { ClientResponse, FinTSClient, Statement } from 'lib-fints';
import type { CustomerOrderInteraction } from './fints-internals.js';
import type { VopVerdict } from './fints-vop';

export type { TanMethod } from './fints-internals.js';
export type { VopVerdict };

// ---------------------------------------------------------------------------
// lib-fints extensions
// ---------------------------------------------------------------------------

/** HIIPZ (Echtzeitüberweisung) reports an order id and status; HICCS does not. */
export type TransferResult = {
  orderId: string | null;
  cancellationCode: string | null;
  orderStatus: string | null;
};

export type ClientResponseWithResult = ClientResponse & {
  transferResult?: TransferResult;
  /** Vormerkposten parsed from the MT942 in HIVMK. */
  pendingStatements?: Statement[];
};

/**
 * `startCustomerOrderInteraction` / `continueCustomerInteractionWithTan` drive
 * the custom segments, and `currentDialog` tells us whether the bank closed the
 * dialog between decoupled status polls. All three are marked private in the
 * published declarations even though they are ordinary runtime members, so the
 * client is widened here rather than silenced at each call site.
 *
 * The mapped type is what makes that possible: intersecting a class type that
 * has private members with an object type declaring the same names collapses to
 * `never`, while `{ [K in keyof FinTSClient]: … }` keeps only the public
 * surface and drops the private brand.
 */
type PublicFinTSClient = { [K in keyof FinTSClient]: FinTSClient[K] };

export type FinTSClientEx = PublicFinTSClient & {
  currentDialog?: { hasEnded: boolean };
  startCustomerOrderInteraction(interaction: CustomerOrderInteraction): Promise<ClientResponseWithResult>;
  continueCustomerInteractionWithTan(segIds: string[], tanReference: string, tan?: string): Promise<ClientResponseWithResult>;
};

// ---------------------------------------------------------------------------
// Wire format: server → browser
// ---------------------------------------------------------------------------

export type BankMeta = {
  blz: string;
  bankName: string;
  brand: string;
  bic: string | null;
};

export type SerializedTanMethod = {
  id: number;
  name: string;
  version: number;
  isDecoupled: boolean;
  activeTanMedia: string[];
  tanMediaRequirement: number;
  decoupled: {
    waitBeforeFirst: number;
    waitBetween: number;
    maxStatusRequests: number;
  } | null;
};

export type SerializedAccount = {
  accountNumber: string;
  iban: string | null;
  bic: string | null;
  currency: string;
  accountType: string;
  holder: string;
  product: string | null;
  limit: number | null;
  canStatements: boolean;
  canBalance: boolean;
  canTransfer: boolean;
  canInstant: boolean;
  canPending: boolean;
};

export type SerializedBalance = {
  balance: number;
  currency: string;
  date: Date | string;
  availableAmount: number | null;
  creditLimit?: number | null;
  notedBalance?: number | null;
};

export type SerializedTransaction = {
  valueDate: Date | string;
  entryDate: Date | string;
  /** Already signed: debit negative, credit positive. */
  amount: number;
  currency: string;
  purpose: string;
  bookingText: string;
  remoteName: string;
  remoteIban: string;
  /** The counterparty's BIC (MT940 ?30 may carry a BLZ instead). Never a creditor ID. */
  remoteBic: string;
  /**
   * The SEPA creditor identifier (or, rarely, debtor identifier) the bank
   * filed separately — MT940's CRED+/DEBT+. Optional because CAMT leaves it
   * inside the purpose; read it through txCreditorId() in lib/categories.ts,
   * which looks in both places.
   */
  creditorId?: string;
  e2eReference: string;
  mandateReference: string;
  customerReference: string;
  bankReference: string;
  transactionCode: string;
  primeNotesNr: string;
  textKeyExtension: string;
  additionalInformation: string;
  statementNumber: string;
};

/**
 * One MT940/CAMT statement block's own balances, exactly as the bank sent them.
 *
 * The client uses these to *verify* a reconstructed balance history — opening
 * plus the block's bookings must land on its closing — and refuses to draw a
 * Kontoverlauf it cannot check. A balance the bank omitted is null, never 0:
 * lib-fints' CAMT parser substitutes 0 for a missing opening balance, and a
 * made-up zero must not pass as a real figure.
 */
export type StatementBlock = {
  openingBalance: number | null;
  openingDate: string | null;
  closingBalance: number | null;
  closingDate: string | null;
  currency: string;
  /** Bookings in this block. */
  count: number;
};

export type BankMessage = { subject: string; text: string };

/** Every TAN-gated endpoint answers with this shape when the bank wants SCA. */
export type TanRequired = {
  needsTan: true;
  decoupled: true;
  tanChallenge: string | null;
  tanMediaName: string | null;
  accountNumber?: string;
};

export type ConnectResponse =
  | {
      sessionId: string;
      bank: BankMeta;
      restored: true;
      accounts: SerializedAccount[];
      selectedTanMethod: SerializedTanMethod | null;
    }
  | {
      sessionId: string;
      bank: BankMeta;
      restored?: false;
      tanMethods: SerializedTanMethod[];
      bankMessages: BankMessage[];
    };

export type SelectTanResponse =
  | { chooseTanMedia: string[] }
  | TanRequired
  | { needsTan: false; accounts: SerializedAccount[]; deviceSaved: boolean };

export type TanPollResponse =
  | { status: 'pending' }
  | { status: 'dialog_ended'; type: string; accountNumber?: string }
  | { status: 'done'; kind: 'accounts'; accounts: SerializedAccount[]; deviceSaved: boolean }
  | { status: 'done'; kind: 'balance'; accountNumber?: string; balance: SerializedBalance | null }
  | { status: 'done'; kind: 'statements'; accountNumber?: string; transactions: SerializedTransaction[]; balance: SerializedBalance | null; blocks?: StatementBlock[] }
  | { status: 'done'; kind: 'pending'; accountNumber?: string; pending: SerializedTransaction[] }
  | { status: 'done'; kind: 'transfer'; accountNumber?: string; transferResult: TransferResult | null; bankAnswers: string };

export type TransactionsResponse =
  | TanRequired
  | { needsTan: false; accountNumber: string; transactions: SerializedTransaction[]; balance: SerializedBalance | null; blocks?: StatementBlock[] };

export type PendingResponse =
  | TanRequired
  | { needsTan: false; accountNumber: string; pending: SerializedTransaction[] };

export type BalanceResponse =
  | TanRequired
  | { needsTan: false; accountNumber: string; balance: SerializedBalance | null };

/**
 * What the Namensabgleich turned up, as shown to the user before the transfer
 * is authorised. `verdict` is the bank's own comparison of the payee name we
 * sent against the name behind the IBAN.
 */
export type SerializedVop = {
  verdict: VopVerdict;
  /** The name the bank holds for that IBAN — sent on a Close Match. */
  suggestedName: string | null;
  /** Why no check was possible (Not Applicable). */
  reason: string | null;
  /** The bank's legally required explanation; shown verbatim. */
  infoText: string | null;
  /** The name we submitted, for a side-by-side comparison. */
  submittedName: string;
  iban: string | null;
  validTo: string | null;
};

export type TransferResponse =
  | (TanRequired & { vop?: SerializedVop })
  /** The bank voided the challenge: the user must confirm the VoP result first. */
  | { needsVop: true; accountNumber: string; vop: SerializedVop }
  | { needsTan: false; accountNumber: string; transferResult: TransferResult | null; bankAnswers: string; vop?: SerializedVop };

export type MetaResponse = {
  productRegistered: boolean;
  bankCount: number;
  /** Whether counterparty names may be matched against Brandfetch for logos. */
  merchantLogos: boolean;
};

/** A counterparty recognised as a company, with a logo to show for it. */
export type Merchant = {
  id: string;
  label: string;
  logo: string;
  /**
   * The payment provider the purchase went through, when the shop was only
   * identifiable from the Verwendungszweck because the booking's counterparty
   * was the provider itself. Present exactly when the row shows one company's
   * mark but the statement names another.
   */
  via?: { label: string; logo: string };
};

export type MerchantsResponse = Record<string, Merchant | null>;

export type BankSearchHit = {
  blz: string;
  name: string;
  location: string;
  bic: string;
  url: string;
  brand: string;
};
