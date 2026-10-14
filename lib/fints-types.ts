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
import type { DatedRules, OrderSchedule, StandingRules } from './order-schedule';

export type { TanMethod } from './fints-internals.js';
export type { VopVerdict };
export type { DatedRules, OrderSchedule, StandingRules };

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
  /**
   * Vormerkposten the bank sent beside the Umsätze, in HIKAZ/HICAZ
   * (lib/fints-statements.ts). Undefined when the answer carried none; null
   * when it carried some the app could not read.
   */
  notedStatements?: Statement[] | null;
  /** The Daueraufträge or terminierten Überweisungen of a Bestand read (HICDB/HICSB, lib/fints-orders.ts). */
  bankOrders?: BankOrdersRead;
};

/**
 * One order of the bank's Bestand as lib/fints-orders.ts read it: what the
 * screen shows, plus the raw pieces a deletion has to send back unchanged.
 * The raw part never leaves the server (lib/session.ts keeps it).
 */
export type ReadBankOrder = {
  order: Omit<SerializedBankOrder, 'ref' | 'deletable'> & { deletable: boolean };
  raw: {
    sepaDescriptor: string;
    sepaMessage: string;
    /** The answer segment as decoded, for the delete segment's own fields. */
    fields: Record<string, unknown>;
  };
};

/** A Bestand read: the orders, and whether the bank delivered all of them. */
export type BankOrdersRead = {
  orders: ReadBankOrder[];
  /** False when the bank had more to send than this read collected (an Aufsetzpunkt left over). */
  complete: boolean;
  /** Entries the app could not read (a pain message it could not parse); they are left out, and counted. */
  unreadable: number;
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
  /**
   * Vorgemerkte can be fetched on their own (HKVMK). A bank without it may
   * still send them with the Umsätze (`pending` on a statement answer).
   */
  canPending: boolean;
  /**
   * Terminierte Überweisungen (HKCSE/HKCSB/HKCSL) and Daueraufträge
   * (HKCDE/HKCDB/HKCDL), each where the BPD declares the segment and the
   * account's UPD allows it — with the bank's rules for them. Absent or null:
   * the account offers none of it.
   */
  dated?: (OrderCaps & { rules: DatedRules }) | null;
  standing?: (OrderCaps & { rules: StandingRules }) | null;
};

/** What an account can do with one kind of bank-held order. */
export type OrderCaps = {
  /** Can be placed (HKCSE / HKCDE). */
  create: boolean;
  /** The bank's list can be read (HKCSB / HKCDB). */
  list: boolean;
  /** One can be deleted (HKCSL / HKCDL). */
  remove: boolean;
};

/** A Dauerauftrag ('standing') or a terminierte Überweisung ('dated'). */
export type BankOrderKind = 'standing' | 'dated';

/**
 * One order the bank holds for the account, as its Bestand lists it — the
 * payment as the bank keeps it in the pain.001, and when it runs.
 */
export type SerializedBankOrder = {
  /** The server's handle for this entry of the last read: what a deletion names. Opaque. */
  ref: string;
  kind: BankOrderKind;
  /** The bank's Auftragsidentifikation. */
  orderId: string | null;
  /** The payee, as the bank keeps the name. */
  name: string;
  iban: string;
  bic: string | null;
  /** Positive, in euros. */
  amount: number;
  currency: string;
  purpose: string;
  /** When it runs; null when the bank's answer did not say in a way the app could read. */
  schedule: OrderSchedule | null;
  /** Further payments in the same order (a bank may keep several in one); 0 for the usual single one. */
  more: number;
  /** Whether it can be deleted here: the account allows it and the bank did not mark it otherwise. */
  deletable: boolean;
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
  /**
   * The party behind the account holder: the "abweichender Empfänger" of a
   * payment (MT940 ABWE+, CAMT UltmtCdtr) or the "abweichender Auftraggeber"
   * of money coming in (ABWA+, UltmtDbtr). A Sparkasse Visa Debit payment
   * names its card processor as `remoteName` and the shop only here. Read it
   * through counterpartyName() in lib/categories.ts.
   */
  ultimateName?: string;
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
  /**
   * The bank answered the approval with an error. 'refused': its answer
   * refuses the operation and says nothing else (lib/bank-answer.ts) — for an
   * order, no money moved. 'unclear': an error that does not say so (a dialog
   * abort, or an execution code beside it) — an order may have gone through.
   */
  | (({ status: 'refused' } | { status: 'unclear' }) & { type: string; accountNumber?: string; bankAnswers: string })
  | { status: 'done'; kind: 'accounts'; accounts: SerializedAccount[]; deviceSaved: boolean }
  | { status: 'done'; kind: 'balance'; accountNumber?: string; balance: SerializedBalance | null }
  | { status: 'done'; kind: 'statements'; accountNumber?: string; transactions: SerializedTransaction[]; balance: SerializedBalance | null; blocks?: StatementBlock[]; pending?: SerializedTransaction[] | null }
  | { status: 'done'; kind: 'pending'; accountNumber?: string; pending: SerializedTransaction[] }
  | { status: 'done'; kind: 'transfer'; accountNumber?: string; transferResult: TransferResult | null; bankAnswers: string }
  | ({ status: 'done'; kind: 'bankOrders'; accountNumber?: string } & BankOrdersAnswer)
  | { status: 'done'; kind: 'orderDeleted'; accountNumber?: string; bankAnswers: string };

/** The bank's list of one kind of orders for an account (lib/fints-orders.ts). */
export type BankOrdersAnswer = {
  orderKind: BankOrderKind;
  orders: SerializedBankOrder[];
  /** False when the bank had more to send than the read collected: the list is incomplete. */
  complete: boolean;
  /** Orders the bank listed that the app could not read; left out of `orders`. */
  unreadable: number;
};

export type BankOrdersResponse =
  | TanRequired
  | ({ needsTan: false; accountNumber: string } & BankOrdersAnswer);

/** /api/bank-orders/delete: as a transfer's answer — refused, unclear, or done. */
export type DeleteOrderResponse =
  | TanRequired
  | { outcome: 'refused' | 'unclear'; accountNumber: string; bankAnswers: string }
  | { needsTan: false; accountNumber: string; bankAnswers: string };

export type TransactionsResponse =
  | TanRequired
  | {
      needsTan: false;
      accountNumber: string;
      transactions: SerializedTransaction[];
      balance: SerializedBalance | null;
      blocks?: StatementBlock[];
      /**
       * Vorgemerkte the bank sent with these Umsätze; absent when it sent
       * none, null when it sent some the server could not read. Never part
       * of `transactions`, `balance` or `blocks`.
       */
      pending?: SerializedTransaction[] | null;
    };

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
  /** The bank answered the order with an error — refused, or unclear as in TanPollResponse. */
  | { outcome: 'refused' | 'unclear'; accountNumber: string; bankAnswers: string }
  | { needsTan: false; accountNumber: string; transferResult: TransferResult | null; bankAnswers: string; vop?: SerializedVop };

export type MetaResponse = {
  productRegistered: boolean;
  bankCount: number;
  /** Whether this build offers company logos via Brandfetch. Whether the user agreed is theirs to say (logoConsent). */
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
