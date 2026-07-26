// SEPA credit transfer support for lib-fints.
//
// lib-fints (1.4.8) implements read-only business transactions; the transfer
// segments are added here through the library's own extension points:
//
//   HKCCS v1 — SEPA Einzelüberweisung      (single credit transfer)
//   HKIPZ v1 — SEPA Echtzeitüberweisung    (instant credit transfer)
//
// Both segments have the identical wire format (verified against the official
// FinTS 3.0 segment catalogue as shipped in hbci4java's hbci-300.xml):
//   Kontoverbindung international + SEPA descriptor + pain.001 XML (binary).
// The instant nature is expressed solely by the segment code — the pain.001
// payload is the same as for a normal transfer.
//
// The bank decides via BPD/UPD whether an account may use HKCCS/HKIPZ, and the
// dialog layer automatically attaches the HKTAN handshake because HIPINS marks
// both transactions as TAN-required. Registering the definitions requires the
// (patched) export of registerSegmentDefinition — see patches/.
//
// Where the bank runs a Namensabgleich (Verification of Payee) the order also
// carries HKVPP or HKVPA in the same message; that half lives in fints-vop.ts.

import type { FinTSConfig, Message, Segment } from 'lib-fints';
import {
  SegmentDefinition,
  AlphaNumeric,
  Binary,
  DataGroup,
  Numeric,
  InternationalAccountGroup,
  CustomerOrderInteraction,
  registerSegmentDefinition,
} from './fints-internals.js';
import type { ClientResponseWithResult, TransferResult } from './fints-types';
import {
  VopCollector, isVopRequired, queueVopPoll, reportDelivery, vopAuthSegment, vopCheckSegment,
} from './fints-vop';

class HKCCS extends SegmentDefinition {
  static Id = 'HKCCS';
  constructor() { super(HKCCS.Id); }
  version = 1;
  elements = [
    new InternationalAccountGroup('account', 1, 1),
    new AlphaNumeric('sepaDescriptor', 1, 1, 256),
    new Binary('sepaMessage', 1, 1),
  ];
}

class HKIPZ extends SegmentDefinition {
  static Id = 'HKIPZ';
  constructor() { super(HKIPZ.Id); }
  version = 1;
  elements = [
    new InternationalAccountGroup('account', 1, 1),
    new AlphaNumeric('sepaDescriptor', 1, 1, 256),
    new Binary('sepaMessage', 1, 1),
  ];
}

/**
 * HIIPZS (BPD) — the Echtzeitüberweisung parameters. Only registered so that
 * `supportedFormats` becomes readable; lib-fints ignores parameter segments it
 * has no definition for, which left pickSepaDescriptor guessing for HKIPZ.
 * Elements are optional throughout: this is decoded during dialog
 * initialisation, where a decoder throw would cost the whole login.
 */
class HIIPZS extends SegmentDefinition {
  static Id = 'HIIPZS';
  constructor() { super(HIIPZS.Id); }
  version = 1;
  elements = [
    new Numeric('maxTrans', 0, 1, 3),
    new Numeric('minSigs', 0, 1, 1),
    new Numeric('secClass', 0, 1, 1),
    new DataGroup('params', [
      new AlphaNumeric('purposeCodes', 0, 1, 4096),
      new AlphaNumeric('supportedFormats', 0, 9, 256),
    ], 0, 1),
  ];
}

registerSegmentDefinition(new HKCCS());
registerSegmentDefinition(new HKIPZ());
registerSegmentDefinition(new HIIPZS());

export const TRANSFER_SEG = HKCCS.Id;
export const INSTANT_SEG = HKIPZ.Id;

// ---------------------------------------------------------------------------
// SEPA character set + helpers
// ---------------------------------------------------------------------------
const TRANSLIT: Record<string, string> = {
  'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'Ä': 'Ae', 'Ö': 'Oe', 'Ü': 'Ue', 'ß': 'ss',
  'à': 'a', 'á': 'a', 'â': 'a', 'ã': 'a', 'å': 'a', 'ç': 'c', 'è': 'e', 'é': 'e',
  'ê': 'e', 'ë': 'e', 'ì': 'i', 'í': 'i', 'î': 'i', 'ï': 'i', 'ñ': 'n', 'ò': 'o',
  'ó': 'o', 'ô': 'o', 'õ': 'o', 'ù': 'u', 'ú': 'u', 'û': 'u', 'ý': 'y',
  'À': 'A', 'Á': 'A', 'Â': 'A', 'Ã': 'A', 'Å': 'A', 'Ç': 'C', 'È': 'E', 'É': 'E',
  'Ê': 'E', 'Ë': 'E', 'Ì': 'I', 'Í': 'I', 'Î': 'I', 'Ï': 'I', 'Ñ': 'N', 'Ò': 'O',
  'Ó': 'O', 'Ô': 'O', 'Õ': 'O', 'Ù': 'U', 'Ú': 'U', 'Û': 'U', 'Ý': 'Y',
  '&': '+', '€': 'EUR', '@': '(at)', '*': '.', '_': '-', '"': "'",
};

// Reduce any text to the SEPA/EPC allowed character set (pure ASCII), so the
// pain.001 byte length always equals its JS string length regardless of the
// transport encoding.
export function sepaSanitize(text: unknown, maxLength?: number): string {
  let out = '';
  for (const ch of String(text ?? '')) {
    if (/[A-Za-z0-9\/\-?:().,'+ ]/.test(ch)) out += ch;
    else if (TRANSLIT[ch] !== undefined) out += TRANSLIT[ch];
    else out += ' ';
  }
  out = out.replace(/\s+/g, ' ').trim();
  return maxLength ? out.slice(0, maxLength) : out;
}

export function validateIban(input: unknown): string | null {
  const iban = String(input || '').replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(iban)) return null;
  if (iban.startsWith('DE') && iban.length !== 22) return null;
  // ISO 13616 mod-97 check
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const v = ch >= '0' && ch <= '9' ? ch : (ch.charCodeAt(0) - 55).toString();
    for (const d of v) remainder = (remainder * 10 + (d.charCodeAt(0) - 48)) % 97;
  }
  return remainder === 1 ? iban : null;
}

/** '' when empty (BIC is optional), the BIC when valid, null when malformed. */
export function validateBic(input: unknown): string | null {
  const bic = String(input || '').replace(/\s+/g, '').toUpperCase();
  if (!bic) return '';
  return /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic) ? bic : null;
}

// Accepts "12,34", "12.34", "1.234,56", "1,234.56" → integer cents (or null).
export function parseAmount(input: unknown): number | null {
  let s = String(input ?? '').trim().replace(/\s|€/g, '');
  if (!s) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > lastDot) {
    s = s.replace(/\./g, '').replace(',', '.'); // German: 1.234,56
  } else if (lastDot > lastComma) {
    s = s.replace(/,/g, ''); // English: 1,234.56
  }
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const cents = Math.round(parseFloat(s) * 100);
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 99999999999) return null;
  return cents;
}

const centsToDecimal = (cents: number) => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;

// ---------------------------------------------------------------------------
// pain.001 builder
// ---------------------------------------------------------------------------
const xmlEscape = (s: string) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c] as string));

const DEFAULT_DESCRIPTOR = 'urn:iso:std:iso:20022:tech:xsd:pain.001.001.03';

// The pain.001 flavours this builder can produce, most widely accepted first.
const SUPPORTED_PAIN = ['pain.001.001.03', 'pain.001.003.03', 'pain.001.001.09'];

/**
 * Pick a SEPA descriptor the bank actually accepts for this order.
 *
 * Two lists can carry them and they are not interchangeable: HKIPZ
 * (Echtzeitüberweisung) has its own list in HIIPZS, while HKCCS has none of its
 * own — HICCSS carries no format list at all — so it falls back to the bank-wide
 * one in HISPAS. Offering a descriptor from the wrong list is what a bank
 * answers with 3999 "Pain Nachricht nicht zugelassen".
 */
export function pickSepaDescriptor(config: FinTSConfig, segId: string = TRANSFER_SEG): string {
  const instantFormats = segId === INSTANT_SEG
    ? config.getTransactionParameters<{ supportedFormats?: string[] }>(INSTANT_SEG)?.supportedFormats
    : undefined;
  const sepaFormats = config
    .getTransactionParameters<{ supportedSepaFormats?: string[] }>('HKSPA')?.supportedSepaFormats;

  for (const formats of [instantFormats, sepaFormats]) {
    const known = (formats || []).filter(Boolean) as string[];
    if (!known.length) continue;
    for (const wanted of SUPPORTED_PAIN) {
      const hit = known.find((f) => f.includes(wanted));
      if (hit) return hit;
    }
    // The bank advertises formats but none we can build — say so rather than
    // silently sending a descriptor that will be rejected.
    console.warn(`[sepa] ${segId}: bank offers ${known.join(', ')} — none supported, falling back`);
  }
  return DEFAULT_DESCRIPTOR;
}

/** `urn:…:pain.001.001.03` → `001.001.03`. */
function painVersionOf(descriptor: string): string {
  const m = /pain\.(001\.\d{3}\.\d{2})/.exec(descriptor);
  return m ? m[1] : '001.001.03';
}

export type Pain001Input = {
  descriptor: string;
  debtorName: string;
  debtorIban: string;
  debtorBic?: string;
  creditorName: string;
  creditorIban: string;
  creditorBic?: string;
  amountCents: number;
  purpose?: string;
  endToEndId?: string;
};

/**
 * Builds a single-transaction pain.001 credit transfer document.
 * All text inputs must already be SEPA-sanitized (pure ASCII).
 */
export function buildPain001({ descriptor, debtorName, debtorIban, debtorBic, creditorName, creditorIban, creditorBic, amountCents, purpose, endToEndId }: Pain001Input): string {
  const painVersion = painVersionOf(descriptor);
  // For pain messages the FinTS descriptor *is* the XML target namespace, so it
  // is used verbatim; only a non-urn descriptor (an old `sepade.…xsd` style
  // name) needs the namespace rebuilt from the version.
  const ns = descriptor.startsWith('urn:')
    ? descriptor
    : `urn:iso:std:iso:20022:tech:xsd:pain.${painVersion}`;
  const isV09 = painVersion === '001.001.09';
  const bicTag = isV09 ? 'BICFI' : 'BIC';

  const now = new Date();
  const stamp = now.toISOString().slice(0, 19);
  const msgId = `MSG${now.getTime()}${Math.floor(Math.random() * 900 + 100)}`;
  const amount = centsToDecimal(amountCents);
  const e2e = endToEndId ? sepaSanitize(endToEndId, 35) : 'NOTPROVIDED';

  // FinTS/DK convention: 1999-01-01 = execute immediately
  const executionDate = isV09
    ? '<ReqdExctnDt><Dt>1999-01-01</Dt></ReqdExctnDt>'
    : '<ReqdExctnDt>1999-01-01</ReqdExctnDt>';

  const debtorAgent = debtorBic
    ? `<DbtrAgt><FinInstnId><${bicTag}>${xmlEscape(debtorBic)}</${bicTag}></FinInstnId></DbtrAgt>`
    : `<DbtrAgt><FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId></DbtrAgt>`;
  const creditorAgent = creditorBic
    ? `<CdtrAgt><FinInstnId><${bicTag}>${xmlEscape(creditorBic)}</${bicTag}></FinInstnId></CdtrAgt>`
    : '';
  const remittance = purpose ? `<RmtInf><Ustrd>${xmlEscape(purpose)}</Ustrd></RmtInf>` : '';

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Document xmlns="${ns}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="${ns} pain.${painVersion}.xsd">` +
    `<CstmrCdtTrfInitn>` +
    `<GrpHdr>` +
    `<MsgId>${msgId}</MsgId>` +
    `<CreDtTm>${stamp}</CreDtTm>` +
    `<NbOfTxs>1</NbOfTxs>` +
    `<CtrlSum>${amount}</CtrlSum>` +
    `<InitgPty><Nm>${xmlEscape(debtorName)}</Nm></InitgPty>` +
    `</GrpHdr>` +
    `<PmtInf>` +
    `<PmtInfId>${msgId}P1</PmtInfId>` +
    `<PmtMtd>TRF</PmtMtd>` +
    `<BtchBookg>false</BtchBookg>` +
    `<NbOfTxs>1</NbOfTxs>` +
    `<CtrlSum>${amount}</CtrlSum>` +
    `<PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl></PmtTpInf>` +
    executionDate +
    `<Dbtr><Nm>${xmlEscape(debtorName)}</Nm></Dbtr>` +
    `<DbtrAcct><Id><IBAN>${xmlEscape(debtorIban)}</IBAN></Id></DbtrAcct>` +
    debtorAgent +
    `<ChrgBr>SLEV</ChrgBr>` +
    `<CdtTrfTxInf>` +
    `<PmtId><EndToEndId>${xmlEscape(e2e)}</EndToEndId></PmtId>` +
    `<Amt><InstdAmt Ccy="EUR">${amount}</InstdAmt></Amt>` +
    creditorAgent +
    `<Cdtr><Nm>${xmlEscape(creditorName)}</Nm></Cdtr>` +
    `<CdtrAcct><Id><IBAN>${xmlEscape(creditorIban)}</IBAN></Id></CdtrAcct>` +
    remittance +
    `</CdtTrfTxInf>` +
    `</PmtInf>` +
    `</CstmrCdtTrfInitn>` +
    `</Document>`
  );
}

/**
 * Segment ids of a bank response, marking the ones lib-fints could not parse
 * with `(?)` — those arrive as "unknown" segments and carry only raw data, so
 * this is the quickest way to see a segment definition that doesn't fit.
 */
function describeSegments(response: Message): string {
  return response.segments
    .map((seg) => {
      const original = (seg as { originalId?: string }).originalId;
      return original ? `${original}(?)` : seg.header.segId;
    })
    .join(', ');
}

export type TransferOrder = {
  creditorName: string;
  creditorIban: string;
  creditorBic?: string;
  amountCents: number;
  purpose?: string;
  debtorBic?: string;
};

// ---------------------------------------------------------------------------
// The customer interaction driving HKCCS / HKIPZ
// ---------------------------------------------------------------------------
/**
 * How the Namensabgleich rides along with this order (see fints-vop.ts):
 *   'auto'     — attach HKVPP when the bank checks this transaction
 *   { vopId }  — the re-submission: same pain, now confirmed with HKVPA
 */
export type VopMode = 'auto' | { vopId: string };

export class SepaTransferInteraction extends CustomerOrderInteraction {
  accountNumber: string;
  transfer: TransferOrder;
  instant: boolean;
  vopMode: VopMode;

  /**
   * The exact SEPA descriptor and pain.001 that went to the bank. A VoP
   * re-submission must repeat the original message byte for byte (the bank
   * answers 9010 "Auftrag weicht vom Ursprungsauftrag ab" otherwise), and the
   * builder stamps a fresh message id and timestamp on every call — so the
   * result is captured here and replayed rather than rebuilt.
   */
  sepaDescriptor: string | null = null;
  sepaMessage: string | null = null;

  /**
   * The Namensabgleich result, gathered across however many messages the bank
   * takes to deliver it. Read this rather than the ClientResponse: when the bank
   * uses the Aufsetzpunkt mechanism the VOP-ID only arrives in a later message,
   * whose response is not the one `startCustomerOrderInteraction` hands back.
   */
  vop: VopCollector | null = null;

  /**
   * @param accountNumber debtor account (must exist in the UPD)
   * @param transfer the order to send
   * @param instant  true → HKIPZ (Echtzeitüberweisung), false → HKCCS
   * @param vopMode  how to handle the Namensabgleich
   * @param prebuilt the pain.001 to replay, when re-submitting for a HKVPA
   */
  constructor(
    accountNumber: string,
    transfer: TransferOrder,
    instant: boolean,
    vopMode: VopMode = 'auto',
    prebuilt?: { descriptor: string; sepaMessage: string },
  ) {
    super(instant ? HKIPZ.Id : HKCCS.Id, instant ? 'HIIPZ' : 'HICCS');
    this.accountNumber = accountNumber;
    this.transfer = transfer;
    this.instant = instant;
    this.vopMode = vopMode;
    if (prebuilt) {
      this.sepaDescriptor = prebuilt.descriptor;
      this.sepaMessage = prebuilt.sepaMessage;
    }
  }

  createSegments(config: FinTSConfig): Segment[] {
    const account = config.getBankAccount(this.accountNumber);
    if (!config.isAccountTransactionSupported(this.accountNumber, this.segId)) {
      throw Error(`Account ${this.accountNumber} does not support business transaction '${this.segId}'`);
    }
    if (!account.iban) {
      throw Error(`Account ${this.accountNumber} has no IBAN in the UPD — cannot build a SEPA transfer`);
    }
    const version = config.getMaxSupportedTransactionVersion(this.segId) ?? 1;

    if (!this.sepaMessage || !this.sepaDescriptor) {
      const descriptor = pickSepaDescriptor(config, this.segId);
      const debtorName = sepaSanitize([account.holder1, account.holder2].filter(Boolean).join(' '), 70) || 'Auftraggeber';
      this.sepaDescriptor = descriptor;
      this.sepaMessage = buildPain001({
        descriptor,
        debtorName,
        debtorIban: account.iban,
        debtorBic: this.transfer.debtorBic || undefined,
        creditorName: this.transfer.creditorName,
        creditorIban: this.transfer.creditorIban,
        creditorBic: this.transfer.creditorBic || undefined,
        amountCents: this.transfer.amountCents,
        purpose: this.transfer.purpose,
      });
      console.log(`[sepa] ${this.segId} v${version} descriptor=${descriptor}`);
    }

    const segments: Segment[] = [
      {
        header: { segId: this.segId, segNr: 0, version },
        account: { ...account, bic: this.transfer.debtorBic || undefined },
        sepaDescriptor: this.sepaDescriptor,
        sepaMessage: this.sepaMessage,
      } as Segment,
    ];

    // The Namensabgleich segment travels in the same message as the order.
    if (typeof this.vopMode === 'object') {
      segments.push(vopAuthSegment(config, this.vopMode.vopId));
    } else if (this.vopMode === 'auto' && isVopRequired(config, this.segId)) {
      this.vop = new VopCollector(this.transfer.creditorName, reportDelivery(config));
      segments.push(vopCheckSegment(config));
    }
    return segments;
  }

  /**
   * The Namensabgleich result arrives *with* the TAN challenge, and lib-fints
   * only calls handleResponse once a request has come through without one — so
   * HIVPP is read here, where every response passes. A bank that has more to
   * send gets another bare check request queued behind this one.
   */
  handleClientResponse(response: Message): ClientResponseWithResult {
    const clientResponse = super.handleClientResponse(response) as ClientResponseWithResult;
    if (this.vop) {
      // Segment ids only — enough to tell a HIVPP that was parsed from one that
      // fell through as an unknown segment, without logging any of its content.
      console.log(`[vop] response segments: ${describeSegments(response)}`);
      this.vop.absorb(response);
      queueVopPoll(this, response, this.vop);
    }
    return clientResponse;
  }

  handleResponse(response: Message, clientResponse: ClientResponseWithResult): void {
    // HICCS carries no payload; HIIPZ (instant) optionally reports
    // orderId + status. Both arrive as "unknown" segments — parse manually.
    const seg = response.findAllUnknownSegments(this.responseSegId)[0];
    if (seg && typeof seg.rawData === 'string') {
      const [orderId, cancellationCode, orderStatus] = seg.rawData.split('+');
      const result: TransferResult = {
        orderId: orderId || null,
        cancellationCode: cancellationCode || null,
        orderStatus: orderStatus || null,
      };
      clientResponse.transferResult = result;
    }
  }
}
