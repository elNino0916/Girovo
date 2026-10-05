// Vorgemerkte Umsätze (pending / not-yet-booked entries) via HKVMK.
//
// FinTS 3.0 defines HKVMK ("Vormerkposten"): the bank answers with HIVMK, whose
// payload is an MT942 *interim transaction report* — entries that have hit the
// account but are not yet booked. An incoming SEPA-Lastschrift shows up here
// before it posts, so this is the closest thing to "upcoming direct debits".
//
// lib-fints doesn't implement HKVMK, so — like the transfer segments — we
// register it through the library's own extension points. MT942 reuses the
// MT940 :61:/:86: entry format (it only adds :34F: floor limits and :90D:/:90C:
// summary tags, which the MT940 parser safely skips as unknown tags), so we can
// reuse lib-fints' Mt940Parser (through lib/noted.ts, which evens out the
// framing it trips over). Verified against the official segment catalogue
// (hbci4java hbci-300.xml): HKVMK v1 uses the national account group
// (KTV3 = number + subnumber + bank), no IBAN.
//
// Not every bank offers HKVMK — Sparkassen do not, and send their
// Vormerkposten with the Umsätze instead (lib/fints-statements.ts).

import type { FinTSConfig, Message, Segment } from 'lib-fints';
import {
  SegmentDefinition,
  AccountGroup,
  YesNo,
  Numeric,
  AlphaNumeric,
  Binary,
  CustomerOrderInteraction,
  registerSegmentDefinition,
} from './fints-internals.js';
import type { ClientResponseWithResult } from './fints-types';
import { parseMt942 } from './noted.ts';

class HKVMK extends SegmentDefinition {
  static Id = 'HKVMK';
  constructor() { super(HKVMK.Id); }
  version = 1;
  elements = [
    new AccountGroup('account', 1, 1),
    new YesNo('allAccounts', 1, 1),
    new Numeric('maxEntries', 0, 1, 4),
    // Aufsetzpunkt — presence of a continuationMark element also enables
    // lib-fints' parted-response reassembly for large pending lists.
    new AlphaNumeric('continuationMark', 0, 1, 35),
  ];
}

class HIVMK extends SegmentDefinition {
  static Id = 'HIVMK';
  constructor() { super(HIVMK.Id); }
  version = 1;
  elements = [
    new Binary('mt942', 1, 1, Number.MAX_SAFE_INTEGER),
  ];
}

registerSegmentDefinition(new HKVMK());
registerSegmentDefinition(new HIVMK());

export const PENDING_SEG = HKVMK.Id;

export class PendingInteraction extends CustomerOrderInteraction {
  accountNumber: string;

  constructor(accountNumber: string) {
    super(HKVMK.Id, HIVMK.Id);
    this.accountNumber = accountNumber;
  }

  createSegments(config: FinTSConfig): Segment[] {
    const bankAccount = config.getBankAccount(this.accountNumber);
    if (!config.isAccountTransactionSupported(this.accountNumber, HKVMK.Id)) {
      throw Error(`Account ${this.accountNumber} does not support business transaction '${HKVMK.Id}'`);
    }
    const version = config.getMaxSupportedTransactionVersion(HKVMK.Id) ?? 1;
    const account = { ...bankAccount, iban: undefined, bic: undefined }; // v1 is national
    return [
      { header: { segId: HKVMK.Id, segNr: 0, version }, account, allAccounts: false } as Segment,
    ];
  }

  handleResponse(response: Message, clientResponse: ClientResponseWithResult): void {
    // A long list spread over several messages arrives as several HIVMK.
    const mt942 = response.findAllSegments<Segment & { mt942?: string }>(HIVMK.Id).map((seg) => seg.mt942 || '');
    try {
      clientResponse.pendingStatements = parseMt942(mt942);
    } catch (err) {
      console.warn('MT942 parsing failed:', (err as Error)?.message || err);
      clientResponse.pendingStatements = [];
    }
  }
}
